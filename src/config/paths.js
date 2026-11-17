"use strict";

const path = require("path");
const os = require("os");

function resolveHome() {
  const fromEnv = process.env.FREEGPT_HOME;
  if (fromEnv && fromEnv.trim() !== "") {
    const expanded = fromEnv.startsWith("~")
      ? path.join(os.homedir(), fromEnv.slice(1).replace(/^[/\\]+/, ""))
      : fromEnv;
    return path.resolve(expanded);
  }
  return path.join(os.homedir(), ".freegpt");
}

const CONFIG_DIR = resolveHome();
const COOKIES_DIR = path.join(CONFIG_DIR, "cookies");
const CHROME_PROFILES_DIR = path.join(CONFIG_DIR, "chrome-profiles");
const REAL_CONFIG = path.join(CONFIG_DIR, "config.yaml");
const SECRETS_FILE = path.join(CONFIG_DIR, "secrets.yaml");
const DEMO_CONFIG = path.join(__dirname, "..", "..", "config.demo.yaml");

module.exports = {
  CONFIG_DIR,
  COOKIES_DIR,
  CHROME_PROFILES_DIR,
  REAL_CONFIG,
  SECRETS_FILE,
  DEMO_CONFIG,
  resolveHome
};
