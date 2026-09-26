#!/usr/bin/env bash
# Скачивает ONNX Runtime для macOS и кладёт в src-tauri/macos/libonnxruntime.dylib
# (оттуда Tauri бандлит его в Memiro AI.app/Contents/Frameworks).
#
# Версия 1.23.2 — последняя, у которой Microsoft выпускает сборку и для Intel
# (x86_64), и для Apple Silicon (arm64). Memiro работает с ней через ort
# `load-dynamic` + `api-23`.
#
#   scripts/fetch-onnxruntime-macos.sh            # под текущую архитектуру
#   scripts/fetch-onnxruntime-macos.sh x86_64     # или arm64 / universal2
set -euo pipefail

VERSION="1.23.2"
ARCH="${1:-$(uname -m)}"
case "$ARCH" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|x64) ARCH=x86_64 ;;
  universal2) ;;
  *) echo "неизвестная архитектура: $ARCH" >&2; exit 1 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/macos/libonnxruntime.dylib"
NAME="onnxruntime-osx-$ARCH-$VERSION"
URL="https://github.com/microsoft/onnxruntime/releases/download/v$VERSION/$NAME.tgz"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "ONNX Runtime $VERSION ($ARCH) ← $URL"
curl -fsSL --retry 4 "$URL" -o "$TMP/ort.tgz"
tar -xzf "$TMP/ort.tgz" -C "$TMP"
mkdir -p "$(dirname "$DEST")"
cp "$TMP/$NAME/lib/libonnxruntime.$VERSION.dylib" "$DEST"
chmod 644 "$DEST"
echo "→ $DEST"
file "$DEST" 2>/dev/null || true
