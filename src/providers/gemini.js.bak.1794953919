"use strict";

const { ProviderAdapter } = require("./base");

function toGeminiRequest(messages) {
  const contents = [];
  let systemInstruction = null;
  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = { parts: [{ text: typeof msg.content === "string" ? msg.content : "" }] };
      continue;
    }
    const role = msg.role === "assistant" ? "model" : "user";
    contents.push({ role, parts: [{ text: typeof msg.content === "string" ? msg.content : "" }] });
  }
  const body = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  return body;
}

function toOpenAIResponse(geminiResponse, model) {
  const candidate = geminiResponse.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("");
  return {
    id: geminiResponse.responseId || `gemini-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text },
      finish_reason: candidate?.finishReason?.toLowerCase() || "stop"
    }],
    usage: {
      prompt_tokens: geminiResponse.usageMetadata?.promptTokenCount || 0,
      completion_tokens: geminiResponse.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: geminiResponse.usageMetadata?.totalTokenCount || 0
    }
  };
}

class GeminiAdapter extends ProviderAdapter {
  constructor(name, config) {
    super(name, config);
    this.baseUrl = (
      config.base_url || "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, "");
  }

  async chatCompletion({ model, messages, options = {}, apiKey }) {
    const key = apiKey || this.getDefaultKey();
    if (!key) throw new Error(`No API key available for "${this.name}".`);

    const url = `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
    const generationConfig = {};
    if (options.temperature != null) generationConfig.temperature = options.temperature;
    if (options.max_tokens != null) generationConfig.maxOutputTokens = options.max_tokens;
    if (options.top_p != null) generationConfig.topP = options.top_p;

    const body = toGeminiRequest(messages);
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = new Error(
        `Gemini ${response.status} ${response.statusText}: ${text.slice(0, 300)}`
      );
      error.status = response.status;
      throw error;
    }

    return toOpenAIResponse(await response.json(), model);
  }

  async healthCheck() {
    const key = this.getDefaultKey();
    if (!key) return false;
    try {
      const response = await fetch(`${this.baseUrl}/models?key=${key}`);
      return response.ok;
    } catch (_) {
      return false;
    }
  }
}

module.exports = { GeminiAdapter };
