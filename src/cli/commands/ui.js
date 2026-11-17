"use strict";

const { runServe } = require("./serve");

async function runUi(cli) {
  // Force the UI flag without mutating the parser output.
  const proxy = {
    ...cli,
    s: { ...cli.s, u: "true" },
    c: { ...cli.c, ui: "true" }
  };
  await runServe(proxy);
}

module.exports = { runUi };
