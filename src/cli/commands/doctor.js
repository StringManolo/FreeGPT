"use strict";

const { ensureConfig } = require("../../config/ensure");
const { loadConfig, loadYaml } = require("../../config/load");
const { buildProviders } = require("../../providers");

const HEALTH_TIMEOUT_MS = 10_000;

async function runDoctor(cli) {
  const c = cli.color;
  const configPath = cli.c.config || ensureConfig({ verbose: false });

  console.log(c.bold.cyan("FreeGPT doctor"));
  console.log("");
  console.log(`Config: ${configPath}`);
  console.log("");

  let loaded;
  try {
    loaded = loadConfig(configPath);
  } catch (err) {
    console.error(c.red(`✗ Failed to load config: ${err.message}`));
    process.exit(1);
  }

  const { config, warnings } = loaded;
  const raw = loadYaml(configPath);
  const providers = buildProviders(config);

  const results = [];

  for (const [name, rawProvider] of Object.entries(raw.providers || {})) {
    const adapter = providers.get(name);

    // Provider not loaded: report the exact reason.
    if (!adapter) {
      let detail;
      if (rawProvider && rawProvider.enabled === false) {
        detail = "disabled (enabled: false)";
      } else {
        const missing = findMissingEnv(rawProvider);
        detail =
          missing.length > 0
            ? `missing env: ${missing.join(", ")}`
            : "skipped (invalid config)";
      }
      results.push({ name, status: "skipped", detail });
      continue;
    }

    // Placeholder key: no point hitting the network.
    const apiKey = adapter.config.api_key;
    if (typeof apiKey === "string" && apiKey.startsWith("YOUR_")) {
      results.push({
        name,
        status: "fail",
        detail: "placeholder API key — edit config.yaml or set the env var"
      });
      continue;
    }

    // Real health check.
    const startedAt = Date.now();
    try {
      const ok = await withTimeout(adapter.healthCheck(), HEALTH_TIMEOUT_MS);
      const elapsed = Date.now() - startedAt;
      results.push({
        name,
        status: ok ? "ok" : "fail",
        detail: ok ? `ok (${elapsed}ms)` : "unhealthy (check API key and quota)"
      });
    } catch (err) {
      results.push({
        name,
        status: "fail",
        detail: err.message || "error"
      });
    }
  }

  printProviders(c, results);
  printModelGroups(c, config);
  printWarnings(c, warnings);

  const hasOk = results.some((r) => r.status === "ok");
  const hasFail = results.some((r) => r.status === "fail");

  if (!hasOk) {
    console.error(
      c.red("No healthy providers. Fix your config before starting the server.")
    );
    process.exit(1);
  }
  if (hasFail) {
    console.log(
      c.yellow(
        "Some providers are unhealthy. The server will still start and skip them on failure."
      )
    );
  } else {
    console.log(c.green("All configured providers are healthy."));
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function printProviders(c, results) {
  console.log(c.bold("Providers:"));

  const nameWidth = Math.max(10, ...results.map((r) => r.name.length));

  for (const r of results) {
    let icon;
    let label;
    if (r.status === "ok") {
      icon = c.green("✓");
      label = c.green("ok");
    } else if (r.status === "fail") {
      icon = c.red("✗");
      label = c.red("fail");
    } else {
      icon = c.yellow("⊘");
      label = c.yellow("skipped");
    }
    console.log(`  ${icon} ${r.name.padEnd(nameWidth)}  ${label.padEnd(10)}  ${r.detail}`);
  }
  console.log("");
}

function printModelGroups(c, config) {
  const groups = config.routing?.model_groups || {};
  const names = Object.keys(groups);
  if (names.length === 0) return;

  console.log(c.bold("Model groups:"));
  const width = Math.max(10, ...names.map((n) => n.length));

  for (const name of names) {
    const chain = [...groups[name]].sort(
      (a, b) => (a.priority ?? 99) - (b.priority ?? 99)
    );
    const desc = chain.map((s) => `${s.provider} :: ${s.model}`).join(", ");
    console.log(`  ${name.padEnd(width)}  → ${desc}`);
  }
  console.log("");
}

function printWarnings(c, warnings) {
  if (warnings.length === 0) return;
  console.log(c.bold("Warnings:"));
  for (const w of warnings) {
    console.log(`  ${c.yellow("!")} ${w}`);
  }
  console.log("");
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function findMissingEnv(obj) {
  const missing = [];
  (function walk(v) {
    if (typeof v === "string" && v.startsWith("env.")) {
      const name = v.slice(4);
      if (!process.env[name]) missing.push(name);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  })(obj);
  return missing;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout after ${ms}ms`)),
      ms
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

module.exports = { runDoctor };
