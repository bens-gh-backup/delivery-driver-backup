import { GAME_CONFIG } from "../game/config";

export type MissionLicenseId = "taxi" | "ambulance_driver" | "police_chase";

export interface MissionLicenseDefinition {
  id: MissionLicenseId;
  name: string;
  tabLabel: string;
  description: string;
  unlockCost: number;
  fareMultiplier: number;
  maxTipPercent?: number;
  violationTipPenaltyMultiplier?: number;
  activityType: "passengerRide" | "ambulanceDriver" | "policeChase";
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
    description: "Find injured people and race them to a clinic.",
    unlockCost: GAME_CONFIG.progression.missionLicenseUnlockCosts.ambulance_driver,
    fareMultiplier: 1,
    activityType: "ambulanceDriver",
    unlockLocation: "phone",
    offerSeed: GAME_CONFIG.ambulanceDriver.offerSeed,
  },
  {
    id: "police_chase", name: "Police", tabLabel: "POLICE",
    description: "Pursue and disable armed getaway cars.",
    unlockCost: GAME_CONFIG.progression.missionLicenseUnlockCosts.police_chase,
    fareMultiplier: 1, activityType: "policeChase", unlockLocation: "phone", offerSeed: 0,
  },
];

const LICENSES_BY_ID = new Map(MISSION_LICENSES.map((license) => [license.id, license]));

export function getMissionLicense(id: string): MissionLicenseDefinition | null {
  return LICENSES_BY_ID.get(id as MissionLicenseId) ?? null;
}
