"use strict";

const { CooldownTracker } = require("./cooldown");
const { KeyPool } = require("./key-pool");
const { loadUsage, saveUsage } = require("./usage-store");
const { collectKeys } = require("../providers");

function cleanProviderError(msg) {
  if (!msg) return msg;
  return msg
    .replace(/\s*Need more tokens\??\s*Upgrade to Dev Tier today at \S+/gi, "")
    .replace(/\s*Upgrade to Dev Tier today at \S+/gi, "")
    .replace(/\s*For more on scraping[^.]*\./gi, "")
    .trim();
}

function isContextError(record) {
  if (!record || record.status !== "failed") return false;
  if (record.errorStatus === 413) return true;
  const msg = (record.error || "").toLowerCase();
  return (
    msg.includes("payload too large") ||
    msg.includes("context length") ||
    msg.includes("too many tokens") ||
    msg.includes("maximum context") ||
    msg.includes("request too large") ||
    msg.includes("exceeds the maximum") ||
    msg.includes("too long")
  );
}

function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages || []) chars += (m.content || "").length;
  return Math.ceil(chars / 4);
}

function parseRetryAfterMs(msg) {
  if (!msg) return 0;
  const m = msg.match(/try again in ([\d.]+)\s*s/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : 0;
}

class Router {
  constructor(config, providers) {
    this.config = config;
    this.providers = providers;
    this.cooldown = new CooldownTracker(
      config.settings?.cooldown_after_failure_ms ?? 60_000
    );
    this.timeoutMs = config.settings?.request_timeout_ms ?? 30_000;

    const persisted = loadUsage();
    this.pools = new Map();

    for (const [name, providerConfig] of Object.entries(config.providers || {})) {
      if (!providers.has(name)) continue;
      const keys = collectKeys(providerConfig);
      if (keys.length === 0) continue;

      const pool = new KeyPool(
        name,
        keys,
        providerConfig.limits || {},
        providerConfig.key_strategy || "sequential",
        persisted[name] || {}
      );
      this.pools.set(name, pool);
    }
  }

  persist() {
    const out = {};
    for (const [name, pool] of this.pools.entries()) {
      out[name] = pool.toPersisted();
    }
    saveUsage(out);
  }

  resolveChain(logicalModel) {
    const groups = this.config.routing?.model_groups || {};
    const group = groups[logicalModel];
    if (group) {
      return [...group].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
    }
    if (logicalModel.includes(":")) {
      const [provider, model] = logicalModel.split(":", 2);
      return [{ provider, model, priority: 1 }];
    }
    const chain = [];
    for (const [name, adapter] of this.providers.entries()) {
      const models = adapter.config.models || [];
      if (models.includes(logicalModel)) {
        chain.push({ provider: name, model: logicalModel, priority: 1 });
      }
    }
    return chain;
  }

  async chatCompletion({ model: logicalModel, messages, options = {} }) {
    const fullChain = this.resolveChain(logicalModel);
    if (fullChain.length === 0) {
      const err = new Error(`No providers configured for model "${logicalModel}".`);
      err.code = "NO_CHAIN";
      throw err;
    }

    const chain = fullChain.filter((step) => this.providers.has(step.provider));
    if (chain.length === 0) {
      const skipped = fullChain.map((s) => s.provider);
      const err = new Error(
        `All providers for "${logicalModel}" were skipped at startup (${skipped.join(", ")}).`
      );
      err.code = "NO_PROVIDERS";
      err.skipped = skipped;
      throw err;
    }

    const startTime = Date.now();
    const attempts = [];
    const errors = [];
    const estimated = estimateTokens(messages);

    for (const step of chain) {
      const adapter = this.providers.get(step.provider);
      const pool = this.pools.get(step.provider);
      if (!adapter || !pool) continue;

      if (this.cooldown.isCoolingDown(step.provider)) {
        errors.push(`${step.provider}: provider cooling down`);
        continue;
      }

      const triedKeys = new Set();
      let keyErrors = 0;
      let nonKeyErrors = 0;

      while (true) {
        const acquired = pool.acquire(step.model, estimated, triedKeys);
        if (!acquired) break;
        const { entry } = acquired;
        triedKeys.add(entry.id);

        const attemptStart = Date.now();
        const record = {
          provider: step.provider,
          key: entry.id,
          model: step.model,
          attempt: attempts.length + 1,
          status: "trying",
          startedAt: attemptStart
        };
        attempts.push(record);

        try {
          const result = await this.withTimeout(
            adapter.chatCompletion({
              model: step.model,
              messages,
              options,
              apiKey: entry.secret
            }),
            this.timeoutMs
          );

          const tokensUsed =
            result.usage?.total_tokens ||
            result.usageMetadata?.totalTokenCount ||
            0;
          pool.recordSuccess(entry, step.model, tokensUsed);
          record.status = "ok";
          record.durationMs = Date.now() - attemptStart;
          this.cooldown.recordSuccess(step.provider);
          this.persist();

          return {
            completion: result,
            meta: {
              logicalModel,
              provider: step.provider,
              key: entry.id,
              model: step.model,
              attempts,
              totalMs: Date.now() - startTime
            }
          };
        } catch (err) {
          record.status = "failed";
          record.error = cleanProviderError(err.message);
          record.errorStatus = err.status || 0;
          record.durationMs = Date.now() - attemptStart;

          const status = err.status || 0;

          if (status === 401 || status === 403) {
            pool.recordAuthFailure(entry);
            keyErrors++;
            errors.push(`${step.provider}/${entry.id}: auth failed`);
            continue;
          }
          if (status === 429) {
            pool.recordRateLimit(entry, step.model, parseRetryAfterMs(err.message));
            keyErrors++;
            errors.push(`${step.provider}/${entry.id}: rate limited`);
            continue;
          }
          if (status === 413) {
            pool.recordNeutralFailure(entry);
            errors.push(`${step.provider}/${entry.id}: payload too large`);
            break;
          }

          pool.recordNeutralFailure(entry);
          nonKeyErrors++;
          errors.push(`${step.provider}/${entry.id}: ${record.error}`);
          continue;
        }
      }

      if (nonKeyErrors > 0 && keyErrors === 0) {
        this.cooldown.recordFailure(step.provider, 60_000);
      }
      this.persist();
    }

    if (attempts.length > 0 && attempts.every(isContextError)) {
      const err = new Error(
        "The conversation exceeds the token limit of every configured provider."
      );
      err.code = "CONTEXT_EXCEEDED";
      err.attempts = attempts;
      throw err;
    }

    const anyRateLimit = attempts.some((a) => a.errorStatus === 429);
    const allRateLimit = attempts.length > 0 && attempts.every((a) => a.errorStatus === 429);
    const anyAuth = attempts.some((a) => a.errorStatus === 401 || a.errorStatus === 403);

    let code = "ALL_FAILED";
    if (allRateLimit) code = "ALL_RATE_LIMITED";
    else if (anyRateLimit && !anyAuth) code = "SOME_RATE_LIMITED";
    else if (anyAuth) code = "AUTH_FAILED";

    const err = new Error(`All providers failed for "${logicalModel}".`);
    err.code = code;
    err.attempts = attempts;
    err.summary = errors.join("\n");
    throw err;
  }

  withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const e = new Error(`Request timed out after ${ms} ms`);
        e.code = "ETIMEDOUT";
        reject(e);
      }, ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }
}

module.exports = { Router, cleanProviderError };
