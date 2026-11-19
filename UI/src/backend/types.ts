/** Shapes of Backend/samples/construction.json and of WasmBuilding.geometryJson(). */
export type ConstructionSet = {
  materials: Record<string, { name: string; density: number; heat_transfer_coefficient: number; specific_heat_capacity: number; dictionary: object }>;
  composites: Record<string, { name: string; part1: string; part2: string; part1_fraction: number; part2_fraction: number; dictionary: object }>;
  layers: Record<string, { name: string; material: string; thickness: number; priority: number; joint_type: string; dictionary: object }>;
  layer_groups: Record<string, { name: string; layers: string[]; layer_offsets: number[]; dictionary: object }>;
};

export type P3 = [number, number, number];

export type LayerResult = {
  name: string;
  /** Uuid of the construction layer. */
  uuid: string;
  area: number;
  inner: P3[];
  outer: P3[];
  joints: ({ face: string | null; layer_idx: number } | null)[];
};

export type FaceResult = { uuid: string; type: string; layers: LayerResult[] };
