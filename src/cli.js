#!/usr/bin/env node
"use strict";

const parseCLI = require("simpleargumentsparser");

const { runInit } = require("./cli/commands/init");
const { runServe } = require("./cli/commands/serve");
const { runDoctor } = require("./cli/commands/doctor");
const { runKey } = require("./cli/commands/key");
const { runSetup } = require("./cli/commands/setup");

(async () => {
  const cli = await parseCLI();

  if (cli.s.h || cli.c.help) {
    printHelp(cli);
    process.exit(0);
  }

  if (cli.s.v || cli.c.version) {
    console.log(cli.color.bold.cyan("FreeGPT") + " v0.1.0");
    process.exit(0);
  }

  const command = getPositional(cli, 1) || "serve";

  switch (command) {
    case "init":
      await runInit(cli);
      break;
    case "serve":
      await runServe(cli);
      break;
    case "doctor":
      await runDoctor(cli);
      break;
    case "key":
      runKey(cli);
      break;
    case "setup":
      runSetup(cli);
      break;
    default:
      console.error(cli.color.red(`Unknown command: ${command}`));
      printHelp(cli);
      process.exit(1);
  }
})();

/* ---------------------------------------------------------- */
/* Helpers                                                     */
/* ---------------------------------------------------------- */

function getPositional(cli, position) {
  const entry = cli.o.find(([, pos]) => pos === position);
  return entry ? entry[0] : null;
}

function printHelp(cli) {
  const c = cli.color;
  console.log(c.bold.cyan("FreeGPT") + " — free AI provider gateway");
  console.log("");
  console.log(c.bold("Usage:"));
  console.log("  freegpt [command] [options]");
  console.log("");
  console.log(c.bold("Commands:"));
  console.log("  serve      Start the OpenAI-compatible API (default)");
  console.log("  init       Create the config from the demo template");
  console.log("  doctor     Validate config and check provider health");
  console.log("  key        Store an API key in secrets.yaml");
  console.log("  setup      Show setup instructions for a provider");
  console.log("");
  console.log(c.bold("Examples:"));
  console.log("  freegpt setup groq");
  console.log("  freegpt key groq gsk_xxxxxxxxxxxxxxxx");
  console.log("  freegpt doctor");
  console.log("  freegpt serve");
  console.log("");
  console.log(c.bold("Options:"));
  console.log("  -h, --help           Show this help");
  console.log("  -v, --version        Show version");
  console.log("  --config <path>      Use a custom config file");
  console.log("  --port <number>      Override the listening port");
}
