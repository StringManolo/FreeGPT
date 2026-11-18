# FreeGPT

A local gateway that exposes a single OpenAI-compatible API and routes
requests across multiple free AI providers (Groq, Cerebras, Gemini,
OpenRouter) with automatic fallback, cooldowns and health checks.

Point any OpenAI client at `http://127.0.0.1:3100/v1` and let FreeGPT
pick a working provider in the background. A zero-dependency bash
client (`freegpt-client`) is included for quick shell use.

## Features

- **OpenAI-compatible API** — `POST /v1/chat/completions`, `GET /v1/models`, `GET /health`
- **Multi-provider routing** with priority-ordered fallback chains
- **Automatic cooldowns** when a provider returns `429`, `401` or times out
- **Health checks** via `freegpt doctor` before sending real traffic
- **Secrets isolated** in `~/.freegpt/secrets.yaml` (mode `600`), separate from `config.yaml`
- **Streaming** (`stream: true`) via SSE, compatible with the OpenAI SDK
- **Bash client** (`freegpt-client`) using only system `curl` and `jq`, with pipe and streaming support
- **Zero-dependency HTTP server** (built-in Node `http` module)

## Requirements

- Node.js 20 or newer
- At least one API key from a supported provider (all have free tiers)
- For the bash client: `curl` and `jq` on the system

## Tested instalation
```bash
# Enviroment: Android DebianLiveCD.apk using System -> Normal mode
# At: 18/11/2027-10:59:31:2675
# Commit: https://github.com/StringManolo/FreeGPT/commit/ef3883f53ede6c645adfe3f4d70cec0638416e96
# You can get the apk from https://github.com/StringManolo/DebianLiveCD4Android/releases/download/v0.3.0-alpha/DebianLiveCD_v0.3.0-alpha.apk

cd ~
apt update
apt install git
apt install npm
git clone https://github.com/stringmanolo/freegpt
cd freegpt

apt update
apt install -y \
    python3 \
    python3-pip \
    python3-venv \
    python3-setuptools \
    curl \
    wget \
    ca-certificates \
    tar \
    gzip \
    coreutils \
    util-linux

npm i
npm link
freegpt init


# The next command shows you how to setup API keys:
freegpt setup gemini

# Google Gemini API key — setup instructions
#
#1. Open Google AI Studio: https://aistudio.google.com/app/apikey
#2. Log in with your Google account.
#3. Click "Create API key" and choose or create a project.
#4. Copy the key.
#
#5. Add it to FreeGPT
#   freegpt key gemini <your_api_key>
#



# Show supported Providers:
freegpt setup

  freegpt setup groq
  freegpt setup nvidia
  freegpt setup gemini
  freegpt setup openrouter
  freegpt setup kilo
  freegpt setup sambanova
  freegpt setup cohere
  freegpt setup cerebras



# Setup API keys
freegpt key groq gsk_abckdjdjdjdjdjdjsjdjdjdjsjsA

# You can also setup multiple keys from different accounts
freegpt key groq --index 2 gsk_abkdjdjsjssjjsjjsks

# Examples
freegpt key nvidia nvapi-ahshjsjssjsh-hdhshshsjsjsj-hsjsjsjsjsj-hsjsjssjhs
# ✓ Key for "nvidia" saved to /root/.freegpt/secrets.yaml
#   (secrets.yaml takes precedence over config.yaml)


# RECOMMENDED: At least setup 2 or 3 provideers, for example groq, gemini and kilo. But its better to setup them all


# Finally:
freegpt --ui --track-agent

# Open the next url in the browser:
#   http://127.0.0.1:3100/


# To stop FreeGPT            CTRL + C (Only when you done)
# To start FreeGPT $         freegpt --ui --track-agent


# In the web click Agent to activate the agent running in an Udocker sandbox. And click shell to activate his ability to run commands
```

## Installation

```bash
npm install -g freegpt
```

For local development from a clone:

```bash
git clone https://github.com/stringmanolo/freegpt.git
cd freegpt
npm install
chmod +x bin/freegpt-client.sh
npm link          # registers `freegpt` and `freegpt-client` globally
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

Or with the bundled bash client:

```bash
freegpt-client -p 'Say hi in one word.'
```

## Server commands

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

`freegpt setup` supports `groq`, `cerebras`, `gemini` and `openrouter`. Running
it without a provider lists the available options. Each one prints the URL to
open, the steps to create a key, the `freegpt key` command to store it, and
the `freegpt doctor` command to verify.

## Bash client

`freegpt-client` is a self-contained bash script that talks to the FreeGPT
API using the system `curl` and `jq`. It sources `parseCLI` from the
`simpleargumentsparser` package (installed as a dependency of FreeGPT) so
argument handling matches the server CLI.

| Flag | Description |
|---|---|
| `-p, --prompt <text>` | Prompt to send (or use a pipe) |
| `-m, --model <name>` | Logical model name (default: `fast-chat`) |
| `-e, --endpoint <url>` | Full endpoint URL (default: `http://127.0.0.1:3100/v1/chat/completions`) |
| `-t, --temperature <num>` | Sampling temperature (optional) |
| `-n, --max-tokens <int>` | Max completion tokens (optional) |
| `-s, --stream` | Stream the response token by token |
| `-v, --verbose` | Print the request being made |
| `-d, --debug` | Dump parsed arguments as JSON |
| `-h, --help` | Show help |
| `--version` | Show version |

The prompt can be provided in three ways, checked in this order:

1. `-p` / `--prompt` flag
2. Positional argument (`freegpt-client 'Say hi'`)
3. stdin pipe (`echo 'Say hi' | freegpt-client -s`)

Examples:

```bash
freegpt-client -p 'Say hi in one word.'
freegpt-client -p 'Explain TCP in one sentence.' -m smart-chat
freegpt-client -s -p 'Count from 1 to 5.'
freegpt-client -t 0.2 -n 50 -p 'Say hi'
echo 'Count to 5' | freegpt-client -s
freegpt-client -p 'hi' -d              # dump parsed args
freegpt-client -p 'hi' -v              # show the POST being made
```

If `curl` or `jq` is missing, the client exits with status `1` **before**
touching the network, printing the install command for `apt`, `dnf`, `apk`
and `brew`.

> **Note on boolean flags.** `simpleargumentsparser` treats any flag followed
> by a non-dash token as a flag with a value. So `-s 'Count'` sets `s="Count"`
> rather than making `'Count'` a positional. The safe pattern is to use
> `-p 'Count' -s` (flag first, boolean after) or `-s -p 'Count'` (boolean
> first, then a flag with value). The positional shorthand
> `freegpt-client 'Count' -s` also works because the boolean comes last.

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
instead of aborting startup. `freegpt doctor` reports the reason for each
(missing env var, `enabled: false`, placeholder key, or unhealthy).

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

> **Note:** free model IDs change frequently. If a request returns
> `404 model_not_found`, update the `models` list in `config.yaml`. Current
> Groq models are `openai/gpt-oss-20b` and `openai/gpt-oss-120b`.

Any OpenAI-compatible provider can be added by adding a `type: "openai_compatible"`
entry with its `base_url`. The generic adapter forwards `base_url` and `api_key`
as-is; no code change is needed.

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

You can bypass routing and call a provider directly:

```json
{ "model": "groq:openai/gpt-oss-20b", "messages": [...] }
```

## API

### `POST /v1/chat/completions`

Request (same shape as OpenAI):

```json
{
  "model": "fast-chat",
  "messages": [{ "role": "user", "content": "Say hi" }],
  "stream": false
}
```

Optional: `temperature`, `max_tokens`, and any other field is forwarded to the
underlying provider.

Response: OpenAI-compatible `chat.completion` object.

With `"stream": true`, the response is `text/event-stream` and ends with
`data: [DONE]`. The server currently chunks the full response; native
upstream streaming is on the roadmap.

### `GET /v1/models`

Lists the logical model groups defined in `config.yaml`.

### `GET /health`

Returns `{ "status": "ok", "service": "freegpt" }`.

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

### Streaming via curl

```bash
curl -N http://127.0.0.1:3100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"fast-chat","stream":true,"messages":[{"role":"user","content":"Count to 5"}]}'
```

## Project layout

```
freegpt/
├── bin/
│   └── freegpt-client.sh              # bash client (curl + jq)
├── src/
│   ├── cli.js                         # dispatcher
│   ├── server.js                      # HTTP server
│   ├── cli/commands/                  # init, serve, doctor, key, setup
│   ├── config/                        # paths, ensure, load, secrets
│   ├── providers/                     # base, groq, openrouter, gemini, generic-openai, index
│   └── router/                        # router, cooldown
├── config.demo.yaml                   # template copied on first run
└── README.md
```

## How it works

```
client → server.js → router → adapter → provider API
                        │
                        ├─ cooldown tracker (skips recently failed providers)
                        ├─ retry per provider (settings.retries_per_provider)
                        └─ timeout per request (settings.request_timeout_ms)
```

Each provider is an adapter implementing `chatCompletion()` and `healthCheck()`.
The router does not care whether the adapter uses `fetch` to an OpenAI-compatible
endpoint, translates to a native API (Gemini), or — in the future — drives a
browser via Puppeteer. This is the same design used by LiteLLM and Docker
Model Gateway.

## Roadmap

- **Native streaming** — forward streaming responses from providers instead of
  chunking the full response.
- **Quota tracking** — per-provider, per-minute and per-day counters to skip
  providers proactively before hitting `429`.
- **Web-based providers via Puppeteer** — use sites that only expose a web UI
  (ChatGPT, Gemini Web, etc.) as additional routing targets. Config
  placeholders (`type: "web_puppeteer"`, `user_data_dir`, `cookie_file`,
  selectors) already exist in `config.demo.yaml` and are skipped until an
  adapter lands.

