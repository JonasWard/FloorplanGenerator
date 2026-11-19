import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Vec2 } from '@dirty-geometry/vec2/core/vec2';
import { Line2 } from '@dirty-geometry/vec2/geometry/primitives/line2';
import type { Arrangement, EdgeKind } from './planar';
import { newId, type Pt, type Wall } from './model';

export type Tool = 'draw' | 'rect' | 'select';

type Props = {
  walls: Wall[];
  arrangement: Arrangement;
  tool: Tool;
  gridStep: number;
  /** Extent of the built-up wall either side of the face plane, along the face normal. */
  band: Record<EdgeKind, { start: number; end: number }>;
  onChange: (walls: Wall[]) => void;
  /** Called on every pointer-down that will change walls, so the app can push one undo step. */
  onBeginEdit: () => void;
};

type View = { cx: number; cy: number; scale: number };
type Snap = { p: Pt; kind: 'node' | 'wall' | 'grid' };

const SNAP_PX = 10;
const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
const round = (v: number, step: number) => Math.round(v / step) * step;
const fmt = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(2);

export function PlanEditor({ walls, arrangement, tool, gridStep, band, onChange, onBeginEdit }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ cx: 5, cy: 4, scale: 50 });
  const [cursor, setCursor] = useState<Snap | null>(null);
  const [chain, setChain] = useState<Pt[]>([]);
  const [rectStart, setRectStart] = useState<Pt | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<
    | { type: 'pan'; x: number; y: number; view: View }
    | { type: 'node'; from: Pt; walls: Wall[] }
    | null
  >(null);
  const fitted = useRef(false);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect;
      setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const pts = walls.flatMap((w) => [w.a, w.b]);
    if (!pts.length) return setView({ cx: 5, cy: 4, scale: 50 });
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const scale = Math.min(size.w / (x1 - x0 + 3), size.h / (y1 - y0 + 3), 200);
    setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale });
  }, [walls, size]);

  useEffect(() => {
    if (!fitted.current && size.w > 1) {
      fitted.current = true;
      fit();
    }
  }, [size, fit]);

  useEffect(() => {
    setChain([]);
    setRectStart(null);
  }, [tool]);

  const toWorld = (sx: number, sy: number): Pt => [
    view.cx + (sx - size.w / 2) / view.scale,
    view.cy - (sy - size.h / 2) / view.scale,
  ];
  const toScreen = (p: Pt | Vec2): [number, number] => {
    const [x, y] = 'x' in p ? [p.x, p.y] : p;
    return [size.w / 2 + (x - view.cx) * view.scale, size.h / 2 - (y - view.cy) * view.scale];
  };

  const lines = useMemo(
    () => walls.map((w) => ({ wall: w, line: new Line2(new Vec2(w.a[0], w.a[1]), new Vec2(w.b[0], w.b[1])) })),
    [walls],
  );

  const snap = (raw: Pt, from: Pt | null, ortho: boolean, ignore?: Set<string>): Snap => {
    const tol = SNAP_PX / view.scale;
    const q = new Vec2(raw[0], raw[1]);
    if (ortho && from) {
      // Lock to the nearest multiple of 45° from the previous point, with a length on the grid.
      const dx = raw[0] - from[0];
      const dy = raw[1] - from[1];
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = round(Math.hypot(dx, dy), gridStep);
      return { p: [from[0] + Math.cos(a) * len, from[1] + Math.sin(a) * len].map((v) => round(v, 1e-6)) as unknown as Pt, kind: 'grid' };
    }
    let best: Snap | null = null;
    let bestD = tol;
    for (const n of arrangement.nodes) {
      const d = n.distance(q);
      if (d < bestD) {
        bestD = d;
        best = { p: [n.x, n.y], kind: 'node' };
      }
    }
    for (const { wall, line } of lines) {
      if (ignore?.has(wall.id)) continue;
      for (const end of [wall.a, wall.b]) {
        const d = Math.hypot(end[0] - raw[0], end[1] - raw[1]);
        if (d < bestD) {
          bestD = d;
          best = { p: end, kind: 'node' };
        }
      }
    }
    if (best) return best;
    bestD = tol;
    for (const { wall, line } of lines) {
      if (ignore?.has(wall.id)) continue;
      const c = line.closestPointForPoint(q);
      const d = c.distance(q);
      if (d < bestD) {
        bestD = d;
        // Prefer a grid position along the wall when the wall is axis-aligned.
        const gx = round(c.x, gridStep);
        const gy = round(c.y, gridStep);
        const onGrid = line.distanceToPoint(new Vec2(gx, gy)) < 1e-6;
        best = { p: onGrid ? [gx, gy] : [c.x, c.y], kind: 'wall' };
      }
    }
    if (best) return best;
    return { p: [round(raw[0], gridStep), round(raw[1], gridStep)], kind: 'grid' };
  };

  const local = (e: React.PointerEvent | React.WheelEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const hitWall = (raw: Pt): string | null => {
    const q = new Vec2(raw[0], raw[1]);
    let best: string | null = null;
    let bestD = 8 / view.scale;
    for (const { wall, line } of lines) {
      const d = line.distanceToPoint(q);
      if (d < bestD) {
        bestD = d;
        best = wall.id;
      }
    }
    return best;
  };

  const finishChain = () => setChain([]);

  const onPointerDown = (e: React.PointerEvent) => {
    const [sx, sy] = local(e);
    const raw = toWorld(sx, sy);
    svgRef.current!.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      drag.current = { type: 'pan', x: sx, y: sy, view };
      return;
    }
    if (e.button !== 0) return;

    if (tool === 'draw') {
      const s = snap(raw, chain.at(-1) ?? null, e.shiftKey);
      if (!chain.length) return setChain([s.p]);
      const prev = chain.at(-1)!;
      if (same(prev, s.p)) return finishChain();
      onBeginEdit();
      onChange([...walls, { id: newId(), a: prev, b: s.p }]);
      // Closing onto the start, or onto an existing node, ends the chain.
      if (same(chain[0]!, s.p) || (s.kind === 'node' && chain.length > 0 && !chain.some((c) => same(c, s.p)) && hasNode(s.p))) {
        return finishChain();
      }
      setChain([...chain, s.p]);
    } else if (tool === 'rect') {
      setRectStart(snap(raw, null, false).p);
    } else {
      // Select: grab a node to move it, else pick a wall.
      const tol = SNAP_PX / view.scale;
      const node = arrangement.nodes.find((n) => Math.hypot(n.x - raw[0], n.y - raw[1]) < tol);
      if (node) {
        const from: Pt = [node.x, node.y];
        drag.current = { type: 'node', from, walls };
        onBeginEdit();
        return;
      }
      setSelected(hitWall(raw));
    }
  };

  const hasNode = (p: Pt) => arrangement.nodes.some((n) => Math.hypot(n.x - p[0], n.y - p[1]) < 1e-6);

  const onPointerMove = (e: React.PointerEvent) => {
    const [sx, sy] = local(e);
    const raw = toWorld(sx, sy);
    const d = drag.current;
    if (d?.type === 'pan') {
      setView({ ...d.view, cx: d.view.cx - (sx - d.x) / d.view.scale, cy: d.view.cy + (sy - d.y) / d.view.scale });
      return;
    }
    if (d?.type === 'node') {
      const moving = new Set(d.walls.filter((w) => same(w.a, d.from) || same(w.b, d.from)).map((w) => w.id));
      const s = snap(raw, null, false, moving);
      setCursor(s);
      onChange(
        d.walls.map((w) =>
          moving.has(w.id) ? { ...w, a: same(w.a, d.from) ? s.p : w.a, b: same(w.b, d.from) ? s.p : w.b } : w,
        ),
      );
      return;
    }
    setCursor(tool === 'select' ? null : snap(raw, tool === 'draw' ? (chain.at(-1) ?? null) : null, e.shiftKey));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.type === 'node') {
      // Drop walls that collapsed to a point.
      onChange(walls.filter((w) => !same(w.a, w.b)));
      return;
    }
    if (tool === 'rect' && rectStart) {
      const [sx, sy] = local(e);
      const b = snap(toWorld(sx, sy), null, false).p;
      setRectStart(null);
      if (Math.abs(b[0] - rectStart[0]) < 1e-6 || Math.abs(b[1] - rectStart[1]) < 1e-6) return;
      const c: Pt[] = [rectStart, [b[0], rectStart[1]], b, [rectStart[0], b[1]]];
      onBeginEdit();
      onChange([...walls, ...c.map((p, i) => ({ id: newId(), a: p, b: c[(i + 1) % 4]! }))]);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const [sx, sy] = local(e);
    const [wx, wy] = toWorld(sx, sy);
    const scale = Math.min(800, Math.max(5, view.scale * Math.exp(-e.deltaY * 0.0015)));
    // Keep the point under the cursor fixed.
    setView({ scale, cx: wx - (sx - size.w / 2) / scale, cy: wy + (sy - size.h / 2) / scale });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      if (e.key === 'Escape' || e.key === 'Enter') {
        setChain([]);
        setRectStart(null);
        setSelected(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        onBeginEdit();
        onChange(walls.filter((w) => w.id !== selected));
        setSelected(null);
      } else if (e.key === 'f') {
        fit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, walls, onChange, onBeginEdit, fit]);

  // Grid lines in view.
  const [wx0, wy1] = toWorld(0, 0);
  const [wx1, wy0] = toWorld(size.w, size.h);
  const minor = view.scale * gridStep >= 8 ? gridStep : view.scale >= 8 ? 1 : 5;
  const gridLines: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
  for (let x = Math.ceil(wx0 / minor) * minor; x <= wx1; x += minor) {
    const [s] = toScreen([x, 0]);
    gridLines.push({ x1: s, y1: 0, x2: s, y2: size.h, major: Math.abs(x - Math.round(x)) < 1e-6 });
  }
  for (let y = Math.ceil(wy0 / minor) * minor; y <= wy1; y += minor) {
    const [, s] = toScreen([0, y]);
    gridLines.push({ x1: 0, y1: s, x2: size.w, y2: s, major: Math.abs(y - Math.round(y)) < 1e-6 });
  }

  const poly = (pts: (Pt | Vec2)[]) => pts.map((p) => toScreen(p).join(',')).join(' ');

  const bands = arrangement.edges.map((e, i) => {
    const [p, q] = e.kind === 'facade' && e.right >= 0 ? [e.b, e.a] : [e.a, e.b];
    const P = arrangement.nodes[p]!;
    const Q = arrangement.nodes[q]!;
    const t = Q.subtract(P).unit();
    const n = new Vec2(t.y, -t.x);
    const { start, end } = band[e.kind];
    const pts = [P.add(n.scale(start)), Q.add(n.scale(start)), Q.add(n.scale(end)), P.add(n.scale(end))];
    return <polygon key={i} points={poly(pts)} className={`band band-${e.kind}`} />;
  });

  const selectedWall = walls.find((w) => w.id === selected);
  const last = chain.at(-1);
  const preview: [Pt, Pt] | null =
    tool === 'draw' && last && cursor ? [last, cursor.p] : tool === 'rect' && rectStart && cursor ? [rectStart, cursor.p] : null;

  return (
    <svg
      ref={svgRef}
      className={`plan tool-${tool}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setCursor(null)}
      onWheel={onWheel}
      onDoubleClick={finishChain}
      onContextMenu={(e) => e.preventDefault()}
    >
      {gridLines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className={l.major ? "grid major" : "grid"} />
      ))}
      {arrangement.rooms.map((r, i) => (
        <polygon key={i} points={poly(r.nodes.map((n) => arrangement.nodes[n]!))} className="room" />
      ))}
      {bands}
      {arrangement.edges.map((e, i) => {
        const [x1, y1] = toScreen(arrangement.nodes[e.a]!);
        const [x2, y2] = toScreen(arrangement.nodes[e.b]!);
        const sel = selected !== null && e.walls.includes(selected);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={`edge edge-${e.kind}${sel ? ' selected' : ''}`} />;
      })}
      {arrangement.nodes.map((n, i) => {
        const [x, y] = toScreen(n);
        return <circle key={i} cx={x} cy={y} r={3} className="node" />;
      })}
      {arrangement.rooms.map((r, i) => {
        const [x, y] = toScreen(r.centroid);
        return (
          <text key={i} x={x} y={y} className="room-label">
            <tspan x={x}>Room {i + 1}</tspan>
            <tspan x={x} dy="1.2em">
              {r.area.toFixed(1)} m²
            </tspan>
          </text>
        );
      })}
      {selectedWall && <SelectedLabel wall={selectedWall} toScreen={toScreen} />}
      {preview && tool === 'draw' && (
        <>
          <line
            x1={toScreen(preview[0])[0]}
            y1={toScreen(preview[0])[1]}
            x2={toScreen(preview[1])[0]}
            y2={toScreen(preview[1])[1]}
            className="preview"
          />
          <text x={toScreen(preview[1])[0] + 12} y={toScreen(preview[1])[1] - 12} className="dim">
            {Math.hypot(preview[1][0] - preview[0][0], preview[1][1] - preview[0][1]).toFixed(2)} m
          </text>
        </>
      )}
      {preview && tool === 'rect' && (
        <>
          <polygon
            points={poly([preview[0], [preview[1][0], preview[0][1]], preview[1], [preview[0][0], preview[1][1]]])}
            className="preview"
          />
          <text x={toScreen(preview[1])[0] + 12} y={toScreen(preview[1])[1] - 12} className="dim">
            {Math.abs(preview[1][0] - preview[0][0]).toFixed(2)} × {Math.abs(preview[1][1] - preview[0][1]).toFixed(2)} m
          </text>
        </>
      )}
      {chain.map((p, i) => {
        const [x, y] = toScreen(p);
        return <circle key={i} cx={x} cy={y} r={4} className="chain" />;
      })}
      {cursor && (
        <g transform={`translate(${toScreen(cursor.p).join(',')})`} className={`cursor cursor-${cursor.kind}`}>
          {cursor.kind === 'node' ? <rect x={-6} y={-6} width={12} height={12} /> : cursor.kind === 'wall' ? <path d="M-6,6 L0,-6 L6,6 Z" /> : <circle r={5} />}
        </g>
      )}
      {cursor && (
        <text x={10} y={size.h - 10} className="coords">
          x {fmt(cursor.p[0])} · y {fmt(cursor.p[1])} · snap {cursor.kind}
        </text>
      )}
    </svg>
  );
}

function SelectedLabel({ wall, toScreen }: { wall: Wall; toScreen: (p: Pt) => [number, number] }) {
  const [x1, y1] = toScreen(wall.a);
  const [x2, y2] = toScreen(wall.b);
  const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  return (
    <text x={(x1 + x2) / 2 + 8} y={(y1 + y2) / 2 - 8} className="dim">
      {len.toFixed(2)} m · Delete to remove
    </text>
  );
}
