import { GAME_CONFIG } from "../game/config";
import type { AutoBodyShop } from "../game/types";
import { clamp, distanceXZ } from "../utils/math";
import type { PlayerCar } from "./PlayerCar";
import type { PlayerProfile } from "./PlayerProfile";

export class DamageManager {
  damagePercent = 0;
  isNearShop = false;
  canUseRepair = false;
  isRepairing = false;
  freeRepair = false;
  lastRepairAmount = 0;

  update(deltaTime: number, player: PlayerCar, shops: AutoBodyShop[], profile: PlayerProfile, repairRequested = false, freeRepair = false): void {
    this.freeRepair = freeRepair;
    this.lastRepairAmount = 0;
    this.isNearShop = this.checkNearShop(player, shops);
    this.canUseRepair = this.isNearShop && player.getSpeedMph() <= GAME_CONFIG.repair.repairStopSpeedMph;
    this.isRepairing = this.canUseRepair && repairRequested && !this.isRepaired && (freeRepair || profile.money > 0);
    if (!this.isRepairing) {
      return;
    }

    const requestedRepair = Math.min(GAME_CONFIG.repair.repairRatePerSecond * deltaTime, this.damagePercent);
    const requestedCost = requestedRepair * GAME_CONFIG.repair.fullRepairCost;
    const spent = freeRepair ? requestedCost : profile.spend(requestedCost);
    const purchasedRepair = spent / GAME_CONFIG.repair.fullRepairCost;
    this.lastRepairAmount = purchasedRepair;
    this.damagePercent = clamp(this.damagePercent - purchasedRepair, 0, 1);
    if (this.isRepaired) {
      this.isRepairing = false;
    }
  }

  applyCollision(relativeClosingSpeedMph: number, directness: number): number {
    const damage = collisionDamagePercent(relativeClosingSpeedMph, directness);
    this.applyDamage(damage);
    return damage;
  }

  applyDamage(damagePercent: number): void {
    this.damagePercent = clamp(this.damagePercent + damagePercent, 0, 1);
  }

  get isRepaired(): boolean {
    return this.damagePercent <= 0.001;
  }

  private checkNearShop(player: PlayerCar, shops: AutoBodyShop[]): boolean {
    for (const shop of shops) {
      if (distanceXZ(player.root.position, shop.position) <= shop.radius) {
        return true;
      }
    }
    return false;
  }
}

export function collisionDamagePercent(relativeClosingSpeedMph: number, directness: number): number {
  if (relativeClosingSpeedMph <= 0 || directness <= 0) {
    return 0;
  }
  const clampedDirectness = clamp(directness, 0, 1);
  const effectiveSpeed = relativeClosingSpeedMph * (0.45 + 0.55 * clampedDirectness);
  const severity = Math.pow(clamp(effectiveSpeed / GAME_CONFIG.repair.damageScaleSpeedMph, 0, 1), 1.1);
  return GAME_CONFIG.repair.maxCollisionDamage * severity;
}
