"use strict";

const { ensureConfig } = require("../../config/ensure");
const { start } = require("../../server");

async function runServe(cli) {
  const configPath = cli.c.config || ensureConfig({ verbose: false });
  const port = cli.c.port ? Number(cli.c.port) : undefined;
  const ui = Boolean(cli.s.u || cli.c.ui);

  console.log(cli.color.green("✓ Starting FreeGPT gateway…"));
  console.log(`  Config: ${configPath}`);
  if (port) console.log(`  Port override: ${port}`);
  if (ui) console.log("  Web UI: enabled");

  try {
    await start({ configPath, port, ui });
  } catch (err) {
    console.error(cli.color.red(`✗ Failed to start: ${err.message}`));
    process.exit(1);
  }
}

module.exports = { runServe };
