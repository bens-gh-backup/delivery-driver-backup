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

  it("refuels on either side of each actual pump, with the same reach in every station orientation", () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const town = new TownGenerator(scene).generate();
    const player = new PlayerCar(scene, town.roadSpawnPoints);
    const fuel = new FuelManager(), profile = new PlayerProfile();
    const orientations = new Set<string>();
    for (const station of town.gasStations) {
      orientations.add(`${station.roadAxis}/${station.roadSide}`);
      const axis = station.roadAxis === "northSouth" ? "x" : "z";
      for (const pump of station.pumpPositions) for (const side of [-1, 1]) {
        // Cover ordinary parking and the edge of the pump's reach. The outer
        // positions used to fail because distance was measured from the map pin.
        for (const distance of [7, station.radius - .1, station.radius + .1]) {
          player.root.position.copyFrom(pump);
          player.root.position[axis] += side * station.roadSide * distance;
          profile.money = 100;
          fuel.fuelPercent = .5;
          fuel.update(.5, player, town.gasStations, profile, true);
          const withinReach = distance < station.radius;
          expect(fuel.canUsePump).toBe(withinReach);
          expect(fuel.isRefueling).toBe(withinReach);
          expect(fuel.fuelPercent > .5).toBe(withinReach);
          expect(profile.money < 100).toBe(withinReach);
        }
      }
    }
    expect(orientations.size).toBe(4);
    scene.dispose(); engine.dispose();
  });
});
