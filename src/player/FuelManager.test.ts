import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { TownGenerator } from "../world/Town";
import { FuelManager } from "./FuelManager";
import { PlayerCar } from "./PlayerCar";
import { PlayerProfile } from "./PlayerProfile";

describe("FuelManager", () => {
  it("drains during play and refuels only while the pump is held at a station", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const town = new TownGenerator(scene).generate();
    const player = new PlayerCar(scene, town.roadSpawnPoints);
    const fuel = new FuelManager();
    const profile = new PlayerProfile();
    profile.money = 100;

    fuel.update(10, player, [], profile);
    expect(fuel.fuelPercent).toBeLessThan(1);

    fuel.fuelPercent = 0.5;
    player.root.position.copyFrom(town.gasStations[0].position);
    fuel.update(0.5, player, town.gasStations, profile);
    expect(fuel.canUsePump).toBe(true);
    expect(fuel.isRefueling).toBe(false);
    expect(fuel.fuelPercent).toBeLessThan(0.5);

    fuel.update(0.5, player, town.gasStations, profile, true);
    expect(fuel.isRefueling).toBe(true);
    expect(fuel.fuelPercent).toBeGreaterThan(0.5);
    expect(profile.money).toBeLessThan(100);

    fuel.fuelPercent = 0.99;
    fuel.update(1, player, town.gasStations, profile, true);
    expect(fuel.fuelPercent).toBe(1);
    expect(fuel.isRefueling).toBe(false);

    profile.money = 0;
    fuel.fuelPercent = 0.5;
    fuel.update(1, player, town.gasStations, profile, true);
    expect(fuel.isRefueling).toBe(false);
    expect(fuel.fuelPercent).toBeLessThanOrEqual(0.5);
    scene.dispose();
    engine.dispose();
  });
});
