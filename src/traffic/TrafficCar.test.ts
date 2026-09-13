import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import type { TrafficVehicleRole, TrafficWaypoint } from "../game/types";
import {
  choosePursuitDirection,
  createTrafficTurnPath,
  createTrafficUTurnPath,
  shouldStartPursuitUTurn,
  trafficSignalSpeedLimit,
  TrafficCar,
  turnSignalForDirections,
} from "./TrafficCar";
import { findOrientedBoxCollision } from "./OrientedBoxCollision";
import { TrafficTurnSignals } from "./TrafficTurnSignals";

function sequenceRandom(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function createCarFixture(
  speed: number,
  rng: () => number = () => 0.25,
  role: TrafficVehicleRole = "civilian",
) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const material = new StandardMaterial("traffic-test-material", scene);
  material.diffuseColor = Color3.White();
  const prototype = TrafficCar.createPrototype(scene, material, 0);
  const roadPositionsX = [0, 1000, 2000];
  const roadPositionsZ = [0, 1000, 2000];
  const waypoint: TrafficWaypoint = {
    position: new Vector3(roadPositionsX[0], 1, roadPositionsZ[1]),
    ix: 0,
    iz: 1,
  };
  const car = new TrafficCar(
    1,
    role,
    waypoint,
    "east",
    speed,
    roadPositionsX,
    roadPositionsZ,
    rng,
    prototype,
  );
  return {
    car,
    scene,
    dispose: () => {
      car.dispose();
      prototype.dispose();
      material.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

describe("TrafficCar", () => {
  it("catches a starter-speed player and commits to rear-quarter contact", () => {
    const f = createCarFixture(90, () => 0.25, "police");
    const car = f.car;
    car.mesh.position.set(300, 1, 992);
    let x = 400;
    const phases = new Set<string>();
    let impact = null;
    for (let step = 0; step < 600; step++) {
      x += 90 / 60;
      car.setPursuitTarget({ x, z: 992, heading: Math.PI / 2, velocityX: 90 });
      car.update(1 / 60, []);
      phases.add(car.pursuitPhase);
      const contact = findOrientedBoxCollision(
        { x, z: 992, heading: Math.PI / 2, halfWidth: GAME_CONFIG.player.width / 2, halfLength: GAME_CONFIG.player.length / 2 },
        { x: car.mesh.position.x, z: car.mesh.position.z, heading: car.mesh.rotation.y,
          halfWidth: GAME_CONFIG.traffic.hitboxWidth / 2, halfLength: GAME_CONFIG.traffic.hitboxLength / 2 },
      );
      if (contact) {
        const vx = 90 - car.getVelocityX(), vz = -car.getVelocityZ();
        const closing = Math.max(0, -(vx * contact.normalX + vz * contact.normalZ)) * GAME_CONFIG.ride.mphPerWorldUnitPerSecond;
        impact = car.createRamImpact(closing, closing / (Math.hypot(vx, vz) * GAME_CONFIG.ride.mphPerWorldUnitPerSecond));
        break;
      }
    }
    expect([...phases]).toEqual(expect.arrayContaining(["catchUp", "align", "ram"]));
    expect(impact).not.toBeNull();
    expect(impact!.damage).toBeGreaterThanOrEqual(0.19);
    expect(impact!.damage).toBeLessThanOrEqual(0.25);
    f.dispose();
  });

  it("keeps a crash recovery to four seconds despite continued contact", () => {
    const f = createCarFixture(80, () => 0.25, "police");
    const car = f.car;
    car.mesh.position.x = 500;
    const target = { x: 700, z: 992, heading: Math.PI / 2, velocityX: 90 };
    car.setPursuitTarget(target);
    car.update(1 / 60, []);
    car.registerCollision(-1, 0.22, true);
    const heading = car.mesh.rotation.y;
    for (let i = 0; i < 239; i++) {
      car.markCollisionContact(-1);
      if (i === 60) car.registerCollision(-1, 0.01, false);
      car.setPursuitTarget(target);
      car.update(1 / 60, []);
      expect(car.pursuitPhase).toBe("recover");
    }
    expect(Math.abs(car.mesh.rotation.y - heading)).toBeGreaterThan(1);
    car.update(1 / 60, []);
    expect(car.pursuitPhase).toBe("catchUp");
    expect(car.speed).toBe(0);
    car.update(1 / 60, []);
    expect(car.speed).toBeGreaterThan(0);
    f.dispose();
  });

  it("a wrecked officer stays disabled when the pursuit target refreshes", () => {
    const f = createCarFixture(80, () => 0.25, "police");
    const target = { x: 700, z: 992 };
    f.car.setPursuitTarget(target);
    f.car.registerCollision(-1, 1, true);
    for (let i = 0; i < 360; i++) {
      f.car.setPursuitTarget(target);
      f.car.update(1 / 60, []);
    }
    expect(f.car.isPursuitDisabled).toBe(true);
    expect(f.car.speed).toBe(0);
    expect(f.car.pursuitRecoveryRemaining).toBe(0);
    f.dispose();
  });

  it("abandons a ram after a sharp evasive turn and waits before retrying", () => {
    const f = createCarFixture(100, () => 0.25, "police");
    f.car.mesh.position.set(500, 1, 992);
    let x = 530;
    for (let i = 0; i < 120 && f.car.pursuitPhase !== "ram"; i++) {
      x += 80 / 60;
      f.car.setPursuitTarget({ x, z: 992, heading: Math.PI / 2, velocityX: 80 });
      f.car.update(1 / 60, []);
    }
    expect(f.car.pursuitPhase).toBe("ram");
    f.car.setPursuitTarget({ x, z: 992, heading: 0, velocityZ: 80 });
    f.car.update(1 / 60, []);
    expect(f.car.pursuitPhase).toBe("catchUp");
    f.car.setPursuitTarget({ x: f.car.mesh.position.x + 25, z: 992, heading: Math.PI / 2, velocityX: 80 });
    f.car.update(0.5, []);
    expect(f.car.pursuitPhase).toBe("catchUp");
    f.dispose();
  });

  it("times out a missed committed attack instead of staying locked on indefinitely", () => {
    const f = createCarFixture(100, () => 0.25, "police");
    f.car.mesh.position.set(300, 1, 992 + GAME_CONFIG.player.width * 0.55);
    const refresh = () => f.car.setPursuitTarget({ x: f.car.mesh.position.x + 20, z: 992, heading: Math.PI / 2, velocityX: 90 });
    for (let i = 0; i < 10 && f.car.pursuitPhase !== "ram"; i++) {
      refresh();
      f.car.update(1 / 60, []);
    }
    expect(f.car.pursuitPhase).toBe("ram");
    for (let i = 0; i < 91; i++) { refresh(); f.car.update(1 / 60, []); }
    expect(f.car.pursuitPhase).toBe("catchUp");
    f.dispose();
  });

  it("cannot close a straight-road gap to an undamaged elite-speed player", () => {
    const f = createCarFixture(GAME_CONFIG.police.pursuitSpeed, () => 0.25, "police");
    f.car.mesh.position.set(100, 1, 992);
    let x = 200;
    for (let i = 0; i < 240; i++) {
      x += GAME_CONFIG.progression.eliteVehicleStats.topSpeed / 60;
      f.car.setPursuitTarget({ x, z: 992, heading: Math.PI / 2, velocityX: GAME_CONFIG.progression.eliteVehicleStats.topSpeed });
      f.car.update(1 / 60, []);
      expect(f.car.speed).toBeLessThanOrEqual(GAME_CONFIG.police.pursuitSpeed);
    }
    expect(x - f.car.mesh.position.x).toBeGreaterThan(180);
    f.dispose();
  });

  it("classifies signals for all headings, including leftward U-turns", () => {
    const headings = ["north", "west", "south", "east"] as const;
    headings.forEach((heading, i) => {
      expect(turnSignalForDirections(heading, heading)).toBe("off");
      expect(turnSignalForDirections(heading, headings[(i + 1) % 4])).toBe("right");
      expect(turnSignalForDirections(heading, headings[(i + 3) % 4])).toBe("left");
      expect(turnSignalForDirections(heading, headings[(i + 2) % 4])).toBe("left");
    });
  });

  it("signals ahead of the turn, through a red light and turn, then cancels", () => {
    const f = createCarFixture(35, sequenceRandom([0, 0.8, 0]));
    const car = f.car;
    car.refreshTurnSignal();
    expect(car.turnSignal).toBe("off");
    car.mesh.position.x = car.target.position.x - 160;
    car.refreshTurnSignal();
    expect(car.turnSignal).toBe("right");
    for (let i = 0; i < 300; i++) car.update(1 / 60, [], "red");
    expect(car.speed).toBeCloseTo(0);
    expect(car.turnSignal).toBe("right");
    let sawTurn = false;
    for (let i = 0; i < 1200; i++) {
      car.update(1 / 60, []);
      car.refreshTurnSignal();
      if (car.isTurning) {
        sawTurn = true;
        expect(car.turnSignal).toBe("right");
      } else if (sawTurn) break;
    }
    expect(sawTurn).toBe(true);
    expect(car.isTurning).toBe(false);
    expect(car.turnSignal).toBe("off");
    f.dispose();
  });

  it("blinks independently of movement and resets after recycling and accidents", () => {
    const f = createCarFixture(35, sequenceRandom([0, 0.8, 0]));
    f.car.mesh.setEnabled(true);
    f.car.mesh.position.x = f.car.target.position.x - 150;
    const signals = new TrafficTurnSignals(f.scene, [f.car]);
    const activeLamp = f.scene.getMeshByName("npc-right-signal-1")!;
    const inactiveLamp = f.scene.getMeshByName("npc-left-signal-1")!;
    signals.update(0);
    expect(activeLamp.isEnabled()).toBe(true);
    expect(inactiveLamp.isEnabled()).toBe(false);
    signals.update(0.41);
    expect(activeLamp.isEnabled()).toBe(false);
    signals.update(0.4);
    expect(activeLamp.isEnabled()).toBe(true);
    f.car.registerCollision(2, 0.1, true);
    signals.update(0);
    expect(activeLamp.isEnabled()).toBe(false);
    f.car.respawn({ position: new Vector3(0, 1, 1000), ix: 0, iz: 1 }, "east", 0);
    signals.update(0);
    expect(f.car.turnSignal).toBe("off");
    expect(activeLamp.isEnabled()).toBe(false);
    signals.dispose();
    expect(f.scene.getMeshByName("npc-left-signal")).toBeNull();
    f.dispose();
  });

  it("suppresses patrolling police signals during pursuit", () => {
    const f = createCarFixture(35, sequenceRandom([0, 0.8, 0]), "police");
    f.car.mesh.position.x = f.car.target.position.x - 150;
    f.car.refreshTurnSignal();
    expect(f.car.turnSignal).toBe("right");
    f.car.setPursuitTarget({ x: 1500, z: 1000 });
    f.car.refreshTurnSignal();
    expect(f.car.turnSignal).toBe("off");
    f.dispose();
  });
  it("calculates safe red-light braking and commits through a yellow when too close to stop", () => {
    const stopCenterDistance = GAME_CONFIG.world.roadWidth / 2
      + GAME_CONFIG.trafficSignals.stopLineSetback
      + GAME_CONFIG.traffic.hitboxLength / 2;
    const farDistance = stopCenterDistance + 50;
    const closeDistance = stopCenterDistance + 4;

    expect(trafficSignalSpeedLimit("green", 30, farDistance)).toBeNull();
    expect(trafficSignalSpeedLimit("red", 30, stopCenterDistance)).toBe(0);
    expect(trafficSignalSpeedLimit("red", 30, farDistance)).toBeCloseTo(
      Math.sqrt(2 * GAME_CONFIG.traffic.braking * 50),
    );
    expect(trafficSignalSpeedLimit("yellow", 20, farDistance)).not.toBeNull();
    expect(trafficSignalSpeedLimit("yellow", 20, closeDistance)).toBeNull();
    expect(trafficSignalSpeedLimit("red", 20, GAME_CONFIG.world.roadWidth / 2 - 1)).toBeNull();
  });

  it("stops at a red signal, queues a following car, and resumes on green", () => {
    const leaderFixture = createCarFixture(GAME_CONFIG.traffic.maxSpeed);
    const followerFixture = createCarFixture(GAME_CONFIG.traffic.maxSpeed);
    const leader = leaderFixture.car;
    const follower = followerFixture.car;
    const stopCenterDistance = GAME_CONFIG.world.roadWidth / 2
      + GAME_CONFIG.trafficSignals.stopLineSetback
      + GAME_CONFIG.traffic.hitboxLength / 2;
    const intersectionX = leader.target.position.x;
    leader.mesh.position.x = intersectionX - stopCenterDistance - 80;
    follower.mesh.position.x = leader.mesh.position.x - 35;
    follower.mesh.position.z = leader.mesh.position.z;

    for (let frame = 0; frame < 600; frame++) {
      leader.update(1 / 60, [], "red");
      follower.update(1 / 60, [leader], "green");
    }

    expect(leader.speed).toBeLessThan(0.1);
    expect(intersectionX - leader.mesh.position.x).toBeGreaterThanOrEqual(stopCenterDistance - 0.5);
    expect(follower.speed).toBeLessThan(0.25);
    expect(leader.mesh.position.x - follower.mesh.position.x).toBeGreaterThanOrEqual(
      GAME_CONFIG.traffic.hitboxLength + GAME_CONFIG.traffic.minimumFollowingGap - 0.5,
    );

    const stoppedX = leader.mesh.position.x;
    for (let frame = 0; frame < 60; frame++) leader.update(1 / 60, [], "green");
    expect(leader.mesh.position.x).toBeGreaterThan(stoppedX);

    leaderFixture.dispose();
    followerFixture.dispose();
  });

  it("selects the road direction that closes on the pursuit target, including reverse", () => {
    const roads = [0, 1000, 2000];
    const intersection: TrafficWaypoint = { position: new Vector3(1000, 1, 1000), ix: 1, iz: 1 };

    expect(choosePursuitDirection(intersection, "east", { x: 1000, z: 2000 }, roads, roads)).toBe("south");
    expect(choosePursuitDirection(intersection, "east", { x: 2000, z: 1000 }, roads, roads)).toBe("east");
    expect(choosePursuitDirection(intersection, "east", { x: 0, z: 1000 }, roads, roads)).toBe("west");
  });

  it("only requests a mid-block U-turn when the player is behind and reversing saves distance", () => {
    const roads = [0, 1000, 2000];
    const previous: TrafficWaypoint = { position: new Vector3(0, 1, 1000), ix: 0, iz: 1 };
    const next: TrafficWaypoint = { position: new Vector3(1000, 1, 1000), ix: 1, iz: 1 };
    const position = { x: 500, z: 1000 };

    expect(shouldStartPursuitUTurn(
      position,
      previous,
      next,
      "east",
      { x: 600, z: 1000 },
      roads,
      roads,
    )).toBe(false);
    expect(shouldStartPursuitUTurn(
      position,
      previous,
      next,
      "east",
      { x: 100, z: 1000 },
      roads,
      roads,
    )).toBe(true);
  });

  it("builds an on-road semicircular U-turn with matching entry and exit headings", () => {
    const start = new Vector3(100, 1, 81.25);
    const end = new Vector3(100, 1, 108);
    const points = createTrafficUTurnPath(start, end, "east", 8);

    expect(points).toHaveLength(8);
    expect(points[0].x).toBeGreaterThan(start.x);
    expect(Math.abs(points[0].z - start.z)).toBeLessThan(points[0].x - start.x);
    expect(points[7].x).toBeCloseTo(end.x);
    expect(points[7].z).toBeCloseTo(end.z);
    expect(points[6].x).toBeGreaterThan(end.x);
  });

  it("builds a turn path tangent to the incoming and outgoing lanes", () => {
    const start = new Vector3(68, 1, 81.25);
    const end = new Vector3(81.25, 1, 68);
    const points = createTrafficTurnPath(start, end, "east", 4);

    expect(points).toHaveLength(4);
    expect(points[0].x).toBeGreaterThan(start.x);
    expect(points[0].z).toBeLessThan(start.z);
    expect(points[3].x).toBe(end.x);
    expect(points[3].z).toBe(end.z);
    expect(Math.abs(points[0].z - start.z)).toBeLessThan(Math.abs(points[0].x - start.x));
    expect(Math.abs(end.x - points[2].x)).toBeLessThan(Math.abs(end.z - points[2].z));
  });

  it("begins a planned curved turn before reaching the intersection center", () => {
    const fixture = createCarFixture(
      GAME_CONFIG.traffic.maxSpeed,
      sequenceRandom([0.5, 0.9, 0, 0.5]),
    );
    const { car } = fixture;
    const intersectionX = car.target.position.x;
    car.mesh.position.x = intersectionX - GAME_CONFIG.traffic.turnCurveRadius + 1;
    const previousZ = car.mesh.position.z;

    car.update(0.1, []);

    expect(car.isTurning).toBe(true);
    expect(car.direction).toBe("north");
    expect(car.mesh.position.x).toBeLessThan(intersectionX);
    expect(car.mesh.position.x).toBeGreaterThan(intersectionX - GAME_CONFIG.traffic.turnCurveRadius);
    expect(car.mesh.position.z).toBeLessThan(previousZ);

    fixture.dispose();
  });

  it("reselects cruise speed around ten seconds and accelerates smoothly", () => {
    const fixture = createCarFixture(
      GAME_CONFIG.traffic.minSpeed,
      sequenceRandom([0, 0, 0.999, 0.5]),
    );
    const { car } = fixture;

    for (let elapsed = 0; elapsed < GAME_CONFIG.traffic.minSpeedChangeSeconds - 0.1; elapsed += 0.1) {
      car.update(0.1, []);
    }
    expect(car.targetCruiseSpeed).toBe(GAME_CONFIG.traffic.minSpeed);

    const speedBeforeChange = car.speed;
    car.update(0.2, []);
    expect(car.targetCruiseSpeed).toBeCloseTo(GAME_CONFIG.traffic.maxSpeed, 1);
    expect(car.speed - speedBeforeChange).toBeLessThanOrEqual(GAME_CONFIG.traffic.acceleration * 0.2 + 0.001);

    fixture.dispose();
  });

  it("brakes smoothly when gaining on same-lane NPC traffic", () => {
    const followerFixture = createCarFixture(GAME_CONFIG.traffic.maxSpeed);
    const leaderFixture = createCarFixture(GAME_CONFIG.traffic.minSpeed);
    const follower = followerFixture.car;
    const leader = leaderFixture.car;
    follower.mesh.position.x = 100;
    leader.mesh.position.x = 130;
    leader.mesh.position.z = follower.mesh.position.z;

    const previousSpeed = follower.speed;
    follower.update(0.1, [leader]);

    expect(follower.speed).toBeLessThan(previousSpeed);
    expect(previousSpeed - follower.speed).toBeLessThanOrEqual(GAME_CONFIG.traffic.braking * 0.1 + 0.001);

    followerFixture.dispose();
    leaderFixture.dispose();
  });

  it("uses hard yielding normally and only a very light brake for an intentional conflict", () => {
    const hardFixture = createCarFixture(GAME_CONFIG.traffic.maxSpeed);
    const lightFixture = createCarFixture(GAME_CONFIG.traffic.maxSpeed);
    hardFixture.car.setSafetyBrakeMode("hard");
    lightFixture.car.setSafetyBrakeMode("light");
    const hardStart = hardFixture.car.speed;
    const lightStart = lightFixture.car.speed;

    hardFixture.car.update(0.1, []);
    lightFixture.car.update(0.1, []);

    expect(hardStart - hardFixture.car.speed).toBeCloseTo(GAME_CONFIG.traffic.braking * 0.1);
    expect(lightStart - lightFixture.car.speed).toBeCloseTo(
      GAME_CONFIG.traffic.intentionalCrashBraking * 0.1,
    );
    hardFixture.dispose();
    lightFixture.dispose();
  });

  it("makes patrol police obey red lights while pursuing police ignore them", () => {
    const fixture = createCarFixture(GAME_CONFIG.traffic.minSpeed, () => 0.25, "police");
    const { car } = fixture;
    const stopCenterDistance = GAME_CONFIG.world.roadWidth / 2
      + GAME_CONFIG.trafficSignals.stopLineSetback
      + GAME_CONFIG.traffic.hitboxLength / 2;
    car.mesh.position.x = car.target.position.x - stopCenterDistance;
    const previousSpeed = car.speed;

    car.update(0.1, [], "red");
    expect(car.speed).toBeCloseTo(previousSpeed - GAME_CONFIG.traffic.braking * 0.1);

    car.speed = previousSpeed;
    car.setPursuitTarget({ x: 2000, z: 1000 });
    car.update(0.1, [], "red");

    expect(car.isPursuing).toBe(true);
    expect(car.speed).toBeCloseTo(previousSpeed + GAME_CONFIG.police.pursuitAcceleration * 0.1);
    car.clearPursuit();
    expect(car.isPursuing).toBe(false);

    fixture.dispose();
  });

  it("matches player speed and calmly stops behind a stopped player", () => {
    const movingFixture = createCarFixture(GAME_CONFIG.traffic.maxSpeed, () => 0.25, "police");
    const movingPolice = movingFixture.car;
    movingPolice.mesh.position.x = 500;
    movingPolice.setPursuitTarget({
      x: 530,
      z: movingPolice.mesh.position.z,
      heading: Math.PI / 2,
      velocityX: 30,
      velocityZ: 0,
      vehicleLength: GAME_CONFIG.player.length,
    });
    const movingSpeed = movingPolice.speed;
    movingPolice.update(0.1, []);
    expect(movingPolice.speed).toBeLessThan(movingSpeed);
    expect(movingPolice.speed).toBeGreaterThan(30);

    const stoppedFixture = createCarFixture(GAME_CONFIG.traffic.maxSpeed, () => 0.25, "police");
    const stoppedPolice = stoppedFixture.car;
    stoppedPolice.mesh.position.x = 500;
    const desiredCenterDistance = GAME_CONFIG.traffic.vehicleLength / 2
      + GAME_CONFIG.player.length / 2
      + GAME_CONFIG.police.pursuitDesiredGapMeters;
    stoppedPolice.setPursuitTarget({
      x: 500 + desiredCenterDistance,
      z: stoppedPolice.mesh.position.z,
      heading: Math.PI / 2,
      velocityX: 0,
      velocityZ: 0,
      vehicleLength: GAME_CONFIG.player.length,
    });
    stoppedPolice.update(0.1, []);
    expect(stoppedPolice.speed).toBe(0);

    movingFixture.dispose();
    stoppedFixture.dispose();
  });

  it("brakes early enough to settle behind a player who has stopped at the curb", () => {
    const fixture = createCarFixture(GAME_CONFIG.police.pursuitSpeed, () => 0.25, "police");
    const { car } = fixture;
    car.mesh.position.x = 300;
    const playerX = 500;
    const roadsideZ = 1000 - GAME_CONFIG.world.roadWidth / 2 + GAME_CONFIG.player.width / 2;
    const target = {
      x: playerX,
      z: roadsideZ,
      heading: Math.PI / 2,
      velocityX: 0,
      velocityZ: 0,
      vehicleLength: GAME_CONFIG.player.length,
    };
    for (let step = 0; step < 400; step++) {
      car.setPursuitTarget(target);
      car.update(0.05, []);
    }
    const centerDistance = Math.hypot(playerX - car.mesh.position.x, roadsideZ - car.mesh.position.z);
    const captureDistance = GAME_CONFIG.traffic.vehicleLength / 2
      + GAME_CONFIG.player.length / 2
      + GAME_CONFIG.police.pursuitCaptureGapMeters;
    expect(car.mesh.position.x).toBeLessThan(playerX);
    expect(centerDistance).toBeLessThanOrEqual(captureDistance);
    expect(car.speed).toBeLessThan(1);
    fixture.dispose();
  });

  it("pulls ordinary traffic over after a serious crash", () => {
    const fixture = createCarFixture(GAME_CONFIG.traffic.maxSpeed);
    const { car } = fixture;
    car.registerCollision(99, 0.2, true);
    expect(car.accidentState).toBe("braking");

    for (let step = 0; step < 200 && car.accidentState === "braking"; step++) {
      car.update(0.05, []);
    }
    expect(["pullingOver", "stopped"]).toContain(car.accidentState);

    for (let step = 0; step < 400 && car.accidentState !== "stopped"; step++) {
      car.update(0.05, []);
    }
    expect(car.accidentState).toBe("stopped");
    expect(car.speed).toBe(0);
    fixture.dispose();
  });

  it("waits briefly and resumes after an NPC-only serious crash", () => {
    const fixture = createCarFixture(GAME_CONFIG.traffic.maxSpeed);
    const { car } = fixture;
    car.registerCollision(99, 0.2, true, false);

    for (let step = 0; step < 200 && car.accidentState !== "waiting"; step++) {
      car.update(0.05, []);
    }
    expect(car.accidentState).toBe("waiting");
    for (let step = 0; step < 40; step++) car.update(0.05, []);
    expect(car.accidentState).toBe("driving");
    expect(car.speed).toBeGreaterThan(0);
    fixture.dispose();
  });

  it("stabilizes and resumes pursuit with accumulated damage after a serious crash", () => {
    const fixture = createCarFixture(GAME_CONFIG.traffic.maxSpeed, () => 0.25, "police");
    const { car } = fixture;
    car.setPursuitTarget({ x: 1800, z: 1000, heading: Math.PI / 2, velocityX: 40, velocityZ: 0 });
    car.registerCollision(99, 0.3, true);
    expect(car.accidentState).toBe("pursuitRecovery");
    expect(car.damagePercent).toBeCloseTo(0.3);

    for (let step = 0; step < 41; step++) car.update(0.1, []);
    expect(car.accidentState).toBe("driving");
    expect(car.isPursuing).toBe(true);
    fixture.dispose();
  });

  it("promotes a collision-triggered officer from accident braking into pursuit recovery", () => {
    const fixture = createCarFixture(GAME_CONFIG.traffic.maxSpeed, () => 0.25, "police");
    const { car } = fixture;
    car.registerCollision(-1, 0.2, true);
    expect(car.accidentState).toBe("braking");

    car.setPursuitTarget({ x: 1800, z: 1000, heading: Math.PI / 2, velocityX: 40, velocityZ: 0 });
    expect(car.accidentState).toBe("pursuitRecovery");
    expect(car.isPursuing).toBe(true);
    fixture.dispose();
  });

  it("moves to the pursuit lane and does not queue behind distant civilian traffic", () => {
    const policeFixture = createCarFixture(GAME_CONFIG.traffic.maxSpeed, () => 0.25, "police");
    const leaderFixture = createCarFixture(GAME_CONFIG.traffic.minSpeed);
    const police = policeFixture.car;
    const leader = leaderFixture.car;
    police.mesh.position.x = 100;
    leader.mesh.position.x = 130;
    leader.mesh.position.z = police.mesh.position.z;

    const previousSpeed = police.speed;
    police.setPursuitTarget({ x: 2000, z: 1000 });

    expect(police.target.position.z).toBeCloseTo(1000 - GAME_CONFIG.police.pursuitLaneOffset);
    police.update(0.1, [leader]);
    expect(police.speed).toBeGreaterThan(previousSpeed);

    policeFixture.dispose();
    leaderFixture.dispose();
  });

  it("immediately begins a U-turn when the pursuit target is behind", () => {
    const fixture = createCarFixture(GAME_CONFIG.traffic.minSpeed, () => 0.25, "police");
    const { car } = fixture;
    car.mesh.position.x = 500;
    const startingX = car.mesh.position.x;

    car.setPursuitTarget({ x: 100, z: 1000 });
    car.update(0.1, []);

    expect(car.isPursuing).toBe(true);
    expect(car.isTurning).toBe(true);
    expect(car.direction).toBe("west");
    expect(car.mesh.position.x).toBeGreaterThan(startingX);

    fixture.dispose();
  });

  it("continues forward instead of U-turning when the player is ahead on the current block", () => {
    const fixture = createCarFixture(GAME_CONFIG.traffic.minSpeed, () => 0.25, "police");
    const { car } = fixture;
    car.mesh.position.x = 500;

    car.setPursuitTarget({ x: 600, z: 1000 });
    car.update(0.1, []);

    expect(car.isTurning).toBe(false);
    expect(car.direction).toBe("east");
    expect(car.mesh.position.x).toBeGreaterThan(500);

    fixture.dispose();
  });

  it("does not immediately reverse a second time after completing a pursuit U-turn", () => {
    const fixture = createCarFixture(GAME_CONFIG.traffic.minSpeed, () => 0.25, "police");
    const { car } = fixture;
    car.mesh.position.x = 500;
    car.setPursuitTarget({ x: 100, z: 1000 });
    car.update(0.1, []);

    for (let step = 0; car.isTurning && step < 30; step++) {
      car.update(0.1, []);
    }
    expect(car.isTurning).toBe(false);
    expect(car.direction).toBe("west");

    const positionAfterTurn = car.mesh.position.x;
    car.setPursuitTarget({ x: 900, z: 1000 });
    car.update(0.1, []);

    expect(car.isTurning).toBe(false);
    expect(car.direction).toBe("west");
    expect(car.mesh.position.x).toBeLessThan(positionAfterTurn);

    fixture.dispose();
  });

  it("commits to an intersection turn once it enters the approach", () => {
    const fixture = createCarFixture(GAME_CONFIG.traffic.minSpeed, () => 0.25, "police");
    const { car } = fixture;
    car.mesh.position.x = 975;

    car.setPursuitTarget({ x: 1000, z: 2000 });
    car.setPursuitTarget({ x: 1000, z: 0 });
    car.update(0.1, []);

    expect(car.isTurning).toBe(true);
    expect(car.direction).toBe("south");

    fixture.dispose();
  });

  it("can follow a late player turn until the actual turn approach", () => {
    const fixture = createCarFixture(GAME_CONFIG.traffic.minSpeed, () => 0.25, "police");
    const { car } = fixture;
    car.mesh.position.x = 940;

    car.setPursuitTarget({ x: 1000, z: 2000, heading: 0, velocityX: 0, velocityZ: 40 });
    car.setPursuitTarget({ x: 1000, z: 0, heading: Math.PI, velocityX: 0, velocityZ: -40 });
    for (let step = 0; step < 30 && !car.isTurning; step++) car.update(0.1, []);

    expect(car.isTurning).toBe(true);
    expect(car.direction).toBe("north");
    fixture.dispose();
  });

  it("caps pursuit speed even when the player is faster", () => {
    const fixture = createCarFixture(GAME_CONFIG.police.pursuitSpeed, () => 0.25, "police");
    const { car } = fixture;
    car.setPursuitTarget({
      x: 2000,
      z: 1000,
      heading: Math.PI / 2,
      velocityX: 150,
      velocityZ: 0,
      vehicleLength: GAME_CONFIG.player.length,
    });
    car.update(0.5, []);

    expect(car.speed).toBeLessThanOrEqual(GAME_CONFIG.police.pursuitSpeed);
    fixture.dispose();
  });

  it("does not stop a distant officer because the pursuit target is at the path endpoint", () => {
    const fixture = createCarFixture(GAME_CONFIG.traffic.maxSpeed, () => 0.25, "police");
    const { car } = fixture;
    car.mesh.position.set(500, 1, 1000);
    car.setPursuitTarget({
      x: 700,
      z: 1000,
      heading: Math.PI / 2,
      velocityX: GAME_CONFIG.traffic.maxSpeed,
      velocityZ: 0,
      vehicleLength: GAME_CONFIG.player.length,
    });
    const previousSpeed = car.speed;
    car.update(0.1, []);
    expect(car.speed).toBeGreaterThan(previousSpeed);
    fixture.dispose();
  });
});
