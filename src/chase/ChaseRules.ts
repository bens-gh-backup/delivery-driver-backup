import { GAME_CONFIG } from "../game/config";
import type { BoxCollider } from "../game/types";
import type { VehicleBody } from "../physics/VehicleBody";
import { clamp } from "../utils/math";

export type ChaseOutcome = "won" | "destroyed" | "escaped" | "reset";
export interface ChaseResult { readonly outcome: ChaseOutcome; passiveIncomeGain: number }
export interface ChaseHudState {
  active: boolean; licenseRequired: boolean; suspectHealth: number; distance: number;
  escapeRemaining: number | null; hit: boolean; result: ChaseResult | null; resultSeconds: number;
}

export function shotAtDistance(meters: number): { probability: number; damage: number } {
  const c = GAME_CONFIG.policeChase;
  const t = clamp((meters - c.shotNearMeters) / Math.max(1, c.shotFarMeters - c.shotNearMeters), 0, 1);
  return { probability: 1 - t, damage: c.shotNearDamage + (c.shotFarDamage - c.shotNearDamage) * t };
}

export function chaseImpactDamage(closingMph: number, directness: number, armored: boolean): number {
  const c = GAME_CONFIG.policeChase;
  const effective = Math.max(0, closingMph) * (.45 + .55 * clamp(directness, 0, 1));
  return directness <= 0 ? 0 : (armored ? c.policeMaxImpactDamage : c.suspectMaxImpactDamage)
    * Math.pow(clamp(effective / c.fullImpactSpeedMph, 0, 1), 1.1);
}

export class ChaseEngagement {
  closingSeconds = 0;
  nearbySeconds = 0;
  private previousDistance: number | null = null;
  reset(): void { this.closingSeconds = this.nearbySeconds = 0; this.previousDistance = null; }
  update(dt: number, distance: number, available: boolean): boolean {
    if (!available || dt <= 0) { this.reset(); return false; }
    const c = GAME_CONFIG.policeChase;
    this.closingSeconds = distance <= c.closingRadiusMeters && this.previousDistance !== null
      && distance < this.previousDistance - 1e-6 ? this.closingSeconds + dt : 0;
    this.nearbySeconds = distance <= c.nearbyRadiusMeters ? this.nearbySeconds + dt : 0;
    this.previousDistance = distance;
    return this.closingSeconds > c.engagementSeconds || this.nearbySeconds > c.engagementSeconds;
  }
}

/** Earliest intersection fraction, or Infinity. Top-down box tests, never triangle raycasts. */
export function segmentBoxFraction(ax: number, az: number, bx: number, bz: number, box: BoxCollider): number {
  let enter = 0, leave = 1;
  const dx = bx - ax, dz = bz - az;
  for (let axis = 0; axis < 2; axis++) {
    const origin = axis ? az : ax, delta = axis ? dz : dx;
    const center = axis ? box.z : box.x, half = axis ? box.halfZ : box.halfX;
    if (Math.abs(delta) < 1e-8) { if (origin < center - half || origin > center + half) return Infinity; }
    else {
      const a = (center - half - origin) / delta, b = (center + half - origin) / delta;
      enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
      if (enter > leave) return Infinity;
    }
  }
  return leave >= 0 && enter <= 1 ? Math.max(0, enter) : Infinity;
}

const localBox: BoxCollider = { x: 0, z: 0, halfX: 0, halfZ: 0 };
export function segmentVehicleFraction(ax: number, az: number, bx: number, bz: number, body: VehicleBody): number {
  const s = Math.sin(body.heading), c = Math.cos(body.heading);
  const x1 = ax - body.x, z1 = az - body.z, x2 = bx - body.x, z2 = bz - body.z;
  localBox.halfX = body.halfWidth; localBox.halfZ = body.halfLength;
  return segmentBoxFraction(x1*c-z1*s,x1*s+z1*c,x2*c-z2*s,x2*s+z2*c,localBox);
}
