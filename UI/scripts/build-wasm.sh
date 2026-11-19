#!/usr/bin/env bash
# Builds the Rust backend (Backend/, feature "wasm") into UI/src/wasm via wasm-bindgen.
# Needs: rustup target add wasm32-unknown-unknown
#        cargo install wasm-bindgen-cli --version <same as wasm-bindgen in Backend/Cargo.lock>
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
backend="$here/../Backend"
out="$here/src/wasm"

(cd "$backend" && cargo build --release --target wasm32-unknown-unknown --features wasm)
wasm-bindgen --target web --out-dir "$out" --out-name floorplan_backend \
  "$backend/target/wasm32-unknown-unknown/release/floorplan_backend.wasm"
echo "wasm written to $out"
