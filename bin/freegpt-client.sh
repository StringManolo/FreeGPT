#!/usr/bin/env bash

# ---------------------------------------------------------------------------
# Locate and source parseCLI
# ---------------------------------------------------------------------------
SCRIPT_PATH="$0"
if command -v readlink >/dev/null 2>&1 && readlink -f "$SCRIPT_PATH" >/dev/null 2>&1; then
    SCRIPT_PATH="$(readlink -f "$SCRIPT_PATH")"
fi
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"

find_parse_cli() {
    local candidates=(
        "$SCRIPT_DIR/../node_modules/simpleargumentsparser/other_languages/bash/parseCLI"
        "$SCRIPT_DIR/node_modules/simpleargumentsparser/other_languages/bash/parseCLI"
    )
    if command -v npm >/dev/null 2>&1; then
        local global_root
        global_root="$(npm root -g 2>/dev/null || true)"
        [ -n "$global_root" ] && candidates+=(
            "$global_root/simpleargumentsparser/other_languages/bash/parseCLI"
            "$global_root/freegpt/node_modules/simpleargumentsparser/other_languages/bash/parseCLI"
        )
    fi
    local c
    for c in "${candidates[@]}"; do
        [ -f "$c" ] && { printf '%s\n' "$c"; return 0; }
    done
    return 1
}

PARSE_CLI_PATH="$(find_parse_cli || true)"
[ -z "$PARSE_CLI_PATH" ] && {
    echo "Error: simpleargumentsparser bash library not found." >&2
    echo "Install it with: npm install simpleargumentsparser" >&2
    exit 1
}

source "$PARSE_CLI_PATH"
parse_cli "$@"

# ---------------------------------------------------------------------------
# Globals and output helpers
# ---------------------------------------------------------------------------
version="freegpt-client 0.1.0 by https://github.com/stringmanolo/freegpt"

exit()    { local msg="$1"; echo -e "$msg"; builtin exit 0; }
info()    { echo "$(cli color cyan [INFO]) $1"; }
success() { echo "$(cli color green [SUCCESS]) $1"; }
warning() { echo "$(cli color yellow [WARNING]) $1"; }
error()   { echo "$(cli color bold red [ERROR]) $1" >&2; builtin exit 1; }

showUsage() {
cat << SHOWUSAGE
$(cli color bold cyan freegpt-client) — bash client for the FreeGPT API

$(cli color bold red USAGE)
  freegpt-client -p $(cli color dim '<prompt>') [options]
  echo $(cli color dim '<prompt>') | freegpt-client [options]

$(cli color bold red OPTIONS)
  $(cli color bold cyan -p, --prompt) $(cli color dim '<text>')      Prompt to send (or use a pipe)
  $(cli color bold cyan -m, --model) $(cli color dim '<name>')       Logical model name (default: fast-chat)
  $(cli color bold cyan -e, --endpoint) $(cli color dim '<url>')     Full endpoint URL
  $(cli color bold cyan -t, --temperature) $(cli color dim '<num>')  Sampling temperature (optional)
  $(cli color bold cyan -n, --max-tokens) $(cli color dim '<int>')   Max completion tokens (optional)
  $(cli color bold cyan -s, --stream)              Stream the response
  $(cli color bold cyan -v, --verbose)             Print the request being made
  $(cli color bold cyan -d, --debug)               Dump parsed arguments
  $(cli color bold cyan -h, --help)                Show this help
      $(cli color bold cyan --version)             Show version

$(cli color bold red EXAMPLES)
  freegpt-client -p 'Say hi in one word.'
  freegpt-client -p 'Explain TCP in one sentence.' -m smart-chat
  freegpt-client -p 'Count from 1 to 5.' -s
  freegpt-client -s -p 'Count from 1 to 5.'
  freegpt-client -p 'hi' -v
  freegpt-client -p 'hi' -d
  echo 'Count to 5' | freegpt-client -s
  freegpt-client 'Say hi in one word.'

SHOWUSAGE
builtin exit 0
}

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------
if cli noArgs || cli s h || cli c help; then    showUsage              ; fi
if                cli c version;        then    exit "$version"        ; fi

verbose=false;  cli s v && verbose=true;  cli c verbose && verbose=true
debug=false;    cli s d && debug=true;    cli c debug   && debug=true
stream=false;   cli s s && stream=true;   cli c stream  && stream=true

model="fast-chat"
cli s m       && model=${__CLI_S[m]}
cli c model   && model=${__CLI_C[model]}

endpoint="http://127.0.0.1:3100/v1/chat/completions"
cli s e       && endpoint=${__CLI_S[e]}
cli c endpoint && endpoint=${__CLI_C[endpoint]}

temperature=""
cli s t              && temperature=${__CLI_S[t]}
cli c temperature    && temperature=${__CLI_C[temperature]}

max_tokens=""
cli s n             && max_tokens=${__CLI_S[n]}
cli c max-tokens    && max_tokens=${__CLI_C[max-tokens]}

# Prompt resolution order: -p / --prompt  →  positional  →  stdin pipe
prompt=""
cli s p         && prompt=${__CLI_S[p]}
cli c prompt    && prompt=${__CLI_C[prompt]}

if [ -z "$prompt" ]; then
    prompt="$(cli o | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
fi

if [ -z "$prompt" ] && cli p found; then
    prompt="$(cli p)"
fi

if [ -z "$prompt" ]; then
    error "Missing prompt.

Examples:
  freegpt-client -p 'Your prompt'
  freegpt-client -p 'Your prompt' -m smart-chat
  freegpt-client -s -p 'Your prompt'
  echo 'Your prompt' | freegpt-client -s"
fi

if [ "$debug" = "true" ]; then cli print; fi

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------
for cmd in curl jq; do
    command -v "$cmd" >/dev/null 2>&1 || error "Missing required command: $(cli color bold cyan "$cmd")
Install it with your package manager (apt/dnf/apk/brew)."
done

# ---------------------------------------------------------------------------
# Build JSON payload
# ---------------------------------------------------------------------------
jq_args=(--arg m "$model" --arg p "$prompt" --argjson stream "$stream")
jq_filter='{model: $m, messages: [{role: "user", content: $p}], stream: $stream}'

if [ -n "$temperature" ]; then
    jq_args+=(--argjson temperature "$temperature")
    jq_filter="${jq_filter%?}, temperature: \$temperature}"
fi

if [ -n "$max_tokens" ]; then
    jq_args+=(--argjson max_tokens "$max_tokens")
    jq_filter="${jq_filter%?}, max_tokens: \$max_tokens}"
fi

payload="$(jq -nc "${jq_args[@]}" "$jq_filter")" \
    || error "Failed to build JSON payload with jq."

if [ "$verbose" = "true" ]; then
    info "POST $(cli color bold cyan "$endpoint")"
    info "model=$(cli color bold cyan "$model")  stream=$(cli color bold cyan "$stream")"
fi

# ---------------------------------------------------------------------------
# Send request
# ---------------------------------------------------------------------------
if [ "$stream" = "true" ]; then
    tmp_raw="$(mktemp)"
    trap 'rm -f "$tmp_raw"' EXIT

    curl -sS -N "$endpoint" \
        -H "Content-Type: application/json" \
        -d "$payload" >"$tmp_raw" || error "curl request failed."

    got_output=0
    while IFS= read -r line; do
        case "$line" in
            "data: [DONE]") break ;;
            "data: "*)
                content="$(printf '%s' "${line#data: }" \
                    | jq -r '.choices[0].delta.content // empty' 2>/dev/null || true)"
                if [ -n "$content" ]; then
                    printf '%s' "$content"
                    got_output=1
                fi
                ;;
        esac
    done <"$tmp_raw"
    printf '\n'

    if [ "$got_output" -eq 0 ]; then
        err="$(jq -r '.error.message // empty' <"$tmp_raw" 2>/dev/null || true)"
        [ -n "$err" ] && error "$err"
        error "Unexpected response from server."
    fi
else
    response="$(curl -sS "$endpoint" \
        -H "Content-Type: application/json" \
        -d "$payload" || true)"

    content="$(printf '%s' "$response" \
        | jq -r '.choices[0].message.content // empty' 2>/dev/null || true)"

    if [ -n "$content" ]; then
        printf '%s\n' "$content"
    else
        err="$(printf '%s' "$response" \
            | jq -r '.error.message // empty' 2>/dev/null || true)"
        [ -n "$err" ] && error "$err"
        error "Unexpected response: $response"
    fi
fi
