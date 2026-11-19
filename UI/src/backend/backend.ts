/** Runs the Rust backend (compiled to WebAssembly by scripts/build-wasm.sh) on a topology and a construction set. */
import init, { WasmBuilding } from '../wasm/floorplan_backend.js';
import type { FaceResult } from './types';

let ready: Promise<unknown> | null = null;

/** Loads the wasm module once. In Node (tests) pass the module bytes. */
export function loadBackend(moduleOrPath?: BufferSource | URL | string): Promise<unknown> {
  ready ??= init(moduleOrPath === undefined ? undefined : { module_or_path: moduleOrPath });
  return ready;
}

export type SolveResult = { faces: FaceResult[]; solveMs: number };

/** Builds the building, solves all joints and returns every face's layer geometry. */
export function solveBuilding(topologyJson: string, constructionJson: string): SolveResult {
  const building = new WasmBuilding(topologyJson, constructionJson);
  try {
    const t0 = performance.now();
    building.solveJoints();
    const solveMs = performance.now() - t0;
    return { faces: JSON.parse(building.geometryJson()) as FaceResult[], solveMs };
  } finally {
    building.free();
  }
}
