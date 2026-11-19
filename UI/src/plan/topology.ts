/**
 * Builds the backend's topology JSON (Backend/src/bim/topology) from a planar arrangement, storey by storey.
 *
 * Conventions read off Backend/samples/topology.json and the solver:
 * - a face's vertex loop runs counter-clockwise around its normal `n` (`uvn[2]`), and `edges[i]` joins
 *   `verts[i]` and `verts[i + 1]`;
 * - layers stack along `n` from the face plane, so a facade's drawn line is its inner face and `n` points out;
 * - floors and the roof face up, the foundation faces down;
 * - every room on every storey is a cell, bounded by its walls, the slab below and the slab above.
 */
import type { Arrangement } from './planar';
import type { ConstructionSet } from '../backend/types';

type V3 = [number, number, number];

export type TopologyJson = {
  verts: Record<string, { coords: V3; edges: string[]; dictionary: object }>;
  edges: Record<string, { verts: string[]; faces: string[]; dictionary: object }>;
  faces: Record<
    string,
    {
      verts: string[];
      edges: string[];
      cells: string[];
      construction: string;
      type: FaceType;
      uvn: [V3, V3, V3];
      dictionary: object;
    }
  >;
  cells: Record<string, { faces: string[]; dictionary: object }>;
};

export type FaceType = 'Facade' | 'Internal wall' | 'Floor' | 'Roof' | 'Foundation';
export const FACE_TYPES: FaceType[] = ['Facade', 'Internal wall', 'Floor', 'Roof', 'Foundation'];

/** Construction (layer group) per face type, looked up by layer group name. */
export type ConstructionChoice = Record<FaceType, string>;

export function defaultConstructions(set: ConstructionSet): ConstructionChoice {
  const byName = (name: string) => {
    const hit = Object.entries(set.layer_groups).find(([, g]) => g.name === name);
    if (!hit) throw new Error(`construction set has no layer group named "${name}"`);
    return hit[0];
  };
  return {
    Facade: byName('Facade'),
    'Internal wall': byName('Interior wall'),
    Floor: byName('Floor'),
    Roof: byName('Roof'),
    Foundation: byName('Foundation'),
  };
}

export function buildTopology(
  arrangement: Arrangement,
  storeys: number,
  storeyHeight: number,
  constructions: ConstructionChoice,
): TopologyJson {
  const { nodes, edges, rooms } = arrangement;
  const topo: TopologyJson = { verts: {}, edges: {}, faces: {}, cells: {} };

  const vert = (n: number, level: number) => {
    const id = `v${n}_${level}`;
    if (!topo.verts[id]) {
      const p = nodes[n]!;
      topo.verts[id] = { coords: [p.x, p.y, level * storeyHeight], edges: [], dictionary: {} };
    }
    return id;
  };
  const edge = (id: string, a: string, b: string) => {
    if (!topo.edges[id]) {
      topo.edges[id] = { verts: [a, b], faces: [], dictionary: {} };
      topo.verts[a]!.edges.push(id);
      topo.verts[b]!.edges.push(id);
    }
    return id;
  };
  const planEdge = (e: number, level: number) => edge(`e${e}_${level}`, vert(edges[e]!.a, level), vert(edges[e]!.b, level));
  const riser = (n: number, storey: number) => edge(`r${n}_${storey}`, vert(n, storey), vert(n, storey + 1));
  const cell = (room: number, storey: number) => `c${room}_${storey}`;

  const addFace = (
    id: string,
    type: FaceType,
    verts: string[],
    faceEdges: string[],
    cells: string[],
    u: V3,
    n: V3,
  ) => {
    topo.faces[id] = {
      verts,
      edges: faceEdges,
      cells,
      construction: constructions[type],
      type,
      uvn: [u, cross(n, u), n],
      dictionary: {},
    };
    for (const e of faceEdges) topo.edges[e]!.faces.push(id);
    for (const c of cells) (topo.cells[c] ??= { faces: [], dictionary: {} }).faces.push(id);
  };

  for (let s = 0; s < storeys; s++) {
    edges.forEach((e, i) => {
      // The loop [p0, q0, q1, p1] has its normal on the right of p → q. A facade's normal points away from its room.
      const [p, q] = e.kind === 'facade' && e.right >= 0 ? [e.b, e.a] : [e.a, e.b];
      const P = nodes[p]!;
      const Q = nodes[q]!;
      const len = Math.hypot(Q.x - P.x, Q.y - P.y);
      const u: V3 = [(Q.x - P.x) / len, (Q.y - P.y) / len, 0];
      const n: V3 = [u[1], -u[0], 0];
      const cells = [e.left, e.right].filter((r) => r >= 0).map((r) => cell(r, s));
      addFace(
        `w${i}_${s}`,
        e.kind === 'facade' ? 'Facade' : 'Internal wall',
        [vert(p, s), vert(q, s), vert(q, s + 1), vert(p, s + 1)],
        [planEdge(i, s), riser(q, s), planEdge(i, s + 1), riser(p, s)],
        cells,
        u,
        n,
      );
    });
  }

  for (let level = 0; level <= storeys; level++) {
    const type: FaceType = level === 0 ? 'Foundation' : level === storeys ? 'Roof' : 'Floor';
    rooms.forEach((room, r) => {
      const cells = [level - 1, level].filter((s) => s >= 0 && s < storeys).map((s) => cell(r, s));
      let loop = room.nodes.map((n) => vert(n, level));
      let loopEdges = room.edges.map((e) => planEdge(e, level));
      let n: V3 = [0, 0, 1];
      if (type === 'Foundation') {
        // Clockwise seen from above, so counter-clockwise around a downward normal.
        loop = [loop[0]!, ...loop.slice(1).reverse()];
        loopEdges = [...loopEdges].reverse();
        n = [0, 0, -1];
      }
      addFace(`s${r}_${level}`, type, loop, loopEdges, cells, [1, 0, 0], n);
    });
  }

  return topo;
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
