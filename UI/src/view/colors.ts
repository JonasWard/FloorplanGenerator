import type { ConstructionSet, LayerResult } from '../backend/types';
import { materialOf } from './takeoff';

const BY_MATERIAL: Record<string, string> = {
  OSB: '#d8b36a',
  Studs: '#a9764a',
  Fir: '#a9764a',
  'Mineral wool': '#e8d84a',
  'Ceramic facade tiles': '#c4623d',
  Concrete: '#9a9a94',
};
const FALLBACK = ['#5b8db8', '#7aa95c', '#b46aa8', '#d1904a', '#4fa3a0', '#8a7bc8'];

export function makeColorOf(set: ConstructionSet) {
  const assigned = new Map<string, string>();
  return (layer: Pick<LayerResult, 'uuid' | 'name'>): string => {
    const def = set.layers[layer.uuid];
    const name = def ? materialOf(set, def.material).name : layer.name;
    if (BY_MATERIAL[name]) return BY_MATERIAL[name];
    if (!assigned.has(name)) assigned.set(name, FALLBACK[assigned.size % FALLBACK.length]!);
    return assigned.get(name)!;
  };
}
