"use strict";

class CooldownTracker {
  constructor(defaultMs = 60_000) {
    this.defaultMs = defaultMs;
    this.until = new Map(); // providerName → timestamp (ms)
  }

  isCoolingDown(providerName, now = Date.now()) {
    const expiresAt = this.until.get(providerName);
    if (!expiresAt) return false;
    if (expiresAt <= now) {
      this.until.delete(providerName);
      return false;
    }
    return true;
  }

  recordFailure(providerName, ms = this.defaultMs, now = Date.now()) {
    this.until.set(providerName, now + ms);
  }

  recordSuccess(providerName) {
    this.until.delete(providerName);
  }

  remainingMs(providerName, now = Date.now()) {
    const expiresAt = this.until.get(providerName);
    if (!expiresAt || expiresAt <= now) return 0;
    return expiresAt - now;
  }
}

module.exports = { CooldownTracker };
