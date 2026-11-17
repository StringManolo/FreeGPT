"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const USAGE_FILE = path.join(os.homedir(), ".freegpt", "usage.json");

function loadUsage() {
  try {
    if (!fs.existsSync(USAGE_FILE)) return {};
    return JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) || {};
  } catch {
    return {};
  }
}

function saveUsage(usage) {
  const dir = path.dirname(USAGE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2), "utf8");
  try { fs.chmodSync(USAGE_FILE, 0o600); } catch (_) {}
}

module.exports = { loadUsage, saveUsage, USAGE_FILE };
