"use strict";

const { ensureConfig } = require("../../config/ensure");
const { loadConfig, loadYaml } = require("../../config/load");
const { buildProviders } = require("../../providers");

const TEST_PROMPT =
  "Which of the following numbers is larger? 4 or 5. " +
  "Answer only with the number, nothing else, e.g.: 5";
const TEST_EXPECTED = "5";
const TEST_TIMEOUT_MS = 20_000;
const TEST_MAX_TOKENS = 256;
const KEY_COL_WIDTH = 12;
const MODEL_COL_WIDTH = 38;

async function testChat(adapter, keyId, key, model) {
  const startedAt = Date.now();
  try {
    const result = await withTimeout(
      adapter.chatCompletion({
        model,
        messages: [{ role: "user", content: TEST_PROMPT }],
        options: { max_tokens: TEST_MAX_TOKENS },
        reasoning_effort: "low",
        apiKey: key
      }),
      TEST_TIMEOUT_MS
    );
    const elapsed = Date.now() - startedAt;
    const text = (result.choices?.[0]?.message?.content || "").trim();
    const cleaned = text.replace(/^[`*_"']+|[`*_"'.!,;:]+$/g, "").trim();

    if (!text) {
      return { status: "fail", reason: "empty response", durationMs: elapsed, raw: result };
    }
    if (cleaned === TEST_EXPECTED) {
      return { status: "ok", text, durationMs: elapsed };
    }
    if (cleaned.includes(TEST_EXPECTED)) {
      return {
        status: "warn",
        reason: `contains "${TEST_EXPECTED}" but has extra text`,
        text,
        durationMs: elapsed,
        raw: result
      };
    }
    return {
      status: "fail",
      reason: `does not contain "${TEST_EXPECTED}"`,
      text,
      durationMs: elapsed,
      raw: result
    };
  } catch (err) {
    return {
      status: "fail",
      reason: err.message || "unknown error",
      errorStatus: err.status || 0,
      durationMs: Date.now() - startedAt
    };
  }
}

async function runDoctor(cli) {
  const c = cli.color;
  const configPath = cli.c.config || ensureConfig({ verbose: false });
  const verbose = Boolean(cli.s.V || cli.c.verbose);

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

  console.log(
    c.dim(
      "Each key × model combination receives one chat request. " +
        "Consumes a small amount of quota."
    )
  );
  console.log("");

  const skipped = [];
  const providerResults = [];

  for (const [name, rawProvider] of Object.entries(raw.providers || {})) {
    const adapter = providers.get(name);

    if (!adapter) {
      skipped.push({ name, detail: skipReason(name, rawProvider, config) });
      continue;
    }

    const keys = adapter.config.api_keys || [];
    const models = adapter.config.models || [];
    if (keys.length === 0 || models.length === 0) {
      skipped.push({ name, detail: "no keys or models configured" });
      continue;
    }

    const tests = [];
    for (let i = 0; i < keys.length; i++) {
      for (const model of models) {
        tests.push({ keyId: `${name}#${i + 1}`, key: keys[i], model });
      }
    }

    if (verbose) {
      console.log(
        c.bold(name) +
          c.dim(` (${tests.length} combination${tests.length > 1 ? "s" : ""})`)
      );
    } else {
      process.stdout.write(`  ${name.padEnd(12)} `);
    }

    const results = [];
    for (const t of tests) {
      const r = await testChat(adapter, t.keyId, t.key, t.model);
      results.push({ ...t, ...r });

      if (verbose) {
        const icon =
          r.status === "ok" ? c.green("✓") :
          r.status === "warn" ? c.yellow("⚠") :
          c.red("✗");
        const detail = r.text
          ? JSON.stringify(truncate(r.text, 44))
          : r.reason || "error";
        console.log(
          `  ${icon} ${t.keyId.padEnd(KEY_COL_WIDTH)} ` +
            `${t.model.padEnd(MODEL_COL_WIDTH)} ` +
            `${detail} ${c.dim(`(${r.durationMs}ms)`)}`
        );
      } else {
        process.stdout.write(
          r.status === "ok" ? c.green(".") :
          r.status === "warn" ? c.yellow("w") :
          c.red("x")
        );
      }
    }

    if (verbose) console.log("");

    const summary = summarize(results);
    providerResults.push({ name, results, summary });

    if (!verbose) {
      const icon =
        summary.status === "ok" ? c.green("✓") :
        summary.status === "warn" ? c.yellow("⚠") :
        c.red("✗");
      console.log(` ${icon} ${summary.ok}/${summary.total} passed`);
    }
  }

  console.log("");

  if (providerResults.length === 0 && skipped.length === 0) {
    console.log(c.yellow("No providers configured."));
    return;
  }

  printSummary(c, providerResults, skipped);
  printIssues(c, providerResults, verbose);
  printModelGroups(c, config);
  printWarnings(c, warnings);

  const anyOk = providerResults.some((pr) => pr.summary.ok > 0);
  const anyFail = providerResults.some((pr) => pr.summary.fail > 0);
  const anyWarn = providerResults.some((pr) => pr.summary.warn > 0);

  if (!anyOk) {
    console.error(c.red("No working combination. Fix the config before starting the server."));
    process.exit(1);
  }
  if (anyFail) {
    console.log(c.yellow("Some combinations failed. The server will still start and skip them at runtime."));
  } else if (anyWarn) {
    console.log(c.yellow("Some combinations returned unusual responses. Review the issues above."));
  } else {
    console.log(c.green("All providers responded correctly."));
  }
}

function skipReason(name, rawProvider, config) {
  if (rawProvider && rawProvider.enabled === false) {
    return "disabled (enabled: false)";
  }
  const missing = findMissingEnv(rawProvider);
  if (missing.length > 0) {
    return `missing env: ${missing.join(", ")}`;
  }
  const loadedCfg = config.providers[name];
  const keys = loadedCfg?.api_keys || [];
  if (keys.length === 0) return "no API keys";
  if (keys.every((k) => k.startsWith("YOUR_"))) {
    return "placeholder API key — edit config.yaml or set the env var";
  }
  return "skipped (invalid config)";
}

function summarize(results) {
  const ok = results.filter((r) => r.status === "ok").length;
  const warn = results.filter((r) => r.status === "warn").length;
  const fail = results.filter((r) => r.status === "fail").length;
  let status = "ok";
  if (fail > 0) status = "fail";
  else if (warn > 0) status = "warn";
  return { ok, warn, fail, status, total: results.length };
}

function printSummary(c, providerResults, skipped) {
  console.log(c.bold("Summary:"));
  const nameWidth = Math.max(
    10,
    ...providerResults.map((p) => p.name.length),
    ...skipped.map((s) => s.name.length)
  );

  for (const pr of providerResults) {
    const icon =
      pr.summary.status === "ok" ? c.green("✓") :
      pr.summary.status === "warn" ? c.yellow("⚠") :
      c.red("✗");
    const label =
      pr.summary.status === "ok" ? c.green("ok") :
      pr.summary.status === "warn" ? c.yellow("warn") :
      c.red("fail");
    const counts = [];
    if (pr.summary.ok > 0) counts.push(`${pr.summary.ok} ok`);
    if (pr.summary.warn > 0) counts.push(`${pr.summary.warn} warn`);
    if (pr.summary.fail > 0) counts.push(`${pr.summary.fail} fail`);
    console.log(
      `  ${icon} ${pr.name.padEnd(nameWidth)}  ${label.padEnd(10)}  ${counts.join(" · ")}`
    );
  }
  for (const s of skipped) {
    console.log(
      `  ${c.yellow("⊘")} ${s.name.padEnd(nameWidth)}  ${c.yellow("skipped").padEnd(10)}  ${s.detail}`
    );
  }
  console.log("");
}

function printIssues(c, providerResults, verbose) {
  const issues = [];
  for (const pr of providerResults) {
    for (const r of pr.results) {
      if (r.status !== "ok") issues.push(r);
    }
  }
  if (issues.length === 0) return;

  console.log(c.bold("Issues:"));
  for (const r of issues) {
    const icon = r.status === "warn" ? c.yellow("⚠") : c.red("✗");
    console.log(`  ${icon} ${r.keyId} :: ${r.model}`);
    if (r.errorStatus) console.log(`      ${c.bold("Status:")}   ${r.errorStatus}`);
    console.log(`      ${c.bold("Reason:")}   ${r.reason || "unknown"}`);
    if (r.text) console.log(`      ${c.bold("Response:")} ${JSON.stringify(r.text)}`);
    console.log(`      ${c.bold("Duration:")} ${r.durationMs}ms`);
    if (verbose && r.raw) {
      console.log(`      ${c.bold("Raw:")}`);
      console.log(indent(JSON.stringify(r.raw, null, 2), 8));
    }
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
    const chain = [...groups[name]].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
    const desc = chain.map((s) => `${s.provider} :: ${s.model}`).join(", ");
    console.log(`  ${name.padEnd(width)}  → ${desc}`);
  }
  console.log("");
}

function printWarnings(c, warnings) {
  if (warnings.length === 0) return;
  console.log(c.bold("Warnings:"));
  for (const w of warnings) console.log(`  ${c.yellow("!")} ${w}`);
  console.log("");
}

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

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function indent(s, n) {
  const pad = " ".repeat(n);
  return s.split("\n").map((l) => pad + l).join("\n");
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

module.exports = { runDoctor };
