import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import type { BoxCollider, RoadDefinition } from "../game/types";
import { WorldQuery } from "../world/WorldQuery";
import {
  DrivingBehaviorManager,
  evaluateDrivingViolations,
  type DrivingBehaviorSample,
} from "./DrivingBehaviorManager";
import type { PlayerCar } from "./PlayerCar";

function createQuery(legalDrivingAreas: BoxCollider[] = []): WorldQuery {
  const roads: RoadDefinition[] = [];
  for (const [axis, prefix] of [["northSouth", "ns"], ["eastWest", "ew"]] as const) {
    for (let index = 0; index < 3; index++) {
      const highway = axis === "northSouth" && index === 1;
      roads.push({
        id: `${prefix}-${index}`,
        axis,
        index,
        center: index * 120,
        type: highway ? "highway" : "city",
        speedLimitMph: highway ? 70 : 60,
        allowsMissionStops: !highway,
      });
    }
  }
  return new WorldQuery([], roads, 20, 22, 64, legalDrivingAreas);
}

function northbound(overrides: Partial<DrivingBehaviorSample> = {}): DrivingBehaviorSample {
  return {
    x: -10,
    z: 60,
    heading: Math.PI,
    velocityX: 0,
    velocityZ: -20,
    speedMph: 30,
    width: 6,
    length: 10,
    ...overrides,
  };
}

describe("DrivingBehaviorManager", () => {
  it("distinguishes a legal lane, line overlap, and fully wrong-way travel", () => {
    const query = createQuery();
    const legal = evaluateDrivingViolations(northbound(), query);
    const lineOverlap = evaluateDrivingViolations(northbound({ x: -3 }), query);
    const wrongWay = evaluateDrivingViolations(northbound({ x: 10 }), query);

    expect(legal.wrongSide).toBe(0);
    expect(lineOverlap.wrongSide).toBeGreaterThan(0);
    expect(lineOverlap.wrongSide).toBeLessThan(0.5);
    expect(wrongWay.wrongSide).toBe(1);
  });

  it("forgives reversing for 20 meters before building wrong-way severity", () => {
    const query = createQuery();
    const backingUp = northbound({ velocityZ: 20, reverseDistanceMeters: 10 });
    const afterGrace = northbound({ velocityZ: 20, reverseDistanceMeters: 30 });
    expect(evaluateDrivingViolations(backingUp, query).wrongSide).toBe(0);
    expect(evaluateDrivingViolations(afterGrace, query).wrongSide).toBeGreaterThan(0);
    expect(evaluateDrivingViolations(northbound({ velocityZ: 20, reverseDistanceMeters: 40 }), query).wrongSide).toBe(1);
  });

  it("scales sidewalk severity with the amount of car outside the road", () => {
    const query = createQuery();
    const partial = evaluateDrivingViolations(northbound({ x: 19 }), query);
    const full = evaluateDrivingViolations(northbound({ x: 30 }), query);

    expect(partial.sidewalk).toBeGreaterThan(0);
    expect(partial.sidewalk).toBeLessThan(full.sidewalk);
    expect(full.sidewalk).toBe(1);
  });

  it("allows intersection turns and service-area driving", () => {
    const serviceArea = { x: 30, z: 60, halfX: 8, halfZ: 8 };
    const query = createQuery([serviceArea]);
    const intersection = evaluateDrivingViolations(northbound({ x: 10, z: 0 }), query);
    const turningGapZ = 20 + GAME_CONFIG.world.roadMarkings.intersectionBuffer - 1;
    const turningGap = evaluateDrivingViolations(northbound({ x: 10, z: turningGapZ }), query);
    const service = evaluateDrivingViolations(northbound({ x: 30 }), query);

    expect(intersection.wrongSide).toBe(0);
    expect(turningGap.wrongSide).toBe(0);
    expect(service.wrongSide).toBe(0);
    expect(service.sidewalk).toBe(0);
  });

  it("uses each road's speed limit with configured tolerance and severity range", () => {
    const query = createQuery();
    const cityLimit = GAME_CONFIG.world.roadTypes.city.speedLimitMph;
    const speedingStarts = cityLimit + GAME_CONFIG.drivingRules.speedToleranceMph;
    const fullSpeedingMph = cityLimit + GAME_CONFIG.drivingRules.fullSpeedingOverLimitMph;
    const midpoint = (speedingStarts + fullSpeedingMph) / 2;

    expect(evaluateDrivingViolations(northbound({ speedMph: speedingStarts }), query).speeding).toBe(0);
    expect(evaluateDrivingViolations(northbound({ speedMph: midpoint }), query).speeding).toBeCloseTo(0.5);
    expect(evaluateDrivingViolations(northbound({ speedMph: fullSpeedingMph }), query).speeding).toBe(1);
    expect(evaluateDrivingViolations(northbound({ x: 110, speedMph: 70 }), query).speeding).toBe(0);
  });

  it("accumulates weighted points consistently across fixed-step subdivisions", () => {
    const query = createQuery();
    const sample = northbound({ x: 10, speedMph: 70 });
    const player = {
      root: { position: { x: sample.x, z: sample.z } },
      heading: sample.heading,
      getVelocityX: () => sample.velocityX,
      getVelocityZ: () => sample.velocityZ,
      getSpeedMph: () => sample.speedMph,
      vehicleWidth: sample.width,
      vehicleLength: sample.length,
    } as unknown as PlayerCar;
    const singleStep = new DrivingBehaviorManager();
    const fixedSteps = new DrivingBehaviorManager();

    singleStep.update(1, player, query);
    for (let index = 0; index < 60; index++) fixedSteps.update(1 / 60, player, query);

    expect(singleStep.totals.speeding).toBeCloseTo(GAME_CONFIG.drivingRules.speedingPointsPerSecond);
    expect(singleStep.totals.wrongSide).toBeCloseTo(GAME_CONFIG.drivingRules.wrongSidePointsPerSecond);
    expect(singleStep.rates.speeding).toBeCloseTo(GAME_CONFIG.drivingRules.speedingPointsPerSecond);
    expect(singleStep.rates.wrongSide).toBeCloseTo(GAME_CONFIG.drivingRules.wrongSidePointsPerSecond);
    expect(singleStep.rates.total).toBeCloseTo(singleStep.rates.speeding + singleStep.rates.wrongSide);
    expect(fixedSteps.totals.total).toBeCloseTo(singleStep.totals.total);
  });
});
