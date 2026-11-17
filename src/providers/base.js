"use strict";

/**
 * Base class for all provider adapters.
 * Subclasses must override chatCompletion().
 */
class ProviderAdapter {
  /**
   * @param {string} name Logical provider name (e.g. "groq").
   * @param {object} config Provider entry from config.yaml.
   */
  constructor(name, config) {
    this.name = name;
    this.config = config;
  }

  /**
   * Send a chat completion request and return an OpenAI-compatible response.
   *
   * @param {object} params
   * @param {string} params.model Provider-specific model id.
   * @param {Array<{role: string, content: string}>} params.messages
   * @param {object} [params.options] Forwarded provider options (temperature, max_tokens…).
   * @returns {Promise<object>} OpenAI-shaped completion object.
   */
  async chatCompletion(_params) {
    throw new Error(`Provider "${this.name}" does not implement chatCompletion()`);
  }

  /**
   * Optional connectivity check used by `freegpt doctor`.
   * Default implementation returns true (providers may override).
   */
  async healthCheck() {
    return true;
  }
}

module.exports = { ProviderAdapter };
