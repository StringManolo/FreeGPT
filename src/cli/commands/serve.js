"use strict";

const { ensureConfig } = require("../../config/ensure");
const { start } = require("../../server");
const { loadConfig } = require("../../config/load");
const sandbox = require("../../sandbox");

async function runServe(cli) {
  const configPath = cli.c.config || ensureConfig({ verbose: false });
  const port = cli.c.port ? Number(cli.c.port) : undefined;
  const ui = Boolean(cli.s.u || cli.c.ui);

  console.log(cli.color.green("✓ Starting FreeGPT gateway…"));
  console.log(`  Config: ${configPath}`);
  if (port) console.log(`  Port override: ${port}`);
  if (ui) console.log("  Web UI: enabled");

  try {
        const { config } = loadConfig(configPath);
    if (sandbox.needed(config.agent || {})) {
      console.log("  Agent sandbox: preparando… (espera si otro proceso lo está montando)");
      try {
        const r = await sandbox.ensureReady(config.agent);
        console.log(`  Agent sandbox: ${r.mode} (${r.name})`);
      } catch (e) {
        console.error(cli.color.red(`  ✗ Agent sandbox NO disponible: ${e.message}`));
        console.error("    El gateway arranca, pero las tools terminal/git fallarán hasta que se arregle");
        console.error("    (o pon agent.sandbox.enabled: false para correr sin aislamiento).");
      }
    } else if (!sandbox.isOn(config.agent || {})) {
      console.warn(cli.color.yellow("  ⚠ agent.sandbox.enabled=false: el agente corre SIN aislamiento"));
    }
    await start({ configPath, port, ui });
  } catch (err) {
    console.error(cli.color.red(`✗ Failed to start: ${err.message}`));
    process.exit(1);
  }
}

module.exports = { runServe };
