"use strict";

const { RateLimiter } = require("./rate-limiter");

class KeyPool {
  constructor(providerName, keys, modelLimits, strategy = "sequential", persisted = {}) {
    this.providerName = providerName;
    this.strategy = strategy;
    this.entries = keys.map((secret, i) => {
      const keyId = `${providerName}#${i + 1}`;
      const stored = persisted[keyId] || {};
      return {
        id: keyId,
        secret,
        state: stored.state || "ok",
        cooldownUntil: stored.cooldownUntil || 0,
        failures: stored.failures || 0,
        limiters: {},
        modelLimits
      };
    });
  }

  getLimiter(entry, model) {
    if (!entry.limiters[model]) {
      const limits = entry.modelLimits?.[model] || {};
      entry.limiters[model] = new RateLimiter(limits);
    }
    return entry.limiters[model];
  }

  isUsable(entry, model, estimatedTokens, now = Date.now()) {
    if (entry.state === "disabled") return false;
    if (entry.state === "cooling") {
      if (entry.cooldownUntil > now) return false;
      entry.state = "ok";
      entry.cooldownUntil = 0;
    }
    return this.getLimiter(entry, model).canSpend(estimatedTokens, now);
  }

  acquire(model, estimatedTokens = 0, excludeIds = new Set()) {
    const now = Date.now();
    const candidates = this.entries.filter(
      (e) => !excludeIds.has(e.id) && this.isUsable(e, model, estimatedTokens, now)
    );
    if (candidates.length === 0) return null;

    if (this.strategy === "balanced") {
      candidates.sort((a, b) => {
        const ra = remainingScore(a, model, now, this);
        const rb = remainingScore(b, model, now, this);
        return rb - ra;
      });
    }
    return { entry: candidates[0] };
  }

  recordSuccess(entry, model, tokensUsed = 0) {
    entry.failures = 0;
    if (entry.state === "cooling") {
      entry.state = "ok";
      entry.cooldownUntil = 0;
    }
    this.getLimiter(entry, model).record(tokensUsed);
  }

  recordRateLimit(entry, model, retryAfterMs) {
    entry.failures += 1;
    entry.state = "cooling";
    const backoff = retryAfterMs > 0
      ? retryAfterMs
      : Math.min(10_000 * 2 ** entry.failures, 600_000);
    entry.cooldownUntil = Date.now() + backoff;
  }

  recordAuthFailure(entry) {
    entry.state = "disabled";
  }

  recordNeutralFailure(_entry) {
    // no-op: 5xx/timeout do not affect key state
  }

  toPersisted() {
    const out = {};
    for (const e of this.entries) {
      out[e.id] = {
        state: e.state,
        cooldownUntil: e.cooldownUntil,
        failures: e.failures
      };
    }
    return out;
  }
}

function remainingScore(entry, model, now, pool) {
  const snap = pool.getLimiter(entry, model).snapshot(now);
  const { rpm, rpd } = snap.limits;
  let score = 0;
  if (rpm > 0) score += (rpm - snap.minuteRequests) / rpm;
  if (rpd > 0) score += (rpd - snap.dayRequests) / rpd;
  return score;
}

module.exports = { KeyPool };
