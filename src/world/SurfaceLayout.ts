import { GAME_CONFIG } from "../game/config";
import type { Point3 } from "../graphics/FacetedMesh";

/** Visible surface heights, not box centers. Keep layered surfaces clearly separated. */
export const WORLD_SURFACES = {
  road: .06,
  sidewalk: .1,
  service: .26,
  markings: .2,
  garden: .26,
  path: .42,
  pavementDetail: .26,
  gutter: .2,
  grate: .34,
  grateBars: .46,
} as const;

/** Street-relative lot bounds: along the road, then inward from the refueling spot. */
export function gasForecourtBounds(): { halfLength: number; front: number; back: number } {
  const { sidewalkWidth, servicePlacement } = GAME_CONFIG.world;
  const halfLength = 12 + servicePlacement.gasStationDrivewayWidth;
  const { canopySetback, canopyDepth } = GAME_CONFIG.presentation.gasStation;
  const back = canopySetback + canopyDepth / 2 + 2;
  // The sidewalk slab extends slightly into the road; bridge its entire visible edge.
  const front = -14 - sidewalkWidth * 2 - 1;
  return { halfLength, front, back };
}

/** One convex forecourt: street edge, two rounded inlet ends, pumps, and rear kiosk. */
export function gasForecourtOutline(): Point3[] {
  const { servicePlacement } = GAME_CONFIG.world;
  const { halfLength, front, back } = gasForecourtBounds();
  const radius = Math.min(servicePlacement.gasStationApronRadius, halfLength, back - front);
  const points: Point3[] = [[-halfLength, WORLD_SURFACES.service, front], [halfLength, WORLD_SURFACES.service, front]];
  const segments = 10;
  for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI / 2;
    points.push([halfLength - radius + radius * Math.cos(angle), WORLD_SURFACES.service,
      back - radius + radius * Math.sin(angle)]);
  }
  for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI / 2;
    points.push([-halfLength + radius - radius * Math.sin(angle), WORLD_SURFACES.service,
      back - radius + radius * Math.cos(angle)]);
  }
  return points;
}
