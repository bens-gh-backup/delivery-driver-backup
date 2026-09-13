import { createTrainingRegions } from "../training/Training";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { WorldQuery } from "./WorldQuery";
import { entranceApproach, overlapsArea } from "./StreetDetails";
import { TownGenerator } from "./Town";

describe("TownGenerator", () => {
  it("merges static geometry by chunk and registers solid world props", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);

    const town = new TownGenerator(scene).generate();

    // Scattered service locations occupy more render chunks, but remain a small static workload.
    expect(town.meshes.length).toBeLessThan(210);
    expect(town.staticColliders.length).toBeGreaterThan(300);
    expect(town.gasStations).toHaveLength(14);
    expect(town.autoBodyShops).toHaveLength(6);
    expect(town.clinics).toHaveLength(GAME_CONFIG.world.blocksX * GAME_CONFIG.world.blocksZ);
    expect(new Set(town.clinics.map(clinic => clinic.regionId)).size).toBe(town.clinics.length);
    for (const clinic of town.clinics) {
      const road = town.roads.find(road => road.id === clinic.destinationPoint.roadId);
      expect(road).toMatchObject({ type: "city", allowsMissionStops: true });
      expect(clinic.id).toBe(`clinic-${clinic.regionId.replace("block-", "")}`);
    }
    expect(town.legalDrivingAreas).toHaveLength(20);
    const services = [...town.gasStations, ...town.autoBodyShops];
    expect(new Set(services.map(({ position }) => `${position.x},${position.z}`)).size).toBe(20);
    for (let first = 0; first < services.length; first++) {
      for (let second = first + 1; second < services.length; second++) {
        expect(Vector3.Distance(services[first].position, services[second].position))
          .toBeGreaterThanOrEqual(GAME_CONFIG.world.servicePlacement.minimumSpacing);
      }
    }
    expect(Math.max(...services.map(({ position }) => position.x))
      - Math.min(...services.map(({ position }) => position.x))).toBeGreaterThan((town.maxX - town.minX) * 0.7);
    expect(Math.max(...services.map(({ position }) => position.z))
      - Math.min(...services.map(({ position }) => position.z))).toBeGreaterThan((town.maxZ - town.minZ) * 0.7);
    expect(town.meshes.some((mesh) => mesh.name === "center-lines")).toBe(true);
    const highwayRoads = town.roads.filter((road) => road.type === "highway");
    expect(highwayRoads.map((road) => road.id).sort()).toEqual([
      "ew-0",
      `ew-${GAME_CONFIG.world.blocksZ}`,
      "ns-0",
      `ns-${GAME_CONFIG.world.blocksX}`,
    ]);
    expect(highwayRoads.every((road) => road.speedLimitMph === 70 && !road.allowsMissionStops)).toBe(true);
    const roadsById = new Map(town.roads.map((road) => [road.id, road]));
    expect(town.deliveryPoints.length).toBeGreaterThan(0);
    expect(town.deliveryPoints.every((point) => roadsById.get(point.roadId)?.allowsMissionStops)).toBe(true);
    expect(town.residentialTrees.length).toBeGreaterThan(20);
    for (const tree of town.residentialTrees) {
      expect(town.buildings.some(lot =>
        overlapsArea(tree.x,tree.z,tree.radius,entranceApproach(lot))
        || overlapsArea(tree.x,tree.z,tree.radius,{
          x:lot.x,z:lot.z,halfX:lot.width/2,halfZ:lot.depth/2,
        })
      )).toBe(false);
      expect(town.legalDrivingAreas.some(area => overlapsArea(tree.x,tree.z,tree.radius,area))).toBe(false);
    }
    expect(town.curbFootprints.length).toBeGreaterThan(150);
    for (const curb of town.curbFootprints) {
      expect(town.legalDrivingAreas.some(area =>
        Math.abs(curb.x-area.x) < curb.halfX+area.halfX
        && Math.abs(curb.z-area.z) < curb.halfZ+area.halfZ
      )).toBe(false);
    }
    expect(scene.textures).toHaveLength(0);
    expect(scene.meshes.length).toBe(town.meshes.length);
    scene.dispose();
    engine.dispose();
  });

  it("places every gas station mid-block on an interior city road with legal entrance inlets", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const town = new TownGenerator(scene).generate();
    const regions = createTrainingRegions(town);
    expect(regions).toHaveLength(GAME_CONFIG.world.blocksX * GAME_CONFIG.world.blocksZ);
    expect(regions.every(region => region.pickups.length > 0)).toBe(true);
    expect(new Set(regions.flatMap(region => region.pickups)).size).toBe(town.deliveryPoints.length);
    const { roadPositionsX, roadPositionsZ } = town;
    const roadOffset = GAME_CONFIG.world.roadWidth / 2 + GAME_CONFIG.world.sidewalkWidth + 14;
    const corridorHalfWidth = GAME_CONFIG.world.roadWidth / 2
      + GAME_CONFIG.world.sidewalkWidth
      + 17
      + GAME_CONFIG.drivingRules.serviceAreaPadding;
    const gasHalfWidth = GAME_CONFIG.world.servicePlacement.gasStationLegalHalfWidth
      + GAME_CONFIG.drivingRules.serviceAreaPadding;

    // Gas alone must cover the city: shops used to hide large gaps in this check.
    const blockStep = GAME_CONFIG.world.blockSize + GAME_CONFIG.world.roadWidth;
    for (let first = 0; first < town.gasStations.length; first++) {
      for (let second = first + 1; second < town.gasStations.length; second++) {
        expect(Vector3.Distance(town.gasStations[first].position, town.gasStations[second].position))
          .toBeGreaterThan(blockStep);
      }
    }
    for (let bx = 0; bx < roadPositionsX.length - 1; bx++) {
      for (let bz = 0; bz < roadPositionsZ.length - 1; bz++) {
        const x = (roadPositionsX[bx] + roadPositionsX[bx + 1]) / 2;
        const z = (roadPositionsZ[bz] + roadPositionsZ[bz + 1]) / 2;
        const nearest = Math.min(...town.gasStations.map(({ position }) => Math.hypot(x - position.x, z - position.z)));
        expect(nearest).toBeLessThan(blockStep * 1.5);
      }
    }

    for (const station of town.gasStations) {
      const axis = station.roadAxis!;
      const coordinate = axis === "northSouth" ? station.position.x : station.position.z;
      const accessRoad = town.roads.find(road => road.axis === axis
        && Math.abs(road.center - (coordinate - station.roadSide! * roadOffset)) < .01);
      expect(accessRoad).toBeDefined();
      expect(accessRoad!.type).toBe("city");
      expect(accessRoad!.allowsMissionStops).toBe(true);
      expect(accessRoad!.index).toBeGreaterThan(0);
      expect(accessRoad!.index).toBeLessThan((axis === "northSouth" ? roadPositionsX : roadPositionsZ).length - 1);
      const nearestX = roadPositionsX.reduce((best, road) => Math.abs(road - station.position.x) < Math.abs(best - station.position.x) ? road : best);
      const nearestZ = roadPositionsZ.reduce((best, road) => Math.abs(road - station.position.z) < Math.abs(best - station.position.z) ? road : best);
      if (station.roadAxis === "northSouth") {
        expect(Math.abs(station.position.x - nearestX)).toBeCloseTo(roadOffset);
        const segment = roadPositionsZ.findIndex((road, index) => (
          index < roadPositionsZ.length - 1
          && Math.abs(station.position.z - (road + roadPositionsZ[index + 1]) / 2) < 0.01
        ));
        expect(segment).toBeGreaterThanOrEqual(0);
      } else {
        expect(Math.abs(station.position.z - nearestZ)).toBeCloseTo(roadOffset);
        const segment = roadPositionsX.findIndex((road, index) => (
          index < roadPositionsX.length - 1
          && Math.abs(station.position.x - (road + roadPositionsX[index + 1]) / 2) < 0.01
        ));
        expect(segment).toBeGreaterThanOrEqual(0);
      }
    }

    expect(town.legalDrivingAreas).toHaveLength(GAME_CONFIG.fuel.stationCount + GAME_CONFIG.repair.shopCount);
    for (let index = 0; index < town.gasStations.length; index++) {
      const area = town.legalDrivingAreas[index];
      for (const building of town.buildings) {
        const clearance = GAME_CONFIG.world.servicePlacement.buildingClearance;
        expect(Math.abs(building.x - area.x) < building.width / 2 + area.halfX + clearance
          && Math.abs(building.z - area.z) < building.depth / 2 + area.halfZ + clearance).toBe(false);
      }
      // The entire entrance area stays inside the highway ring, not just the station center.
      const halfRoad = GAME_CONFIG.world.roadWidth / 2;
      expect(area.x - area.halfX).toBeGreaterThan(roadPositionsX[0] + halfRoad);
      expect(area.x + area.halfX).toBeLessThan(roadPositionsX.at(-1)! - halfRoad);
      expect(area.z - area.halfZ).toBeGreaterThan(roadPositionsZ[0] + halfRoad);
      expect(area.z + area.halfZ).toBeLessThan(roadPositionsZ.at(-1)! - halfRoad);
      if (town.gasStations[index].roadAxis === "northSouth") {
        expect(area.halfX).toBeCloseTo(corridorHalfWidth);
        expect(area.halfZ).toBeCloseTo(gasHalfWidth);
      } else {
        expect(area.halfX).toBeCloseTo(gasHalfWidth);
        expect(area.halfZ).toBeCloseTo(corridorHalfWidth);
      }
    }

    expect(town.meshes.length).toBeLessThan(210);
    const query = new WorldQuery(
      town.staticColliders,
      town.roads,
      GAME_CONFIG.world.roadWidth / 2,
      GAME_CONFIG.world.roadWidth / 2 + GAME_CONFIG.world.sidewalkWidth,
      GAME_CONFIG.world.spatialCellSize,
      town.legalDrivingAreas,
    );
    for (const station of town.gasStations) {
      const side = station.roadSide ?? 1;
      const inlet = station.roadAxis === "northSouth"
        ? { x: station.position.x - side * 20, z: station.position.z + 40 }
        : { x: station.position.x + 40, z: station.position.z - side * 20 };
      expect(query.isInLegalDrivingArea(inlet.x, inlet.z)).toBe(true);
    }
    scene.dispose();
    engine.dispose();
  });
});
