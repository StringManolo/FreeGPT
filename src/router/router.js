"use strict";

const { CooldownTracker } = require("./cooldown");

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
    const chain = this.resolveChain(logicalModel);
    if (chain.length === 0) {
      throw new Error(
        `No provider configured for model "${logicalModel}". ` +
          `Check routing.model_groups in ~/.freegpt/config.yaml.`
      );
    }

    const startTime = Date.now();
    const attempts = [];
    const errors = [];

    for (const step of chain) {
      const adapter = this.providers.get(step.provider);
      if (!adapter) {
        errors.push(`${step.provider}: provider not loaded`);
        continue;
      }
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
          record.error = err.message;
          record.errorStatus = err.status || 0;
          record.durationMs = Date.now() - attemptStart;

          const status = err.status || 0;
          const isFatal = status === 401 || status === 403;
          const isRateLimit = status === 429;
          const isTimeout = err.code === "ETIMEDOUT";

          errors.push(
            `${step.provider}/${step.model} attempt ${attempt + 1}: ${err.message}`
          );

          if (isFatal) {
            this.cooldown.recordFailure(step.provider, 5 * 60_000);
            break;
          }
          if (isRateLimit || isTimeout) {
            this.cooldown.recordFailure(step.provider, 60_000);
            break;
          }
        }
      }
    }

    // Todos los intentos fallaron por tamaño → error específico
    if (attempts.length > 0 && attempts.every(isContextError)) {
      const err = new Error(
        "The conversation exceeds the context or token limits of all configured providers."
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

    const summary = errors.map((e) => `  - ${e}`).join("\n");
    throw new Error(`All providers failed for "${logicalModel}":\n${summary}`);
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

module.exports = { Router };
