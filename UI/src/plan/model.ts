/** A drawn wall: a straight reference line in plan, in metres. */
export type Wall = { id: string; a: Pt; b: Pt };
export type Pt = readonly [number, number];

export type Plan = {
  walls: Wall[];
  storeys: number;
  storeyHeight: number;
};

let counter = 0;
export const newId = (prefix = 'w'): string => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

/** A small house: a 10 x 8 m outline, split into three rooms. */
export const defaultPlan = (): Plan => {
  const w = (a: Pt, b: Pt): Wall => ({ id: newId(), a, b });
  return {
    storeys: 2,
    storeyHeight: 3,
    walls: [
      w([0, 0], [10, 0]),
      w([10, 0], [10, 8]),
      w([10, 8], [0, 8]),
      w([0, 8], [0, 0]),
      w([6, 0], [6, 8]),
      w([6, 4.5], [10, 4.5]),
    ],
  };
};
