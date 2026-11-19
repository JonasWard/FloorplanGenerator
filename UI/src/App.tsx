import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import constructionRaw from '../../Backend/samples/construction.json?raw';
import sampleTopologyRaw from '../../Backend/samples/topology.json?raw';
import { PlanEditor, type Tool } from './plan/PlanEditor';
import { arrange } from './plan/planar';
import { buildTopology, defaultConstructions, FACE_TYPES } from './plan/topology';
import { defaultPlan, type Plan, type Wall } from './plan/model';
import { loadBackend, solveBuilding, type SolveResult } from './backend/backend';
import { centreGroup, groupThickness } from './backend/construction';
import type { ConstructionSet } from './backend/types';
import { BuildingView, type Picked } from './view/BuildingView';
import { makeColorOf } from './view/colors';
import { takeoff } from './view/takeoff';

const STORAGE_KEY = 'floorplan-ui/plan';
const baseConstruction = JSON.parse(constructionRaw) as ConstructionSet;
const choice = defaultConstructions(baseConstruction);
/** The sample construction set, with interior walls centred on their drawn line. */
const construction = centreGroup(baseConstruction, choice['Internal wall']);
const constructionJson = JSON.stringify(construction);

type Source = 'plan' | 'sample';

function loadPlan(): Plan {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Plan;
  } catch {
    /* storage unavailable: start fresh */
  }
  return defaultPlan();
}

export function App() {
  const [plan, setPlan] = useState<Plan>(loadPlan);
  const past = useRef<Wall[][]>([]);
  const future = useRef<Wall[][]>([]);
  const [tool, setTool] = useState<Tool>('draw');
  const [gridStep, setGridStep] = useState(0.1);
  const [source, setSource] = useState<Source>('plan');
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set(['Roof']));
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [explode, setExplode] = useState(0);
  const [picked, setPicked] = useState<Picked | null>(null);

  useEffect(() => {
    loadBackend().then(
      () => setReady(true),
      (e: unknown) => setLoadError(String(e)),
    );
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    } catch {
      /* ignore */
    }
  }, [plan]);

  const setWalls = useCallback((walls: Wall[]) => setPlan((p) => ({ ...p, walls })), []);
  const beginEdit = useCallback(() => {
    setPlan((p) => {
      past.current.push(p.walls);
      future.current = [];
      return p;
    });
  }, []);
  const undo = useCallback(() => {
    setPlan((p) => {
      const prev = past.current.pop();
      if (!prev) return p;
      future.current.push(p.walls);
      return { ...p, walls: prev };
    });
  }, []);
  const redo = useCallback(() => {
    setPlan((p) => {
      const next = future.current.pop();
      if (!next) return p;
      past.current.push(p.walls);
      return { ...p, walls: next };
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (!e.ctrlKey && !e.metaKey) {
        if (e.key === 'd') setTool('draw');
        if (e.key === 'r') setTool('rect');
        if (e.key === 'v' || e.key === 's') setTool('select');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const arrangement = useMemo(() => arrange(plan.walls), [plan.walls]);
  const topology = useMemo(
    () => buildTopology(arrangement, plan.storeys, plan.storeyHeight, choice),
    [arrangement, plan.storeys, plan.storeyHeight],
  );
  const topologyJson = useMemo(() => JSON.stringify(topology, null, 2), [topology]);

  const solved = useMemo<{ result: SolveResult | null; error: string | null }>(() => {
    if (!ready) return { result: null, error: null };
    try {
      return source === 'sample'
        ? { result: solveBuilding(sampleTopologyRaw, constructionRaw), error: null }
        : { result: solveBuilding(topologyJson, constructionJson), error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [ready, source, topologyJson]);

  const shownConstruction = source === 'sample' ? baseConstruction : construction;
  const colorOf = useMemo(() => makeColorOf(shownConstruction), [shownConstruction]);
  const faces = solved.result?.faces ?? [];
  const rows = useMemo(() => takeoff(faces, shownConstruction, hiddenTypes), [faces, shownConstruction, hiddenTypes]);
  const layerNames = useMemo(() => [...new Set(faces.flatMap((f) => f.layers.map((l) => l.name)))], [faces]);

  const band = useMemo(
    () => ({ facade: groupThickness(construction, choice.Facade), internal: groupThickness(construction, choice['Internal wall']) }),
    [],
  );

  const toggle = (set: Set<string>, value: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  const download = (name: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importPlan = (file: File) => {
    file.text().then((text) => {
      try {
        const p = JSON.parse(text) as Plan;
        if (!Array.isArray(p.walls)) throw new Error('no walls');
        beginEdit();
        setPlan({ storeys: p.storeys ?? 1, storeyHeight: p.storeyHeight ?? 3, walls: p.walls });
      } catch (e) {
        alert(`Could not read plan: ${String(e)}`);
      }
    });
  };

  const totals = rows.reduce((t, r) => ({ volume: t.volume + r.volume, mass: t.mass + r.mass }), { volume: 0, mass: 0 });

  return (
    <div className="app">
      <header>
        <h1>Floorplan Generator</h1>
        <div className="seg" role="tablist" aria-label="Source">
          <button className={source === 'plan' ? 'on' : ''} onClick={() => setSource('plan')}>
            Plan editor
          </button>
          <button className={source === 'sample' ? 'on' : ''} onClick={() => setSource('sample')}>
            Backend sample
          </button>
        </div>
        {source === 'plan' && (
          <>
            <div className="seg" aria-label="Tool">
              <button className={tool === 'draw' ? 'on' : ''} onClick={() => setTool('draw')} title="Draw walls (D)">
                Draw
              </button>
              <button className={tool === 'rect' ? 'on' : ''} onClick={() => setTool('rect')} title="Rectangle room (R)">
                Rectangle
              </button>
              <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')} title="Select / move nodes (V)">
                Select
              </button>
            </div>
            <label>
              Grid
              <select value={gridStep} onChange={(e) => setGridStep(Number(e.target.value))}>
                {[0.05, 0.1, 0.25, 0.5, 1].map((s) => (
                  <option key={s} value={s}>
                    {s} m
                  </option>
                ))}
              </select>
            </label>
            <label>
              Storeys
              <input
                type="number"
                min={1}
                max={10}
                value={plan.storeys}
                onChange={(e) => setPlan((p) => ({ ...p, storeys: Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 1))) }))}
              />
            </label>
            <label>
              Height
              <input
                type="number"
                min={2}
                max={6}
                step={0.1}
                value={plan.storeyHeight}
                onChange={(e) => setPlan((p) => ({ ...p, storeyHeight: Math.max(2, Math.min(6, Number(e.target.value) || 3)) }))}
              />
              m
            </label>
            <div className="seg">
              <button onClick={undo} title="Undo (Ctrl+Z)">
                Undo
              </button>
              <button onClick={redo} title="Redo (Ctrl+Shift+Z)">
                Redo
              </button>
              <button
                onClick={() => {
                  beginEdit();
                  setPlan((p) => ({ ...p, walls: [] }));
                }}
              >
                Clear
              </button>
              <button
                onClick={() => {
                  beginEdit();
                  setPlan(defaultPlan());
                }}
              >
                Example
              </button>
            </div>
          </>
        )}
        <div className="spacer" />
        <details className="menu">
          <summary>Files</summary>
          <div className="menu-body">
            <button onClick={() => download('plan.json', JSON.stringify(plan, null, 2))}>Export plan.json</button>
            <label className="file">
              Import plan.json
              <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && importPlan(e.target.files[0])} />
            </label>
            <button onClick={() => download('topology.json', topologyJson)}>Export topology.json</button>
            <button onClick={() => download('construction.json', JSON.stringify(construction, null, 2))}>Export construction.json</button>
            {solved.result && (
              <button onClick={() => download('layer_geometry.json', JSON.stringify(solved.result!.faces))}>Export layer geometry</button>
            )}
          </div>
        </details>
      </header>

      <main className={source === 'sample' ? 'no-plan' : ''}>
        {source === 'plan' && (
          <section className="pane plan-pane">
            <PlanEditor
              walls={plan.walls}
              arrangement={arrangement}
              tool={tool}
              gridStep={gridStep}
              band={band}
              onChange={setWalls}
              onBeginEdit={beginEdit}
            />
            <div className="hint">
              {tool === 'draw' && 'Click to place wall points · Shift: 45° lock · double-click / Esc to finish'}
              {tool === 'rect' && 'Drag to add a rectangular room'}
              {tool === 'select' && 'Click a wall, Delete to remove · drag a node to move it'}
              {' · wheel: zoom · right-drag: pan · F: fit'}
            </div>
          </section>
        )}
        <section className="pane view-pane">
          {loadError ? (
            <div className="message error">Could not load the backend: {loadError}. Run `npm run wasm`.</div>
          ) : !ready ? (
            <div className="message">Loading backend…</div>
          ) : solved.error ? (
            <div className="message error">Backend error: {solved.error}</div>
          ) : faces.length === 0 ? (
            <div className="message">Draw walls to see the building.</div>
          ) : (
            <BuildingView
              faces={faces}
              colorOf={colorOf}
              hiddenTypes={hiddenTypes}
              hiddenLayers={hiddenLayers}
              explode={explode}
              onPick={setPicked}
              picked={picked}
            />
          )}
        </section>

        <aside className="pane side">
          <div className="stats">
            {source === 'plan' && (
              <>
                <span>
                  <b>{arrangement.rooms.length}</b> rooms
                </span>
                <span>
                  <b>{arrangement.edges.filter((e) => e.kind === 'facade').length}</b> facade ·{' '}
                  <b>{arrangement.edges.filter((e) => e.kind === 'internal').length}</b> internal walls
                </span>
              </>
            )}
            <span>
              <b>{faces.length}</b> faces
            </span>
            {solved.result && <span>joints solved in {solved.result.solveMs.toFixed(1)} ms</span>}
          </div>

          <h2>Show</h2>
          <div className="chips">
            {FACE_TYPES.map((t) => (
              <label key={t} className="chip">
                <input type="checkbox" checked={!hiddenTypes.has(t)} onChange={() => toggle(hiddenTypes, t, setHiddenTypes)} />
                {t}
              </label>
            ))}
          </div>
          <div className="chips">
            {layerNames.map((n) => (
              <label key={n} className="chip">
                <input type="checkbox" checked={!hiddenLayers.has(n)} onChange={() => toggle(hiddenLayers, n, setHiddenLayers)} />
                {n}
              </label>
            ))}
          </div>
          <label className="slider">
            Explode layers
            <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(Number(e.target.value))} />
          </label>

          {picked && (
            <>
              <h2>Selected layer</h2>
              <dl className="picked">
                <dt>Face</dt>
                <dd>
                  {picked.face.type} <code>{picked.face.uuid.slice(0, 8)}</code>
                </dd>
                <dt>Layer</dt>
                <dd>
                  {picked.index + 1}. {picked.layer.name}
                </dd>
                <dt>Area</dt>
                <dd>{picked.layer.area.toFixed(3)} m²</dd>
                <dt>Joints</dt>
                <dd>
                  {picked.layer.joints.filter(Boolean).length} of {picked.layer.joints.length} edges
                </dd>
              </dl>
            </>
          )}

          <h2>Quantity takeoff</h2>
          <table className="takeoff">
            <thead>
              <tr>
                <th>Layer</th>
                <th className="num">m²</th>
                <th className="num">m³</th>
                <th className="num">kg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.uuid}>
                  <td>
                    <span className="swatch" style={{ background: colorOf({ uuid: r.uuid, name: r.layer }) }} />
                    {r.layer}
                    <small className="sub">
                      {(r.thickness * 1000).toFixed(0)} mm {r.material} · {r.faces}×
                    </small>
                  </td>
                  <td className="num">{r.area.toFixed(1)}</td>
                  <td className="num">{r.volume.toFixed(2)}</td>
                  <td className="num">{Math.round(r.mass).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total{hiddenTypes.size ? ' (shown faces)' : ''}</td>
                <td className="num">{totals.volume.toFixed(2)}</td>
                <td className="num">{Math.round(totals.mass).toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </aside>
      </main>
    </div>
  );
}
