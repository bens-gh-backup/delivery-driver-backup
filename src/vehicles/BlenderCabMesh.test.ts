import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { GAME_CONFIG } from "../game/config";
import { resolvePlayerCabModel, setSceneGraphicsMode, type PlayerCabModel } from "../graphics/GraphicsMode";
import { PlayerCar } from "../player/PlayerCar";
import type { Input } from "../player/Input";
import type { WorldQuery } from "../world/WorldQuery";
import { WORLD_SURFACES } from "../world/SurfaceLayout";
import { AMBULANCE_VEHICLE, ELITE_VEHICLE, STARTER_VEHICLE } from "./VehicleCatalog";
import { createBlenderCabMesh } from "./BlenderCabMesh";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
function fixture(model: PlayerCabModel = "blender") {
  const engine = new NullEngine(), scene = new Scene(engine);
  setSceneGraphicsMode(scene, "enhanced", model);
  cleanup.push(() => { scene.dispose(); engine.dispose(); });
  return { scene, car: new PlayerCar(scene, [{ position: Vector3.Zero(), ix: 0, iz: 0 }]) };
}

describe("Blender cab integration", () => {
  it("keeps the comparison switch out of ordinary player settings", () => {
    expect(resolvePlayerCabModel("?cab=procedural")).toBe("blender");
    expect(resolvePlayerCabModel("?debug&cab=procedural")).toBe("procedural");
    expect(resolvePlayerCabModel("?debug&cab=blender")).toBe("blender");
    expect(resolvePlayerCabModel("?debug&cab=missing")).toBe("blender");
  });

  it("fits the existing footprint, grounds the tires and stays within one draw and the triangle budget", () => {
    const { car } = fixture();
    const [mesh] = car.root.getChildMeshes();
    expect(car.root.getChildMeshes()).toHaveLength(1);
    expect(mesh.metadata.vehicleModel).toBe("blender-cab");
    expect(mesh.getTotalIndices() / 3).toBe(1496);
    expect(mesh.getTotalIndices() / 3).toBeLessThanOrEqual(GAME_CONFIG.graphics.playerTriangleBudget);
    expect(mesh.subMeshes).toHaveLength(1);
    expect(mesh.material?.getActiveTextures()).toHaveLength(0);
    expect(mesh.hasVertexAlpha).toBe(false);
    const box = mesh.getBoundingInfo().boundingBox;
    expect(box.maximum.x - box.minimum.x).toBeCloseTo(car.vehicleWidth, 5);
    expect(box.maximum.z - box.minimum.z).toBeCloseTo(car.vehicleLength, 5);
    expect(box.minimum.y + car.root.position.y).toBeGreaterThan(WORLD_SURFACES.road);
    expect(box.minimum.y + car.root.position.y).toBeLessThan(WORLD_SURFACES.road + .03);
    const p = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const n = mesh.getVerticesData(VertexBuffer.NormalKind)!;
    const colors = mesh.getVerticesData(VertexBuffer.ColorKind)!;
    const indices = mesh.getIndices()!;
    expect(p.every(Number.isFinite)).toBe(true);
    expect(colors).toHaveLength(mesh.getTotalVertices() * 4);
    for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 5);
    // Left-handed winding must agree with the authored outward normals.
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
      const ab = new Vector3(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
      const ac = new Vector3(p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]);
      expect(Vector3.Dot(Vector3.Cross(ab, ac), new Vector3(n[a], n[a + 1], n[a + 2]))).toBeLessThan(0);
    }
  });

  it("uses the existing procedural model for the A/B baseline and original graphics", () => {
    const { car, scene } = fixture("procedural");
    expect(car.root.getChildMeshes()[0].getTotalIndices() / 3).toBe(748);
    setSceneGraphicsMode(scene, "original", "blender");
    car.equipVehicle(STARTER_VEHICLE, STARTER_VEHICLE.stats);
    expect(car.root.getChildMeshes()[0].metadata?.vehicleModel).not.toBe("blender-cab");
  });

  it("leaves ambulance lights, purchased vehicles, and equip/reset disposal intact", () => {
    const { car, scene } = fixture();
    const count = { meshes: scene.meshes.length, materials: scene.materials.length, geometries: scene.geometries.length };
    for (let i = 0; i < 5; i++) {
      car.equipVehicle(AMBULANCE_VEHICLE, AMBULANCE_VEHICLE.stats);
      expect(car.root.getChildMeshes()).toHaveLength(3);
      expect(car.isAmbulance).toBe(true);
      car.equipVehicle(ELITE_VEHICLE, ELITE_VEHICLE.stats);
      expect(car.root.getChildMeshes()[0].metadata?.vehicleModel).not.toBe("blender-cab");
      car.equipVehicle(STARTER_VEHICLE, STARTER_VEHICLE.stats);
      car.reset();
      expect(car.root.getChildMeshes()[0].metadata.vehicleModel).toBe("blender-cab");
      expect({ meshes: scene.meshes.length, materials: scene.materials.length, geometries: scene.geometries.length }).toEqual(count);
    }
  });

  it("produces identical acceleration, steering, collision response and reset behavior", () => {
    const a = fixture("procedural").car, b = fixture("blender").car;
    const world = { isOnSidewalk: () => false, getNearbyColliders: () => {} } as unknown as WorldQuery;
    for (let frame = 0; frame < 240; frame++) {
      const input = { throttle: frame < 180 ? 1 : 0, brake: frame >= 180 ? 1 : 0,
        steering: frame > 60 && frame < 120 ? .4 : 0, consumeReset: () => false, updateDriving: () => {} } as unknown as Input;
      for (const car of [a, b]) {
        if (frame === 150) {
          Object.assign(car.collisionBody, { velocityX: 12, velocityZ: 18, angularVelocity: .8, changed: true, impulse: 25 });
          car.applyCollisionBody();
        }
        car.update(1 / 60, input, world);
      }
      expect(b.root.position).toEqual(a.root.position);
      expect(b.heading).toBe(a.heading);
      expect(b.getSpeedMph()).toBe(a.getSpeedMph());
      expect(b.collisionBody).toEqual(a.collisionBody);
    }
  });

  it("creates independent meshes without modifying the imported geometry on repeated equips", () => {
    const { scene } = fixture();
    const material = new StandardMaterial("test", scene);
    const a = createBlenderCabMesh(scene, "a", material, STARTER_VEHICLE.appearance);
    createBlenderCabMesh(scene, "small", material, { bodyWidth: 2, bodyLength: 4 });
    const b = createBlenderCabMesh(scene, "b", material, STARTER_VEHICLE.appearance);
    expect(b.getVerticesData(VertexBuffer.PositionKind)).toEqual(a.getVerticesData(VertexBuffer.PositionKind));
  });
});
