import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { MISSION_LICENSES, getMissionLicense } from "./MissionLicenseCatalog";

describe("MissionLicenseCatalog", () => {
  it("defines the initial license prices and fare multipliers", () => {
    expect(MISSION_LICENSES.map(({ id, unlockCost, fareMultiplier }) => ({ id, unlockCost, fareMultiplier }))).toEqual([
      { id: "taxi", unlockCost: GAME_CONFIG.progression.missionLicenseUnlockCosts.taxi, fareMultiplier: 1 },
      { id: "ambulance_driver", unlockCost: GAME_CONFIG.progression.missionLicenseUnlockCosts.ambulance_driver, fareMultiplier: 1 },
    ]);
    expect(MISSION_LICENSES.map(({ id, unlockCost }) => [id, unlockCost])).toEqual(
      Object.entries(GAME_CONFIG.progression.missionLicenseUnlockCosts),
    );
    expect(getMissionLicense("taxi")?.maxTipPercent).toBeUndefined();
    expect(getMissionLicense("rideshare")).toBeNull();
    expect(getMissionLicense("rideshare_silver")).toBeNull();
    expect(getMissionLicense("ambulance_driver")).toMatchObject({
      activityType: "ambulanceDriver",
      unlockLocation: "phone",
    });
    expect(getMissionLicense("unknown")).toBeNull();
  });
});
