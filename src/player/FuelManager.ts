import { GAME_CONFIG } from "../game/config";
import type { GasStation } from "../game/types";
import { clamp, distanceXZ } from "../utils/math";
import type { PlayerCar } from "./PlayerCar";
import type { PlayerProfile } from "./PlayerProfile";

export class FuelManager {
  fuelPercent = 1;
  isNearStation = false;
  canUsePump = false;
  isRefueling = false;

  update(deltaTime: number, player: PlayerCar, gasStations: GasStation[], profile: PlayerProfile, refuelRequested = false): void {
    this.isNearStation = this.checkNearGasStation(player, gasStations);
    this.canUsePump = this.isNearStation && player.getSpeedMph() <= GAME_CONFIG.fuel.refuelStopSpeedMph;
    this.isRefueling = this.canUsePump && refuelRequested && !this.isFull && profile.money > 0;
    if (this.isRefueling) {
      const requestedFuel = Math.min(GAME_CONFIG.fuel.refuelRatePerSecond * deltaTime, 1 - this.fuelPercent);
      const requestedCost = requestedFuel * GAME_CONFIG.fuel.fullTankCost;
      const spent = profile.spend(requestedCost);
      const purchasedFuel = spent / GAME_CONFIG.fuel.fullTankCost;
      this.fuelPercent = clamp(this.fuelPercent + purchasedFuel, 0, 1);
      if (this.isFull) {
        this.isRefueling = false;
      }
      return;
    }

    const speedMph = player.getSpeedMph();
    const maxSpeedMph = player.getMaxForwardSpeed() * GAME_CONFIG.ride.mphPerWorldUnitPerSecond;
    const speedRatio = clamp(speedMph / maxSpeedMph, 0, 1);
    const movingMultiplier = speedMph < 1
      ? GAME_CONFIG.fuel.idleDrainMultiplier
      : GAME_CONFIG.fuel.minMovingDrainMultiplier + speedRatio * GAME_CONFIG.fuel.speedDrainMultiplier;
    const drainPerSecond = (1 / GAME_CONFIG.fuel.capacitySecondsAtCruise) * movingMultiplier;
    this.fuelPercent = clamp(this.fuelPercent - drainPerSecond * deltaTime, 0, 1);
  }

  get isLow(): boolean {
    return this.fuelPercent <= GAME_CONFIG.fuel.lowFuelThreshold;
  }

  get hasFuel(): boolean {
    return this.fuelPercent > 0;
  }

  get isFull(): boolean {
    return this.fuelPercent >= 0.999;
  }

  private checkNearGasStation(player: PlayerCar, gasStations: GasStation[]): boolean {
    for (const station of gasStations) {
      if (distanceXZ(player.root.position, station.position) <= station.radius) {
        return true;
      }
    }
    return false;
  }
}
