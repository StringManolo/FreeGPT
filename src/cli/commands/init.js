"use strict";

const { ensureConfig } = require("../../config/ensure");

async function runInit(cli) {
  const configPath = ensureConfig();
  console.log(cli.color.green("✓ Config ready at ") + configPath);
}

module.exports = { runInit };
