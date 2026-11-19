/**
 * Turns loosely drawn walls into a clean planar arrangement, using @dirty-geometry/vec2:
 * - walls are split where they cross (Intersection2.segmentCrossings) and where another wall ends on them (T-junctions);
 * - coincident points become one node;
 * - rooms are the bounded faces of the arrangement (traced by angle, kept when Polygon2 area is positive);
 * - an edge with a room on both sides is an internal wall, any other edge is a facade.
 */
import { Vec2 } from '@dirty-geometry/vec2/core/vec2';
import { Line2 } from '@dirty-geometry/vec2/geometry/primitives/line2';
import { Polygon2 } from '@dirty-geometry/vec2/geometry/regions/polygon2';
import { Intersection2 } from '@dirty-geometry/vec2/operations/intersection2';
import type { Wall } from './model';

export type EdgeKind = 'facade' | 'internal';

export type PlanEdge = {
  a: number;
  b: number;
  /** Walls this edge came from (several when drawn walls overlap). */
  walls: string[];
  kind: EdgeKind;
  /** Room on the left of a → b, on the right of a → b (-1: none). */
  left: number;
  right: number;
};

export type Room = {
  /** Node loop, counter-clockwise. */
  nodes: number[];
  /** `edges[i]` joins `nodes[i]` and `nodes[i + 1]`. */
  edges: number[];
  polygon: Polygon2;
  area: number;
  centroid: Vec2;
};

export type Arrangement = {
  nodes: Vec2[];
  edges: PlanEdge[];
  rooms: Room[];
};

/** Points closer than this are one node (metres). */
export const MERGE_TOLERANCE = 1e-4;

export function arrange(walls: readonly Wall[]): Arrangement {
  const lines = walls
    .map((w) => ({ wall: w, line: new Line2(new Vec2(w.a[0], w.a[1]), new Vec2(w.b[0], w.b[1])) }))
    .filter(({ line }) => line.length() > MERGE_TOLERANCE);

  // Parameters along each wall where it must be split.
  const splits: number[][] = lines.map(() => [0, 1]);
  for (const { point, i, j } of Intersection2.segmentCrossings(lines.map((l) => l.line))) {
    splits[i]!.push(lines[i]!.line.closestParameterForPoint(point));
    splits[j]!.push(lines[j]!.line.closestParameterForPoint(point));
  }
  // T-junctions and collinear overlaps: every wall end that lies on another wall splits it.
  lines.forEach(({ line }, i) => {
    for (const end of [line.from, line.to]) {
      lines.forEach((other, j) => {
        if (i !== j && other.line.distanceToPoint(end) < MERGE_TOLERANCE) {
          splits[j]!.push(other.line.closestParameterForPoint(end));
        }
      });
    }
  });

  const nodes: Vec2[] = [];
  const nodeAt = new Map<string, number>();
  const key = (p: Vec2) => `${Math.round(p.x / MERGE_TOLERANCE)},${Math.round(p.y / MERGE_TOLERANCE)}`;
  const node = (p: Vec2): number => {
    const k = key(p);
    let id = nodeAt.get(k);
    if (id === undefined) {
      id = nodes.length;
      nodes.push(p);
      nodeAt.set(k, id);
    }
    return id;
  };

  const edges: PlanEdge[] = [];
  const edgeAt = new Map<string, number>();
  lines.forEach(({ wall, line }, i) => {
    const ts = [...new Set(splits[i]!.map((t) => Math.min(1, Math.max(0, t))))].sort((x, y) => x - y);
    const ids = ts.map((t) => node(line.evaluate(t)));
    for (let k = 0; k + 1 < ids.length; k++) {
      const a = ids[k]!;
      const b = ids[k + 1]!;
      if (a === b) continue;
      const ek = a < b ? `${a}:${b}` : `${b}:${a}`;
      const existing = edgeAt.get(ek);
      if (existing !== undefined) {
        edges[existing]!.walls.push(wall.id);
      } else {
        edgeAt.set(ek, edges.length);
        edges.push({ a, b, walls: [wall.id], kind: 'facade', left: -1, right: -1 });
      }
    }
  });

  const rooms = traceRooms(nodes, edges);
  rooms.forEach((room, r) => {
    room.edges.forEach((e, i) => {
      const edge = edges[e]!;
      // The room is on the left of its own (counter-clockwise) traversal direction.
      if (edge.a === room.nodes[i]) edge.left = r;
      else edge.right = r;
    });
  });
  for (const edge of edges) edge.kind = edge.left >= 0 && edge.right >= 0 ? 'internal' : 'facade';

  return { nodes, edges, rooms };
}

/** Bounded faces of the arrangement, after peeling off dangling walls. */
function traceRooms(nodes: readonly Vec2[], edges: readonly PlanEdge[]): Room[] {
  const alive = edges.map(() => true);
  const degree = nodes.map(() => 0);
  for (const e of edges) {
    degree[e.a]!++;
    degree[e.b]!++;
  }
  // Peel spurs: a wall end that touches nothing cannot bound a room.
  let changed = true;
  while (changed) {
    changed = false;
    edges.forEach((e, i) => {
      if (alive[i] && (degree[e.a] === 1 || degree[e.b] === 1)) {
        alive[i] = false;
        degree[e.a]!--;
        degree[e.b]!--;
        changed = true;
      }
    });
  }

  // Outgoing half-edges per node, sorted counter-clockwise by angle.
  type Half = { to: number; edge: number };
  const out: Half[][] = nodes.map(() => []);
  edges.forEach((e, i) => {
    if (!alive[i]) return;
    out[e.a]!.push({ to: e.b, edge: i });
    out[e.b]!.push({ to: e.a, edge: i });
  });
  out.forEach((list, n) => {
    const p = nodes[n]!;
    list.sort((h, k) => angle(p, nodes[h.to]!) - angle(p, nodes[k.to]!));
  });

  const visited = new Set<string>();
  const rooms: Room[] = [];
  out.forEach((list, start) => {
    for (const first of list) {
      if (visited.has(`${start}>${first.to}`)) continue;
      const loop: number[] = [];
      const loopEdges: number[] = [];
      let from = start;
      let half = first;
      // Walk with the face on the left: at each node take the next half-edge clockwise from the one we came in on.
      for (let guard = 0; guard <= edges.length * 2; guard++) {
        visited.add(`${from}>${half.to}`);
        loop.push(from);
        loopEdges.push(half.edge);
        const at = out[half.to]!;
        const back = at.findIndex((h) => h.to === from);
        const next = at[(back - 1 + at.length) % at.length]!;
        from = half.to;
        half = next;
        if (from === start && half.to === first.to) break;
      }
      if (loop.length < 3) continue;
      const polygon = new Polygon2(loop.map((n) => nodes[n]!));
      const signed = polygon.signedArea();
      if (signed <= MERGE_TOLERANCE) continue; // the outside of a component
      rooms.push({ nodes: loop, edges: loopEdges, polygon, area: signed, centroid: areaCentroid(polygon) });
    }
  });
  return rooms;
}

const angle = (from: Vec2, to: Vec2) => Math.atan2(to.y - from.y, to.x - from.x);

function areaCentroid(polygon: Polygon2): Vec2 {
  const v = polygon.vertices;
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < v.length; i++) {
    const p = v[i]!;
    const q = v[(i + 1) % v.length]!;
    const c = p.crossProduct(q);
    a += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  return Math.abs(a) < 1e-12 ? Vec2.center(...v) : new Vec2(cx / (3 * a), cy / (3 * a));
}
