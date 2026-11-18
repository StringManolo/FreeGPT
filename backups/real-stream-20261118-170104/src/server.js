"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadConfig } = require("./config/load");
const { buildProviders } = require("./providers");
const { Router } = require("./router/router");

require("./tools");
const { runAgentRequest, listAvailableTools } = require("./agent/agent");

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function start({ configPath, port, host, ui = false } = {}) {
  if (!configPath) throw new Error("start(): 'configPath' is required.");

  const { config, warnings } = loadConfig(configPath);
  for (const w of warnings) console.warn(`[freegpt] config warning: ${w}`);

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

  const server = http.createServer((req, res) =>
    handle(req, res, router, config, ui)
  );

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
      if (ui) console.log(`[freegpt] Web UI: http://${listenHost}:${listenPort}/`);
      resolve(server);
    });
  });
}

async function handle(req, res, router, config, ui) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  try {
    if (req.method === "GET" && pathname === "/health") {
      return sendJson(res, 200, { status: "ok", service: "freegpt" });
    }

    if (req.method === "GET" && pathname === "/v1/models") {
      return handleModels(res, config);
    }

    if (req.method === "GET" && pathname === "/v1/agent/tools") {
      return handleAgentTools(res, config);
    }

    if (req.method === "POST" && pathname === "/v1/chat/completions") {
      return await handleChat(req, res, router);
    }

    if (req.method === "POST" && pathname === "/v1/agent/completions") {
      return await handleAgentChat(req, res, router, config);
    }

    if (ui && req.method === "GET") {
      return serveStatic(res, pathname);
    }

    return sendError(res, 404, `Unknown route: ${req.method} ${pathname}`, "not_found");
  } catch (err) {
    console.error("[freegpt] Handler error:", err);
    if (!res.headersSent) {
      sendError(res, 500, err.message || "Internal error", "internal_error");
    } else res.end();
  }
}

/* ─────────────── Chat (sin cambios) ─────────────── */

async function handleChat(req, res, router) {
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendError(res, 400, `Invalid JSON body: ${err.message}`, "invalid_request_error");
  }

  const problem = validateChatBody(body);
  if (problem) return sendError(res, 400, problem, "invalid_request_error");

  const { model, messages, stream, ...options } = body;

  try {
    const { completion, meta } = await router.chatCompletion({
      model,
      messages,
      options
    });

    if (stream) return streamAsSse(res, completion, meta);

    completion.freegpt = meta;
    return sendJson(res, 200, completion);
  } catch (err) {
    if (err.code === "CONTEXT_EXCEEDED") {
      return sendJson(res, 413, {
        error: {
          message: err.message,
          type: "context_length_exceeded",
          code: "context_exceeded",
          param: null
        },
        freegpt: { attempts: err.attempts }
      });
    }
    if (err.code === "NO_PROVIDERS" || err.code === "NO_CHAIN") {
      return sendJson(res, 503, {
        error: {
          message: err.message,
          type: "no_providers",
          code: err.code.toLowerCase(),
          param: null
        },
        freegpt: { skipped: err.skipped || [] }
      });
    }
    console.error("[freegpt] Router error:", err.message);
    return sendJson(res, 502, {
      error: {
        message: err.message,
        type: "provider_error",
        code: (err.code || "all_failed").toLowerCase(),
        param: null
      },
      freegpt: {
        attempts: err.attempts || [],
        summary: err.summary || ""
      }
    });
  }
}

/* ─────────────── Agent (nuevo) ─────────────── */

function handleAgentTools(res, config) {
  const agentConfig = config.agent || {};
  const tools = listAvailableTools(agentConfig);
  return sendJson(res, 200, { tools });
}

async function handleAgentChat(req, res, router, config) {
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendError(res, 400, `Invalid JSON body: ${err.message}`, "invalid_request_error");
  }

  const problem = validateAgentBody(body);
  if (problem) return sendError(res, 400, problem, "invalid_request_error");

  const { model, messages, tools, stream } = body;
  const agentConfig = config.agent || {};
  const requestedTools = tools || {};

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  /* Non-streaming */
  if (!stream) {
    const events = [];
    try {
      const result = await runAgentRequest({
        router,
        model,
        messages,
        requestedTools,
        agentConfig,
        emit: (evt) => events.push(evt),
        signal: controller.signal
      });

      if (res.writableEnded || res.destroyed) return;

      if (result.status === "completed") {
        return sendJson(res, 200, {
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            message: { role: "assistant", content: result.content },
            finish_reason: "stop"
          }],
          freegpt: { agent: true, events }
        });
      }

      if (result.status === "cancelled") {
        return sendJson(res, 499, {
          error: { message: "Agent request cancelled.", type: "cancelled", code: "cancelled" }
        });
      }

      const err = result.error || { code: "AGENT_FAILED", message: "Agent failed." };
      return sendJson(res, 502, {
        error: { message: err.message, type: "agent_error", code: err.code },
        freegpt: { agent: true, events }
      });
    } catch (err) {
      if (res.writableEnded || res.destroyed) return;
      console.error("[freegpt] Agent error:", err);
      return sendJson(res, 500, {
        error: {
          message: err.message || "Agent failed.",
          type: "agent_error",
          code: "agent_error"
        }
      });
    }
  }

  /* Streaming SSE */
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  const sendEvent = (obj) => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch {
      /* cliente desconectado */
    }
  };

  const emitChunk = (delta, finishReason = null) => {
    sendEvent({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }]
    });
  };

  try {
    const result = await runAgentRequest({
      router,
      model,
      messages,
      requestedTools,
      agentConfig,
      emit: sendEvent,
      signal: controller.signal
    });

    if (result.status === "completed" && typeof result.content === "string") {
      // Un solo chunk con el contenido final (streaming real vendrá después).
      emitChunk({ content: result.content });
      emitChunk({}, "stop");
    } else if (result.status !== "cancelled") {
      const err = result.error || { code: "AGENT_FAILED", message: "Agent failed." };
      sendEvent({ type: "agent.error", error: err });
      // Texto visible para el parser actual del cliente.
      emitChunk({ content: `\n\n⚠️ Agent error (${err.code}): ${err.message}` });
      emitChunk({}, "stop");
    }
    // status === "cancelled": el cliente cerró; no escribimos nada más.
  } catch (err) {
    sendEvent({
      type: "agent.error",
      error: { code: "AGENT_ERROR", message: err.message || "Agent failed." }
    });
    emitChunk({ content: `\n\n⚠️ Agent error: ${err.message || "unknown"}` });
    emitChunk({}, "stop");
  }

  res.write("data: [DONE]\n\n");
  res.end();
}

function validateAgentBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object.";
  }
  if (body.mode !== "agent") {
    return `'mode' must be "agent" for /v1/agent/completions.`;
  }
  if (typeof body.model !== "string" || body.model.length === 0) {
    return "Missing or invalid 'model' (expected a non-empty string).";
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return "'messages' must be a non-empty array.";
  }
  for (let i = 0; i < body.messages.length; i++) {
    const m = body.messages[i];
    if (!m || typeof m !== "object") return `messages[${i}] must be an object.`;
    if (typeof m.role !== "string") return `messages[${i}].role must be a string.`;
    if (typeof m.content !== "string") return `messages[${i}].content must be a string.`;
  }
  if (body.tools != null && (typeof body.tools !== "object" || Array.isArray(body.tools))) {
    return "'tools' must be an object mapping tool names to booleans.";
  }
  return null;
}

/* ─────────────── Common (sin cambios) ─────────────── */

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

function serveStatic(res, pathname) {
  const safe = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(safe));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendError(res, 403, "Forbidden", "forbidden");
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendError(res, 404, "Not found", "not_found");
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

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
    if (!m || typeof m !== "object") return `messages[${i}] must be an object.`;
    if (typeof m.role !== "string") return `messages[${i}].role must be a string.`;
    if (typeof m.content !== "string") return `messages[${i}].content must be a string.`;
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

function streamAsSse(res, completion, meta) {
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

  send({ freegpt: meta });

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
        { index: 0, delta: { content: content.slice(i, i + CHUNK) }, finish_reason: null }
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
