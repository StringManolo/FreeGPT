"use strict";

function startOfUTCDay() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

class RateLimiter {
  constructor(limits = {}) {
    this.limits = limits;
    this.minuteWindowStart = Date.now();
    this.dayWindowStart = startOfUTCDay();
    this.minuteUsage = { requests: 0, tokens: 0 };
    this.dayUsage = { requests: 0, tokens: 0 };
  }

  refreshWindows(now = Date.now()) {
    if (now - this.minuteWindowStart >= 60_000) {
      this.minuteWindowStart = now;
      this.minuteUsage = { requests: 0, tokens: 0 };
    }
    if (now - this.dayWindowStart >= 86_400_000) {
      this.dayWindowStart = startOfUTCDay();
      this.dayUsage = { requests: 0, tokens: 0 };
    }
  }

  canSpend(estimatedTokens = 0, now = Date.now()) {
    this.refreshWindows(now);
    const { rpm, rpd, tpm, tpd } = this.limits;
    if (rpm > 0 && this.minuteUsage.requests + 1 > rpm) return false;
    if (rpd > 0 && this.dayUsage.requests + 1 > rpd) return false;
    if (tpm > 0 && this.minuteUsage.tokens + estimatedTokens > tpm) return false;
    if (tpd > 0 && this.dayUsage.tokens + estimatedTokens > tpd) return false;
    return true;
  }

  record(tokensUsed = 0, now = Date.now()) {
    this.refreshWindows(now);
    this.minuteUsage.requests += 1;
    this.minuteUsage.tokens += tokensUsed;
    this.dayUsage.requests += 1;
    this.dayUsage.tokens += tokensUsed;
  }

  snapshot(now = Date.now()) {
    this.refreshWindows(now);
    return {
      minuteRequests: this.minuteUsage.requests,
      minuteTokens: this.minuteUsage.tokens,
      dayRequests: this.dayUsage.requests,
      dayTokens: this.dayUsage.tokens,
      limits: this.limits
    };
  }
}

module.exports = { RateLimiter };
