import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { describe, expect, it, vi } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { TownGenerator } from "./Town";
import { gasForecourtBounds, WORLD_SURFACES } from "./SurfaceLayout";
import { WorldQuery } from "./WorldQuery";

describe("world surface separation", () => {
  it("keeps colored roof faces clear of walls and uses billboard signs without beacon columns", () => {
    const engine = new NullEngine(), scene = new Scene(engine), generator = new TownGenerator(scene);
    // Inspect actual generated geometry before the production batching pass disposes it.
    const batcher = generator as unknown as { optimizeStaticMeshes(meshes: Mesh[], x: number, z: number): Mesh[] };
    const original = batcher.optimizeStaticMeshes.bind(generator);
    const bounds = new Map<string, { min: Vector3; max: Vector3 }>();
    vi.spyOn(batcher, "optimizeStaticMeshes").mockImplementation((meshes, x, z) => {
      for (const mesh of meshes) {
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        bounds.set(mesh.name, { min: box.minimumWorld.clone(), max: box.maximumWorld.clone() });
      }
      return original(meshes, x, z);
    });
    const town = generator.generate();
    for (const [i, station] of town.gasStations.entries()) {
      const roof = bounds.get(`gas-canopy-${i}`)!;
      const axis = station.roadAxis === "northSouth" ? "x" : "z";
      const front = station.roadSide * ((station.roadSide === 1 ? roof.min[axis] : roof.max[axis]) - station.position[axis]);
      const pumpSetback = Math.max(...station.pumpPositions.map(pump =>
        station.roadSide * (pump[axis] - station.position[axis])));
      // Even at the rear of the interaction radius, a camera facing back toward
      // the road must fit in front of the roof (including the fascia lettering).
      expect(front - GAME_CONFIG.presentation.serviceSigns.surfaceGap)
        .toBeGreaterThan(pumpSetback + station.radius + GAME_CONFIG.camera.distance + 1);
      // The billboard is at the curb, beside the inlet instead of obstructing it.
      const pole = bounds.get(`gas-${i}-billboard-post`)!;
      const road = town.roads.filter(road => road.axis === station.roadAxis)
        .sort((a, b) => Math.abs(a.center - station.position[axis]) - Math.abs(b.center - station.position[axis]))[0];
      const poleCenter = (pole.min[axis] + pole.max[axis]) / 2;
      const curbInset = station.roadSide * (poleCenter - road.center) - GAME_CONFIG.world.roadWidth / 2;
      expect(curbInset).toBeGreaterThan(1);
      expect(curbInset).toBeLessThan(GAME_CONFIG.world.sidewalkWidth + 5);
      const alongAxis = axis === "x" ? "z" : "x";
      expect(Math.abs((pole.min[alongAxis] + pole.max[alongAxis]) / 2 - station.position[alongAxis]))
        .toBeGreaterThan(gasForecourtBounds().halfLength + GAME_CONFIG.player.radius + .75);
    }
    for (let i = 0; i < town.dealerships.length; i++) {
      const wall = bounds.get(`dealership-showroom-${i}`)!, roof = bounds.get(`dealership-fascia-${i}`)!;
      expect(roof.min.y).toBeGreaterThanOrEqual(wall.max.y);
      expect(roof.min.x).toBeLessThan(wall.min.x);
      expect(roof.max.z).toBeGreaterThan(wall.max.z);
    }
    for (let i = 0; i < town.autoBodyShops.length; i++) {
      const wall = (bounds.get(`repair-shell-${i}`) ?? bounds.get(`repair-side-1-${i}`))!, roof = bounds.get(`repair-roof-${i}`)!;
      expect(roof.min.y).toBeGreaterThanOrEqual(wall.max.y - .00001);
    }
    expect([...bounds.keys()].some(name => /^(gas|repair)-beam-/.test(name))).toBe(false);
    for (const [kind, count] of [["gas", town.gasStations.length], ["repair", town.autoBodyShops.length]] as const) {
      for (let i = 0; i < count; i++) {
        const board = bounds.get(`${kind}-${i}-billboard`)!, pole = bounds.get(`${kind}-${i}-billboard-post`)!;
        expect((board.max.y + board.min.y) / 2).toBeCloseTo(28 * 1.2);
        expect(pole.max.y).toBeCloseTo(board.min.y);
      }
    }
    scene.dispose(); engine.dispose();
  });

  it("leaves car-wide lanes on both sides and between solid pumps in every station orientation", () => {
    const engine = new NullEngine(), scene = new Scene(engine), town = new TownGenerator(scene).generate();
    const query = new WorldQuery(town.staticColliders, town.roads, GAME_CONFIG.world.roadWidth / 2,
      GAME_CONFIG.world.roadWidth / 2 + GAME_CONFIG.world.sidewalkWidth, 64, town.legalDrivingAreas);
    const blocked = (x: number, z: number, radius: number) => town.staticColliders.some(c =>
      Math.abs(x - c.x) < c.halfX + radius && Math.abs(z - c.z) < c.halfZ + radius);
    for (const station of town.gasStations) {
      const point = (along: number, inward: number) => ({
        x: station.position.x + (station.roadAxis === "northSouth" ? inward * station.roadSide : along),
        z: station.position.z + (station.roadAxis === "northSouth" ? along : inward * station.roadSide),
      });
      const setback = GAME_CONFIG.presentation.gasStation.pumpSetback;
      for (const side of [-1, 1]) for (let along = -40; along <= 40; along += 2) {
        const p = point(along, setback + side * 7);
        expect(blocked(p.x, p.z, GAME_CONFIG.player.radius)).toBe(false);
        expect(query.isInLegalDrivingArea(p.x, p.z)).toBe(true);
      }
      // A forgiving off-center approach across the row must also stay clear.
      for (const along of [-4.5, 0, 4.5]) for (let inward = setback - 16; inward <= setback + 16; inward += 2) {
        const p = point(along, inward);
        expect(blocked(p.x, p.z, GAME_CONFIG.player.radius)).toBe(false);
      }
      for (const pump of station.pumpPositions) {
        expect(blocked(pump.x, pump.z, 0)).toBe(true);
      }
    }
    scene.dispose(); engine.dispose();
  });

  it("shows asphalt above the sidewalk at both gas entrances in every orientation, all within legal driving areas", () => {
    const engine = new NullEngine(), scene = new Scene(engine), town = new TownGenerator(scene).generate();
    const query = new WorldQuery(town.staticColliders, town.roads, GAME_CONFIG.world.roadWidth / 2,
      GAME_CONFIG.world.roadWidth / 2 + GAME_CONFIG.world.sidewalkWidth, 64, town.legalDrivingAreas);
    for (const gas of town.gasStations) for (const end of [-1, 1]) {
      for (const inward of [-20, -12, 0]) {
        const along = end * 30;
        const x = gas.position.x + (gas.roadAxis === "northSouth" ? gas.roadSide * inward : along);
        const z = gas.position.z + (gas.roadAxis === "northSouth" ? along : gas.roadSide * inward);
        const ray = new Ray(new Vector3(x, 2, z), Vector3.Down(), 3);
        const hits = town.meshes.map(mesh => ray.intersectsMesh(mesh)).filter(hit => hit.hit).sort((a, b) => a.distance - b.distance);
        expect(hits[0]?.pickedPoint?.y).toBeCloseTo(WORLD_SURFACES.service);
        expect(hits[0].getNormal(true)!.y).toBeGreaterThan(.99);
        expect(query.isInLegalDrivingArea(x, z)).toBe(true);
        // Paving uses the road color, with no buried blue pad or sidewalk covering it.
        const mesh = hits[0].pickedMesh!, vertex = mesh.getIndices()![hits[0].faceId * 3];
        const colors = mesh.getVerticesData(VertexBuffer.ColorKind)!;
        expect(colors[vertex * 4]).toBeCloseTo(0x34 / 255);
        expect(colors[vertex * 4 + 1]).toBeCloseTo(0x48 / 255);
      }
    }
    scene.dispose(); engine.dispose();
  });
});
