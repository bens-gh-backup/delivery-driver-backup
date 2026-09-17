import type { BoxCollider } from "../game/types";

/** Match interaction eligibility to the visible forecourt, including its corners. */
export function isInServiceArea(position: { x: number; z: number }, area: BoxCollider): boolean {
  return Math.abs(position.x - area.x) <= area.halfX && Math.abs(position.z - area.z) <= area.halfZ;
}
