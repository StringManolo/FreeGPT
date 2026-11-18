"use strict";

const { ProviderAdapter } = require("./base");

class GenericOpenAIAdapter extends ProviderAdapter {
  constructor(name, config) {
    super(name, config);
    if (!config.base_url) {
      throw new Error(`Provider "${name}" needs a base_url.`);
    }
    this.baseUrl = config.base_url.replace(/\/+$/, "");
  }

  async chatCompletion({ model, messages, options = {}, apiKey, signal }) {
    const key = apiKey || this.getDefaultKey();
    if (!key) throw new Error(`No API key available for "${this.name}".`);

    const url = `${this.baseUrl}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({ model, messages, ...options }),
      signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = new Error(
        `${this.name} ${response.status} ${response.statusText}: ${text.slice(0, 300)}`
      );
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  async healthCheck() {
    const key = this.getDefaultKey();
    if (!key) return false;
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` }
      });
      return response.ok;
    } catch (_) {
      return false;
    }
  }
}

module.exports = { GenericOpenAIAdapter };
