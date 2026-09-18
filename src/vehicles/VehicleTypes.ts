import type { TrainingProgress } from "../training/Training";
import type { RideHistoryEntry } from "../game/types";
import type { MissionLicenseId } from "../missions/MissionLicenseCatalog";

export type VehicleStatKey = "acceleration" | "topSpeed" | "turning" | "braking";

export interface VehicleStats {
  acceleration: number;
  topSpeed: number;
  turning: number;
  braking: number;
}

export type PlayerUpgradeLevels = Record<VehicleStatKey, number>;

export interface VehicleAppearance {
  bodyColor: string;
  bodyLength: number;
  bodyWidth: number;
  bodyHeight: number;
  cabinLength: number;
  cabinWidth: number;
  cabinHeight: number;
  role?: "ambulance" | "police";
}

export interface VehicleDefinition {
  id: string;
  name: string;
  price: number;
  stats: VehicleStats;
  appearance: VehicleAppearance;
}

export interface PlayerProgression {
  version: number;
  taxiPassiveIncomePerSecond: number;
  ambulancePassiveIncomePerSecond: number;
  policeChasePassiveIncomePerSecond: number;
  racingPassiveIncomePerSecond: number;
  trainingProgress: TrainingProgress;
  jailFreeCards: number;
  vehicleCoupons: number;
  freeUpgradeCredits: number;
  money: number;
  completedRides: number;
  ownedVehicleIds: string[];
  equippedVehicleId: string;
  upgrades: PlayerUpgradeLevels;
  ownedMissionLicenseIds: MissionLicenseId[];
  rideHistory: RideHistoryEntry[];
  racingLicenseOwned: boolean;
  bestRaceFinishes: Record<string, number>;
}
