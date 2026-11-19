# FreeGPT

A local gateway with a single OpenAI-compatible API that routes requests across
free AI providers (Groq, NVIDIA NIM, Gemini, OpenRouter, Kilo, SambaNova,
Cohere, Mistral) with fallback, key rotation, rate limits and cooldowns.
Includes a web UI and an agent mode with tools.

## Features

- OpenAI-compatible API: `/v1/chat/completions` (with streaming), `/v1/models`, `/health`
- Priority fallback chains (`fast-chat`, `smart-chat`, `code-chat`)
- Multiple API keys per provider, per-model limits, automatic cooldowns
- `freegpt doctor` to check every key × model before using it
- Web UI with streaming and syntax highlighting
- Agent mode: `web_search`, `web_fetch`, `filesystem`, `terminal`, `git`, `shell`
- Agent commands run inside a Debian sandbox ([udocker](https://github.com/indigo-dc/udocker)), prepared by `npm install`
- Bash client (`freegpt-client`)

## Requirements

- Node.js 20+
- `python3`, `python3-venv`, `python3-pip`, `curl` (for the agent sandbox, Linux only)
- `jq` (only for the bash client)
- At least one provider API key (all have free tiers)

## Install

Tested on Debian live for Android
([DebianLiveCD4Android](https://github.com/StringManolo/DebianLiveCD4Android/releases/download/v0.3.0-alpha/DebianLiveCD_v0.3.0-alpha.apk)),
2026-11-18.

```bash
apt update
apt install -y git npm python3 python3-pip python3-venv python3-setuptools \
    curl wget ca-certificates tar gzip coreutils util-linux

git clone https://github.com/stringmanolo/freegpt
cd freegpt
npm install      # also prepares the agent sandbox (first run takes a few minutes)
npm link         # registers `freegpt` and `freegpt-client`
freegpt init     # creates ~/.freegpt/config.yaml
```

Skip the sandbox setup with `FREEGPT_SKIP_SANDBOX=1 npm install`. If it fails
during install, it is retried when FreeGPT starts.

### API keys

```bash
freegpt setup                        # list providers
freegpt setup gemini                 # how to get a key
freegpt key groq gsk_xxxxxxxx        # save a key
freegpt key groq --index 2 gsk_yyyy  # a second key for the same provider
```

Set up 2 or 3 providers at least (for example Groq, Gemini and Kilo).

### Run

```bash
freegpt doctor                  # check config and providers
freegpt --ui --track-agent      # gateway + web UI + agent tool-call logs
```

Open <http://127.0.0.1:3100/>. In the web UI click **Agent** to enable the
agent and **shell** to let it run commands. Stop with `Ctrl + C`.

## Commands

| Command | Description |
|---|---|
| `freegpt serve` | Start the API (default) |
| `freegpt --ui` | Start the API and the web UI |
| `freegpt init` | Create `~/.freegpt/config.yaml` from the demo |
| `freegpt doctor` | Test every key × model (uses a little quota) |
| `freegpt setup [provider]` | How to get a key |
| `freegpt key <provider> <key>` | Save a key (`--index <n>` for extra keys) |
| `freegpt key list` | List providers with stored keys |

Options: `--config <path>`, `--port <n>`, `--ui`, `--track-agent`, `-h`, `-v`.

## Configuration

Files live in `~/.freegpt/` (or `$FREEGPT_HOME`):

- `config.yaml`: providers, routing, agent, settings
- `secrets.yaml`: API keys written by `freegpt key`

`config.yaml` is created from [`config.demo.yaml`](config.demo.yaml) and never
overwritten. It is a copy: merge later changes of the demo by hand.

Keys are resolved in this order: `secrets.yaml`, literal value in `config.yaml`,
`env.VAR_NAME`. Providers without a key are skipped with a warning.

```yaml
providers:
  groq:
    type: "openai_compatible"
    base_url: "https://api.groq.com/openai/v1"
    api_keys: ["env.GROQ_API_KEY"]
    key_strategy: "sequential"        # or "balanced"
    models: ["openai/gpt-oss-20b"]
    limits:
      "openai/gpt-oss-20b": { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 }   # 0 = no limit

routing:
  model_groups:
    "fast-chat":
      - { provider: "groq", model: "openai/gpt-oss-20b", priority: 1 }

settings:
  retries_per_provider: 1
  request_timeout_ms: 30000
  cooldown_after_failure_ms: 60000
  port: 3100
```

## Providers

Free-tier details as of 2026-11-17. They change often; run `freegpt doctor`
after editing models.

| Provider | Free tier |
|---|---|
| Groq | No card. ~30 RPM / 1,000 RPD per model |
| NVIDIA NIM | No card. Developer Program account |
| Google Gemini | No card. Limits per Google Cloud project, not per key |
| OpenRouter | `:free` models only. 20 RPM / 50 RPD per account |
| Kilo Gateway | No card, no phone. ~200 requests/hour per IP |
| SambaNova | No card. ~20 RPD per model |
| Cohere | Trial key. ~1,000 calls/month, non-commercial |
| Mistral | Phone verification. Free plan lets Mistral train on your requests |
| Cerebras | Disabled in the demo (needs a verified payment method) |

Any OpenAI-compatible provider works with `type: "openai_compatible"` and a
`base_url`.

## Routing

1. The model group's chain is sorted by `priority` (lowest first).
2. Providers in cooldown are skipped; keys follow `key_strategy`.
3. `401`/`403` → 5 min cooldown. `429`/timeout → 60 s cooldown. Then the next step.
4. Other errors are retried `retries_per_provider` times, then the next step.
5. If everything fails: `502` with a per-provider summary (`503` if no provider is available, `413` if the context is too large).

Call a provider directly with `"model": "groq:openai/gpt-oss-20b"`.

## API

| Method | Path | |
|---|---|---|
| `GET` | `/health` | Status |
| `GET` | `/v1/models` | Model groups |
| `POST` | `/v1/chat/completions` | Chat (OpenAI format, `stream: true` supported) |
| `GET` | `/v1/agent/tools` | Tools enabled on the server |
| `POST` | `/v1/agent/completions` | Agent mode |

```bash
curl http://127.0.0.1:3100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"fast-chat","messages":[{"role":"user","content":"Say hi"}]}'
```

With the OpenAI SDK, set `baseURL: "http://127.0.0.1:3100/v1"` and any `apiKey`.

### Agent endpoint

```json
{
  "mode": "agent",
  "model": "smart-chat",
  "messages": [{ "role": "user", "content": "What is in the working folder?" }],
  "tools": { "terminal": true, "filesystem": true },
  "stream": true
}
```

- `mode` must be `"agent"`.
- A tool runs only if the server config enables it **and** the request sets it to `true` in `tools`.
- Without `stream`, you get a `chat.completion` with the progress in `freegpt.events`.
- With `stream: true` you get SSE: agent events, then the final answer as a single
  chunk (token streaming in agent mode is not implemented yet), then `data: [DONE]`.

Event types: `agent.started`, `agent.thinking`, `tool.started`, `tool.completed`,
`tool.failed`, `tool.denied`, `agent.completed`, `agent.error`, `agent.cancelled`.

Tool calls use a plain-text protocol (FGTP), so any model works without native
function calling.

## Agent

| Tool | What it does | Runs in |
|---|---|---|
| `web_search` | Web search | host |
| `web_fetch` | Fetch a URL | host |
| `filesystem` | Read, list, stat, glob (read-only) | host |
| `terminal` | `ls pwd cat head tail wc du df file stat which` (read-only, no pipes) | sandbox |
| `git` | `status log diff show branch ls-files remote rev-parse` (read-only) | sandbox |
| `shell` | Full `sh -c`: pipes, scripts, writing files. Off by default | sandbox |

`allow_paths` is the folder (or folders) the agent can see. The repo includes an
empty `agent_folder/` for that.

```yaml
agent:
  sandbox:
    enabled: true          # false = run tools directly on your system
  limits:
    max_iterations: 15
    max_calls: 20
    max_parallel: 3
    max_time_ms: 180000
  tools:
    web_search: { enabled: true }
    web_fetch:  { enabled: true }
    filesystem: { enabled: true, allow_paths: ["/path/to/agent_folder"] }
    terminal:   { enabled: true, allow_paths: ["/path/to/agent_folder"] }
    git:        { enabled: true, allow_paths: ["/path/to/agent_folder"] }
    shell:      { enabled: false, allow_paths: ["/path/to/agent_folder"], timeout_ms: 30000 }
```

### Sandbox

- Debian rootfs run by udocker in fakechroot mode `F1`, stored in `.sandbox/` (does not touch `~/.udocker`).
- Prepared by `npm install`, and checked on every `freegpt serve` / `--ui` (it waits if another process is still preparing it). `freegpt doctor` shows its state.
- If it cannot be prepared, `terminal`, `git` and `shell` return an error. `shell` never runs without the sandbox.
- The repo bundles an `aarch64` rootfs with `git` and `file`. On other architectures the `debian:bookworm-slim` image is downloaded instead, without `git` or `file` (the `git` tool will not work there).
- `apt` and `dpkg` do not work inside it. Extra packages must be added when the rootfs is built.
- Linux only.

## Bash client

`freegpt-client` needs `curl` and `jq`. Chat only (no agent yet).

```bash
freegpt-client -p 'Say hi in one word.'
freegpt-client -p 'Explain TCP.' -m smart-chat
freegpt-client -s -p 'Count from 1 to 5.'      # stream
echo 'Count to 5' | freegpt-client -s
```

Flags: `-p` prompt, `-m` model (default `fast-chat`), `-e` endpoint, `-t` temperature,
`-n` max tokens, `-s` stream, `-v` verbose, `-d` debug, `-h` help.

Put boolean flags last or before another flag (`-p 'text' -s`, not `-s 'text'`):
the argument parser reads a value after any flag.

## Development

```bash
node --test test/                  # tests
source scripts/sandbox-env.sh      # UDOCKER_DIR + PYTHONPATH, to run udocker by hand
bash scripts/build-rootfs.sh       # rebuild sandbox/rootfs-aarch64.tar.gz (needs dpkg-deb)
```

Tests that use the tools must set `sandbox: { enabled: false }` in the agent
config. Commit the rootfs tarball sparingly: every version stays in the git history.

## Roadmap

- Token streaming in agent mode
- `--debug` flag
- Smart routing (a fast model classifies the task and orders the models)
- Cloudflare Workers AI; web providers via Puppeteer (placeholders in the config)
- Local models and multimodal input
- Web UI: warning icon on `shell`, model picker, delete chats
- Bash client with agent support
- Relative `allow_paths` so the demo config works on any machine
- Screenshots
