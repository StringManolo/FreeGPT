"use strict";

const { GroqAdapter } = require("./groq");
const { OpenRouterAdapter } = require("./openrouter");
const { GeminiAdapter } = require("./gemini");
const { GenericOpenAIAdapter } = require("./generic-openai");

const ADAPTER_REGISTRY = {
  openai_compatible: null,
  gemini_native: GeminiAdapter
};

function buildProviders(config) {
  const providers = new Map();

  for (const [name, providerConfig] of Object.entries(config.providers || {})) {
    if (providerConfig.enabled === false) continue;

    let AdapterClass = ADAPTER_REGISTRY[providerConfig.type];

    if (providerConfig.type === "openai_compatible") {
      AdapterClass = pickOpenAICompatibleAdapter(name, providerConfig);
    }

    if (!AdapterClass) {
      console.warn(`Skipping provider "${name}": unknown type "${providerConfig.type}".`);
      continue;
    }

    try {
      providers.set(name, new AdapterClass(name, providerConfig));
    } catch (err) {
      console.warn(`Skipping provider "${name}": ${err.message}`);
    }
  }

  return providers;
}

function pickOpenAICompatibleAdapter(name, providerConfig) {
  const base = (providerConfig.base_url || "").toLowerCase();
  if (name === "groq" || base.includes("groq.com")) return GroqAdapter;
  if (name === "openrouter" || base.includes("openrouter.ai")) return OpenRouterAdapter;
  // Cualquier otra API compatible con OpenAI usa el adaptador genérico,
  // respetando su propia base_url y api_key.
  return GenericOpenAIAdapter;
}

module.exports = { buildProviders };
