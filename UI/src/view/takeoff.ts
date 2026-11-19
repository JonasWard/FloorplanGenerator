import type { ConstructionSet, FaceResult } from '../backend/types';

export type TakeoffRow = {
  uuid: string;
  layer: string;
  material: string;
  thickness: number;
  faces: number;
  area: number;
  volume: number;
  mass: number;
};

export function materialOf(set: ConstructionSet, id: string): { name: string; density: number } {
  const m = set.materials[id];
  if (m) return { name: m.name, density: m.density };
  const c = set.composites[id];
  if (!c) return { name: 'unknown', density: 0 };
  const a = materialOf(set, c.part1);
  const b = materialOf(set, c.part2);
  return { name: c.name, density: a.density * c.part1_fraction + b.density * c.part2_fraction };
}

/** Area, volume and mass per construction layer, summed over the faces shown. */
export function takeoff(faces: FaceResult[], set: ConstructionSet, hiddenTypes: Set<string>): TakeoffRow[] {
  const rows = new Map<string, TakeoffRow>();
  for (const face of faces) {
    if (hiddenTypes.has(face.type)) continue;
    for (const layer of face.layers) {
      const def = set.layers[layer.uuid];
      const thickness = def?.thickness ?? 0;
      const material = def ? materialOf(set, def.material) : { name: 'unknown', density: 0 };
      const row =
        rows.get(layer.uuid) ??
        rows.set(layer.uuid, { uuid: layer.uuid, layer: layer.name, material: material.name, thickness, faces: 0, area: 0, volume: 0, mass: 0 }).get(layer.uuid)!;
      row.faces += 1;
      row.area += layer.area;
      row.volume += layer.area * thickness;
      row.mass += layer.area * thickness * material.density;
    }
  }
  return [...rows.values()].sort((a, b) => b.volume - a.volume);
}
