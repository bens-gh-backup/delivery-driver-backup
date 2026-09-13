import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function damping(deltaTime: number, strength: number): number {
  return 1 - Math.exp(-strength * deltaTime);
}

export function distanceXZ(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

export function forwardFromHeading(heading: number): Vector3 {
  return new Vector3(Math.sin(heading), 0, Math.cos(heading));
}

export function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** Returns a fresh seed for content that should differ between game sessions. */
export function randomSeed(): number {
  const cryptoSource = globalThis.crypto;
  if (cryptoSource) {
    const values = new Uint32Array(1);
    cryptoSource.getRandomValues(values);
    return values[0];
  }
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

export function randomBetween(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function pickWeighted<T extends string>(rng: () => number, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as Array<[T, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) {
      return key;
    }
  }
  return entries[entries.length - 1][0];
}
