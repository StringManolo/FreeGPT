# FreeGPT

A local gateway that exposes a single OpenAI-compatible API and routes
requests across multiple free AI providers (Groq, Cerebras, Gemini,
OpenRouter) with automatic fallback, cooldowns and health checks.

Point any OpenAI client at `http://127.0.0.1:3100/v1` and let FreeGPT
pick a working provider in the background.

## Features

- **OpenAI-compatible API** — `POST /v1/chat/completions`, `GET /v1/models`
- **Multi-provider routing** with priority-ordered fallback chains
- **Automatic cooldowns** when a provider returns `429`, `401` or times out
- **Health checks** via `freegpt doctor` before sending real traffic
- **Secrets isolated** in `~/.freegpt/secrets.yaml` (mode `600`), separate
  from `config.yaml`
- **Streaming** (`stream: true`) via SSE, compatible with the OpenAI SDK
- **Zero-dependency HTTP server** (built-in `http` module)

## Requirements

- Node.js 20 or newer
- At least one API key from a supported provider (all have free tiers)

## Installation

```bash
npm install -g freegpt
```

For local development from a clone:

```bash
git clone https://github.com/stringmanolo/freegpt.git
cd freegpt
npm install
npm link          # registers the `freegpt` command globally
```

## Quick start

```bash
freegpt init                    # creates ~/.freegpt/config.yaml from the demo
freegpt setup groq              # prints instructions to get a Groq key
freegpt key groq gsk_xxxxxxx    # stores the key in secrets.yaml
freegpt doctor                  # verifies the config and provider health
freegpt serve                   # starts the gateway on 127.0.0.1:3100
```

Then call it like any OpenAI endpoint:

```bash
curl http://127.0.0.1:3100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fast-chat",
    "messages": [{"role": "user", "content": "Say hi in one word."}]
  }'
```

## Commands

| Command | Description |
|---|---|
| `freegpt serve` | Start the OpenAI-compatible API (default command) |
| `freegpt init` | Create `~/.freegpt/config.yaml` from the demo template |
| `freegpt doctor` | Validate config, print routing, check provider health |
| `freegpt setup [provider]` | Show step-by-step instructions to get an API key |
| `freegpt key <provider> <key>` | Store an API key in `secrets.yaml` |
| `freegpt key list` | List providers with stored keys |
| `freegpt -h` / `--help` | Show help |
| `freegpt -v` / `--version` | Show version |

Options accepted by every command:

- `--config <path>` — use a custom config file instead of `~/.freegpt/config.yaml`
- `--port <number>` — override the listening port (default `3100`)

## Configuration

FreeGPT reads two files from `~/.freegpt/` (or from `$FREEGPT_HOME` if set):

| File | Purpose |
|---|---|
| `config.yaml` | Providers, routing, settings (safe to share, should not contain keys) |
| `secrets.yaml` | API keys, written by `freegpt key`, mode `600` |

The CLI creates `config.yaml` on first run from `config.demo.yaml` and
**never overwrites** an existing file. `secrets.yaml` is created the first
time you store a key.

### Where API keys can live

FreeGPT resolves each provider's `api_key` with this precedence:

1. **`secrets.yaml`** — highest priority, set via `freegpt key <provider> <key>`
2. **`config.yaml` literal** — e.g. `api_key: "gsk_abc123..."`
3. **Environment variable** — e.g. `api_key: "env.GROQ_API_KEY"`

Providers whose keys are missing or unresolved are **skipped with a warning**
instead of aborting startup. `freegpt doctor` reports the reason for each.

### Example `config.yaml`

```yaml
providers:
  groq:
    type: "openai_compatible"
    base_url: "https://api.groq.com/openai/v1"
    api_key: "env.GROQ_API_KEY"
    models:
      - "openai/gpt-oss-20b"
      - "openai/gpt-oss-120b"

  cerebras:
    type: "openai_compatible"
    base_url: "https://api.cerebras.ai/v1"
    api_key: "env.CEREBRAS_API_KEY"
    models:
      - "llama3.1-8b"

  gemini:
    type: "gemini_native"
    api_key: "env.GEMINI_API_KEY"
    models:
      - "gemini-2.5-flash-lite"

  openrouter:
    type: "openai_compatible"
    base_url: "https://openrouter.ai/api/v1"
    api_key: "env.OPENROUTER_API_KEY"
    models:
      - "meta-llama/llama-3.3-70b-instruct:free"

routing:
  model_groups:
    "fast-chat":
      - provider: "groq"
        model: "openai/gpt-oss-20b"
        priority: 1
      - provider: "cerebras"
        model: "llama3.1-8b"
        priority: 2

    "smart-chat":
      - provider: "groq"
        model: "openai/gpt-oss-120b"
        priority: 1
      - provider: "gemini"
        model: "gemini-2.5-flash-lite"
        priority: 2
      - provider: "openrouter"
        model: "meta-llama/llama-3.3-70b-instruct:free"
        priority: 3

settings:
  retries_per_provider: 1
  request_timeout_ms: 30000
  cooldown_after_failure_ms: 60000
  port: 3100
```

## Supported providers

| Provider | `type` | Free tier | Notes |
|---|---|---|---|
| **Groq** | `openai_compatible` | Yes | No credit card required |
| **Cerebras** | `openai_compatible` | Yes | No credit card required |
| **Google Gemini** | `gemini_native` | Yes | Limits reduced significantly in late 2025 |
| **OpenRouter** | `openai_compatible` | Yes | `:free` model suffix for free models |

> **Note:** free model IDs change frequently. If a request returns `404 model_not_found`,
> update the `models` list in `config.yaml`. Current Groq models are `openai/gpt-oss-20b`
> and `openai/gpt-oss-120b`.

## Routing

Logical model names (`fast-chat`, `smart-chat`, …) are defined in
`routing.model_groups` and resolve to an ordered chain of `(provider, model)`
pairs. When a request comes in:

1. The chain is sorted by `priority` (lowest first).
2. Each step is tried in order. Providers currently in cooldown are skipped.
3. `401` / `403` → cooldown for 5 minutes, move to next provider.
4. `429` / timeout → cooldown for 60 seconds, move to next provider.
5. Other errors → retried up to `retries_per_provider`, then move on.
6. If every step fails, a `502` is returned with a per-provider error summary.

You can also bypass routing and call a provider directly:

```json
{ "model": "groq:openai/gpt-oss-20b", "messages": [...] }
```

## Using with clients

### curl

```bash
curl http://127.0.0.1:3100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"fast-chat","messages":[{"role":"user","content":"hi"}]}'
```

### OpenAI SDK (Node.js)

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:3100/v1",
  apiKey: "not-needed"
});

const res = await client.chat.completions.create({
  model: "smart-chat",
  messages: [{ role: "user", content: "Hello" }]
});
console.log(res.choices[0].message.content);
```

### Streaming

```bash
curl -N http://127.0.0.1:3100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"fast-chat","stream":true,"messages":[{"role":"user","content":"Count to 5"}]}'
```

## Project layout

```
freegpt/
├── src/
│   ├── cli.js                     # dispatcher
│   ├── server.js                  # HTTP server
│   ├── cli/commands/              # init, serve, doctor, key, setup
│   ├── config/                    # paths, ensure, load, secrets
│   ├── providers/                 # adapters (groq, cerebras, gemini, openrouter, generic)
│   └── router/                    # router, cooldown
├── config.demo.yaml               # template copied on first run
└── README.md
```

## Roadmap

- **Web-based providers via Puppeteer** — use sites that only expose a web UI
  (ChatGPT, Gemini Web, etc.) as additional routing targets. Config placeholders
  (`type: "web_puppeteer"`, `user_data_dir`, `cookie_file`, selectors) already
  exist in `config.demo.yaml` and are skipped until an adapter lands.
- **Quota tracking** — per-provider, per-minute and per-day counters to skip
  providers proactively before hitting `429`.
- **Native streaming** — forward streaming responses from providers instead of
  chunking the full response.

