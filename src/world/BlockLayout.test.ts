import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { STARTER_VEHICLE } from "../vehicles/VehicleCatalog";
import type { BoxCollider } from "../game/types";
import { planBlock, subtractAreas, footprint } from "./BlockLayout";
import { TownGenerator, type Town } from "./Town";
import { WORLD_SURFACES } from "./SurfaceLayout";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { worldTriangleBudgetForScene } from "../graphics/GraphicsMode";

const overlaps=(a:BoxCollider,b:BoxCollider)=>Math.abs(a.x-b.x)<a.halfX+b.halfX-.001
  && Math.abs(a.z-b.z)<a.halfZ+b.halfZ-.001;

describe("street frontage layout",()=>{
  let engine:NullEngine,scene:Scene,town:Town;
  beforeAll(()=>{engine=new NullEngine();scene=new Scene(engine);town=new TownGenerator(scene).generate();});
  afterAll(()=>{scene.dispose();engine.dispose();});

  it("subtracts overlapping reservations without overlapping ground tiles or losing unreserved area",()=>{
    const area={x:0,z:0,halfX:10,halfZ:10};
    const cuts=[{x:0,z:0,halfX:3,halfZ:3},{x:3,z:0,halfX:3,halfZ:3}];
    const pieces=subtractAreas(area,cuts);
    expect(pieces.reduce((sum,p)=>sum+4*p.halfX*p.halfZ,0)).toBeCloseTo(400-54);
    for(const a of pieces){
      expect(cuts.some(b=>overlaps(a,b))).toBe(false);
      expect(pieces.some(b=>a!==b&&overlaps(a,b))).toBe(false);
    }
  });

  it("plans deterministic, non-overlapping corners, yards, frontage and service clearances",()=>{
    const reservations=[{x:0,z:-150,halfX:51,halfZ:50},{x:160,z:170,halfX:30,halfZ:30}];
    for(const district of ["downtown","residential"] as const){
      const plan=planBlock(3,3,0,0,district,reservations);
      expect(plan).toEqual(planBlock(3,3,0,0,district,reservations));
      const setback=district==="downtown"?GAME_CONFIG.world.buildings.downtownSetback:GAME_CONFIG.world.buildings.residentialSetback;
      for(const b of plan.buildings){
        const ns=b.facing%2===0,sign=b.facing<2?-1:1;
        expect(sign*(ns?b.z+b.depth/2*sign:b.x+b.width/2*sign)).toBeCloseTo(GAME_CONFIG.world.blockSize/2-setback);
        expect(plan.buildings.some(c=>c!==b&&overlaps(footprint(b),footprint(c)))).toBe(false);
        expect(reservations.some(c=>overlaps(footprint(b),c))).toBe(false);
      }
      for(const fence of plan.fences){
        expect(reservations.some(c=>overlaps(fence,c))).toBe(false);
        expect(Math.max(fence.halfX,fence.halfZ)).toBeLessThanOrEqual(GAME_CONFIG.world.spatialCellSize);
      }
      for(const p of plan.ground){
        expect(plan.ground.some(q=>p!==q&&overlaps(p.area,q.area))).toBe(false);
        expect(reservations.some(c=>overlaps(p.area,c))).toBe(false);
      }
      if(district==="downtown")expect(plan.buildings.some(b=>b.frontage!.sideClearances!.some(Number.isFinite))).toBe(true);
      else expect(plan.buildings.some(b=>b.frontage!.yard)).toBe(true);
    }
  });

  it("keeps all service areas open and world geometry within the combined art ceiling",()=>{
    expect(town.buildings.length).toBeLessThanOrEqual(912);
    expect(town.meshes.reduce((sum,m)=>sum+m.getTotalIndices()/3,0)).toBeLessThanOrEqual(worldTriangleBudgetForScene(scene));
    // At most one fence batch per occupied block-sized rendering cell.
    expect(town.meshes.filter(m=>m.material?.name==="fence-mat").length).toBeLessThanOrEqual(36);
    expect(town.meshes.filter(m => !m.isAnInstance).length).toBeLessThanOrEqual(450);
    expect(town.buildings.filter(b=>b.landmark)).toHaveLength(2);
    for(const area of town.legalDrivingAreas){
      expect(town.buildings.some(b=>overlaps(area,footprint(b)))).toBe(false);
      expect(town.fenceFootprints.some(f=>overlaps(area,f))).toBe(false);
    }
    const yard=town.buildings.find(b=>b.frontage?.yard)!.frontage!.yard!;
    const ray=new Ray(new Vector3(yard.x,1,yard.z),Vector3.Down(),2);
    const hits=town.meshes.map(m=>ray.intersectsMesh(m)).filter(h=>h.hit).sort((a,b)=>a.distance-b.distance);
    expect(hits[0].pickedPoint!.y).toBeCloseTo(WORLD_SURFACES.garden);
    expect(hits[0].getNormal(true)!.y).toBeGreaterThan(.99);
  });

  it("gives adjacent downtown buildings seeded gaps of 75–100% of the taxi width, too narrow to drive through",()=>{
    const gaps:number[]=[];
    const taxiWidth = STARTER_VEHICLE.appearance.bodyWidth;
    const minGap = taxiWidth * GAME_CONFIG.world.buildings.downtownGapMinTaxiWidths;
    const maxGap = taxiWidth * GAME_CONFIG.world.buildings.downtownGapMaxTaxiWidths;
    const collisionDiameter = 2 * GAME_CONFIG.player.radius * taxiWidth / GAME_CONFIG.player.width;
    for(const a of town.buildings.filter(b=>b.district==="downtown")) {
      expect(a.frontage!.coveredHeights.every(h=>h===0)).toBe(true);
      for(let local=0;local<4;local++) {
        const expected=a.frontage!.sideClearances![local];if(!Number.isFinite(expected))continue;
        const side=(a.facing-local+4)%4,ns=side%2===0,sign=side<2?-1:1,ar=footprint(a);
        const neighbors=town.buildings.filter(b=>b!==a&&b.frontage!.blockId===a.frontage!.blockId).map(footprint)
          .filter(b=>Math.abs((ns?b.x:b.z)-(ns?ar.x:ar.z))<(ns?b.halfX+ar.halfX:b.halfZ+ar.halfZ)-.001)
          .map(b=>sign*((ns?b.z:b.x)-(ns?ar.z:ar.x))-(ns?b.halfZ+ar.halfZ:b.halfX+ar.halfX))
          .filter(g=>g>0);
        const actual=Math.min(...neighbors);
        expect(actual).toBeCloseTo(expected);
        gaps.push(actual);
        expect(actual).toBeGreaterThanOrEqual(minGap-1e-8);expect(actual).toBeLessThanOrEqual(maxGap+1e-8);
        expect(actual).toBeLessThan(collisionDiameter);
      }
    }
    expect(new Set(gaps.map(g=>g.toFixed(2))).size).toBeGreaterThan(30);
  });

  it("gives each residential property connected, exclusive ground with no fences cutting through it",()=>{
    const reservations=town.legalDrivingAreas.concat(town.clinics.map(c=>{
      // The production planner uses the actual clinic footprint.
      return town.staticColliders.find(r=>r.x===c.position.x&&r.z===c.position.z)!;
    }));
    for(const block of town.districts.filter(b=>b.district==="residential")) {
      const x=(town.roadPositionsX[block.bx]+town.roadPositionsX[block.bx+1])/2;
      const z=(town.roadPositionsZ[block.bz]+town.roadPositionsZ[block.bz+1])/2;
      const plan=planBlock(block.bx,block.bz,x,z,"residential",reservations);
      const properties=plan.buildings.map(b=>({id:b.frontage!.id,parts:b.frontage!.property!}));
      for(const b of plan.buildings) {
        const parts=b.frontage!.property!;expect(parts.length).toBeGreaterThan(0);
        expect(parts.some(p=>overlaps(p,footprint(b)))).toBe(true);
        for(const p of parts)expect(properties.some(other=>other.id!==b.frontage!.id&&other.parts.some(q=>overlaps(p,q)))).toBe(false);
        // Traverse the parcel adjacency graph, starting at the house.
        const connected=parts.filter(p=>overlaps(p,footprint(b)));
        for(let i=0;i<connected.length;i++)for(const p of parts){
          const a=connected[i];
          const dx=Math.min(a.x+a.halfX,p.x+p.halfX)-Math.max(a.x-a.halfX,p.x-p.halfX);
          const dz=Math.min(a.z+a.halfZ,p.z+p.halfZ)-Math.max(a.z-a.halfZ,p.z-p.halfZ);
          if(!connected.includes(p)&&((dx>.001&&dz>=-.001)||(dz>.001&&dx>=-.001)))connected.push(p);
        }
        expect(connected).toHaveLength(parts.length);
      }
      const owner=(x:number,z:number)=>properties.find(p=>p.parts.some(a=>Math.abs(x-a.x)<a.halfX-.001&&Math.abs(z-a.z)<a.halfZ-.001))?.id;
      for(const f of plan.fenceRuns)for(const fraction of [-.6,0,.6]) {
        const ns=f.halfX>f.halfZ;
        const px=f.x+(ns?fraction*f.halfX:0),pz=f.z+(ns?0:fraction*f.halfZ);
        const a=owner(px+(ns?0:.3),pz+(ns?.3:0)),b=owner(px-(ns?0:.3),pz-(ns?.3:0));
        if(a&&b)expect(a,`internal fence in ${a}`).not.toBe(b);
      }
    }
  });

  it("prevents car-sized routes into every ordinary block interior, including behind service lots",()=>{
    // Flood the actual collision layout at car clearance. This catches open corners,
    // broken fence joins and service paths that accidentally bypass the street wall.
    const step=3,radius=2.8,half=GAME_CONFIG.world.blockSize/2+9,size=Math.ceil(half*2/step)+1;
    for(const block of town.districts){
      if(block.district==="park")continue;
      const cx=(town.roadPositionsX[block.bx]+town.roadPositionsX[block.bx+1])/2;
      const cz=(town.roadPositionsZ[block.bz]+town.roadPositionsZ[block.bz+1])/2;
      const colliders=town.staticColliders.filter(c=>Math.abs(c.x-cx)<half+c.halfX&&Math.abs(c.z-cz)<half+c.halfZ);
      const seen=new Uint8Array(size*size),queue:number[]=[];
      const add=(ix:number,iz:number)=>{
        if(ix<0||iz<0||ix>=size||iz>=size)return;
        const id=iz*size+ix;if(seen[id])return;seen[id]=1;
        const x=cx-half+ix*step,z=cz-half+iz*step;
        if(colliders.some(c=>Math.max(0,Math.abs(x-c.x)-c.halfX)**2+Math.max(0,Math.abs(z-c.z)-c.halfZ)**2<radius*radius))return;
        seen[id]=2;queue.push(id);
      };
      for(let i=0;i<size;i++){add(i,0);add(i,size-1);add(0,i);add(size-1,i);}
      for(let q=0;q<queue.length;q++){
        const ix=queue[q]%size,iz=Math.floor(queue[q]/size);
        add(ix-1,iz);add(ix+1,iz);add(ix,iz-1);add(ix,iz+1);
      }
      const middle=Math.round(half/step);
      expect(seen[middle*size+middle],`block ${block.bx},${block.bz} has a drivable shortcut`).not.toBe(2);
    }
  });
});
