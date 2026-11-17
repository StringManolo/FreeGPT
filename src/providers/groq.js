"use strict";

const { ProviderAdapter } = require("./base");

class GroqAdapter extends ProviderAdapter {
  constructor(name, config) {
    super(name, config);
    if (!config.api_key) {
      throw new Error(`Groq provider "${name}" needs an api_key.`);
    }
    this.baseUrl = (config.base_url || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
  }

  async chatCompletion({ model, messages, options = {} }) {
    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model,
      messages,
      ...options
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.api_key}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = new Error(
        `Groq ${response.status} ${response.statusText}: ${text.slice(0, 300)}`
      );
      error.status = response.status;
      throw error;
    }

    const data = await response.json();

    // Groq already returns an OpenAI-compatible shape.
    return data;
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

module.exports = { GroqAdapter };
