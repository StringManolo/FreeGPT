"use strict";

const fs = require("fs");
const yaml = require("js-yaml");
const { readSecrets } = require("./secrets");

const ENV_PREFIX = "env.";

function loadYaml(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, "utf8");
  try {
    return yaml.load(raw) || {};
  } catch (err) {
    throw new Error(`Invalid YAML in ${configPath}: ${err.message}`);
  }
}

function resolveEnv(value, path = "") {
  if (typeof value === "string" && value.startsWith(ENV_PREFIX)) {
    const varName = value.slice(ENV_PREFIX.length);
    const envValue = process.env[varName];
    if (!envValue) {
      throw new Error(
        `Missing environment variable "${varName}" (referenced at ${path || "root"})`
      );
    }
    return envValue;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => resolveEnv(item, `${path}[${i}]`));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveEnv(v, path ? `${path}.${k}` : k);
    }
    return out;
  }
  return value;
}

function tryResolve(value, path) {
  try {
    return { ok: true, value: resolveEnv(value, path) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function validateConfig(config) {
  const warnings = [];
  if (!config.providers || typeof config.providers !== "object") {
    warnings.push("No 'providers' section found in config.");
    return warnings;
  }
  for (const [name, p] of Object.entries(config.providers)) {
    if (!p.type) warnings.push(`Provider "${name}" has no "type" field.`);
    if (p.type === "openai_compatible" && !p.base_url) {
      warnings.push(`Provider "${name}" (openai_compatible) has no "base_url".`);
    }
    if (!Array.isArray(p.models) || p.models.length === 0) {
      warnings.push(`Provider "${name}" has no models listed.`);
    }
    if (typeof p.api_key === "string" && p.api_key.startsWith("YOUR_")) {
      warnings.push(`Provider "${name}" still has a placeholder API key.`);
    }
  }
  if (!config.routing || !config.routing.model_groups) {
    warnings.push("No 'routing.model_groups' defined.");
  }
  return warnings;
}

function loadConfig(configPath) {
  const raw = loadYaml(configPath);
  const secrets = readSecrets();
  const warnings = [];
  const config = { providers: {}, routing: {}, settings: {} };

  for (const [name, provider] of Object.entries(raw.providers || {})) {
    if (provider && provider.enabled === false) {
      warnings.push(`Provider "${name}" is disabled (enabled: false).`);
      continue;
    }

    // Secrets override config.yaml.
    const candidate = { ...provider };
    const secretKey = secrets.providers?.[name]?.api_key;
    if (secretKey) {
      candidate.api_key = secretKey; // literal key; resolveEnv leaves it untouched
    }

    const resolved = tryResolve(candidate, `providers.${name}`);
    if (!resolved.ok) {
      warnings.push(`Provider "${name}" skipped: ${resolved.error}`);
      continue;
    }
    config.providers[name] = resolved.value;
  }

  const settings = tryResolve(raw.settings || {}, "settings");
  config.settings = settings.ok ? settings.value : raw.settings || {};

  const routing = tryResolve(raw.routing || {}, "routing");
  config.routing = routing.ok ? routing.value : raw.routing || {};

  warnings.push(...validateConfig(config));

  return { config, warnings };
}

module.exports = { loadConfig, loadYaml, resolveEnv, validateConfig };
