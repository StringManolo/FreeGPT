"use strict";

const { ProviderAdapter, parseSseStream } = require("./base");

class GroqAdapter extends ProviderAdapter {
  constructor(name, config) {
    super(name, config);
    this.baseUrl = (config.base_url || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
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
        `Groq ${response.status} ${response.statusText}: ${text.slice(0, 300)}`
      );
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    if (Array.isArray(data.choices)) {
      for (const choice of data.choices) {
        if (choice.message && "reasoning" in choice.message) {
          delete choice.message.reasoning;
        }
      }
    }
    return data;
  }

  async *chatCompletionStream({ model, messages, options = {}, apiKey, signal }) {
    const key = apiKey || this.getDefaultKey();
    if (!key) throw new Error(`No API key available for "${this.name}".`);

    const url = `${this.baseUrl}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({ model, messages, ...options, stream: true }),
      signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = new Error(
        `${"Groq"} ${response.status} ${response.statusText}: ${text.slice(0, 300)}`
      );
      error.status = response.status;
      throw error;
    }

    yield* parseSseStream(response);
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

module.exports = { GroqAdapter };
