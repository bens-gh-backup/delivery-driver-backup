import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { PassengerType, type PoliceCitation, type RideResult } from "../game/types";
import { ProgressionStore, type KeyValueStorage } from "../progression/ProgressionStore";
import { getUpgradeCost } from "../progression/UpgradeSystem";
import type { VehicleStatKey } from "../vehicles/VehicleTypes";
import { PlayerProfile, defaultProgression } from "./PlayerProfile";
import { TRAINING_CATEGORIES, type TrainingRegion } from "../training/Training";

describe("PlayerProfile", () => {
  it("starts a new save with the starter vehicle and configured budget", () => {
    const profile = createProfile();

    expect(profile.money).toBe(GAME_CONFIG.progression.startingMoney);
    expect(profile.completedRides).toBe(0);
    expect(profile.freeUpgradeCredits).toBe(0);
    expect(profile.ownedVehicleIds).toEqual(["starter"]);
    expect(profile.equippedVehicleId).toBe("starter");
    expect(profile.ownedMissionLicenseIds).toEqual(["taxi"]);
    expect(profile.ownsRacingLicense).toBe(false);
    expect(profile.getBestRaceFinish("block-0-0")).toBeNull();
    expect(profile.upgrades).toEqual({ acceleration: 0, topSpeed: 0, turning: 0, braking: 0 });
  });

  it("owns earnings and completed ride progression", () => {
    const profile = createProfile();

    profile.completeRide(rideResult(18.5, "First Rider"));
    profile.completeRide(rideResult(7.25, "Second Rider"));

    expect(profile.money).toBe(GAME_CONFIG.progression.startingMoney + 25.75);
    expect(profile.completedRides).toBe(2);
    expect(profile.rideHistory.map((ride) => ride.passengerName)).toEqual(["Second Rider", "First Rider"]);

    expect(profile.spend(8)).toBe(8);
    expect(profile.money).toBe(GAME_CONFIG.progression.startingMoney + 17.75);
    expect(profile.spend(30_000)).toBe(GAME_CONFIG.progression.startingMoney + 17.75);
    expect(profile.money).toBe(0);
  });

  it("persists purchased vehicles, equipped vehicle, and upgrades", () => {
    const storage = new MemoryStorage();
    const profile = createProfile(storage);
    profile.money = 25_000;

    expect(profile.purchaseVehicle("used-compact", true)).toBe(true);
    expect(profile.purchaseUpgrade("topSpeed")).toBe(true);

    const reloaded = createProfile(storage);
    expect(reloaded.money).toBe(
      25_000 - GAME_CONFIG.progression.vehiclePrices["used-compact"] - getUpgradeCost(1),
    );
    expect(reloaded.ownedVehicleIds).toEqual(["starter", "used-compact"]);
    expect(reloaded.equippedVehicleId).toBe("used-compact");
    expect(reloaded.upgrades.topSpeed).toBe(1);
  });

  it("keeps debug money temporary while persisting purchases made with it", () => {
    const storage = new MemoryStorage();
    const profile = createProfile(storage);

    profile.addTemporaryDebugMoney(25_000);
    expect(profile.money).toBe(GAME_CONFIG.progression.startingMoney + 25_000);
    expect(profile.purchaseMissionLicense("ambulance_driver")).toBe(true);
    expect(profile.money).toBe(
      GAME_CONFIG.progression.startingMoney + 25_000
      - GAME_CONFIG.progression.missionLicenseUnlockCosts.ambulance_driver,
    );

    const reloaded = createProfile(storage);
    expect(reloaded.money).toBe(GAME_CONFIG.progression.startingMoney);
    expect(reloaded.ownedMissionLicenseIds).toContain("ambulance_driver");
  });

  it("does not save unused temporary debug money on page exit", () => {
    const storage = new MemoryStorage();
    const profile = createProfile(storage);

    profile.addTemporaryDebugMoney(25_000);
    profile.dispose();

    expect(createProfile(storage).money).toBe(GAME_CONFIG.progression.startingMoney);
  });

  it("can reset persisted cash without clearing other progression", () => {
    const storage = new MemoryStorage();
    const profile = createProfile(storage);
    profile.money = 25_030;
    profile.unlockAllVehicles();

    profile.resetMoneyToStartingAmount();

    const reloaded = createProfile(storage);
    expect(reloaded.money).toBe(GAME_CONFIG.progression.startingMoney);
    expect(reloaded.ownedVehicleIds).toContain("elite-sports-car");
  });

  it("starts with Taxi and persists an Ambulance Driver purchase", () => {
    const storage = new MemoryStorage();
    const profile = createProfile(storage);
    const expectedRemainder = 500;
    profile.money = GAME_CONFIG.progression.missionLicenseUnlockCosts.ambulance_driver
      + expectedRemainder;

    expect(profile.purchaseMissionLicense("taxi")).toBe(false);
    expect(profile.purchaseMissionLicense("ambulance_driver")).toBe(true);
    expect(profile.money).toBe(expectedRemainder);

    const reloaded = createProfile(storage);
    expect(reloaded.ownedMissionLicenseIds).toEqual(["taxi", "ambulance_driver"]);
  });

  it("migrates version 6 package licenses and training progress to ambulance jobs", () => {
    const storage = new MemoryStorage();
    storage.setItem(GAME_CONFIG.progression.saveKey, JSON.stringify({
      ...defaultProgression(), version: 6,
      ownedMissionLicenseIds: ["rideshare", "rideshare_silver", "package_delivery"],
      trainingProgress: { "block-1-2": { rideshare: 4, rideshare_silver: 2, package_delivery: 2, ambulance_driver: 1 } },
    }));
    const profile = createProfile(storage);
    expect(profile.ownedMissionLicenseIds).toEqual(["taxi", "ambulance_driver"]);
    expect(profile.ownedMissionLicenseIds).toContain("ambulance_driver");
    expect(profile.ownedMissionLicenseIds).not.toContain("package_delivery");
    expect(profile.getTrainingCount("block-1-2", "taxi")).toBe(
      Math.min(4, GAME_CONFIG.progression.training.taxi.requiredMissionsPerRegion),
    );
    expect(profile.getTrainingCount("block-1-2", "ambulance_driver")).toBe(
      Math.min(2, GAME_CONFIG.progression.training.ambulance_driver.requiredMissionsPerRegion),
    );
  });

  it("rejects duplicate, unknown, and unaffordable purchases", () => {
    const profile = createProfile();

    expect(profile.purchaseVehicle("starter", true)).toBe(false);
    expect(profile.purchaseVehicle("unknown", true)).toBe(false);
    expect(profile.purchaseVehicle("sport-compact", true)).toBe(false);
    expect(profile.equipVehicle("used-compact")).toBe(false);
    expect(profile.money).toBe(GAME_CONFIG.progression.startingMoney);
  });

  it("debounces continuous spending and writes it after the autosave interval", () => {
    const storage = new MemoryStorage();
    const profile = createProfile(storage);

    profile.money = 100;
    profile.spend(50);
    profile.updateAutosave(GAME_CONFIG.progression.autosaveSeconds - 0.01);
    expect(storage.getItem(GAME_CONFIG.progression.saveKey)).toBeNull();

    profile.updateAutosave(0.02);
    const reloaded = createProfile(storage);
    expect(reloaded.money).toBe(50);
  });

  it("sanitizes known-version data and rejects unknown save versions", () => {
    const storage = new MemoryStorage();
    storage.setItem(GAME_CONFIG.progression.saveKey, JSON.stringify({
      version: GAME_CONFIG.progression.saveVersion,
      money: -10,
      completedRides: 3.9,
      ownedVehicleIds: ["starter", "used-compact", "bogus", "used-compact"],
      equippedVehicleId: "bogus",
      upgrades: { acceleration: 99, topSpeed: -2, turning: 4.8, braking: "bad" },
    }));

    const sanitized = createProfile(storage);
    expect(sanitized.money).toBe(GAME_CONFIG.progression.startingMoney);
    expect(sanitized.completedRides).toBe(3);
    expect(sanitized.ownedVehicleIds).toEqual(["starter", "used-compact"]);
    expect(sanitized.equippedVehicleId).toBe("starter");
    expect(sanitized.upgrades).toEqual({
      acceleration: GAME_CONFIG.progression.maxUpgradeLevel,
      topSpeed: 0,
      turning: 4,
      braking: 0,
    });

    storage.setItem(GAME_CONFIG.progression.saveKey, JSON.stringify({
      version: GAME_CONFIG.progression.saveVersion + 1,
      money: 999_999,
    }));
    const unknownVersion = createProfile(storage);
    expect(unknownVersion.money).toBe(GAME_CONFIG.progression.startingMoney);
    expect(unknownVersion.ownedVehicleIds).toEqual(["starter"]);
  });

  it("migrates version-one progression without discarding existing unlocks or money", () => {
    const storage = new MemoryStorage();
    storage.setItem(GAME_CONFIG.progression.saveKey, JSON.stringify({
      version: 1,
      money: 12_345,
      completedRides: 8,
      ownedVehicleIds: ["starter", "used-compact"],
      equippedVehicleId: "used-compact",
      upgrades: { acceleration: 2, topSpeed: 3, turning: 4, braking: 5 },
    }));

    const migrated = createProfile(storage);
    expect(migrated.money).toBe(12_345);
    expect(migrated.completedRides).toBe(8);
    expect(migrated.equippedVehicleId).toBe("used-compact");
    expect(migrated.upgrades).toEqual({ acceleration: 2, topSpeed: 3, turning: 4, braking: 5 });
    expect(migrated.rideHistory).toEqual([]);
  });

  it("migrates version-two scorecards and classifies them as taxi rides", () => {
    const storage = new MemoryStorage();
    const { missionCategoryId: _legacyCategory, ...legacyResult } = rideResult(14, "Legacy Rider");
    const legacyRide = { ...legacyResult, id: "legacy-ride", completedAt: 12345 };
    storage.setItem(GAME_CONFIG.progression.saveKey, JSON.stringify({
      version: 2,
      money: 90,
      completedRides: 1,
      ownedVehicleIds: ["starter"],
      equippedVehicleId: "starter",
      upgrades: { acceleration: 0, topSpeed: 0, turning: 0, braking: 0 },
      rideHistory: [legacyRide],
    }));

    const migrated = createProfile(storage);
    expect(migrated.ownedMissionLicenseIds).toEqual(["taxi"]);
    expect(migrated.rideHistory[0].missionCategoryId).toBe("taxi");
  });

  it("bounds persisted scorecards while retaining the lifetime ride count", () => {
    const profile = createProfile();
    for (let index = 0; index < GAME_CONFIG.progression.rideHistoryLimit + 3; index++) {
      profile.completeRide(rideResult(1, `Rider ${index}`));
    }

    expect(profile.completedRides).toBe(GAME_CONFIG.progression.rideHistoryLimit + 3);
    expect(profile.rideHistory).toHaveLength(GAME_CONFIG.progression.rideHistoryLimit);
    expect(profile.rideHistory[0].passengerName).toBe(`Rider ${GAME_CONFIG.progression.rideHistoryLimit + 2}`);
  });

  it("persists complete scorecard details across reloads", () => {
    const storage = new MemoryStorage();
    const profile = createProfile(storage);
    const result = rideResult(22.5, "Persistent Rider");

    profile.completeRide(result);
    const reloaded = createProfile(storage);

    expect(reloaded.rideHistory).toHaveLength(1);
    expect(reloaded.rideHistory[0]).toMatchObject(result);
    expect(reloaded.rideHistory[0].id).toMatch(/^ride-/);
    expect(reloaded.rideHistory[0].completedAt).toBeGreaterThan(0);
  });

  it("does not recreate a cleared save during disposal", () => {
    const storage = new MemoryStorage();
    const profile = createProfile(storage);
    profile.money = 10_000;
    profile.purchaseMissionLicense("taxi");
    profile.purchaseVehicle("used-compact", true);
    profile.purchaseUpgrade("acceleration");
    profile.completeRide(rideResult(10, "Reset Rider"));
    expect(storage.getItem(GAME_CONFIG.progression.saveKey)).not.toBeNull();

    profile.clearSave();
    profile.dispose();

    expect(storage.getItem(GAME_CONFIG.progression.saveKey)).toBeNull();
    const reset = createProfile(storage);
    expect(reset.money).toBe(GAME_CONFIG.progression.startingMoney);
    expect(reset.ownedVehicleIds).toEqual(["starter"]);
    expect(reset.equippedVehicleId).toBe("starter");
    expect(reset.ownedMissionLicenseIds).toEqual(["taxi"]);
    expect(reset.upgrades).toEqual({ acceleration: 0, topSpeed: 0, turning: 0, braking: 0 });
    expect(reset.rideHistory).toEqual([]);
  });
  it("persists stacked rewards, waives every fine once, and preserves cards when a Lawyer is onboard", () => {
    const storage = new MemoryStorage();
    const profile = createProfile(storage);
    profile.completeRide({ ...rideResult(0, "Cop"), cardsEarned: 2, couponsEarned: 3, bonusTip: 20 });
    const reloaded = createProfile(storage);
    expect(reloaded.jailFreeCards).toBe(2);
    expect(reloaded.vehicleCoupons).toBe(3);
    expect(reloaded.rideHistory[0]).toMatchObject({ cardsEarned: 2, couponsEarned: 3, bonusTip: 20 });
    const citation = (): PoliceCitation => ({
      officerId: 1, offense: "SPEEDING", assessedFine: 150,
      amountPaid: 0, remainingBalance: 0,
    });
    const money = reloaded.money;
    const lawyer = citation();
    reloaded.settlePoliceCitation(lawyer, true);
    expect(lawyer).toMatchObject({ waiverReason: "lawyer", waivedAmount: 150, amountPaid: 0 });
    expect(reloaded.jailFreeCards).toBe(2);
    const card = citation();
    reloaded.settlePoliceCitation(card);
    reloaded.settlePoliceCitation(card);
    expect(card).toMatchObject({ waiverReason: "card", waivedAmount: 150, amountPaid: 0 });
    expect(reloaded.jailFreeCards).toBe(1);
    expect(reloaded.money).toBe(money);
    expect(createProfile(storage).jailFreeCards).toBe(1);
    reloaded.money = 0;
    reloaded.settlePoliceCitation(citation());
    expect(reloaded.jailFreeCards).toBe(0);
  });

  it("stacks free upgrade credits and persists them with the earned ride history", () => {
    const storage = new MemoryStorage();
    const profile = createProfile(storage);

    profile.completeRide(rideResultWithFreeUpgradeCredits(0, "First Credit", 1.9));
    profile.completeRide(rideResultWithFreeUpgradeCredits(0, "Second Credit", 2.2));

    expect(profile.freeUpgradeCredits).toBe(3);
    expect(profile.rideHistory.map((ride) => ride.freeUpgradeCreditsEarned)).toEqual([2, 1]);
    const reloaded = createProfile(storage);
    expect(reloaded.freeUpgradeCredits).toBe(3);
    expect(reloaded.rideHistory.map((ride) => ride.freeUpgradeCreditsEarned)).toEqual([2, 1]);
  });

  it("redeems a free upgrade at zero cash and quotes cash after the last credit", () => {
    const profile = createProfile();
    profile.money = 0;
    profile.completeRide(rideResultWithFreeUpgradeCredits(0, "Upgrade Credit", 1));

    expect(profile.getUpgradePurchaseQuote("acceleration")).toEqual({ price: 0, creditsUsed: 1, nextLevel: 1 });
    expect(profile.purchaseUpgrade("acceleration")).toBe(true);
    expect(profile.money).toBe(0);
    expect(profile.freeUpgradeCredits).toBe(0);
    expect(profile.getUpgradePurchaseQuote("topSpeed")).toEqual({
      price: getUpgradeCost(1), creditsUsed: 0, nextLevel: 1,
    });
  });

  it("guards invalid and maxed upgrade credit purchases without spending anything", () => {
    const profile = createProfile();
    profile.money = 0;
    profile.completeRide(rideResultWithFreeUpgradeCredits(0, "Guard Credit", 1));
    const invalidStat = "invalid" as VehicleStatKey;

    expect(profile.getUpgradePurchaseQuote(invalidStat)).toBeNull();
    expect(profile.purchaseUpgrade(invalidStat)).toBe(false);
    profile.setUpgradeLevel("turning", GAME_CONFIG.progression.maxUpgradeLevel);
    expect(profile.getUpgradePurchaseQuote("turning")).toBeNull();
    expect(profile.purchaseUpgrade("turning")).toBe(false);
    expect(profile.freeUpgradeCredits).toBe(1);
    expect(profile.money).toBe(0);
  });

  it("quotes and applies coupons atomically, retaining surplus and preserving coupons on failed purchases", () => {
    const profile = createProfile();
    const price = GAME_CONFIG.progression.vehiclePrices["used-compact"];
    const required = Math.ceil(price / 100);
    profile.completeRide({ ...rideResult(0, "Salesman"), couponsEarned: required + 2 });
    profile.money = 0;
    expect(profile.getVehiclePurchaseQuote("used-compact")).toEqual({ price: 0, discount: price, couponsUsed: required });
    expect(profile.purchaseVehicle("unknown", false)).toBe(false);
    expect(profile.vehicleCoupons).toBe(required + 2);
    expect(profile.purchaseVehicle("used-compact", true)).toBe(true);
    expect(profile.vehicleCoupons).toBe(2);
    expect(profile.money).toBe(0);
    expect(profile.purchaseVehicle("used-compact", false)).toBe(false);
    expect(profile.purchaseVehicle("elite-sports-car", false)).toBe(false);
    expect(profile.vehicleCoupons).toBe(2);
  });

  it.each([1, 2, 3, 4])("loads version %s with zero rewards and preserves legacy passenger history", (version) => {
    const storage = new MemoryStorage();
    const profile = createProfile(storage);
    profile.completeRide({ ...rideResult(12, "Legacy"), passengerType: PassengerType.ScaredyCat });
    const save = JSON.parse(storage.getItem(GAME_CONFIG.progression.saveKey)!);
    save.version = version;
    delete save.jailFreeCards;
    delete save.vehicleCoupons;
    delete save.freeUpgradeCredits;
    storage.setItem(GAME_CONFIG.progression.saveKey, JSON.stringify(save));
    const restored = createProfile(storage);
    expect(restored.completedRides).toBe(1);
    expect(restored.jailFreeCards).toBe(0);
    expect(restored.vehicleCoupons).toBe(0);
    expect(restored.freeUpgradeCredits).toBe(0);
    expect(restored.rideHistory[0].passengerType).toBe(PassengerType.ScaredyCat);
  });

  it("sanitizes invalid reward counts and resets inventories with progression", () => {
    const storage = new MemoryStorage();
    storage.setItem(GAME_CONFIG.progression.saveKey, JSON.stringify({
      version: 4,
      jailFreeCards: -2,
      vehicleCoupons: 2.9,
      freeUpgradeCredits: 3.9,
    }));
    const profile = createProfile(storage);
    expect(profile.jailFreeCards).toBe(0);
    expect(profile.vehicleCoupons).toBe(2);
    expect(profile.freeUpgradeCredits).toBe(3);
    profile.completeRide({ ...rideResult(0, "Cop"), cardsEarned: 1 });
    profile.clearSave();
    const reset = createProfile(storage);
    expect(reset.jailFreeCards).toBe(0);
    expect(reset.vehicleCoupons).toBe(0);
  });

  it("purchases and persists the racing license at the configured price", () => {
    const storage = new MemoryStorage();
    const profile = createProfile(storage);
    profile.money = GAME_CONFIG.racing.licenseCost;

    expect(profile.ownsRacingLicense).toBe(false);
    expect(profile.purchaseRacingLicense()).toBe(true);
    expect(profile.ownsRacingLicense).toBe(true);
    expect(profile.money).toBe(0);
    expect(profile.purchaseRacingLicense()).toBe(false);
    expect(createProfile(storage).ownsRacingLicense).toBe(true);
  });

  it("migrates v8 saves without race progression", () => {
    const storage = new MemoryStorage();
    const legacy = { ...defaultProgression(), version: 8 } as Record<string, unknown>;
    delete legacy.racingLicenseOwned;
    delete legacy.bestRaceFinishes;
    storage.setItem(GAME_CONFIG.progression.saveKey, JSON.stringify(legacy));

    const profile = createProfile(storage);
    expect(profile.ownsRacingLicense).toBe(false);
    expect(profile.getBestRaceFinish("block-0-0")).toBeNull();
  });

  it("keeps only the best valid race result and applies its multiplier to regional income", () => {
    const storage = new MemoryStorage();
    const profile = createProfile(storage);
    configureRaceRegions(profile, "block-0-0", "block-1-0");
    const regionId = "block-0-0";
    for (let i = 0; i < GAME_CONFIG.progression.training.taxi.requiredMissionsPerRegion; i++) {
      profile.completeRide(rideResult(0, `Taxi ${i}`), { regionId, categoryId: "taxi" });
    }
    for (let i = 0; i < GAME_CONFIG.progression.training.ambulance_driver.requiredMissionsPerRegion; i++) {
      profile.completeAmbulanceJob(0, { regionId, categoryId: "ambulance_driver" });
    }

    const baseIncome = profile.getRegionBaseIncomePerSecond(regionId);
    const configuredCompletedIncome = TRAINING_CATEGORIES.reduce(
      (sum, category) => sum + category.required * category.passiveIncomePerMission * category.completionMultiplier,
      0,
    );
    expect(baseIncome).toBeCloseTo(configuredCompletedIncome);
    expect(profile.getRegionPassiveIncomePerSecond(regionId)).toBeCloseTo(baseIncome);
    expect(profile.recordRaceFinish(regionId, 5)).toBe(true);
    expect(profile.getBestRaceFinish(regionId)).toBe(5);
    expect(profile.getRaceMultiplier(regionId)).toBe(GAME_CONFIG.racing.finishMultipliers[4]);
    expect(profile.getRegionPassiveIncomePerSecond(regionId))
      .toBeCloseTo(baseIncome * GAME_CONFIG.racing.finishMultipliers[4]);
    expect(profile.recordRaceFinish(regionId, 6)).toBe(false);
    expect(profile.getBestRaceFinish(regionId)).toBe(5);
    expect(profile.recordRaceFinish(regionId, 3)).toBe(true);
    expect(profile.getBestRaceFinish(regionId)).toBe(3);
    expect(profile.getRaceMultiplier(regionId)).toBe(GAME_CONFIG.racing.finishMultipliers[2]);
    expect(profile.recordRaceFinish(regionId, 0)).toBe(false);
    expect(profile.recordRaceFinish(regionId, 8)).toBe(false);
    expect(profile.recordRaceFinish("not-a-region", 1)).toBe(false);
    expect(profile.getBestRaceFinish("block-1-0")).toBeNull();

    const reloaded = createProfile(storage);
    configureRaceRegions(reloaded, "block-0-0", "block-1-0");
    expect(reloaded.getBestRaceFinish(regionId)).toBe(3);
    expect(reloaded.getRegionPassiveIncomePerSecond(regionId))
      .toBeCloseTo(baseIncome * GAME_CONFIG.racing.finishMultipliers[2]);
  });

  it("sanitizes malformed race results and resets debug results", () => {
    const storage = new MemoryStorage();
    storage.setItem(GAME_CONFIG.progression.saveKey, JSON.stringify({
      ...defaultProgression(),
      version: GAME_CONFIG.progression.saveVersion,
      racingLicenseOwned: true,
      bestRaceFinishes: {
        "block-0-0": 2,
        "block-1-1": 2.5,
        "block-2-2": 0,
        "block-3-3": GAME_CONFIG.racing.aiCount + 2,
        "bad-id": 1,
      },
    }));
    const profile = createProfile(storage);
    configureRaceRegions(profile, "block-0-0");
    expect(profile.ownsRacingLicense).toBe(true);
    expect(profile.getBestRaceFinish("block-0-0")).toBe(2);
    expect(profile.getBestRaceFinish("block-1-1")).toBeNull();
    profile.debugResetRaceFinish("block-0-0");
    expect(profile.getBestRaceFinish("block-0-0")).toBeNull();
    expect(createProfile(storage).getBestRaceFinish("block-0-0")).toBeNull();
  });

});

function rideResult(total: number, passengerName: string): RideResult {
  return {
    passengerName,
    passengerType: PassengerType.Normal,
    missionCategoryId: "taxi",
    rideTier: "SHORT",
    pickupDistance: 120,
    tripDistance: 300,
    durationSeconds: 45,
    collisionCount: 0,
    stars: 5,
    baseFare: total * 0.75,
    tip: total * 0.25,
    timeTipPercentRemaining: 90,
    violationPoints: 0,
    violationTipPenaltyPercent: 0,
    total,
  };
}

function rideResultWithFreeUpgradeCredits(total: number, passengerName: string, freeUpgradeCreditsEarned: number): RideResult {
  return { ...rideResult(total, passengerName), freeUpgradeCreditsEarned } as RideResult;
}

function createProfile(storage: KeyValueStorage = new MemoryStorage()): PlayerProfile {
  return new PlayerProfile(new ProgressionStore(storage));
}

function configureRaceRegions(profile: PlayerProfile, ...ids: string[]): void {
  profile.configureTrainingRegions(ids.map((id) => ({
    id,
    label: id,
    bx: 0,
    bz: 0,
    minX: 0,
    maxX: 1,
    minZ: 0,
    maxZ: 1,
    x: 0,
    z: 0,
    pickups: [],
  } satisfies TrainingRegion)));
}

class MemoryStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}
