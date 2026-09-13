import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import type { PlayerCar } from "../player/PlayerCar";
import { RaceManager } from "./RaceManager";
import { RaceCar } from "./RaceCar";
import { advanceRaceProgress } from "./RaceProgress";
import { createRaceCourses } from "./RaceCourse";

const town = { roadPositionsX: Array.from({ length: 7 }, (_, i) => i * 425), roadPositionsZ: Array.from({ length: 7 }, (_, i) => i * 425) };
function playerStub(): PlayerCar {
  const player = { root: { position: Vector3.Zero() }, heading: 0, vehicleWidth: 5.8, vehicleLength: 10.2,
    teleportTo(x: number, z: number, heading: number) { this.root.position.set(x, .9, z); this.heading = heading; },
    applyTrafficCollision(nx: number, nz: number, depth: number) { this.root.position.x += nx * depth; this.root.position.z += nz * depth; } };
  return player as unknown as PlayerCar;
}

describe("race lifecycle and assisted AI", () => {
  it("counts down, finishes once, retains activity through results, and releases all visuals", () => {
    const engine = new NullEngine(); const scene = new Scene(engine); const manager = new RaceManager(scene, town);
    const player = playerStub(); const initialMeshes = scene.meshes.length;
    expect(manager.start("unknown", player)).toBe(false);
    expect(manager.start("block-0-0", player)).toBe(true);
    expect(manager.start("block-1-1", player)).toBe(false);
    expect(manager.snapshot.opponents).toHaveLength(6);
    expect(manager.snapshot.position).toBe(4);
    const start = player.root.position.clone(); manager.update(2, player);
    expect(manager.state).toBe("COUNTDOWN"); expect(player.root.position).toEqual(start);
    manager.update(1, player); expect(manager.state).toBe("RACING");
    const course = manager.getCourse("block-0-0")!;
    for (const checkpoint of course.checkpoints) {
      player.root.position.set(checkpoint.x, .9, checkpoint.z); manager.update(1 / 60, player);
    }
    expect(manager.state).toBe("FINISHED"); expect(manager.isActive).toBe(true);
    expect(manager.snapshot.finishPlace).toBe(1);
    expect(manager.consumeResult()).toEqual({ regionId: "block-0-0", finishPlace: 1 });
    expect(manager.consumeResult()).toBeNull();
    manager.abort(); manager.abort(); expect(manager.isActive).toBe(false);
    expect(scene.meshes.length).toBe(initialMeshes);
    manager.dispose(); scene.dispose(); engine.dispose();
  });
  it("player recovery preserves the next required checkpoint and does not grant teleport progress", () => {
    const engine = new NullEngine(); const scene = new Scene(engine); const manager = new RaceManager(scene, town); const player = playerStub();
    manager.start("block-5-5", player); manager.update(3, player);
    const first = manager.getCourse("block-5-5")!.checkpoints[0];
    player.root.position.set(first.x, .9, first.z); manager.update(1 / 60, player);
    const checkpoint = manager.snapshot.checkpoint;
    player.root.position.set(-10000, .9, -10000); manager.resetPlayer(player); manager.update(1 / 60, player);
    expect(manager.snapshot.checkpoint).toBe(checkpoint);
    expect(player.root.position.x).toBeCloseTo(first.x);
    manager.dispose(); scene.dispose(); engine.dispose();
  });
  it("six competitors finish together with contact enabled and faster cars can pass", () => {
    const engine = new NullEngine(); const scene = new Scene(engine); const manager = new RaceManager(scene, town); const player = playerStub();
    manager.start("block-3-3", player); manager.update(3, player);
    player.root.position.x = -10000; player.root.position.z = -10000;
    const order: number[] = [];
    for (let frame = 0; frame < 180 * 60; frame++) {
      manager.update(1 / 60, player);
      if (frame % 10 === 0) {
        const snapshot = manager.snapshot;
        for (const car of snapshot.opponents) if (car.checkpoint === snapshot.checkpointCount && !order.includes(car.id)) order.push(car.id);
        if (order.length === 6) break;
      }
    }
    expect(order).toHaveLength(6);
    expect(order.indexOf(6)).toBeLessThan(order.indexOf(1));
    for (let frame = 0; frame < 10 * 60; frame++) manager.update(1 / 60, player);
    expect(manager.snapshot.opponents).toHaveLength(6);
    expect(manager.snapshot.opponents.every(car => !car.visible && car.speed === 0)).toBe(true);
    expect(manager.snapshot.position).toBe(7);
    // Hidden finishers remain in the official standings when the player eventually crosses.
    for (const checkpoint of manager.getCourse("block-3-3")!.checkpoints) {
      player.root.position.set(checkpoint.x, .9, checkpoint.z); manager.update(1 / 60, player);
    }
    expect(manager.consumeResult()).toEqual({ regionId: "block-3-3", finishPlace: 7 });
    manager.abort(); expect(manager.consumeResult()).toBeNull(); manager.dispose(); scene.dispose(); engine.dispose();
  });
  it("finished opponents roll through the line, disappear, and preserve recorded finish progress", () => {
    const engine = new NullEngine(); const scene = new Scene(engine);
    for (const course of createRaceCourses(town).values()) {
      const car = new RaceCar(scene, 1, course, GAME_CONFIG.racing.racers[0], course.start, course.heading);
      car.progress.checkpointIndex = course.checkpoints.length;
      car.progress.finishTime = 42;
      car.speed = 80;
      const before = car.mesh.position.clone();
      car.update(1 / 60);
      expect(car.mesh.isEnabled()).toBe(true);
      expect(Vector3.Distance(car.mesh.position, before)).toBeGreaterThan(0);
      for (let frame = 0; frame < 300; frame++) car.update(1 / 60);
      expect(car.mesh.isEnabled()).toBe(false);
      expect(Vector3.Distance(car.mesh.position, before)).toBeCloseTo(GAME_CONFIG.racing.finishExitDistance);
      expect(car.progress.finishTime).toBe(42);
      expect(car.progress.checkpointIndex).toBe(course.checkpoints.length);
      const roadDistance = Math.min(...town.roadPositionsX.map(x => Math.abs(car.mesh.position.x - x)), ...town.roadPositionsZ.map(z => Math.abs(car.mesh.position.z - z)));
      expect(roadDistance + car.width / 2).toBeLessThan(GAME_CONFIG.world.roadWidth / 2);
      const hiddenPosition = car.mesh.position.clone(); car.update(1);
      expect(car.mesh.position).toEqual(hiddenPosition);
      car.dispose();
    }
    scene.dispose(); engine.dispose();
  });
  it("the complete roster traverses every regional course without unassisted failures or leaving pavement", () => {
    const engine = new NullEngine(); const scene = new Scene(engine);
    for (const course of createRaceCourses(town).values()) for (let rosterIndex = 0; rosterIndex < GAME_CONFIG.racing.racers.length; rosterIndex++) {
      const car = new RaceCar(scene, rosterIndex + 1, course, GAME_CONFIG.racing.racers[rosterIndex], course.start, course.heading);
      let elapsed = 0, recoveries = 0, maximumRoadDistance = 0, frame = 0;
      while (elapsed < 180 && car.progress.finishTime === null) {
        const previous = { x: car.mesh.position.x, z: car.mesh.position.z };
        car.update(1 / 60);
        if (car.recoveredThisStep) recoveries++;
        else advanceRaceProgress(car.progress, previous, car.mesh.position, course.checkpoints, GAME_CONFIG.racing.checkpointRadius, elapsed, 1 / 60);
        const roadDistance = Math.min(...town.roadPositionsX.map(x => Math.abs(car.mesh.position.x - x)), ...town.roadPositionsZ.map(z => Math.abs(car.mesh.position.z - z)));
        maximumRoadDistance = Math.max(maximumRoadDistance, roadDistance);
        if (++frame % 10 === 0) {
          const sin = Math.sin(car.mesh.rotation.y), cos = Math.cos(car.mesh.rotation.y);
          for (const side of [-1, 1]) for (const end of [-1, 1]) {
            const cornerX = car.mesh.position.x + side * car.width / 2 * cos + end * car.length / 2 * sin;
            const cornerZ = car.mesh.position.z - side * car.width / 2 * sin + end * car.length / 2 * cos;
            maximumRoadDistance = Math.max(maximumRoadDistance, Math.min(...town.roadPositionsX.map(x => Math.abs(cornerX - x)), ...town.roadPositionsZ.map(z => Math.abs(cornerZ - z))));
          }
        }
        elapsed += 1 / 60;
      }
      expect(car.progress.finishTime, `${course.regionId}, AI ${rosterIndex + 1}`).not.toBeNull();
      expect(recoveries, `${course.regionId}, AI ${rosterIndex + 1}`).toBe(0);
      expect(maximumRoadDistance).toBeLessThan(GAME_CONFIG.world.roadWidth / 2);
      car.dispose();
    }
    scene.dispose(); engine.dispose();
  });
  it("all six racers finish and stronger stats produce faster clean runs; off-course recovery earns no checkpoint", () => {
    const engine = new NullEngine(); const scene = new Scene(engine); const course = createRaceCourses(town).get("block-2-2")!;
    const times: number[] = [];
    for (let i = 0; i < GAME_CONFIG.racing.racers.length; i++) {
      const car = new RaceCar(scene, i + 1, course, GAME_CONFIG.racing.racers[i], course.start, course.heading);
      car.mesh.position.set(-1000, .9, -1000); car.update(1 / 60);
      expect(car.recoveredThisStep).toBe(true); expect(car.progress.checkpointIndex).toBe(0);
      let elapsed = 0;
      while (elapsed < 180 && car.progress.finishTime === null) {
        const previous = { x: car.mesh.position.x, z: car.mesh.position.z };
        car.update(1 / 60);
        if (!car.recoveredThisStep) advanceRaceProgress(car.progress, previous, car.mesh.position, course.checkpoints, GAME_CONFIG.racing.checkpointRadius, elapsed, 1 / 60);
        elapsed += 1 / 60;
      }
      expect(car.progress.finishTime, `racer ${i + 1}, checkpoint ${car.progress.checkpointIndex}`).not.toBeNull();
      times.push(car.progress.finishTime!); car.dispose();
    }
    expect(times[5]).toBeLessThan(times[0] * .8);
    scene.dispose(); engine.dispose();
  });
});
