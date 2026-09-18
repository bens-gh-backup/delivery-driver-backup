import { expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { PlayerCar } from "../player/PlayerCar";
import { POLICE_VEHICLE, STARTER_VEHICLE } from "./VehicleCatalog";
import { createSuspectPrototype } from "./BlenderChaseMeshes";
import { GAME_CONFIG } from "../game/config";
import { WorldQuery } from "../world/WorldQuery";
import type { Input } from "../player/Input";
it("keeps both opaque models within budget and releases every police swap",()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try {
    const car=new PlayerCar(scene,[{ix:0,iz:0,position:Vector3.Zero()}]),counts=()=>[scene.meshes.length,scene.materials.length,scene.geometries.length],baseline=counts();
    for(let i=0;i<5;i++) {
      car.equipVehicle(POLICE_VEHICLE,POLICE_VEHICLE.stats);
      const meshes=car.root.getChildMeshes();expect(meshes).toHaveLength(3);
      expect(meshes.reduce((n,m)=>n+m.getTotalIndices()/3,0)).toBeLessThanOrEqual(GAME_CONFIG.policeChase.policeTriangleBudget);
      for(const m of meshes){expect(m.material!.getActiveTextures()).toHaveLength(0);expect(m.subMeshes).toHaveLength(1);}
      car.equipVehicle(STARTER_VEHICLE,STARTER_VEHICLE.stats);expect(counts()).toEqual(baseline);
    }
    const suspect=createSuspectPrototype(scene,new StandardMaterial("test",scene)),meshes=[suspect,...suspect.getChildMeshes()];
    expect(meshes).toHaveLength(2);expect(meshes.reduce((n,m)=>n+m.getTotalIndices()/3,0)).toBeLessThanOrEqual(GAME_CONFIG.policeChase.suspectTriangleBudget);
    for(const mesh of meshes){
      const p=mesh.getVerticesData(VertexBuffer.PositionKind)!,n=mesh.getVerticesData(VertexBuffer.NormalKind)!,indices=mesh.getIndices()!;
      for(let i=0;i<indices.length;i+=3){const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
        expect(Vector3.Dot(Vector3.Cross(new Vector3(p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]),
          new Vector3(p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2])),new Vector3(n[a],n[a+1],n[a+2]))).toBeLessThan(0);}
    }
  } finally {scene.dispose();engine.dispose();}
});
it("retains identical police handling at 0% and 99% damage",()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try {
    const clean=new PlayerCar(scene,[{ix:0,iz:0,position:Vector3.Zero()}],POLICE_VEHICLE),damaged=new PlayerCar(scene,[{ix:0,iz:0,position:Vector3.Zero()}],POLICE_VEHICLE);
    const world=new WorldQuery([],[],32.5,35.5,64),input={consumeReset:()=>false,updateDriving:()=>{},throttle:1,brake:0,steering:.15} as unknown as Input;
    for(let i=0;i<600;i++){clean.update(1/60,input,world,true,0);damaged.update(1/60,input,world,true,.99);}
    expect(damaged.root.position.asArray()).toEqual(clean.root.position.asArray());expect(damaged.getSpeedMph()).toBe(clean.getSpeedMph());
  } finally {scene.dispose();engine.dispose();}
});
