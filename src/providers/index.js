"use strict";

const { GroqAdapter } = require("./groq");
const { OpenRouterAdapter } = require("./openrouter");
const { GeminiAdapter } = require("./gemini");
const { GenericOpenAIAdapter } = require("./generic-openai");

const ADAPTER_REGISTRY = {
  openai_compatible: null, // resuelto por proveedor
  gemini_native: GeminiAdapter
  // "web_puppeteer": WebPuppeteerAdapter  // futuro
};

function isPlaceholder(key) {
  return typeof key === "string" && key.startsWith("YOUR_");
}

function collectKeys(providerConfig) {
  // Soporta tanto `api_key` singular como `api_keys` array (multi-cuenta).
  const keys = [];
  if (Array.isArray(providerConfig.api_keys)) {
    keys.push(...providerConfig.api_keys);
  }
  if (providerConfig.api_key) {
    keys.push(providerConfig.api_key);
  }
  return keys.filter(Boolean);
}

function hasOnlyPlaceholders(providerConfig) {
  const keys = collectKeys(providerConfig);
  return keys.length > 0 && keys.every(isPlaceholder);
}

function buildProviders(config) {
  const providers = new Map();

  for (const [name, providerConfig] of Object.entries(config.providers || {})) {
    if (providerConfig.enabled === false) continue;

    // Descartar si todas las keys son placeholders YOUR_...
    if (hasOnlyPlaceholders(providerConfig)) {
      console.warn(
        `Skipping provider "${name}": placeholder API key(s). ` +
          `Set a real key with: freegpt key ${name} <key>`
      );
      continue;
    }

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
  return GenericOpenAIAdapter;
}

module.exports = { buildProviders, collectKeys, isPlaceholder };
