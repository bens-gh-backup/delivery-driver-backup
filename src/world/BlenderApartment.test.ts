import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import { resolveApartmentModel, apartmentModelForScene, setSceneGraphicsMode } from "../graphics/GraphicsMode";
import { createBlenderApartment, selectApartmentLots, APARTMENT_COLOR_NAMES } from "./BlenderApartment";
import type { BuildingLot } from "./CityStyle";
import { TownGenerator } from "./Town";
import { GAME_CONFIG } from "../game/config";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
function fixture() {
  const engine = new NullEngine(), scene = new Scene(engine);
  cleanup.push(() => { scene.dispose(); engine.dispose(); });
  return { scene, material: new StandardMaterial("city", scene) };
}
function lot(facing = 0, height = 38.5): BuildingLot {
  return { x: 0, z: 0, width: 40, depth: 44, height, facing, district: "downtown", landmark: false,
    frontage: { id: "building-2-2-2-0-0", blockId: "block-2-2", streetSides: [0], coveredHeights: [0,0,0,0],
      sideClearances: [Infinity,.5,Infinity,.5], colorSeed: 0 } };
}

describe("Blender apartment integration", () => {
  it("requires debug mode for comparisons and leaves original graphics procedural", () => {
    expect(resolveApartmentModel("?apartments=pilot")).toBe("all");
    for (const mode of ["procedural", "pilot", "all"] as const)
      expect(resolveApartmentModel(`?debug&apartments=${mode}`)).toBe(mode);
    expect(resolveApartmentModel("?debug&apartments=unknown")).toBe("all");
    const { scene } = fixture();
    setSceneGraphicsMode(scene, "original", "blender", "all");
    expect(apartmentModelForScene(scene)).toBe("procedural");
  });

  it("fits all orientations/heights with valid opaque geometry and clearance for the smallest alley", () => {
    const { scene, material } = fixture();
    for (let facing = 0; facing < 4; facing++) for (const height of [32,38.5,45,51.5,58]) {
      const l = lot(facing, height), mesh = createBlenderApartment(scene, "apartment", l, material, facing);
      const p = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      const n = mesh.getVerticesData(VertexBuffer.NormalKind)!;
      const colors = mesh.getVerticesData(VertexBuffer.ColorKind)!;
      const indices = mesh.getIndices()!;
      expect(mesh.getTotalIndices()/3).toBeLessThanOrEqual(1600);
      expect(mesh.subMeshes).toHaveLength(1);
      expect(mesh.material).toBe(material);
      expect(mesh.hasVertexAlpha).toBe(false);
      expect(material.getActiveTextures()).toHaveLength(0);
      expect(p.every(Number.isFinite)).toBe(true);
      expect(colors).toHaveLength(p.length/3*4);
      expect(colors.every(v => v >= 0 && v <= 1)).toBe(true);
      const halfWidth = (facing % 2 === 0 ? l.width : l.depth) / 2;
      for (let i = 0; i < p.length; i += 3) {
        expect(Math.abs(p[i])).toBeLessThanOrEqual(halfWidth + .5/4 + .00001);
        expect(p[i+1]).toBeGreaterThanOrEqual(0);
        expect(p[i+1]).toBeLessThanOrEqual(height + .00001);
        expect(Math.hypot(n[i],n[i+1],n[i+2])).toBeCloseTo(1,5);
      }
      for (let i = 0; i < indices.length; i += 3) {
        const a = Vector3.FromArray(p,indices[i]*3), b = Vector3.FromArray(p,indices[i+1]*3), c = Vector3.FromArray(p,indices[i+2]*3);
        expect(Vector3.Cross(b.subtract(a),c.subtract(a)).lengthSquared()).toBeGreaterThan(1e-10);
      }
      expect(scene.meshes).toHaveLength(1); mesh.dispose();
    }
  });

  it("recolors the same geometry without allocating extra materials or textures", () => {
    const { scene, material } = fixture();
    const meshes = APARTMENT_COLOR_NAMES.map((_,i) => createBlenderApartment(scene, `variant-${i}`, lot(), material, i));
    for (const m of meshes.slice(1)) {
      expect(m.getVerticesData(VertexBuffer.PositionKind)).toEqual(meshes[0].getVerticesData(VertexBuffer.PositionKind));
      expect(m.getVerticesData(VertexBuffer.NormalKind)).toEqual(meshes[0].getVerticesData(VertexBuffer.NormalKind));
      expect(m.getIndices()).toEqual(meshes[0].getIndices());
      expect(m.getVerticesData(VertexBuffer.ColorKind)).not.toEqual(meshes[0].getVerticesData(VertexBuffer.ColorKind));
    }
    expect(scene.materials).toHaveLength(1); expect(scene.textures).toHaveLength(0);
  });

  it("has actual window recesses and outward-facing roof/sill surfaces, without backing walls over glass", () => {
    const { scene, material } = fixture();
    const mesh = createBlenderApartment(scene, "apartment", lot(), material, 0);
    mesh.computeWorldMatrix(true);
    // Outer bay center -15; front is z=-22. The wall is missing inside the opening.
    const window = new Ray(new Vector3(-15, 7.5, -40), new Vector3(0,0,1)).intersectsMesh(mesh);
    const wall = new Ray(new Vector3(-19, 7.5, -40), new Vector3(0,0,1)).intersectsMesh(mesh);
    expect(window.hit).toBe(true); expect(wall.hit).toBe(true);
    expect(window.pickedPoint!.z - wall.pickedPoint!.z).toBeCloseTo(.38,4);
    expect(window.getNormal(true)!.z).toBeLessThan(-.99);
    const roof = new Ray(new Vector3(0,70,0), new Vector3(0,-1,0)).intersectsMesh(mesh);
    expect(roof.hit).toBe(true); expect(roof.getNormal(true)!.y).toBeGreaterThan(.99);
    const sill = new Ray(new Vector3(-15,7,-22.25), new Vector3(0,-1,0)).intersectsMesh(mesh);
    expect(sill.hit).toBe(true); expect(sill.getNormal(true)!.y).toBeGreaterThan(.9);
  });

  it("upgrades all ordinary downtown apartments while retaining a four-building comparison and the same layout/batches", () => {
    const a = fixture(), b = fixture();
    // Isolate apartment geometry and retain its original city-wide budget check.
    setSceneGraphicsMode(a.scene, "enhanced", "blender", "procedural", "blender", "procedural");
    setSceneGraphicsMode(b.scene, "enhanced", "blender", "all", "blender", "procedural");
    const oldTown = new TownGenerator(a.scene).generate(), town = new TownGenerator(b.scene).generate();
    for (const key of ["buildings","staticColliders","gasStations","autoBodyShops","clinics","dealerships","deliveryPoints","residentialTrees"] as const)
      expect(town[key]).toEqual(oldTown[key]);
    expect(town.meshes.length).toBe(oldTown.meshes.length);
    expect(b.scene.materials.length).toBe(a.scene.materials.length);
    expect(b.scene.textures.length).toBe(a.scene.textures.length);
    expect(town.meshes.reduce((sum,m) => sum + m.getTotalIndices()/3,0)).toBeLessThanOrEqual(GAME_CONFIG.graphics.worldTriangleBudget);
    const pilot = selectApartmentLots(town.buildings,"pilot");
    expect(pilot.size).toBe(4); expect(new Set(pilot.values()).size).toBe(4);
    expect(selectApartmentLots(town.buildings,"procedural").size).toBe(0);
    const all = selectApartmentLots(town.buildings,"all");
    expect(all.size).toBe(town.buildings.filter(l => l.district === "downtown" && !l.landmark).length);
    expect(all.size).toBeGreaterThan(200);
    for (const building of town.buildings.filter(l => all.has(l.frontage!.id))) {
      expect(building.landmark).toBe(false); expect(building.district).toBe("downtown");
      expect(building.frontage!.streetSides).toContain(0);
    }
    expect(selectApartmentLots(town.buildings,"pilot")).toEqual(pilot);
  });

  it("wraps corners with recessed windows on both streets, leaving alley walls closed", () => {
    const { scene, material } = fixture();
    for (const side of [1,3]) {
      const l = lot(0,58); l.frontage!.streetSides = [0,side];
      l.frontage!.sideClearances![side] = Infinity;
      const mesh = createBlenderApartment(scene, "corner", l, material, side);
      mesh.computeWorldMatrix(true);
      const direction = side === 1 ? -1 : 1, sign = -direction;
      // Second-face bay centers are ±16.5 and ±5.5 for a 44-unit-deep corner.
      const glass = new Ray(new Vector3(sign*40,7.5,sign*5.5),new Vector3(direction,0,0)).intersectsMesh(mesh);
      const pier = new Ray(new Vector3(sign*40,7.5,0),new Vector3(direction,0,0)).intersectsMesh(mesh);
      expect(glass.hit).toBe(true);expect(pier.hit).toBe(true);
      expect((pier.pickedPoint!.x-glass.pickedPoint!.x)*sign).toBeCloseTo(.38,4);
      expect(glass.getNormal(true)!.x*sign).toBeGreaterThan(.99);
      expect(mesh.getTotalIndices()/3).toBeLessThanOrEqual(GAME_CONFIG.graphics.buildingTriangleBudget);
      mesh.dispose();
    }
  });
});
