"use strict";

const { ensureConfig } = require("../../config/ensure");
const { start } = require("../../server");

async function runServe(cli) {
  const configPath = cli.c.config || ensureConfig();
  const port = cli.c.port ? Number(cli.c.port) : undefined;

  console.log(cli.color.green("✓ Starting FreeGPT gateway…"));
  console.log(`  Config: ${configPath}`);
  if (port) console.log(`  Port override: ${port}`);

  try {
    await start({ configPath, port });
  } catch (err) {
    console.error(cli.color.red(`✗ Failed to start: ${err.message}`));
    process.exit(1);
  }
}

module.exports = { runServe };
