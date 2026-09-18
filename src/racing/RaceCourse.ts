import { GAME_CONFIG } from "../game/config";
import type { Town } from "../world/Town";
import { isDevelopedBlock } from "../world/CityDistricts";

export interface RacePoint { x: number; z: number; }
export interface RaceCourse {
  regionId: string;
  start: RacePoint;
  heading: number;
  length: number;
  checkpoints: RacePoint[];
  route: RacePoint[];
}
export interface CourseSettings { seed: number; minLength: number; targetLength: number; maxLength: number; }

/** The town's road arrays describe a complete rectangular intersection graph. */
export function createRaceCourses(
  town: Pick<Town, "roadPositionsX" | "roadPositionsZ">,
  settings: CourseSettings = GAME_CONFIG.racing.course,
): Map<string, RaceCourse> {
  const result = new Map<string, RaceCourse>();
  const xs = town.roadPositionsX, zs = town.roadPositionsZ;
  for (let bz = 0; bz < zs.length - 1; bz++) for (let bx = 0; bx < xs.length - 1; bx++) {
    if (!isDevelopedBlock(bx, bz, xs.length - 1, zs.length - 1)) continue;
    let best: { nodes: RacePoint[]; edge: number; length: number; score: number; inward: RacePoint } | null = null;
    for (let left = 0; left <= bx; left++) for (let right = bx + 1; right < xs.length; right++) {
      for (let bottom = 0; bottom <= bz; bottom++) for (let top = bz + 1; top < zs.length; top++) {
        if (right - left < 2 || top - bottom < 2) continue;
        const length = 2 * (xs[right] - xs[left] + zs[top] - zs[bottom]);
        if (length < settings.minLength || length > settings.maxLength) continue;
        if (left !== bx && right !== bx + 1 && bottom !== bz && top !== bz + 1) continue;
        const nodes: RacePoint[] = [];
        for (let x = left; x < right; x++) nodes.push({ x: xs[x], z: zs[bottom] });
        for (let z = bottom; z < top; z++) nodes.push({ x: xs[right], z: zs[z] });
        for (let x = right; x > left; x--) nodes.push({ x: xs[x], z: zs[top] });
        for (let z = top; z > bottom; z--) nodes.push({ x: xs[left], z: zs[z] });
        const edge = nodes.findIndex((p, i) => {
          const q = nodes[(i + 1) % nodes.length];
          return p.x === q.x
            ? (p.x === xs[bx] || p.x === xs[bx + 1]) && Math.min(p.z, q.z) === zs[bz]
            : (p.z === zs[bz] || p.z === zs[bz + 1]) && Math.min(p.x, q.x) === xs[bx];
        });
        if (edge < 0) continue;
        const p = nodes[edge], q = nodes[(edge + 1) % nodes.length];
        const inward = p.x === q.x ? { x: p.x === xs[bx] ? 1 : -1, z: 0 }
          : { x: 0, z: p.z === zs[bz] ? 1 : -1 };
        const tie = ((settings.seed + bx * 101 + bz * 307 + left * 17 + right * 31 + bottom * 43 + top * 71) * 2654435761 >>> 0) / 4294967296;
        const score = Math.abs(length - settings.targetLength) + tie;
        if (!best || score < best.score) best = { nodes, edge, length, score, inward };
      }
    }
    if (!best) throw new Error(`No valid race course for block-${bx}-${bz}; check racing.course length bounds`);
    const { nodes, edge, inward } = best;
    const first = nodes[edge], next = nodes[(edge + 1) % nodes.length];
    // A slight inset puts the start unambiguously within its owning region.
    const inset = Math.min(GAME_CONFIG.racing.grid.lateralSpacing / 2, GAME_CONFIG.world.roadWidth / 8);
    const start = { x: (first.x + next.x) / 2 + inward.x * inset, z: (first.z + next.z) / 2 + inward.z * inset };
    const checkpoints: RacePoint[] = [];
    for (let n = 1; n <= nodes.length; n++) {
      const p = nodes[(edge + n) % nodes.length];
      checkpoints.push({ ...p });
      if (n < nodes.length) {
        const q = nodes[(edge + n + 1) % nodes.length];
        checkpoints.push({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
      }
    }
    checkpoints.push({ ...start });
    const regionId = `block-${bx}-${bz}`;
    result.set(regionId, { regionId, start, heading: Math.atan2(next.x - first.x, next.z - first.z),
      length: best.length, checkpoints, route: [start, ...checkpoints] });
  }
  return result;
}
