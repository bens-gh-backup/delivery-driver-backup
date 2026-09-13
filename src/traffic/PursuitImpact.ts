import { GAME_CONFIG } from "../game/config";
import { clamp } from "../utils/math";

/** Created only on a fresh, committed ram, never in the per-car update loop. */
export interface PursuitImpact {
  damage: number;
  velocityX: number;
  velocityZ: number;
  yawRate: number;
}

export function createPursuitImpact(
  closingSpeedMph: number, directness: number, heading: number, side: number, variation: number,
): PursuitImpact {
  const strength = clamp(closingSpeedMph / GAME_CONFIG.police.pursuitRamClosingSpeedMph, 0, 1);
  const alignment = clamp(directness, 0, 1);
  const damage = GAME_CONFIG.police.pursuitRamMaxDamage * strength * (0.4 + 0.6 * alignment);
  const spin = GAME_CONFIG.police.pursuitSpinRate * strength * (0.6 + 0.4 * alignment)
    * (0.9 + clamp(variation, 0, 1) * 0.2);
  return {
    damage,
    velocityX: Math.cos(heading) * side * 10 * strength,
    velocityZ: -Math.sin(heading) * side * 10 * strength,
    yawRate: -side * spin,
  };
}
