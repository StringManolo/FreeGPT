"use strict";

const { ProviderAdapter } = require("./base");

class GenericOpenAIAdapter extends ProviderAdapter {
  constructor(name, config) {
    super(name, config);
    if (!config.api_key) {
      throw new Error(`Provider "${name}" needs an api_key.`);
    }
    if (!config.base_url) {
      throw new Error(`Provider "${name}" needs a base_url.`);
    }
    this.baseUrl = config.base_url.replace(/\/+$/, "");
  }

  async chatCompletion({ model, messages, options = {} }) {
    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.api_key}`
      },
      body: JSON.stringify({ model, messages, ...options })
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
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.config.api_key}` }
      });
      return response.ok;
    } catch (_) {
      return false;
    }
  }
}

module.exports = { GenericOpenAIAdapter };
