import { GAME_CONFIG } from "../game/config";
import type { PlayerUpgradeLevels, VehicleStatKey, VehicleStats } from "../vehicles/VehicleTypes";

export const VEHICLE_STAT_KEYS: readonly VehicleStatKey[] = ["topSpeed", "acceleration", "turning", "braking"];

export function getUpgradeCost(nextLevel: number): number {
  if (nextLevel < 1 || nextLevel > GAME_CONFIG.progression.maxUpgradeLevel) {
    return 0;
  }
  const previousLevelCount = nextLevel * (nextLevel - 1) / 2;
  return GAME_CONFIG.progression.upgradeCostBase * nextLevel
    + GAME_CONFIG.progression.additionalCostPerUpgradeLevel * previousLevelCount;
}

export function getUpgradeMultiplier(level: number): number {
  const clampedLevel = Math.max(0, Math.min(GAME_CONFIG.progression.maxUpgradeLevel, Math.floor(level)));
  return 1 + clampedLevel * GAME_CONFIG.progression.upgradePercentPerLevel;
}

export function applyPermanentUpgrades(base: VehicleStats, upgrades: PlayerUpgradeLevels): VehicleStats {
  return {
    acceleration: base.acceleration * getUpgradeMultiplier(upgrades.acceleration),
    topSpeed: base.topSpeed * getUpgradeMultiplier(upgrades.topSpeed),
    turning: base.turning * getUpgradeMultiplier(upgrades.turning),
    braking: base.braking * getUpgradeMultiplier(upgrades.braking),
  };
}
