import { GAME_CONFIG } from "../game/config";
import type { BoxCollider } from "../game/types";
import { seededRandom } from "../utils/math";
import { CITY_STYLE, visualSeed, type BuildingLot, type CityDistrict } from "./CityStyle";
import { curbSegments } from "./StreetDetails";

export interface GroundParcel { area: BoxCollider; color: string }
export interface BlockLayout {
  buildings: BuildingLot[];
  ground: GroundParcel[];
  fences: BoxCollider[];
  fenceRuns: BoxCollider[];
}

export const footprint = (b: BuildingLot): BoxCollider => ({ x: b.x, z: b.z, halfX: b.width / 2, halfZ: b.depth / 2 });
const expanded = (b: BoxCollider, n: number): BoxCollider => ({ ...b, halfX: b.halfX + n, halfZ: b.halfZ + n });
const overlaps = (a: BoxCollider, b: BoxCollider) => Math.abs(a.x-b.x) < a.halfX+b.halfX-.001
  && Math.abs(a.z-b.z) < a.halfZ+b.halfZ-.001;
function intersection(a: BoxCollider, b: BoxCollider): BoxCollider | null {
  const x0 = Math.max(a.x-a.halfX,b.x-b.halfX), x1 = Math.min(a.x+a.halfX,b.x+b.halfX);
  const z0 = Math.max(a.z-a.halfZ,b.z-b.halfZ), z1 = Math.min(a.z+a.halfZ,b.z+b.halfZ);
  return x1-x0 > .001 && z1-z0 > .001 ? {x:(x0+x1)/2,z:(z0+z1)/2,halfX:(x1-x0)/2,halfZ:(z1-z0)/2} : null;
}

/** Non-overlapping rectangles: used for reserved lots and flat ground colors alike. */
export function subtractAreas(area: BoxCollider, cuts: readonly BoxCollider[]): BoxCollider[] {
  let pieces = [area];
  for (const cut of cuts) pieces = pieces.flatMap(a => {
    const hit = intersection(a,cut); if (!hit) return [a];
    const x0=a.x-a.halfX,x1=a.x+a.halfX,z0=a.z-a.halfZ,z1=a.z+a.halfZ;
    const l=hit.x-hit.halfX,r=hit.x+hit.halfX,t=hit.z-hit.halfZ,b=hit.z+hit.halfZ;
    return [
      {x:(x0+l)/2,z:a.z,halfX:(l-x0)/2,halfZ:a.halfZ},
      {x:(r+x1)/2,z:a.z,halfX:(x1-r)/2,halfZ:a.halfZ},
      {x:hit.x,z:(z0+t)/2,halfX:hit.halfX,halfZ:(t-z0)/2},
      {x:hit.x,z:(b+z1)/2,halfX:hit.halfX,halfZ:(z1-b)/2},
    ].filter(p=>p.halfX>.001 && p.halfZ>.001);
  });
  return pieces;
}

/** Pure generation-time plan. Corners own their squares; four rows fill the remainder. */
export function planBlock(bx: number, bz: number, x: number, z: number,
  district: Exclude<CityDistrict,"park">, reservations: readonly BoxCollider[]): BlockLayout {
  const world=GAME_CONFIG.world,rules=world.buildings,commercial=district==="downtown";
  const setback=commercial?rules.downtownSetback:rules.residentialSetback;
  const half=world.blockSize/2-setback, depth=Math.min(rules.frontageDepth,half/2);
  const bounds={x,z,halfX:half,halfZ:half},inner={x,z,halfX:half-depth,halfZ:half-depth};
  const blockId=`block-${bx}-${bz}`,blockSeed=visualSeed(blockId),random=seededRandom(blockSeed);
  const cuts=reservations.map(r=>expanded(r,world.servicePlacement.buildingClearance+1)).filter(r=>overlaps(bounds,r));
  const buildings:BuildingLot[]=[],parcels:{lot:BuildingLot;area:BoxCollider;side:number;corner:boolean}[]=[];
  const districtRules=CITY_STYLE.districts[district];
  const makeLot=(area:BoxCollider,side:number,cornerSide:number|null,id:string) => {
    if(cuts.some(c=>overlaps(area,c)))return;
    const ns=side%2===0,sign=side<2?-1:1,corner=cornerSide!==null;
    const span=(ns?area.halfX:area.halfZ)*2;
    const size=()=>rules.houseMinSize+random()*(rules.houseMaxSize-rules.houseMinSize);
    const w=commercial?span:Math.min(size(),span-8),d=commercial?depth:Math.min(size(),depth-4);
    if(w<12)return;
    const fixed=(ns?area.z:area.x)+sign*((ns?area.halfZ:area.halfX)-d/2);
    let along=ns?area.x:area.z;
    if(corner && !commercial) {
      const edgeSign=cornerSide===1?-1:1;
      along+=edgeSign*(span-w)/2;
    }
    const height=commercial
      ? districtRules.minHeight+Math.floor(random()*5)*CITY_STYLE.floorHeight
      : districtRules.minHeight+random()*(districtRules.maxHeight-districtRules.minHeight);
    const lot:BuildingLot={x:ns?along:fixed,z:ns?fixed:along,width:ns?w:d,depth:ns?d:w,
      height,district,landmark:false,facing:side,frontage:{id,blockId,colorSeed:blockSeed+side,
        streetSides:cornerSide===null?[0]:[0,(side-cornerSide+4)%4],coveredHeights:[0,0,0,0]}};
    buildings.push(lot);parcels.push({lot,area,side,corner});
  };
  for(const sx of [-1,1])for(const sz of [-1,1]) {
    makeLot({x:x+sx*(half-depth/2),z:z+sz*(half-depth/2),halfX:depth/2,halfZ:depth/2},
      sz<0?0:2,sx<0?1:3,`building-${bx}-${bz}-corner-${sx}-${sz}`);
  }
  for(let side=0;side<4;side++) {
    const ns=side%2===0,sign=side<2?-1:1,fixed=(ns?z:x)+sign*(half-depth/2);
    const row:BoxCollider={x:ns?x:fixed,z:ns?fixed:z,halfX:ns?half-depth:depth/2,halfZ:ns?depth/2:half-depth};
    const intervals=cuts.filter(c=>overlaps(row,c)).map(c=>ns?[c.x-c.halfX,c.x+c.halfX] as const:[c.z-c.halfZ,c.z+c.halfZ] as const);
    const origin=ns?x:z;
    for(const [segment,[a,b]] of curbSegments(origin-half+depth,origin+half-depth,intervals).entries()) {
      if(b-a<rules.minimumFrontage)continue;
      const count=Math.max(1,Math.round((b-a)/rules.frontageWidth)),span=(b-a)/count;
      for(let i=0;i<count;i++) {
        const along=a+(i+.5)*span;
        makeLot({x:ns?along:fixed,z:ns?fixed:along,halfX:ns?span/2:depth/2,halfZ:ns?depth/2:span/2},
          side,null,`building-${bx}-${bz}-${side}-${segment}-${i}`);
      }
    }
  }
  // Preserve both landmark identities, now on frontage with readable entrances.
  if(commercial && bz===Math.floor(world.blocksZ/2)
    && (bx===Math.floor(world.blocksX/2)-1 || bx===Math.floor(world.blocksX/2)+1) && buildings.length) {
    buildings[0].landmark=true;buildings[0].height=82;
  }
  if(commercial) {
    const insets=new Map(buildings.map(b=>[b,[0,0,0,0]]));
    const minGap=rules.downtownGapMinMeters/GAME_CONFIG.ride.metersPerWorldUnit;
    const maxGap=rules.downtownGapMaxMeters/GAME_CONFIG.ride.metersPerWorldUnit;
    for(const b of buildings) {
      b.frontage!.sideClearances=[Infinity,Infinity,Infinity,Infinity];
      b.frontage!.neighborHeights=[0,0,0,0];
    }
    // Each original parcel seam chooses one gap, shared by its two neighbors.
    // Insets affect only internal edges, preserving street and corner alignments.
    for(let i=0;i<buildings.length;i++)for(let j=i+1;j<buildings.length;j++) {
      const a=buildings[i],b=buildings[j],ar=footprint(a),br=footprint(b);
      for(let side=0;side<4;side++) {
        const ns=side%2===0,sign=side<2?-1:1;
        const edge=(ns?ar.z:ar.x)+sign*(ns?ar.halfZ:ar.halfX);
        const other=(ns?br.z:br.x)-sign*(ns?br.halfZ:br.halfX);
        const overlap=Math.min((ns?ar.x:ar.z)+(ns?ar.halfX:ar.halfZ),(ns?br.x:br.z)+(ns?br.halfX:br.halfZ))
          -Math.max((ns?ar.x:ar.z)-(ns?ar.halfX:ar.halfZ),(ns?br.x:br.z)-(ns?br.halfX:br.halfZ));
        if(Math.abs(edge-other)>.001 || overlap<.001)continue;
        const gap=minGap+(maxGap-minGap)*visualSeed(`${a.frontage!.id}:${b.frontage!.id}`)/0xffffffff;
        const opposite=(side+2)%4;
        insets.get(a)![side]=Math.max(insets.get(a)![side],gap/2);
        insets.get(b)![opposite]=Math.max(insets.get(b)![opposite],gap/2);
        for(const [lot,neighbor,face] of [[a,b,side],[b,a,opposite]] as const) {
          const local=(lot.facing-face+4)%4;
          lot.frontage!.sideClearances![local]=gap;
          lot.frontage!.neighborHeights![local]=neighbor.landmark?neighbor.height*.55:neighbor.height;
          if(gap<.001)lot.frontage!.coveredHeights[local]=lot.frontage!.neighborHeights![local];
        }
      }
    }
    for(const b of buildings) {
      const [north,west,south,east]=insets.get(b)!;
      b.x+=(west-east)/2;b.z+=(north-south)/2;
      b.width-=west+east;b.depth-=north+south;
    }
  }

  const ground:GroundParcel[]=[];
  const lawnBounds=commercial?inner:{x,z,halfX:world.blockSize/2-world.sidewalkWidth,halfZ:world.blockSize/2-world.sidewalkWidth};
  let background=subtractAreas(lawnBounds,cuts);
  const paint=(area:BoxCollider,color:string) => {
    for(const clip of subtractAreas(area,cuts)) {
      const visible=intersection(clip,lawnBounds);if(!visible)continue;
      background=background.flatMap(b=>subtractAreas(b,[visible]));
      // Paths may replace part of a yard: remove that patch before painting.
      for(let i=ground.length-1;i>=0;i--) {
        const previous=ground[i];if(!overlaps(previous.area,visible))continue;
        ground.splice(i,1,...subtractAreas(previous.area,[visible]).map(a=>({area:a,color:previous.color})));
      }
      ground.push({area:visible,color});
    }
  };
  const fenceLines:{ns:boolean;fixed:number;a:number;b:number}[]=[];
  const addLine=(ns:boolean,fixed:number,a:number,b:number,obstacles:readonly BoxCollider[]) => {
    const alongCuts=obstacles.filter(c=>Math.abs((ns?c.z:c.x)-fixed)<(ns?c.halfZ:c.halfX)+rules.fenceThickness/2)
      .map(c=>ns?[c.x-c.halfX,c.x+c.halfX] as const:[c.z-c.halfZ,c.z+c.halfZ] as const);
    for(const [start,end] of curbSegments(a,b,alongCuts))if(end-start>.05)fenceLines.push({ns,fixed,a:start,b:end});
  };
  const solids=buildings.map(footprint);
  // Close frontage gaps, then follow service-lot sides/rears instead of blocking driveways.
  for(let side=0;side<4;side++) {
    const ns=side%2===0,sign=side<2?-1:1;
    addLine(ns,(ns?z:x)+sign*half,(ns?x:z)-half,(ns?x:z)+half,[...cuts,...solids]);
  }
  for(const cut of cuts) {
    const c=intersection(bounds,cut);if(!c)continue;
    for(let side=0;side<4;side++) {
      const ns=side%2===0,sign=side<2?-1:1,fixed=(ns?c.z:c.x)+sign*(ns?c.halfZ:c.halfX);
      if(Math.abs(fixed-(ns?z:x))>=half-.001)continue;
      addLine(ns,fixed,(ns?c.x:c.z)-(ns?c.halfX:c.halfZ),(ns?c.x:c.z)+(ns?c.halfX:c.halfZ),
        [...cuts.filter(other=>other!==cut),...solids]);
    }
  }
  if(!commercial) {
    const claimed:BoxCollider[]=[];
    // Corners own their frontage first. North/south yards then own the shared
    // inner corners, and east/west plots wrap around them without overlapping.
    const order=[...parcels].sort((a,b)=>(a.corner?0:a.side%2===0?1:2)-(b.corner?0:b.side%2===0?1:2));
    for(const {lot,area,side,corner} of order) {
      const ns=side%2===0,sign=side<2?-1:1;
      const reach=corner?0:rules.yardDepth;
      const candidate={x:area.x-(ns?0:sign*reach/2),z:area.z-(ns?sign*reach/2:0),
        halfX:area.halfX+(ns?0:reach/2),halfZ:area.halfZ+(ns?reach/2:0)};
      const available=subtractAreas(candidate,[...cuts,...claimed]);
      // Discard islands disconnected by a service lot. Every owned piece must
      // connect to the house through an edge, not merely touch at a corner.
      const connected=available.filter(p=>overlaps(p,footprint(lot)));
      for(let i=0;i<connected.length;i++)for(const p of available) {
        if(connected.includes(p))continue;
        const a=connected[i];
        const dx=Math.min(a.x+a.halfX,p.x+p.halfX)-Math.max(a.x-a.halfX,p.x-p.halfX);
        const dz=Math.min(a.z+a.halfZ,p.z+p.halfZ)-Math.max(a.z-a.halfZ,p.z-p.halfZ);
        if((dx>.001 && dz>=-.001)||(dz>.001 && dx>=-.001))connected.push(p);
      }
      lot.frontage!.property=connected;claimed.push(...connected);
      const color=["#708b79","#7b927d","#68836f"][visualSeed(lot.frontage!.id)%3];
      for(const piece of connected)paint(piece,color);
      const rear=(ns?lot.z:lot.x)-sign*(ns?lot.depth:lot.width)/2;
      const rearLimit=(ns?candidate.z:candidate.x)-sign*(ns?candidate.halfZ:candidate.halfX);
      const rearStart=rear-sign*2;
      const rearZone={x:ns?area.x:(rearStart+rearLimit)/2,z:ns?(rearStart+rearLimit)/2:area.z,
        halfX:ns?area.halfX:Math.abs(rearStart-rearLimit)/2,halfZ:ns?Math.abs(rearStart-rearLimit)/2:area.halfZ};
      const gardenPieces=connected.map(p=>intersection(p,rearZone)).filter((p):p is BoxCollider=>!!p&&p.halfX>=5&&p.halfZ>=5);
      lot.frontage!.yard=gardenPieces.sort((a,b)=>b.halfX*b.halfZ-a.halfX*a.halfZ)[0];
      for(const piece of connected)for(let edge=0;edge<4;edge++) {
        const horizontal=edge%2===0,direction=edge<2?-1:1;
        const fixed=(horizontal?piece.z:piece.x)+direction*(horizontal?piece.halfZ:piece.halfX);
        if(Math.abs(fixed-(horizontal?z:x))>=half-.001)continue; // Street frontage handled above.
        addLine(horizontal,fixed,(horizontal?piece.x:piece.z)-(horizontal?piece.halfX:piece.halfZ),
          (horizontal?piece.x:piece.z)+(horizontal?piece.halfX:piece.halfZ),
          [...connected.filter(p=>p!==piece),...cuts,...solids]);
      }
      const face=(ns?lot.z:lot.x)+sign*(ns?lot.depth:lot.width)/2;
      const walkEdge=(ns?z:x)+sign*(world.blockSize/2-world.sidewalkWidth);
      paint({x:ns?lot.x:(face+walkEdge)/2,z:ns?(face+walkEdge)/2:lot.z,
        halfX:ns?1.6:Math.abs(face-walkEdge)/2,halfZ:ns?Math.abs(face-walkEdge)/2:1.6},CITY_STYLE.palette.path);
    }
  }
  ground.push(...background.map(area=>({area,color:commercial?"#a5aaa0":CITY_STYLE.palette.lawn})));

  // Merge shared fences, then bound collider lengths so no fence enters the global query list.
  const groups=new Map<string,typeof fenceLines>();
  for(const line of fenceLines) {
    const key=`${line.ns}:${line.fixed.toFixed(4)}`,group=groups.get(key)??[];
    group.push(line);groups.set(key,group);
  }
  const fences:BoxCollider[]=[],fenceRuns:BoxCollider[]=[];
  for(const group of groups.values()) {
    group.sort((a,b)=>a.a-b.a);
    const merged:typeof fenceLines=[];
    for(const line of group) {
      const last=merged.at(-1);
      if(last&&line.a<=last.b+.001)last.b=Math.max(last.b,line.b);else merged.push({...line});
    }
    for(const {ns,fixed,a,b} of merged) {
      fenceRuns.push({x:ns?(a+b)/2:fixed,z:ns?fixed:(a+b)/2,
        halfX:ns?(b-a)/2:rules.fenceThickness/2,halfZ:ns?rules.fenceThickness/2:(b-a)/2});
      const count=Math.ceil((b-a)/Math.min(rules.fenceMaxSpan,world.spatialCellSize)),span=(b-a)/count;
      for(let i=0;i<count;i++)fences.push({x:ns?a+(i+.5)*span:fixed,z:ns?fixed:a+(i+.5)*span,
        halfX:ns?span/2:rules.fenceThickness/2,halfZ:ns?rules.fenceThickness/2:span/2});
    }
  }
  return {buildings,ground,fences,fenceRuns};
}
