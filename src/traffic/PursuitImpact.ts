import { GAME_CONFIG } from "../game/config";
import { clamp } from "../utils/math";

/** Gameplay damage only. The shared contact solver supplies all physical motion. */
export interface PursuitImpact { damage: number; }

export function createPursuitImpact(closingSpeedMph: number, directness: number): PursuitImpact {
  const strength = clamp(closingSpeedMph / GAME_CONFIG.police.pursuitRamClosingSpeedMph, 0, 1);
  return { damage: GAME_CONFIG.police.pursuitRamMaxDamage * strength * (0.4 + 0.6 * clamp(directness, 0, 1)) };
}
