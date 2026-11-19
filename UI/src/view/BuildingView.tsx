import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { FaceResult, LayerResult } from '../backend/types';
import { layerGeometry, layerOutline } from './meshes';

export type Picked = { face: FaceResult; layer: LayerResult; index: number };

type Props = {
  faces: FaceResult[];
  colorOf: (layer: Pick<LayerResult, 'uuid' | 'name'>) => string;
  hiddenTypes: Set<string>;
  hiddenLayers: Set<string>;
  explode: number;
  onPick: (p: Picked | null) => void;
  picked: Picked | null;
};

type Item = {
  key: string;
  face: FaceResult;
  layer: LayerResult;
  index: number;
  geometry: THREE.BufferGeometry;
  outline: THREE.BufferGeometry;
  /** Direction from the face plane to this layer (for the exploded view). */
  offset: THREE.Vector3;
};

type Preset = { name: 'perspective' | 'top'; n: number };

export function BuildingView({ faces, colorOf, hiddenTypes, hiddenLayers, explode, onPick, picked }: Props) {
  const items = useMemo<Item[]>(
    () =>
      faces.flatMap((face) =>
        face.layers.map((layer, index) => {
          const c = (loop: number[][]) =>
            loop.reduce((a, p) => a.add(new THREE.Vector3(p[0], p[1], p[2])), new THREE.Vector3()).divideScalar(loop.length);
          return {
            key: `${face.uuid}:${index}`,
            face,
            layer,
            index,
            geometry: layerGeometry(layer),
            outline: layerOutline(layer),
            offset: c(layer.outer).sub(c(layer.inner)).normalize().multiplyScalar(index),
          };
        }),
      ),
    [faces],
  );
  useEffect(
    () => () => {
      for (const it of items) {
        it.geometry.dispose();
        it.outline.dispose();
      }
    },
    [items],
  );

  const bounds = useMemo(() => {
    const box = new THREE.Box3();
    for (const f of faces) for (const l of f.layers) for (const p of [...l.inner, ...l.outer]) box.expandByPoint(new THREE.Vector3(...p));
    return box.isEmpty() ? new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 10, 6)) : box;
  }, [faces]);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getSize(new THREE.Vector3()).length() / 2 || 10;

  const [hover, setHover] = useState<string | null>(null);
  const [cut, setCut] = useState(1); // fraction of the height; 1 = no cut
  const [preset, setPreset] = useState<Preset>({ name: 'perspective', n: 0 });
  const cutZ = bounds.min.z + (bounds.max.z - bounds.min.z) * cut + 1e-3;
  const planes = useMemo(() => (cut < 1 ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), cutZ)] : []), [cut, cutZ]);

  return (
    <div className="view3d">
      <Canvas
        gl={{ localClippingEnabled: true }}
        camera={{ up: [0, 0, 1], position: [center.x + radius * 1.4, center.y - radius * 1.6, center.z + radius * 1.2], near: 0.05, far: 2000 }}
        onPointerMissed={() => onPick(null)}
      >
        <color attach="background" args={['#f4f3ef']} />
        <hemisphereLight args={['#ffffff', '#b8b4a8', 2.2]} />
        <directionalLight position={[center.x + radius, center.y - radius * 0.6, center.z + radius * 2]} intensity={1.4} />
        <directionalLight position={[center.x - radius, center.y + radius, center.z + radius]} intensity={0.5} />
        <gridHelper
          args={[Math.ceil(radius * 4), Math.ceil(radius * 4), '#c9c6bb', '#e0ded6']}
          rotation={[Math.PI / 2, 0, 0]}
          position={[center.x, center.y, bounds.min.z - 0.002]}
        />
        {items.map((it) => {
          if (hiddenTypes.has(it.face.type) || hiddenLayers.has(it.layer.name)) return null;
          const isPicked = picked?.face.uuid === it.face.uuid && picked.index === it.index;
          return (
            <group key={it.key} position={it.offset.clone().multiplyScalar(explode * 0.15)}>
              <mesh
                geometry={it.geometry}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHover(it.key);
                }}
                onPointerOut={() => setHover((h) => (h === it.key ? null : h))}
                onClick={(e) => {
                  e.stopPropagation();
                  onPick({ face: it.face, layer: it.layer, index: it.index });
                }}
              >
                <meshStandardMaterial
                  color={isPicked ? '#d9480f' : colorOf(it.layer)}
                  emissive={hover === it.key ? '#2a2a2a' : '#000'}
                  side={THREE.DoubleSide}
                  roughness={0.9}
                  clippingPlanes={planes}
                  polygonOffset
                  polygonOffsetFactor={1}
                  polygonOffsetUnits={1}
                />
              </mesh>
              <lineSegments geometry={it.outline}>
                <lineBasicMaterial color="#3d3a33" transparent opacity={0.4} clippingPlanes={planes} />
              </lineSegments>
            </group>
          );
        })}
        <OrbitControls makeDefault />
        <CameraRig preset={preset} center={center} radius={radius} />
      </Canvas>
      <div className="view-tools">
        <div className="seg">
          <button onClick={() => setPreset((p) => ({ name: 'perspective', n: p.n + 1 }))}>3D</button>
          <button onClick={() => setPreset((p) => ({ name: 'top', n: p.n + 1 }))}>Top</button>
        </div>
        <label className="slider" title="Horizontal section through the building">
          Section
          <input type="range" min={0.02} max={1} step={0.005} value={cut} onChange={(e) => setCut(Number(e.target.value))} />
          <span className="num">{cut < 1 ? `z ${cutZ.toFixed(2)} m` : 'off'}</span>
        </label>
      </div>
    </div>
  );
}

/** Moves the camera to a preset whenever one is chosen (and once on mount). */
function CameraRig({ preset, center, radius }: { preset: Preset; center: THREE.Vector3; radius: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const key = `${preset.name}:${preset.n}:${controls ? 1 : 0}`;
  useEffect(() => {
    if (!controls) return;
    if (preset.name === 'top') camera.position.set(center.x, center.y - 1e-3, center.z + radius * 2.2);
    else camera.position.set(center.x + radius * 1.4, center.y - radius * 1.6, center.z + radius * 1.2);
    controls.target.copy(center);
    controls.update();
    // Only on a new preset: editing the plan must not move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
