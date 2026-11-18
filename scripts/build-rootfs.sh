#!/bin/bash
# Genera sandbox/rootfs-aarch64.tar.gz con git y file YA instalados,
# sin ejecutar dpkg dentro de udocker (no funciona en F1).
# Ejecutar desde la raíz del repo.
set -euo pipefail
command -v dpkg-deb >/dev/null || { echo "falta dpkg-deb en el host"; exit 1; }

export UDOCKER_DIR="${UDOCKER_DIR:-$PWD/.sandbox/udocker}"
export PYTHONPATH="$PWD/scripts/python-compat${PYTHONPATH:+:$PYTHONPATH}"
U="udocker --allow-root"
NAME=rootfs-build
PKGS="git file"
SKIP=" perl perl-modules-5.36 libperl5.36 liberror-perl libgdbm6 libgdbm-compat4 git-man "

$U rm "$NAME" 2>/dev/null || true
$U create --name="$NAME" debian:bookworm-slim >/dev/null
$U setup --execmode=F1 "$NAME"
ROOT="$($U inspect -p "$NAME")"
printf '%s' /lib/ld-linux-aarch64.so.1 > "$(dirname "$ROOT")/ld.so.path"

# 1) Descargar (dentro, F1 + --nosysdirs). No instala nada.
$U run --nosysdirs "$NAME" /bin/sh -c "
  mkdir -p /etc/apt/apt.conf.d /dev/pts
  echo 'APT::Sandbox::User \"root\";' > /etc/apt/apt.conf.d/99root
  apt-get update &&
  apt-get install -y --download-only --no-install-recommends -o Dpkg::Use-Pty=0 $PKGS
"

# 2) Extraer (fuera). Solo desempaqueta ficheros.
ls "$ROOT"/var/cache/apt/archives/*.deb >/dev/null
for deb in "$ROOT"/var/cache/apt/archives/*.deb; do
  pkg="$(dpkg-deb -f "$deb" Package)"
  case "$SKIP" in *" $pkg "*) echo "skip    $pkg"; continue;; esac
  echo "extract $pkg"
  dpkg-deb --fsys-tarfile "$deb" | tar -x -p --keep-directory-symlink -C "$ROOT"
done

rm -f "$ROOT"/var/cache/apt/archives/*.deb
rm -rf "$ROOT"/var/lib/apt/lists/* "$ROOT"/var/log/*
for l in bin lib sbin; do [ -L "$ROOT/$l" ] || { echo "ERROR: /$l ya no es un enlace"; exit 1; }; done

# 3) Verificar dentro del sandbox
$U run --nosysdirs "$NAME" /bin/sh -c 'git --version; file --version | head -1; file -L /bin/sh'

mkdir -p sandbox
tar -C "$ROOT" -czf sandbox/rootfs-aarch64.tar.gz .
ls -lh sandbox/rootfs-aarch64.tar.gz
$U rm "$NAME"
