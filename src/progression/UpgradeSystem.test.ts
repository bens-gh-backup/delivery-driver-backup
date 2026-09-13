import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { applyPermanentUpgrades, getUpgradeCost, getUpgradeMultiplier } from "./UpgradeSystem";

describe("UpgradeSystem", () => {
  it("uses the configured base and additional per-level price curve", () => {
    const expectedCost = (level: number) => GAME_CONFIG.progression.upgradeCostBase * level
      + GAME_CONFIG.progression.additionalCostPerUpgradeLevel * level * (level - 1) / 2;
    expect(getUpgradeCost(1)).toBe(expectedCost(1));
    expect(getUpgradeCost(2)).toBe(expectedCost(2));
    expect(getUpgradeCost(10)).toBe(expectedCost(10));
    expect(getUpgradeCost(GAME_CONFIG.progression.maxUpgradeLevel))
      .toBe(expectedCost(GAME_CONFIG.progression.maxUpgradeLevel));
    expect(getUpgradeCost(0)).toBe(0);
    expect(getUpgradeCost(GAME_CONFIG.progression.maxUpgradeLevel + 1)).toBe(0);
  });

  it("applies the configured additive percentage to each base stat", () => {
    const base = { acceleration: 20, topSpeed: 100, turning: 2, braking: 30 };
    const upgraded = applyPermanentUpgrades(base, {
      acceleration: 10,
      topSpeed: 50,
      turning: 0,
      braking: 25,
    });

    expect(upgraded).toEqual({
      acceleration: 20 * getUpgradeMultiplier(10),
      topSpeed: 100 * getUpgradeMultiplier(50),
      turning: 2,
      braking: 30 * getUpgradeMultiplier(25),
    });
    const maximumMultiplier = 1
      + GAME_CONFIG.progression.maxUpgradeLevel * GAME_CONFIG.progression.upgradePercentPerLevel;
    expect(getUpgradeMultiplier(50)).toBe(maximumMultiplier);
    expect(getUpgradeMultiplier(500)).toBe(maximumMultiplier);
  });
});
