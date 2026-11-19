import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { arrange } from './planar';
import { buildTopology, defaultConstructions } from './topology';
import { defaultPlan, type Wall } from './model';
import { loadBackend, solveBuilding } from '../backend/backend';
import type { ConstructionSet } from '../backend/types';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const constructionJson = readFileSync(here('../../../Backend/samples/construction.json'), 'utf8');
const construction = JSON.parse(constructionJson) as ConstructionSet;

beforeAll(async () => {
  await loadBackend(readFileSync(here('../wasm/floorplan_backend_bg.wasm')));
});

const wall = (a: [number, number], b: [number, number]): Wall => ({ id: `${a}-${b}`, a, b });

describe('arrange', () => {
  it('finds the three rooms of the default plan and classifies walls', () => {
    const { rooms, edges, nodes } = arrange(defaultPlan().walls);
    expect(rooms.map((r) => r.area).sort((a, b) => a - b)).toEqual([
      expect.closeTo(14, 6),
      expect.closeTo(18, 6),
      expect.closeTo(48, 6),
    ]);
    expect(nodes.length).toBe(8);
    expect(edges.filter((e) => e.kind === 'internal').length).toBe(3);
    expect(edges.filter((e) => e.kind === 'facade').length).toBe(7);
  });

  it('splits crossing walls and ignores dangling ones', () => {
    const { rooms, edges } = arrange([
      wall([0, 0], [4, 0]),
      wall([4, 0], [4, 4]),
      wall([4, 4], [0, 4]),
      wall([0, 4], [0, 0]),
      wall([2, -1], [2, 5]), // crosses the box, sticks out on both sides
      wall([3, 2], [3.5, 2]), // free-standing
    ]);
    expect(rooms.length).toBe(2);
    expect(edges.length).toBe(4 + 2 + 3 + 1); // outline split twice, 3 pieces of the cross wall, the free wall
  });
});

describe('backend', () => {
  it('solves the generated topology of the default plan', () => {
    const plan = defaultPlan();
    const arrangement = arrange(plan.walls);
    const topo = buildTopology(arrangement, plan.storeys, plan.storeyHeight, defaultConstructions(construction));
    const { faces } = solveBuilding(JSON.stringify(topo), constructionJson);
    expect(faces.length).toBe(Object.keys(topo.faces).length);
    for (const face of faces) {
      for (const layer of face.layers) {
        expect(layer.area).toBeGreaterThan(0);
        for (const p of [...layer.inner, ...layer.outer]) for (const c of p) expect(Number.isFinite(c)).toBe(true);
      }
    }
  });

  it('runs the sample topology from Backend/samples', () => {
    const topologyJson = readFileSync(here('../../../Backend/samples/topology.json'), 'utf8');
    expect(solveBuilding(topologyJson, constructionJson).faces.length).toBe(100);
  });
});
