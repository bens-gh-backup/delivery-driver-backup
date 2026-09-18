import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PlayerCar } from "../player/PlayerCar";
import { AMBULANCE_VEHICLE, STARTER_VEHICLE } from "./VehicleCatalog";
import { GAME_CONFIG } from "../game/config";
import { WORLD_SURFACES } from "../world/SurfaceLayout";
import { setSceneGraphicsMode } from "../graphics/GraphicsMode";

it("grounds the ambulance within its collider and budget, with correctly wound opaque surfaces", () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  try {
    setSceneGraphicsMode(scene,"enhanced");
    const car=new PlayerCar(scene,[{position:Vector3.Zero(),ix:0,iz:0}],AMBULANCE_VEHICLE);
    const meshes=car.root.getChildMeshes(),box=meshes[0].getBoundingInfo().boundingBox;
    expect(meshes).toHaveLength(3);expect(meshes[0].metadata.vehicleModel).toBe("blender-ambulance");
    expect(meshes.reduce((n,m)=>n+m.getTotalIndices()/3,0)).toBe(1428);
    expect(meshes.reduce((n,m)=>n+m.getTotalIndices()/3,0)).toBeLessThanOrEqual(GAME_CONFIG.ambulanceDriver.vehicleTriangleBudget);
    expect(box.maximum.x-box.minimum.x).toBeCloseTo(car.vehicleWidth,5);
    expect(box.maximum.z-box.minimum.z).toBeCloseTo(car.vehicleLength,5);
    expect(box.minimum.y+car.root.position.y).toBeGreaterThan(WORLD_SURFACES.road);
    for(const mesh of meshes) {
      expect(mesh.subMeshes).toHaveLength(1);expect(mesh.material!.getActiveTextures()).toHaveLength(0);
      const p=mesh.getVerticesData(VertexBuffer.PositionKind)!,n=mesh.getVerticesData(VertexBuffer.NormalKind)!,indices=mesh.getIndices()!;
      expect(p.every(Number.isFinite)).toBe(true);
      for(let i=0;i<n.length;i+=3)expect(Math.hypot(n[i],n[i+1],n[i+2])).toBeCloseTo(1,5);
      for(let i=0;i<indices.length;i+=3) {
        const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
        const ab=new Vector3(p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]),ac=new Vector3(p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]);
        expect(Vector3.Dot(Vector3.Cross(ab,ac),new Vector3(n[a],n[a+1],n[a+2]))).toBeLessThan(0);
      }
    }
  } finally {scene.dispose();engine.dispose();}
});

describe("ambulance lifecycle", () => {
  it("alternates emission while keeping both lenses visible and releases resources on every swap", () => {
    const engine=new NullEngine(),scene=new Scene(engine);
    try {
      const car=new PlayerCar(scene,[{position:Vector3.Zero(),ix:0,iz:0}]);
      const counts=()=>[scene.meshes.length,scene.materials.length,scene.geometries.length],baseline=counts();
      for(let repeat=0;repeat<10;repeat++) {
        car.equipVehicle(AMBULANCE_VEHICLE,AMBULANCE_VEHICLE.stats);
        const lenses=car.root.getChildMeshes().slice(1),materials=lenses.map(m=>m.material as StandardMaterial);
        expect(materials[0].emissiveColor.r).toBe(1);expect(materials[1].emissiveColor.b).toBe(0);
        (car as unknown as {updateEmergencyLights:(dt:number)=>void}).updateEmergencyLights(GAME_CONFIG.ambulanceDriver.lightFlashSeconds);
        expect(materials[0].emissiveColor.r).toBe(0);expect(materials[1].emissiveColor.b).toBe(1);
        expect(lenses.every(m=>m.isEnabled())).toBe(true);
        car.equipVehicle(STARTER_VEHICLE,STARTER_VEHICLE.stats);expect(counts()).toEqual(baseline);
      }
    } finally {scene.dispose();engine.dispose();}
  });
});
