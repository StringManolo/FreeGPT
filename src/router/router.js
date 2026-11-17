"use strict";

const { CooldownTracker } = require("./cooldown");

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
    msg.includes("context_length") ||
    msg.includes("too many tokens") ||
    msg.includes("maximum context") ||
    msg.includes("request too large") ||
    msg.includes("exceeds the maximum") ||
    msg.includes("too long")
  );
}

function parseRetryAfterMs(msg) {
  if (!msg) return 0;
  const m = msg.match(/try again in ([\d.]+)\s*s/i);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000);
  return 0;
}

class Router {
  constructor(config, providers) {
    this.config = config;
    this.providers = providers;
    this.cooldown = new CooldownTracker(
      config.settings?.cooldown_after_failure_ms ?? 60_000
    );
    this.retriesPerProvider = config.settings?.retries_per_provider ?? 1;
    this.timeoutMs = config.settings?.request_timeout_ms ?? 30_000;
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

    for (const step of chain) {
      const adapter = this.providers.get(step.provider);
      if (!adapter) continue;

      if (this.cooldown.isCoolingDown(step.provider)) {
        const ms = this.cooldown.remainingMs(step.provider);
        errors.push(`${step.provider}: cooling down for ${ms} ms`);
        continue;
      }

      for (let attempt = 0; attempt <= this.retriesPerProvider; attempt++) {
        const attemptStart = Date.now();
        const record = {
          provider: step.provider,
          model: step.model,
          attempt: attempt + 1,
          status: "trying",
          startedAt: attemptStart
        };
        attempts.push(record);

        try {
          const result = await this.withTimeout(
            adapter.chatCompletion({ model: step.model, messages, options }),
            this.timeoutMs
          );
          record.status = "ok";
          record.durationMs = Date.now() - attemptStart;
          this.cooldown.recordSuccess(step.provider);
          return {
            completion: result,
            meta: {
              logicalModel,
              provider: step.provider,
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
          const isFatal = status === 401 || status === 403;
          const isRateLimit = status === 429;
          const isTimeout = err.code === "ETIMEDOUT";

          errors.push(
            `${step.provider}/${step.model} attempt ${attempt + 1}: ${record.error}`
          );

          if (isFatal) {
            this.cooldown.recordFailure(step.provider, 5 * 60_000);
            break;
          }
          if (isRateLimit) {
            const retryMs = parseRetryAfterMs(err.message);
            this.cooldown.recordFailure(step.provider, retryMs || 60_000);
            break;
          }
          if (isTimeout) {
            this.cooldown.recordFailure(step.provider, 60_000);
            break;
          }
        }
      }
    }

    if (attempts.length > 0 && attempts.every(isContextError)) {
      const err = new Error(
        "The conversation exceeds the token limit of every configured provider."
      );
      err.code = "CONTEXT_EXCEEDED";
      err.attempts = attempts.map((a) => ({
        provider: a.provider,
        model: a.model,
        attempt: a.attempt,
        error: a.error,
        errorStatus: a.errorStatus
      }));
      throw err;
    }

    const anyRateLimit = attempts.some((a) => a.errorStatus === 429);
    const anyAuth = attempts.some(
      (a) => a.errorStatus === 401 || a.errorStatus === 403
    );
    const allRateLimit =
      attempts.length > 0 && attempts.every((a) => a.errorStatus === 429);

    let code = "ALL_FAILED";
    if (allRateLimit) code = "ALL_RATE_LIMITED";
    else if (anyRateLimit && !anyAuth) code = "SOME_RATE_LIMITED";
    else if (anyAuth) code = "AUTH_FAILED";

    const err = new Error(`All providers failed for "${logicalModel}".`);
    err.code = code;
    err.attempts = attempts.map((a) => ({
      provider: a.provider,
      model: a.model,
      attempt: a.attempt,
      error: a.error,
      errorStatus: a.errorStatus,
      durationMs: a.durationMs
    }));
    err.summary = errors.join("\n");
    throw err;
  }

  withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(`Request timed out after ${ms} ms`);
        err.code = "ETIMEDOUT";
        reject(err);
      }, ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }
}

module.exports = { Router, cleanProviderError };
