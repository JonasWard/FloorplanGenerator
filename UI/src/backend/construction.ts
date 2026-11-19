import type { ConstructionSet } from './types';

/** Total thickness of a layer group: from its first offset to the far side of its last layer. */
export function groupThickness(set: ConstructionSet, groupId: string): { start: number; end: number } {
  const g = set.layer_groups[groupId]!;
  let start = Infinity;
  let end = -Infinity;
  g.layers.forEach((layerId, i) => {
    const o = g.layer_offsets[i]!;
    start = Math.min(start, o);
    end = Math.max(end, o + set.layers[layerId]!.thickness);
  });
  return { start, end };
}

/**
 * The sample stacks every layer group from the face plane outwards. For interior walls a centred wall
 * (the drawn line on its axis) is what a plan expects, so shift that group's offsets by half its thickness.
 */
export function centreGroup(set: ConstructionSet, groupId: string): ConstructionSet {
  const { start, end } = groupThickness(set, groupId);
  const shift = -(start + end) / 2;
  const g = set.layer_groups[groupId]!;
  return {
    ...set,
    layer_groups: {
      ...set.layer_groups,
      [groupId]: { ...g, layer_offsets: g.layer_offsets.map((o) => o + shift) },
    },
  };
}
