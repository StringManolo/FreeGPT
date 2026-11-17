"use strict";

const fs = require("fs");
const {
  CONFIG_DIR,
  COOKIES_DIR,
  CHROME_PROFILES_DIR,
  REAL_CONFIG,
  DEMO_CONFIG
} = require("./paths");

function ensureConfig() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(COOKIES_DIR, { recursive: true });
  fs.mkdirSync(CHROME_PROFILES_DIR, { recursive: true });

  if (!fs.existsSync(REAL_CONFIG)) {
    fs.copyFileSync(DEMO_CONFIG, REAL_CONFIG);
    try {
      fs.chmodSync(REAL_CONFIG, 0o600);
    } catch (_) {
      // chmod may fail on Windows; safe to ignore.
    }
    console.log(`Created demo config at: ${REAL_CONFIG}`);
    console.log("Edit it with your credentials before starting the server.");
  } else {
    console.log(`Using existing config at: ${REAL_CONFIG}`);
  }

  return REAL_CONFIG;
}

module.exports = { ensureConfig };
