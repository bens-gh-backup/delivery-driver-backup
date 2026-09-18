import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { GAME_CONFIG } from "../game/config";
import { createBlenderHouse } from "../world/BlenderHouse";
import { TrafficCar } from "../traffic/TrafficCar";
import { vehicleLightLayout, TAILLIGHT_COLOR } from "../vehicles/VehicleLightLayout";
import { houseModelForScene, trafficModelForScene, resolveNeighborhoodModel, setSceneGraphicsMode } from "./GraphicsMode";
import houses from "../world/assets/houses.json";
import sedan from "../vehicles/assets/sedan.json";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(fn => fn()));
function fixture() {
  const engine = new NullEngine(), scene = new Scene(engine), material = new StandardMaterial("test",scene);
  cleanups.push(() => { scene.dispose(); engine.dispose(); });
  return {scene,material};
}

describe("neighborhood asset experiment", () => {
  it("defaults to both high-detail models, with independent debug overrides and original-mode fallback", () => {
    for (const key of ["houses","traffic"] as const) {
      expect(resolveNeighborhoodModel(key, "")).toBe("blender6k");
      expect(resolveNeighborhoodModel(key, `?${key}=procedural`)).toBe("blender6k");
      for (const mode of ["procedural","blender3k","blender6k"])
        expect(resolveNeighborhoodModel(key, `?debug&${key}=${mode}`)).toBe(mode);
    }
    const {scene} = fixture(); setSceneGraphicsMode(scene,"original");
    expect(houseModelForScene(scene)).toBe("procedural"); expect(trafficModelForScene(scene)).toBe("procedural");
    setSceneGraphicsMode(scene,"enhanced","blender","all","blender","procedural","blender3k");
    expect(houseModelForScene(scene)).toBe("procedural"); expect(trafficModelForScene(scene)).toBe("blender3k");
  });
  it("keeps complete assets inside each tier, with valid outward normals and no degenerate triangles", () => {
    for (const kit of [houses,sedan]) for (const [name,part] of Object.entries(kit.parts)) {
      const budget = GAME_CONFIG.graphics.neighborhoodTriangleBudgets[name.includes("6k") ? "blender6k" : "blender3k"];
      expect(part.triangles).toBe(part.indices.length/3);
      expect(part.triangles+(kit===sedan?48:0)).toBeLessThanOrEqual(budget);
      expect(part.roles).toHaveLength(part.positions.length/3);
      const p=part.positions,n=part.normals;
      for(let i=0;i<p.length;i+=3) expect(Math.hypot(n[i],n[i+1],n[i+2])).toBeCloseTo(1,4);
      let degenerate=0,wrong=0;
      for(let i=0;i<part.indices.length;i+=3) {
        const [a,b,c]=part.indices.slice(i,i+3).map(v=>v*3);
        const u=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]],v=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]];
        const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
        if(Math.hypot(...cross)<1e-9) degenerate++;
        if(cross[0]*n[a]+cross[1]*n[a+1]+cross[2]*n[a+2]>1e-7) wrong++;
      }
      expect({name,degenerate,wrong}).toEqual({name,degenerate:0,wrong:0});
    }
  });
  it("fits roofs, gutters and steps inside every original lot orientation and preserves normalized lighting", () => {
    const {scene,material} = fixture();
    for(const model of ["blender3k","blender6k"] as const) for(const height of [10,16,23]) for(let facing=0;facing<4;facing++) {
      const lot={x:11,z:29,width:28,depth:36,height,facing,district:"residential" as const,landmark:false};
      const mesh=createBlenderHouse(scene,"test-house",lot,material,model);mesh.computeWorldMatrix(true);
      const bounds=mesh.getBoundingInfo().boundingBox;
      expect(bounds.minimumWorld.x).toBeCloseTo(lot.x-lot.width/2,4);
      expect(bounds.maximumWorld.x).toBeCloseTo(lot.x+lot.width/2,4);
      expect(bounds.minimumWorld.z).toBeCloseTo(lot.z-lot.depth/2,4);
      expect(bounds.maximumWorld.z).toBeCloseTo(lot.z+lot.depth/2,4);
      expect(bounds.maximumWorld.y).toBeCloseTo(height,4);
      const n=mesh.getVerticesData(VertexBuffer.NormalKind)!;
      for(let i=0;i<n.length;i+=3) expect(Math.hypot(n[i],n[i+1],n[i+2])).toBeCloseTo(1,4);
      expect(mesh.material).toBe(material);expect(material.getActiveTextures()).toHaveLength(0);mesh.dispose();
    }
  });
  it("matches all four existing indicator lenses exactly and retains opaque red tail lights", () => {
    for(const part of Object.values(sedan.parts)) for(const front of [false,true]) for(const side of [-1,1]) {
      const lamp=vehicleLightLayout(5.4,9.4,1.5,side,front), role=sedan.roles.indexOf(front?"lamp":"tail");
      const points=[];
      for(let i=0;i<part.roles.length;i++) if(part.roles[i]===role && Math.sign(part.positions[i*3])===side)
        points.push(part.positions.slice(i*3,i*3+3));
      for(const [axis,center,size] of [[0,lamp.x,lamp.width],[1,lamp.y,lamp.height],[2,lamp.z,lamp.depth]]) {
        expect(Math.min(...points.map(p=>p[axis]))).toBeCloseTo(center-size/2,5);
        expect(Math.max(...points.map(p=>p[axis]))).toBeCloseTo(center+size/2,5);
      }
    }
    const {scene,material}=fixture();setSceneGraphicsMode(scene,"enhanced");material.diffuseColor=Color3.Red();
    const mesh=TrafficCar.createPrototype(scene,material,0),clone=mesh.clone("copy")!;
    expect(mesh.geometry).toBe(clone.geometry); expect(clone.material).toBe(material);
    const colors=mesh.getVerticesData(VertexBuffer.ColorKind)!;
    const tail=sedan.roles.indexOf("tail"),part=sedan.parts["sedan-6k"];
    for(let i=0;i<part.roles.length;i++)if(part.roles[i]===tail)
      TAILLIGHT_COLOR.forEach((v,c)=>expect(colors[i*4+c]).toBeCloseTo(v,5));
    expect(scene.materials).toHaveLength(1); expect(scene.textures).toHaveLength(0);
  });
});
