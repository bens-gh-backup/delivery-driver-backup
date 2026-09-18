import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { GAME_CONFIG } from "../game/config";
import { createLowPolyVehicleMesh } from "../vehicles/VehicleMeshFactory";
import { VEHICLE_CATALOG } from "../vehicles/VehicleCatalog";
import { TrafficCar } from "../traffic/TrafficCar";
import { PlayerCar } from "../player/PlayerCar";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createNoirBuilding, facadeColumnCount } from "../world/BuildingVisuals";
import { CITY_STYLE, districtForBlock } from "../world/CityStyle";
import { TownGenerator } from "../world/Town";
import { resolveGraphicsMode, setSceneGraphicsMode, trafficModelForScene, worldTriangleBudgetForScene } from "./GraphicsMode";
import { beveledRing, createLoftMesh } from "./FacetedMesh";

const cleanup: (() => void)[]=[];
afterEach(()=>cleanup.splice(0).forEach(fn=>fn()));
function fixture(mode: "original" | "enhanced" = "enhanced") {
  const engine=new NullEngine(),scene=new Scene(engine);
  setSceneGraphicsMode(scene,mode);
  cleanup.push(()=>{scene.dispose();engine.dispose();});
  return {scene,material:new StandardMaterial("test",scene)};
}
function validate(mesh: Mesh) {
  const positions=mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const normals=mesh.getVerticesData(VertexBuffer.NormalKind)!;
  const indices=mesh.getIndices()!;
  expect(positions.every(Number.isFinite)).toBe(true);
  expect(normals).toHaveLength(positions.length);
  expect([...indices].every(i=>i>=0 && i<positions.length/3)).toBe(true);
  for(let i=0;i<normals.length;i+=3) expect(Math.hypot(normals[i],normals[i+1],normals[i+2])).toBeCloseTo(1,4);
}

describe("enhanced graphics",()=>{
  it("allows the original renderer only through an explicit debug comparison",()=>{
    expect(resolveGraphicsMode("?graphics=original")).toBe("enhanced");
    expect(resolveGraphicsMode("?debug&graphics=original")).toBe("original");
    expect(resolveGraphicsMode("?debug&graphics=enhanced")).toBe("enhanced");
  });
  it("builds outward-facing convex bevels",()=>{
    const {scene}=fixture();
    const mesh=createLoftMesh(scene,"bevel",[beveledRing(4,8,-1,0.3),beveledRing(3.8,7.8,1,0.3)]);
    validate(mesh);
    const p=mesh.getVerticesData(VertexBuffer.PositionKind)!,n=mesh.getVerticesData(VertexBuffer.NormalKind)!;
    for(let i=0;i<p.length;i+=3) expect(p[i]*n[i]+p[i+1]*n[i+1]+p[i+2]*n[i+2]).toBeGreaterThan(0);
  });
  it("keeps all catalog vehicles within one mesh and the triangle budget",()=>{
    const {scene,material}=fixture();
    for(const vehicle of VEHICLE_CATALOG) {
      const {bodyColor,...appearance}=vehicle.appearance;
      const mesh=createLowPolyVehicleMesh(scene,vehicle.id,material,{...appearance,bodyColor:Color3.FromHexString(bodyColor)});
      validate(mesh);
      expect(mesh.getTotalIndices()/3).toBeLessThanOrEqual(GAME_CONFIG.graphics.playerTriangleBudget);
      expect(scene.meshes).toHaveLength(1);
      mesh.dispose();
    }
  });
  it("keeps civilian and police prototypes below their budget and shares geometry with clones",()=>{
    const {scene,material}=fixture();
    const civilian=TrafficCar.createPrototype(scene,material,0),police=TrafficCar.createPolicePrototype(scene,material);
    for(const mesh of [civilian,police]) {
      validate(mesh);
      const model = trafficModelForScene(scene);
      const budget = mesh === civilian && model !== "procedural"
        ? GAME_CONFIG.graphics.neighborhoodTriangleBudgets[model] : GAME_CONFIG.graphics.trafficTriangleBudget;
      expect(mesh.getTotalIndices()/3).toBeLessThanOrEqual(budget);
      const clone=mesh.clone("clone")!;
      expect(clone.geometry).toBe(mesh.geometry);clone.dispose();
    }
    expect(scene.meshes).toHaveLength(2);
  });
  it("disposes old geometry and materials when switching player vehicles",()=>{
    const {scene}=fixture();
    const player=new PlayerCar(scene,[{position:Vector3.Zero(),ix:0,iz:0}]);
    const meshes=scene.meshes.length, materials=scene.materials.length;
    for(const vehicle of VEHICLE_CATALOG) {
      player.equipVehicle(vehicle,vehicle.stats);
      expect(scene.meshes.length).toBe(meshes);
      expect(scene.materials.length).toBe(materials);
    }
  });
  it("builds valid colored architecture within budget, including landmarks and all orientations",()=>{
    const {scene,material}=fixture(),neon=new StandardMaterial("neon",scene),styles=new Set();
    for(const district of ["residential","downtown"] as const) for(let i=0;i<24;i++) {
      const meshes=createNoirBuilding(scene,`building-${i}`,10,20,22,30,i===0?82:12+i*2,
        material,neon,district,i===0,i%4);
      styles.add(meshes[0].metadata.buildingStyle);
      expect(meshes.reduce((sum,m)=>sum+m.getTotalIndices()/3,0)).toBeLessThanOrEqual(GAME_CONFIG.graphics.buildingTriangleBudget);
      for(const mesh of meshes) {
        validate(mesh);
        const colors=mesh.getVerticesData(VertexBuffer.ColorKind)!;
        expect(colors.length).toBe(mesh.getTotalVertices()*4);
        expect(colors.every(v=>Number.isFinite(v)&&v>=0&&v<=1)).toBe(true);
        expect(mesh.material?.getActiveTextures()).toHaveLength(0);
        mesh.dispose();
      }
    }
    expect([...styles].sort()).toEqual(["commercial","pitched","stepped"]);
    expect(scene.meshes).toHaveLength(0);
  });
  it("uses bounded facade bays and reserves detailed storefronts for street-facing walls",()=>{
    expect(facadeColumnCount(14)).toBe(2);
    expect(facadeColumnCount(28)).toBe(4);
    expect(facadeColumnCount(1000)).toBe(CITY_STYLE.maximumWindowColumns);
    const {scene,material}=fixture();
    for (let facing=0;facing<4;facing++) for (const side of [1,3]) {
      const corner=createNoirBuilding(scene,"corner-3",0,0,50,50,65,material,material,"downtown",false,facing,side);
      const courtyard=createNoirBuilding(scene,"corner-3",0,0,50,50,65,material,material,"downtown",false,facing,null,false);
      expect(corner[0].metadata.streetSides).toEqual([0,side]);
      expect(courtyard[0].metadata.streetSides).toEqual([]);
      expect(corner.reduce((sum,m)=>sum+m.getTotalIndices()/3,0)).toBeLessThanOrEqual(GAME_CONFIG.graphics.buildingTriangleBudget);
      expect(courtyard[0].getTotalIndices()).toBeLessThan(corner[0].getTotalIndices());
      for (const mesh of [...corner,...courtyard]) { validate(mesh); mesh.dispose(); }
    }
  });

  it("assigns a central downtown and neighboring park blocks with distinct height ranges",()=>{
    const counts={downtown:0,residential:0,park:0};
    for(let x=0;x<7;x++) for(let z=0;z<7;z++) counts[districtForBlock(x,z,7,7)]++;
    expect(counts).toEqual({downtown:9,park:4,residential:36});
    expect(CITY_STYLE.districts.downtown.minHeight).toBeGreaterThan(CITY_STYLE.districts.residential.maxHeight);
  });
  it("removes covered party-wall faces while retaining exposed upper walls",()=>{
    const {scene,material}=fixture();
    const [mesh]=createNoirBuilding(scene,"frontage-check",0,0,40,44,50,material,material,"downtown",false,0,null,true,{
      id:"frontage-check",blockId:"block-3-3",streetSides:[0],coveredHeights:[0,40,0,60],colorSeed:0,
    });
    validate(mesh);
    const positions=mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const normals=mesh.getVerticesData(VertexBuffer.NormalKind)!;
    let upperWallVertices=0;
    for(let i=0;i<positions.length;i+=3){
      // Local right neighbor ends at 40; the left neighbor hides the entire wall.
      if(normals[i]>.99 && positions[i]>=20){
        expect(positions[i+1]).toBeGreaterThanOrEqual(40);
        upperWallVertices++;
      }
      expect(normals[i]<-.99 && positions[i]<=-20).toBe(false);
    }
    expect(upperWallVertices).toBeGreaterThan(0);
  });
  it("keeps full alley walls and roof trim inside even the smallest downtown gaps",()=>{
    const {scene,material}=fixture();
    const [mesh]=createNoirBuilding(scene,"narrow-gap",0,0,40,44,50,material,material,"downtown",false,0,null,true,{
      id:"narrow-gap",blockId:"block-3-3",streetSides:[0],coveredHeights:[0,0,0,0],colorSeed:0,
      sideClearances:[Infinity,.5,Infinity,.5],neighborHeights:[0,60,0,60],
    });
    validate(mesh);
    const p=mesh.getVerticesData(VertexBuffer.PositionKind)!,n=mesh.getVerticesData(VertexBuffer.NormalKind)!;
    let lowSideVertices=0;
    for(let i=0;i<p.length;i+=3){
      expect(Math.abs(p[i])).toBeLessThanOrEqual(20+.5/4+.00001);
      if(Math.abs(n[i])>.99&&p[i+1]<1)lowSideVertices++;
    }
    expect(lowSideVertices).toBeGreaterThan(0);
  });
  it("preserves layout, collision, services and static batching across render modes",()=>{
    const original=fixture("original"),enhanced=fixture("enhanced");
    const a=new TownGenerator(original.scene).generate(),b=new TownGenerator(enhanced.scene).generate();
    expect(b.staticColliders).toEqual(a.staticColliders);
    expect(b.buildings).toEqual(a.buildings);
    expect(b.buildings.filter(lot=>lot.landmark)).toHaveLength(2);
    for (const lot of b.buildings) {
      expect(b.staticColliders).toContainEqual({x:lot.x,z:lot.z,halfX:lot.width/2,halfZ:lot.depth/2});
      expect(lot.district).not.toBe("park");
    }
    expect(b.gasStations).toEqual(a.gasStations);
    expect(b.autoBodyShops).toEqual(a.autoBodyShops);
    expect(b.dealerships).toEqual(a.dealerships);
    expect(b.deliveryPoints).toEqual(a.deliveryPoints);
    expect(b.legalDrivingAreas).toEqual(a.legalDrivingAreas);
    expect(b.meshes.filter(m => !m.isAnInstance).length).toBeLessThan(450);
    expect(b.districts).toEqual(a.districts);
    expect(enhanced.scene.meshes.filter(m => !m.metadata?.housePrototype).length).toBe(b.meshes.length);
    // Three shared sign materials, one display-car material and one dealership facade.
    expect(enhanced.scene.materials.length).toBeLessThanOrEqual(25);
    expect(enhanced.scene.textures.map(t=>t.name)).toEqual(["fence-board-pattern"]);
    expect(enhanced.scene.textures[0].getSize()).toEqual({width:16,height:64});
    expect(b.meshes.reduce((sum,m)=>sum+m.getTotalIndices()/3,0)).toBeLessThan(worldTriangleBudgetForScene(enhanced.scene));
  });
});
