"use strict";

const { setProviderKey, setProviderKeyAt, listProviderKeys } = require("../../config/secrets");
const { loadYaml } = require("../../config/load");
const { REAL_CONFIG, SECRETS_FILE } = require("../../config/paths");

function runKey(cli) {
  const c = cli.color;
  const args = cli.o
    .filter(([, pos]) => pos >= 2)
    .sort((a, b) => a[1] - b[1])
    .map(([value]) => value);

  const provider = args[0];
  if (!provider) return printUsage(c);
  if (provider === "list" || provider === "ls") return printList(c);

  let index = null;
  if (cli.c.index !== undefined) {
    const n = Number(cli.c.index);
    if (!Number.isInteger(n) || n < 1) {
      console.error(c.red("--index must be a positive integer (1-based)."));
      process.exit(1);
    }
    index = n - 1;
  }

  const apiKey = args[1];
  if (!apiKey) {
    console.error(c.red(`Missing API key for "${provider}".`));
    console.error(`Usage: freegpt key ${provider} <api_key>`);
    console.error(`       freegpt key ${provider} --index N <api_key>`);
    process.exit(1);
  }

  let config;
  try {
    config = loadYaml(REAL_CONFIG);
  } catch (err) {
    console.error(c.red(`Cannot read config: ${err.message}`));
    process.exit(1);
  }

  const known = Object.keys(config.providers || {});
  if (!known.includes(provider)) {
    console.error(c.red(`Unknown provider "${provider}". Known: ${known.join(", ")}`));
    process.exit(1);
  }

  let writtenTo;
  if (index !== null) {
    writtenTo = setProviderKeyAt(provider, index, apiKey);
    console.log(c.green(`✓ Key #${index + 1} for "${provider}" saved to ${writtenTo}`));
  } else {
    writtenTo = setProviderKey(provider, apiKey);
    console.log(c.green(`✓ Key for "${provider}" saved to ${writtenTo}`));
  }
  console.log(c.dim("  (secrets.yaml takes precedence over config.yaml)"));
  console.log("");
  console.log("Verify with:");
  console.log("  freegpt doctor");
}

function printList(c) {
  const entries = listProviderKeys();
  if (entries.length === 0) {
    console.log(c.yellow("No keys stored in secrets.yaml."));
    return;
  }
  console.log(c.bold(`Keys in ${SECRETS_FILE}:`));
  for (const { name, count, hasKey } of entries) {
    const suffix = count > 1 ? c.dim(` (${count} keys)`) : "";
    console.log(`  ${hasKey ? c.green("✓") : c.yellow("⊘")} ${name}${suffix}`);
  }
}

function printUsage(c) {
  console.log(c.bold("Usage:"));
  console.log("  freegpt key <provider> <api_key>              Store the primary key");
  console.log("  freegpt key <provider> --index N <api_key>    Store key #N in the pool");
  console.log("  freegpt key list                              List stored keys");
}

module.exports = { runKey };
