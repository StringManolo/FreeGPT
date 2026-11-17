"use strict";

class ProviderAdapter {
  constructor(name, config) {
    this.name = name;
    this.config = config;
  }

  async chatCompletion(_params) {
    throw new Error(`Provider "${this.name}" does not implement chatCompletion()`);
  }

  async healthCheck() {
    return true;
  }

  getDefaultKey() {
    return this.config.api_keys?.[0] || this.config.api_key || null;
  }
}

module.exports = { ProviderAdapter };
