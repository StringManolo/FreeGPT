"use strict";

const { ProviderAdapter } = require("./base");

class OpenRouterAdapter extends ProviderAdapter {
  constructor(name, config) {
    super(name, config);
    if (!config.api_key) {
      throw new Error(`OpenRouter provider "${name}" needs an api_key.`);
    }
    this.baseUrl = (config.base_url || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  }

  async chatCompletion({ model, messages, options = {} }) {
    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.api_key}`,
        "HTTP-Referer": "https://github.com/stringmanolo/freegpt",
        "X-Title": "FreeGPT"
      },
      body: JSON.stringify({ model, messages, ...options })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = new Error(
        `OpenRouter ${response.status} ${response.statusText}: ${text.slice(0, 300)}`
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

module.exports = { OpenRouterAdapter };
