"use strict";

const { CooldownTracker } = require("./cooldown");

class Router {
  /**
   * @param {object} config Parsed config.yaml
   * @param {Map<string, ProviderAdapter>} providers From buildProviders()
   */
  constructor(config, providers) {
    this.config = config;
    this.providers = providers;
    this.cooldown = new CooldownTracker(
      config.settings?.cooldown_after_failure_ms ?? 60_000
    );
    this.retriesPerProvider = config.settings?.retries_per_provider ?? 1;
    this.timeoutMs = config.settings?.request_timeout_ms ?? 30_000;
  }

  /**
   * Return the ordered (provider, model) chain for a logical model name.
   * If the name is not a logical group, treat it as "provider/model" or plain model.
   */
  resolveChain(logicalModel) {
    const groups = this.config.routing?.model_groups || {};
    const group = groups[logicalModel];

    if (group) {
      return [...group].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
    }

    // Allow "provider:model" syntax for direct routing.
    if (logicalModel.includes(":")) {
      const [provider, model] = logicalModel.split(":", 2);
      return [{ provider, model, priority: 1 }];
    }

    // Unknown logical name: try every provider that advertises it.
    const chain = [];
    for (const [name, adapter] of this.providers.entries()) {
      const models = adapter.config.models || [];
      if (models.includes(logicalModel)) {
        chain.push({ provider: name, model: logicalModel, priority: 1 });
      }
    }
    return chain;
  }

  /**
   * Route a chat completion request through the configured chain.
   * Returns the first successful OpenAI-shaped response.
   */
  async chatCompletion({ model: logicalModel, messages, options = {} }) {
    const chain = this.resolveChain(logicalModel);

    if (chain.length === 0) {
      throw new Error(
        `No provider configured for model "${logicalModel}". ` +
          `Check routing.model_groups in ~/.freegpt/config.yaml.`
      );
    }

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
        try {
          const result = await this.withTimeout(
            adapter.chatCompletion({
              model: step.model,
              messages,
              options
            }),
            this.timeoutMs
          );
          this.cooldown.recordSuccess(step.provider);
          return result;
        } catch (err) {
          const status = err.status || 0;
          const isFatal = status === 401 || status === 403;
          const isRateLimit = status === 429;
          const isTimeout = err.code === "ETIMEDOUT";

          errors.push(
            `${step.provider}/${step.model} attempt ${attempt + 1}: ${err.message}`
          );

          if (isFatal) {
            // Bad key: no point retrying; also cool it down hard.
            this.cooldown.recordFailure(step.provider, 5 * 60_000);
            break;
          }

          if (isRateLimit || isTimeout) {
            this.cooldown.recordFailure(step.provider, 60_000);
            break; // move to next provider immediately
          }

          // Otherwise retry, then move on.
        }
      }
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
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }
}

module.exports = { Router };
