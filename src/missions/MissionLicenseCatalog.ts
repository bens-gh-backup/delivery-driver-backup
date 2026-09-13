import { GAME_CONFIG } from "../game/config";

export type MissionLicenseId = "taxi" | "ambulance_driver";

export interface MissionLicenseDefinition {
  id: MissionLicenseId;
  name: string;
  tabLabel: string;
  description: string;
  unlockCost: number;
  fareMultiplier: number;
  maxTipPercent?: number;
  violationTipPenaltyMultiplier?: number;
  activityType: "passengerRide" | "ambulanceDriver";
  unlockLocation: "phone";
  offerSeed: number;
}

export const MISSION_LICENSES: readonly MissionLicenseDefinition[] = [
  {
    id: "taxi",
    name: "Taxi",
    tabLabel: "TAXI",
    description: "Collect passengers and drive them to their destinations.",
    unlockCost: GAME_CONFIG.progression.missionLicenseUnlockCosts.taxi,
    fareMultiplier: 1,
    activityType: "passengerRide",
    unlockLocation: "phone",
    offerSeed: 7419,
  },
  {
    id: "ambulance_driver",
    name: "Ambulance Driver",
    tabLabel: "AMBULANCE",
    description: "Collect patients across the city and return them to this region's clinic.",
    unlockCost: GAME_CONFIG.progression.missionLicenseUnlockCosts.ambulance_driver,
    fareMultiplier: 1,
    activityType: "ambulanceDriver",
    unlockLocation: "phone",
    offerSeed: GAME_CONFIG.ambulanceDriver.offerSeed,
  },
];

const LICENSES_BY_ID = new Map(MISSION_LICENSES.map((license) => [license.id, license]));

export function getMissionLicense(id: string): MissionLicenseDefinition | null {
  return LICENSES_BY_ID.get(id as MissionLicenseId) ?? null;
}
