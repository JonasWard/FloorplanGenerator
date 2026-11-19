# Floorplan UI

A browser UI for the Rust backend in `../Backend`. You draw walls in plan, and the app builds the topology, solves the layer joints in the backend (compiled to WebAssembly), and shows the resulting layers in 3D with a quantity takeoff.

- **Plan editor:** draw walls, add rectangular rooms, or move nodes. Points snap to nodes, to walls and to the grid; hold Shift to lock to 45°.
  [`@dirty-geometry/vec2`](https://github.com/JonasWard/dirty-geometry/tree/main/packages/vec2) does the plan geometry:
  - walls are split where they cross or meet (`Intersection2`, `Line2`);
  - rooms are the bounded faces of the result (`Polygon2`);
  - a wall with a room on both sides is internal, any other wall is a facade.
- **Topology** (`src/plan/topology.ts`): for each storey, every wall becomes a vertical face and every room gets a foundation, floor or roof face and a cell. Constructions come from `Backend/samples/construction.json`. Facade faces point outwards, and interior walls are centred on their drawn line.
- **Backend:** `WasmBuilding` → `solveJoints()` → `geometryJson()`. `geometryJson()` is a small new method that returns every face's layer geometry in one call.
- **View:** layer solids (caps triangulated with vec2's `ConstrainedDelaunay`), coloured by material. You can toggle face types and layers, explode the layers, take a horizontal section, and click a layer to inspect it.
- **Quantity takeoff:** area, volume and mass per construction layer.
- **Backend sample:** shows `Backend/samples/topology.json` as is.
- **Files menu:** exports `plan.json`, `topology.json`, `construction.json` and the layer geometry, so you can use them from Python or Grasshopper.

## Run locally

You need Rust (`rustup target add wasm32-unknown-unknown`), `cargo install wasm-bindgen-cli --version 0.2.129` (the version in `Backend/Cargo.lock`) and Node 22.

```bash
cd UI
npm install
npm run setup   # clone dirty-geometry into vendor/ (pinned commit) and build the backend to src/wasm
npm run dev
```

After you change Rust code, run `npm run wasm` again. To use your own dirty-geometry checkout, set `DIRTY_GEOMETRY=/path/to/dirty-geometry`. `npm test` runs the whole pipeline, from vec2 arrangement to wasm solve, including the backend sample.

## Deploy

`.github/workflows/pages.yml` builds the app and publishes it to GitHub Pages on every push to `main` that touches `UI/` or `Backend/`. You can also run it by hand from the Actions tab. Before the first run, set **Settings → Pages → Source** to **GitHub Actions**.
