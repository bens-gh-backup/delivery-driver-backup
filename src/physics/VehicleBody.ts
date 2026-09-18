import { GAME_CONFIG } from "../game/config";
import { clamp } from "../utils/math";
import type { OrientedBox2D } from "../traffic/OrientedBoxCollision";

/** Flat rigid body, independent of renderer, AI, damage, and save data. */
export interface VehicleBody extends OrientedBox2D {
  id: number;
  velocityX: number; velocityZ: number; angularVelocity: number;
  inverseMass: number; inverseInertia: number;
  startX: number; startZ: number; startHeading: number;
  endX: number; endZ: number; endHeading: number;
  changed: boolean; dynamic: boolean; impulse: number;
  /** Preserve the player's existing circular world-obstacle footprint. NPCs use their box. */
  staticRadius: number;
  reportStaticImpacts?: boolean;
}

export function createVehicleBody(id: number): VehicleBody {
  return { id, x: 0, z: 0, heading: 0, halfWidth: 1, halfLength: 1,
    velocityX: 0, velocityZ: 0, angularVelocity: 0, inverseMass: 1, inverseInertia: 1,
    startX: 0, startZ: 0, startHeading: 0, endX: 0, endZ: 0, endHeading: 0,
    changed: false, dynamic: false, impulse: 0, staticRadius: 0 };
}

export function setBodySize(body: VehicleBody, width: number, length: number): void {
  body.halfWidth = width / 2; body.halfLength = length / 2;
  const mass = clamp(width * length / (GAME_CONFIG.traffic.hitboxWidth * GAME_CONFIG.traffic.hitboxLength),
    GAME_CONFIG.vehicleCollisions.minimumMass, GAME_CONFIG.vehicleCollisions.maximumMass);
  body.inverseMass = 1 / mass;
  body.inverseInertia = 12 / (mass * (width * width + length * length));
}

export function beginBodyStep(body: VehicleBody, x: number, z: number, heading: number): void {
  body.startX = x; body.startZ = z; body.startHeading = heading;
}

export function endBodyStep(body: VehicleBody, x: number, z: number, heading: number,
  vx: number, vz: number, yaw: number, dt: number): void {
  body.x = body.endX = x; body.z = body.endZ = z; body.heading = body.endHeading = heading;
  body.velocityX = vx; body.velocityZ = vz; body.angularVelocity = yaw;
  body.changed = false; body.impulse = 0;
  // Zero-time callers and teleports must never sweep from stale motion history.
  if (dt <= 0) beginBodyStep(body, x, z, heading);
}

