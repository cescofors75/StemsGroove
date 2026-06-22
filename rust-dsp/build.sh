#!/usr/bin/env bash
# Build the STEMS DSP WASM core.
#
# Requirements:
#   rustup target add wasm32-unknown-unknown
#
# No cargo deps / no wasm-bindgen: a single rustc invocation produces a small
# freestanding .wasm that exports `memory`, `alloc`, `mark`, `release`,
# `stft` and `istft`. Output goes to public/wasm/stems_dsp.wasm.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../public/wasm/stems_dsp.wasm"

mkdir -p "$(dirname "$OUT")"

rustc \
  --edition 2021 \
  --target wasm32-unknown-unknown \
  --crate-type cdylib \
  --crate-name stems_dsp \
  -C opt-level=3 \
  -C lto=fat \
  -C panic=abort \
  -C target-feature=+simd128 \
  -C link-arg=--no-entry \
  "$HERE/src/lib.rs" \
  -o "$OUT"

echo "Built $OUT ($(wc -c < "$OUT") bytes)"
