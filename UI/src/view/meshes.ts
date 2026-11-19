/**
 * Turns the backend's layer geometry (an inner and an outer loop per layer) into solid meshes.
 * The two caps are triangulated in their plane with vec2's ConstrainedDelaunay; the sides join the loops.
 */
import * as THREE from 'three';
import { Vec2 } from '@dirty-geometry/vec2/core/vec2';
import { Polygon2 } from '@dirty-geometry/vec2/geometry/regions/polygon2';
import { ConstrainedDelaunay } from '@dirty-geometry/vec2/operations/constrained-delaunay';
import type { LayerResult, P3 } from '../backend/types';

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V): V => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Newell normal of a loop. */
function loopNormal(loop: P3[]): V {
  const n: V = [0, 0, 0];
  loop.forEach((p, i) => {
    const q = loop[(i + 1) % loop.length]!;
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  });
  return norm(n);
}

/** Triangles of a planar loop, as 3D points, wound so their normal agrees with `facing`. */
function capTriangles(loop: P3[], facing: V): V[] {
  if (loop.length < 3) return [];
  const n = loopNormal(loop);
  const o = loop[0]!;
  let u: V = [0, 0, 0];
  for (const p of loop) {
    u = sub(p, o);
    if (Math.hypot(...u) > 1e-9) break;
  }
  u = norm(u);
  const v = cross(n, u);
  const flat = loop.map((p) => new Vec2(dot(sub(p, o), u), dot(sub(p, o), v)));
  const lift = (q: Vec2): V => [o[0] + u[0] * q.x + v[0] * q.y, o[1] + u[1] * q.x + v[1] * q.y, o[2] + u[2] * q.x + v[2] * q.y];

  let polygon: Polygon2;
  try {
    polygon = new Polygon2(flat);
  } catch {
    return [];
  }
  const constraints = flat.map((_, i) => [i, (i + 1) % flat.length] as const);
  const mesh = ConstrainedDelaunay.triangulate(flat, constraints);
  const flip = dot(n, facing) < 0;
  const out: V[] = [];
  for (const [a, b, c] of mesh.triangles) {
    const A = mesh.vertices[a]!;
    const B = mesh.vertices[b]!;
    const C = mesh.vertices[c]!;
    // The triangulation covers the convex hull: keep what lies inside the loop.
    if (!polygon.containsPoint(Vec2.center(A, B, C))) continue;
    const ccw = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) > 0;
    const tri = ccw !== flip ? [A, B, C] : [A, C, B];
    out.push(...tri.map(lift));
  }
  return out;
}

export function layerGeometry(layer: LayerResult): THREE.BufferGeometry {
  const { inner, outer } = layer;
  const stack = norm(sub(centroid(outer), centroid(inner)));
  const positions: V[] = [...capTriangles(inner, [-stack[0], -stack[1], -stack[2]]), ...capTriangles(outer, stack)];

  if (inner.length === outer.length) {
    const ccw = dot(loopNormal(inner), stack) > 0;
    for (let i = 0; i < inner.length; i++) {
      const j = (i + 1) % inner.length;
      const a = inner[i]!;
      const b = inner[j]!;
      const c = outer[j]!;
      const d = outer[i]!;
      if (ccw) positions.push(a, b, c, a, c, d);
      else positions.push(a, c, b, a, d, c);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions.flat(), 3));
  g.computeVertexNormals();
  return g;
}

export function layerOutline(layer: LayerResult): THREE.BufferGeometry {
  const pts: V[] = [];
  const ring = (loop: P3[]) => loop.forEach((p, i) => pts.push(p, loop[(i + 1) % loop.length]!));
  ring(layer.inner);
  ring(layer.outer);
  if (layer.inner.length === layer.outer.length) layer.inner.forEach((p, i) => pts.push(p, layer.outer[i]!));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  return g;
}

function centroid(loop: P3[]): V {
  const c: V = [0, 0, 0];
  for (const p of loop) for (let k = 0; k < 3; k++) c[k]! += p[k]! / loop.length;
  return c;
}
