"use strict";

const fs = require("fs");
const yaml = require("js-yaml");
const { CONFIG_DIR, SECRETS_FILE } = require("./paths");

function readSecrets() {
  if (!fs.existsSync(SECRETS_FILE)) {
    return { providers: {} };
  }
  const raw = fs.readFileSync(SECRETS_FILE, "utf8");
  try {
    const parsed = yaml.load(raw) || {};
    if (!parsed.providers || typeof parsed.providers !== "object") {
      parsed.providers = {};
    }
    return parsed;
  } catch (err) {
    throw new Error(`Invalid YAML in ${SECRETS_FILE}: ${err.message}`);
  }
}

function writeSecrets(secrets) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const text =
    "# FreeGPT secrets. Do not commit this file.\n" +
    "# Managed by `freegpt key`. Takes precedence over config.yaml.\n" +
    yaml.dump(secrets, { lineWidth: -1 });
  fs.writeFileSync(SECRETS_FILE, text, "utf8");
  try {
    fs.chmodSync(SECRETS_FILE, 0o600);
  } catch (_) {
    // chmod is a no-op on Windows.
  }
}

function setProviderKey(providerName, apiKey) {
  const secrets = readSecrets();
  if (!secrets.providers[providerName]) secrets.providers[providerName] = {};
  secrets.providers[providerName].api_key = apiKey;
  writeSecrets(secrets);
  return SECRETS_FILE;
}

function listProviderKeys() {
  const secrets = readSecrets();
  return Object.entries(secrets.providers).map(([name, p]) => ({
    name,
    hasKey: Boolean(p && p.api_key)
  }));
}

module.exports = { readSecrets, writeSecrets, setProviderKey, listProviderKeys };
