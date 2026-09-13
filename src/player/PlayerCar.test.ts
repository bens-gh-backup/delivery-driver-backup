import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { applyPermanentUpgrades } from "../progression/UpgradeSystem";
import { ELITE_VEHICLE, STARTER_VEHICLE } from "../vehicles/VehicleCatalog";
import type { Input } from "./Input";
import type { WorldQuery } from "../world/WorldQuery";
import { PlayerCar, damageStatMultiplier } from "./PlayerCar";

describe("damageStatMultiplier", () => {
  it("scales tunable car stats down as damage increases", () => {
    expect(damageStatMultiplier(0, 0.35)).toBe(1);
    expect(damageStatMultiplier(0.5, 0.35)).toBeCloseTo(0.675);
    expect(damageStatMultiplier(1, 0.35)).toBe(0.35);
  });
});

describe("PlayerCar vehicle configuration", () => {
  it("starts parked curbside halfway between city intersections", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const coordinates = [-1260,-840,-420,0,420,840,1260];
    const spawnPoints = coordinates.flatMap((x,ix) => coordinates.map((z,iz) => ({
      position:new Vector3(x,0,z),ix,iz,
    })));
    const car = new PlayerCar(scene,spawnPoints);
    const nearestRoadX = Math.min(...coordinates.map(x => Math.abs(car.root.position.x-x)));
    const nearestRoadZ = Math.min(...coordinates.map(z => Math.abs(car.root.position.z-z)));
    expect(nearestRoadX).toBe(210);
    expect(nearestRoadZ).toBeGreaterThan(GAME_CONFIG.traffic.laneOffset);
    expect(nearestRoadZ + car.colliderRadius + GAME_CONFIG.player.parkedCurbClearance)
      .toBeCloseTo(GAME_CONFIG.world.roadWidth/2);
    expect(car.heading).toBe(Math.PI/2);
    scene.dispose();engine.dispose();
  });

  it("lets the player accelerate and countersteer during a ram spin and clears it on reset", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const spawn = [{ position: Vector3.Zero(), ix: 0, iz: 0 }];
    const world = { isOnSidewalk: () => false, getNearbyColliders: () => {} } as unknown as WorldQuery;
    const run = (steering: number) => {
      const car = new PlayerCar(scene, spawn);
      car.heading = 0;
      car.applyPursuitImpact({ damage: 0.25, velocityX: 10, velocityZ: 25, yawRate: -3.4 });
      const input = { throttle: 1, brake: 0, steering, consumeReset: () => false, updateDriving: () => {} } as unknown as Input;
      for (let i = 0; i < 60; i++) car.update(1 / 60, input, world);
      return { car, spin: Math.abs(car.heading) };
    };
    const uncontrolled = run(0), counterSteered = run(1);
    expect(uncontrolled.spin).toBeGreaterThan(1);
    expect(counterSteered.spin).toBeLessThan(uncontrolled.spin);
    expect(counterSteered.car.getSpeedMph()).toBeGreaterThan(15);
    counterSteered.car.reset();
    const heading = counterSteered.car.heading;
    counterSteered.car.update(1 / 60, { throttle: 0, brake: 0, steering: 0, consumeReset: () => false, updateDriving: () => {} } as unknown as Input, world);
    expect(counterSteered.car.heading).toBe(heading);
    scene.dispose();
    engine.dispose();
  });

  it("updates physical dimensions and effective performance when equipped", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const spawnPoints = [{ position: Vector3.Zero(), ix: 0, iz: 0, axis: "x" as const, direction: 1 as const }];
    const car = new PlayerCar(scene, spawnPoints);

    expect(car.equippedVehicleId).toBe("starter");
    expect(car.getMaxForwardSpeed()).toBe(STARTER_VEHICLE.stats.topSpeed);
    expect(car.vehicleWidth).toBe(STARTER_VEHICLE.appearance.bodyWidth);
    expect(car.root.getChildMeshes()).toHaveLength(1);
    expect(car.root.getChildMeshes()[0].getTotalVertices()).toBeGreaterThan(200);

    const maximumLevel = GAME_CONFIG.progression.maxUpgradeLevel;
    const upgraded = applyPermanentUpgrades(ELITE_VEHICLE.stats, {
      acceleration: maximumLevel,
      topSpeed: maximumLevel,
      turning: maximumLevel,
      braking: maximumLevel,
    });
    car.equipVehicle(ELITE_VEHICLE, upgraded);

    expect(car.equippedVehicleId).toBe("elite-sports-car");
    expect(car.getMaxForwardSpeed()).toBe(
      ELITE_VEHICLE.stats.topSpeed
        * (1 + maximumLevel * GAME_CONFIG.progression.upgradePercentPerLevel),
    );
    expect(car.vehicleWidth).toBe(ELITE_VEHICLE.appearance.bodyWidth);
    expect(car.vehicleLength).toBe(ELITE_VEHICLE.appearance.bodyLength);
    expect(car.colliderRadius).toBeGreaterThan(STARTER_VEHICLE.appearance.bodyWidth / 2);

    scene.dispose();
    engine.dispose();
  });
});
