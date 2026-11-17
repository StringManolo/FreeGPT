"use strict";

const http = require("http");
const { loadConfig } = require("./config/load");
const { buildProviders } = require("./providers");
const { Router } = require("./router/router");

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Start the FreeGPT HTTP server.
 * Returns a Promise that resolves to the http.Server once listening.
 *
 * @param {object} opts
 * @param {string} opts.configPath Absolute path to config.yaml
 * @param {number} [opts.port] Override port
 * @param {string} [opts.host] Override host
 */
function start({ configPath, port, host } = {}) {
  if (!configPath) {
    throw new Error("start(): 'configPath' is required.");
  }

  const { config, warnings } = loadConfig(configPath);
  for (const w of warnings) {
    console.warn(`[freegpt] config warning: ${w}`);
  }

  const providers = buildProviders(config);
  if (providers.size === 0) {
    throw new Error(
      "No providers loaded. Check ~/.freegpt/config.yaml and your API keys."
    );
  }
  console.log(`[freegpt] Loaded providers: ${[...providers.keys()].join(", ")}`);

  const router = new Router(config, providers);
  const listenPort = port ?? config.settings?.port ?? 3100;
  const listenHost = host ?? config.settings?.host ?? "127.0.0.1";

  const server = http.createServer((req, res) => handle(req, res, router, config));

  const shutdown = (signal) => {
    console.log(`[freegpt] Received ${signal}, shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, listenHost, () => {
      server.removeListener("error", reject);
      console.log(`[freegpt] Listening on http://${listenHost}:${listenPort}`);
      console.log(
        `[freegpt] OpenAI-compatible endpoint: http://${listenHost}:${listenPort}/v1/chat/completions`
      );
      resolve(server);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Request handling                                                    */
/* ------------------------------------------------------------------ */

async function handle(req, res, router, config) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (req.method === "GET" && (pathname === "/" || pathname === "/health")) {
      return sendJson(res, 200, { status: "ok", service: "freegpt" });
    }

    if (req.method === "GET" && pathname === "/v1/models") {
      return handleModels(res, config);
    }

    if (req.method === "POST" && pathname === "/v1/chat/completions") {
      return await handleChat(req, res, router);
    }

    return sendError(res, 404, `Unknown route: ${req.method} ${pathname}`, "not_found");
  } catch (err) {
    console.error("[freegpt] Handler error:", err);
    if (!res.headersSent) {
      sendError(res, 500, err.message || "Internal error", "internal_error");
    } else {
      res.end();
    }
  }
}

async function handleChat(req, res, router) {
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendError(
      res,
      400,
      `Invalid JSON body: ${err.message}`,
      "invalid_request_error"
    );
  }

  const problem = validateChatBody(body);
  if (problem) {
    return sendError(res, 400, problem, "invalid_request_error");
  }

  const { model, messages, stream, ...options } = body;

  try {
    const completion = await router.chatCompletion({ model, messages, options });
    if (stream) {
      return streamAsSse(res, completion);
    }
    return sendJson(res, 200, completion);
  } catch (err) {
    console.error("[freegpt] Router error:", err.message);
    return sendError(res, 502, err.message, "provider_error");
  }
}

function handleModels(res, config) {
  const groups = Object.keys(config.routing?.model_groups || {});
  const data = groups.map((id) => ({
    id,
    object: "model",
    created: 0,
    owned_by: "freegpt"
  }));
  sendJson(res, 200, { object: "list", data });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    });

    req.on("error", reject);
  });
}

function validateChatBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object.";
  }
  if (typeof body.model !== "string" || body.model.length === 0) {
    return "Missing or invalid 'model' (expected a non-empty string).";
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return "'messages' must be a non-empty array.";
  }
  for (let i = 0; i < body.messages.length; i++) {
    const m = body.messages[i];
    if (!m || typeof m !== "object") {
      return `messages[${i}] must be an object.`;
    }
    if (typeof m.role !== "string") {
      return `messages[${i}].role must be a string.`;
    }
    if (typeof m.content !== "string") {
      return `messages[${i}].content must be a string.`;
    }
  }
  return null;
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

function sendError(res, status, message, code = "error") {
  sendJson(res, status, {
    error: {
      message,
      type: status >= 500 ? "server_error" : "invalid_request_error",
      code,
      param: null
    }
  });
}

/**
 * Simulated SSE stream built from a complete response.
 * Real per-adapter streaming can be added later without changing this API.
 */
function streamAsSse(res, completion) {
  const id = completion.id || `chatcmpl-${Date.now()}`;
  const created = completion.created || Math.floor(Date.now() / 1000);
  const model = completion.model || "unknown";
  const content = completion.choices?.[0]?.message?.content ?? "";

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  send({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]
  });

  const CHUNK = 20;
  for (let i = 0; i < content.length; i += CHUNK) {
    send({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: { content: content.slice(i, i + CHUNK) },
          finish_reason: null
        }
      ]
    });
  }

  send({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
  });

  res.write("data: [DONE]\n\n");
  res.end();
}

module.exports = { start };
