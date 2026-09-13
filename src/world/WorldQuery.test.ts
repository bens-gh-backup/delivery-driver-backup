import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import type { BoxCollider, RoadDefinition, RoadTypeId } from "../game/types";
import { WorldQuery } from "./WorldQuery";

function createQuery(colliders: BoxCollider[] = [], legalDrivingAreas: BoxCollider[] = []): WorldQuery {
  return new WorldQuery(colliders, testRoads(), 20, 22, 64, legalDrivingAreas);
}

function testRoads(): RoadDefinition[] {
  const roads: RoadDefinition[] = [];
  for (const [axis, prefix] of [["northSouth", "ns"], ["eastWest", "ew"]] as const) {
    for (let index = 0; index < 3; index++) {
      const type: RoadTypeId = index === 2 ? "highway" : "city";
      roads.push({
        id: `${prefix}-${index}`,
        axis,
        index,
        center: index * 120,
        type,
        speedLimitMph: type === "highway" ? 70 : 60,
        allowsMissionStops: type !== "highway",
      });
    }
  }
  return roads;
}

describe("WorldQuery", () => {
  it("returns nearby and oversized colliders without scanning distant cells", () => {
    const nearby = { x: 15, z: 10, halfX: 5, halfZ: 5 };
    const distant = { x: 400, z: 400, halfX: 5, halfZ: 5 };
    const boundary = { x: 0, z: -500, halfX: 600, halfZ: 6 };
    const query = createQuery([nearby, distant, boundary]);
    const results: BoxCollider[] = [];

    query.getNearbyColliders(10, 10, 3, results);

    expect(results).toContain(nearby);
    expect(results).toContain(boundary);
    expect(results).not.toContain(distant);
  });

  it("classifies regular road and sidewalk bands in constant time", () => {
    const query = createQuery();

    expect(query.isOnSidewalk(0, 60)).toBe(false);
    expect(query.isOnSidewalk(21, 60)).toBe(true);
    expect(query.isOnSidewalk(23, 60)).toBe(false);
    expect(query.isOnSidewalk(141, 60)).toBe(true);
  });

  it("reports road orientation, turning gaps, and legal service areas", () => {
    const query = createQuery([], [{ x: 30, z: 60, halfX: 6, halfZ: 6 }]);

    const road = query.getRoadContext(10, 60, 0, -10);
    const turningGapZ = 20 + GAME_CONFIG.world.roadMarkings.intersectionBuffer - 1;
    const turnApproach = query.getRoadContext(10, turningGapZ, 0, -10);

    expect(road.axis).toBe("northSouth");
    expect(road.road.id).toBe("ns-0");
    expect(road.road.speedLimitMph).toBe(60);
    expect(road.lateralOffset).toBe(10);
    expect(road.inIntersection).toBe(false);
    expect(road.inTurningGap).toBe(false);
    expect(turnApproach.inTurningGap).toBe(true);
    expect(query.isInLegalDrivingArea(30, 60)).toBe(true);
    expect(query.isInLegalDrivingArea(37, 60)).toBe(false);
  });

  it("returns metadata for the selected highway road", () => {
    const road = createQuery().getRoadContext(230, 60, 0, -10);

    expect(road.axis).toBe("northSouth");
    expect(road.road).toMatchObject({
      id: "ns-2",
      type: "highway",
      speedLimitMph: 70,
      allowsMissionStops: false,
    });
  });
});
