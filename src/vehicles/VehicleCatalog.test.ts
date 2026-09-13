import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { ELITE_VEHICLE, STARTER_VEHICLE, VEHICLE_CATALOG, getVehicleDefinition } from "./VehicleCatalog";

describe("VehicleCatalog", () => {
  it("defines sixteen uniquely identified vehicles in ascending price order", () => {
    expect(VEHICLE_CATALOG).toHaveLength(16);
    expect(new Set(VEHICLE_CATALOG.map((vehicle) => vehicle.id)).size).toBe(16);
    expect(VEHICLE_CATALOG.map((vehicle) => vehicle.price)).toEqual(
      [...VEHICLE_CATALOG].map((vehicle) => vehicle.price).sort((a, b) => a - b),
    );
    expect(Object.fromEntries(VEHICLE_CATALOG.map(({ id, price }) => [id, price]))).toEqual(
      GAME_CONFIG.progression.vehiclePrices,
    );
  });

  it("keeps the starter at current handling and maps the elite to target performance", () => {
    expect(STARTER_VEHICLE.stats).toEqual({
      acceleration: GAME_CONFIG.player.acceleration,
      topSpeed: GAME_CONFIG.player.maxForwardSpeed,
      turning: 1,
      braking: GAME_CONFIG.player.braking,
    });
    expect(ELITE_VEHICLE.stats).toEqual(GAME_CONFIG.progression.eliteVehicleStats);
    const maximumMultiplier = 1
      + GAME_CONFIG.progression.maxUpgradeLevel * GAME_CONFIG.progression.upgradePercentPerLevel;
    expect(ELITE_VEHICLE.stats.topSpeed * maximumMultiplier).toBeGreaterThan(STARTER_VEHICLE.stats.topSpeed);
  });

  it("looks up only catalog vehicles", () => {
    expect(getVehicleDefinition("hot-hatch")?.name).toBe("Hot Hatch");
    expect(getVehicleDefinition("not-a-car")).toBeNull();
  });
});
