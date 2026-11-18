#!/usr/bin/env bash
# agent-sandbox.sh — uso: ./agent-sandbox.sh [comando...]
set -e

# Android/Linux compatibility: avoid broken posix_spawn
mkdir -p /tmp/udocker-patch
cat > /tmp/udocker-patch/sitecustomize.py <<'PY'
import subprocess
subprocess._USE_POSIX_SPAWN = False
PY

export PYTHONPATH="/tmp/udocker-patch${PYTHONPATH:+:$PYTHONPATH}"

U="udocker --allow-root"
NAME="${AGENT_NAME:-agent}"
IMG="debian:bookworm-slim"

if ! $U ps | grep -q "'$NAME'"; then
  $U pull "$IMG"
  $U create --name="$NAME" "$IMG" >/dev/null
  $U setup --execmode=F1 "$NAME"
  R="$($U inspect -p "$NAME")"
  rm -rf "$R"/usr/share/doc "$R"/usr/share/man "$R"/usr/share/info \
         "$R"/usr/share/locale "$R"/var/cache/apt/* "$R"/var/lib/apt/lists/* "$R"/var/log/*
  mkdir -p "$R/etc/apt/apt.conf.d"
  echo 'APT::Sandbox::User "root";' > "$R/etc/apt/apt.conf.d/99root"
fi

# setup a veces no genera el loader y fakechroot sale en silencio (exit 252)
C="$(dirname "$($U inspect -p "$NAME")")"
if [ ! -s "$C/ld.so.path" ]; then
  case "$(uname -m)" in
    aarch64) printf '%s' /lib/ld-linux-aarch64.so.1 > "$C/ld.so.path" ;;
    x86_64)  printf '%s' /lib64/ld-linux-x86-64.so.2 > "$C/ld.so.path" ;;
  esac
fi

# Verificación: si ve cosas del host, no se ejecuta
OUT="$($U run --nosysdirs "$NAME" /bin/sh -c 'ls /' 2>/dev/null || true)"
case "$OUT" in
  *sdcard*|*storage*|*apex*|*vendor*) echo "ERROR: el sandbox no aísla, no se ejecuta" >&2; exit 1 ;;
  *bin*) ;;
  *) echo "ERROR: el sandbox no arranca (salida vacía)" >&2; exit 1 ;;
esac

exec $U run --nosysdirs "$NAME" "${@:-/bin/bash}"
