"use strict";

async function* parseSseStream(response) {
  if (!response.body) {
    throw new Error("The provider returned an empty streaming response.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  async function* parseEvent(eventText) {
    const data = eventText
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");

    if (!data) return;
    if (data.trim() === "[DONE]") return "DONE";

    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      throw new Error(`Invalid SSE data from provider: ${err.message}`);
    }

    yield parsed;
  }

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const eventText = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let done = false;
      for await (const event of parseEvent(eventText)) {
        if (event === "DONE") {
          done = true;
          break;
        }
        yield event;
      }
      if (done) return;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    for await (const event of parseEvent(buffer)) {
      if (event === "DONE") return;
      yield event;
    }
  }
}

class ProviderAdapter {
  constructor(name, config) {
    this.name = name;
    this.config = config;
  }

  async chatCompletion(_params) {
    throw new Error(`Provider "${this.name}" does not implement chatCompletion()`);
  }

  async *chatCompletionStream(_params) {
    throw new Error(`Provider "${this.name}" does not implement chatCompletionStream()`);
  }

  async healthCheck() {
    return true;
  }

  getDefaultKey() {
    return this.config.api_keys?.[0] || this.config.api_key || null;
  }
}

module.exports = { ProviderAdapter, parseSseStream };
