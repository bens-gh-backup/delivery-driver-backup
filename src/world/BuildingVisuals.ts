import { WORLD_SURFACES } from "./SurfaceLayout";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { CITY_STYLE, CityGeometry, visualSeed, type CityDistrict, type BuildingFrontage } from "./CityStyle";

/** Bounded generation-time bay count; opening dimensions stay consistent as facades grow. */
export function facadeColumnCount(span: number): number {
  return Math.max(1, Math.min(CITY_STYLE.maximumWindowColumns, Math.floor(span / CITY_STYLE.facades.bayWidth)));
}

export function createNoirBuilding(
  scene: Scene, name: string, x: number, z: number, width: number, depth: number, height: number,
  material: StandardMaterial, neonMaterial: StandardMaterial, district: CityDistrict,
  landmark = false, facing = 0, cornerSide: number | null = null, streetFrontage = true,
  frontage?: BuildingFrontage,
): Mesh[] {
  const seed = visualSeed(name), p = CITY_STYLE.palette, rules = CITY_STYLE.facades;
  const layer = rules.surfaceStep;
  const palette = district === "downtown" ? p.downtown : p.residential;
  const wall = palette[((frontage?.colorSeed ?? 0) + seed % 3) % palette.length], g = new CityGeometry();
  if (facing % 2 !== 0) [width, depth] = [depth, width];
  const pitched = district === "residential" && seed % 3 !== 0;
  const stepped = landmark || (!frontage && district === "downtown" && seed % 3 === 0);
  const commercial = district === "downtown";
  const streetSides = frontage?.streetSides ?? (!streetFrontage ? [] : cornerSide === 1 || cornerSide === 3 ? [0, cornerSide] : [0]);
  const cover = (side: number, w = width, d = depth) => w === width && d === depth ? frontage?.coveredHeights[side] ?? 0 : 0;
  const neighbor = (side: number, w = width, d = depth) => w === width && d === depth ? frontage?.neighborHeights?.[side] ?? 0 : 0;
  const limitedProjection = (side: number, amount: number, w = width, d = depth) => w === width && d === depth
    ? Math.min(amount,(frontage?.sideClearances?.[side] ?? Infinity)/4) : amount;

  // All facade detail is written directly into one vertex-colored building mesh.
  function point(side: number, u: number, y: number, out: number, w = width, d = depth): [number, number, number] {
    if (side === 1) return [w / 2 + out, y, u];
    if (side === 2) return [-u, y, d / 2 + out];
    if (side === 3) return [-w / 2 - out, y, -u];
    return [u, y, -d / 2 - out];
  }
  function panel(side: number, left: number, right: number, bottom: number, top: number,
    out: number, color: string, w = width, d = depth): void {
    g.face([point(side, left, bottom, out, w, d), point(side, right, bottom, out, w, d),
      point(side, right, top, out, w, d), point(side, left, top, out, w, d)], color);
  }
  function ledge(side: number, left: number, right: number, y: number, projection: number,
    thickness: number, color: string, w = width, d = depth): void {
    panel(side, left, right, y - thickness, y, projection, color, w, d);
    g.face([point(side, left, y, projection, w, d), point(side, right, y, projection, w, d),
      point(side, right, y, .025, w, d), point(side, left, y, .025, w, d)], color);
  }
  function belt(y: number, w: number, d: number, projection: number, thickness: number): void {
    for (let side = 0; side < 4; side++) {
      if (Math.max(cover(side,w,d),neighbor(side,w,d)) >= y) continue;
      const half = (side % 2 === 0 ? w : d) / 2;
      const left = cover((side+3)%4,w,d) >= y-thickness ? 0 : limitedProjection((side+3)%4,projection,w,d);
      const right = cover((side+1)%4,w,d) >= y-thickness ? 0 : limitedProjection((side+1)%4,projection,w,d);
      const out=limitedProjection(side,projection,w,d);
      panel(side, -half-left, half+right, Math.max(y-thickness,cover(side,w,d)), y, out, p.trim, w, d);
      // Opposite top strips own the corners, so the cornice closes without overlapping faces.
      const topLeft = half + (side % 2 === 0 ? left : 0), topRight = half + (side % 2 === 0 ? right : 0);
      g.face([point(side,-topLeft,y,out,w,d),point(side,topRight,y,out,w,d),
        point(side,topRight,y,.025,w,d),point(side,-topLeft,y,.025,w,d)],p.trim);
    }
  }
  function windows(w: number, d: number, bottom: number, top: number): void {
    for (let side = 0; side < 4; side++) {
      const span = side % 2 === 0 ? w : d;
      const detailed = streetSides.includes(side);
      const columns = frontage && !detailed ? Math.min(2,facadeColumnCount(span))
        : streetFrontage ? facadeColumnCount(span) : Math.min(3, facadeColumnCount(span));
      const bay = span / columns;
      const half = Math.min(rules.windowWidth / 2, bay * .28);
      const firstY = commercial ? rules.shopHeight + 1.2 : 1.5;
      // A shared floor grid continues across setbacks; window rows never stretch with the wall.
      for (let row = 0; row < CITY_STYLE.maximumWindowRows; row++) {
        const y = firstY + row * CITY_STYLE.floorHeight;
        if (y < Math.max(cover(side,w,d),neighbor(side,w,d)) + .65 || (frontage && !detailed && row > 1)) continue;
        if (y < bottom + .65 || y + rules.windowHeight > top - 1) continue;
        for (let col = 0; col < columns; col++) {
          const center = -span / 2 + (col + .5) * bay;
          if (!commercial && side === 0 && row === 0 && Math.abs(center) < half + 1.6) continue;
          panel(side, center-half, center+half, y, y+rules.windowHeight, layer, p.window, w, d);
          if (detailed) ledge(side, center-half-.3, center+half+.3, y, rules.sillProjection, .3, p.trim, w, d);
        }
      }
    }
  }

  function mass(w: number, d: number, bottom: number, top: number): void {
    // Shared party walls have no hidden windows or duplicate coplanar faces.
    for(let side=0;side<4;side++) {
      const from=Math.max(bottom,cover(side,w,d));
      if(from>=top)continue;
      const half=(side%2===0?w:d)/2;
      panel(side,-half,half,from,top,0,wall,w,d);
    }
    g.face([[-w/2,top,-d/2],[w/2,top,-d/2],[w/2,top,d/2],[-w/2,top,d/2]],p.roof);
  }

  if (stepped) {
    const baseHeight = height * .55, upperWidth = width * .72, upperDepth = depth * .72;
    mass(width,depth,0,baseHeight);
    mass(upperWidth,upperDepth,baseHeight,height);
    belt(baseHeight+.2, width, depth, .6, .65);
    belt(height+.2, upperWidth, upperDepth, .65, .75);
    windows(width, depth, 0, baseHeight);
    windows(upperWidth, upperDepth, baseHeight, height);
    if (landmark) {
      g.box(0,height+2,0,width*.36,4,depth*.36,p.trim);
      g.box(0,height+5,0,width*.14,2,depth*.14,p.roof);
    }
  } else {
    const rise = pitched ? 3 : 0, wallHeight = height-rise;
    mass(width,depth,0,wallHeight);
    if (pitched) g.roof(0, wallHeight, 0, width+.6, depth+.6, rise, p.roof);
    if (!pitched) belt(wallHeight+.15, width, depth, .6, .65);
    windows(width, depth, 0, wallHeight);
  }
  // A continuous masonry base grounds the building without additional collision geometry.
  for (let side = 0; side < 4; side++) {
    if(Math.max(cover(side),neighbor(side))>=(commercial?rules.shopHeight:.65))continue;
    const span = side % 2 === 0 ? width : depth;
    panel(side, -span/2, span/2, .12, commercial ? rules.shopHeight : .65, layer, p.buildingBase);
  }
  if (commercial) {
    belt(rules.shopHeight, width, depth, .5, .4);
    for (const side of streetSides) {
      const span = side % 2 === 0 ? width : depth;
      const columns = facadeColumnCount(span), bay = span / columns;
      for (let col = 0; col < columns; col++) {
        const center = -span/2+(col+.5)*bay, half = bay*.38;
        panel(side, center-half-.12, center+half+.12, .35, rules.shopHeight-.8, layer * 2, p.trim);
        panel(side, center-half, center+half, .55, rules.shopHeight-1, layer * 3, p.window);
        // One narrow mullion is enough to read as shop glazing from the driving camera.
        panel(side, center-.09, center+.09, .55, rules.shopHeight-1, layer * 4, p.windowFrame);
        if (seed % 3 !== 1) {
          const awningY = rules.shopHeight-.45, outerY = awningY-.65;
          for (let stripe = 0; stripe < 4; stripe++) {
            const a = center-half + stripe*(half/2), b = a+half/2;
            const color = stripe % 2 ? p.trim : p.awning[(frontage?.colorSeed ?? seed) % p.awning.length];
            g.face([point(side,a,outerY,1.7),point(side,b,outerY,1.7),
              point(side,b,awningY,.13),point(side,a,awningY,.13)],color);
            panel(side,a,b,outerY-.2,outerY,1.7,color);
          }
        }
      }
    }
  } else if (!frontage) {
    g.face([[-width/2-3,WORLD_SURFACES.garden,-depth/2-3],[width/2+3,WORLD_SURFACES.garden,-depth/2-3],
      [width/2+3,WORLD_SURFACES.garden,depth/2+3],[-width/2-3,WORLD_SURFACES.garden,depth/2+3]],p.lawn);
    g.face([[-1.6,WORLD_SURFACES.path,-depth/2-7],[1.6,WORLD_SURFACES.path,-depth/2-7],
      [1.6,WORLD_SURFACES.path,-depth/2],[-1.6,WORLD_SURFACES.path,-depth/2]],p.path);
    if(seed%3===0) g.box(width*.32,height-.6,depth*.2,1.8,3,2,p.roof);
  }
  if(frontage && !commercial && seed%3===0) g.box(width*.32,height-.6,depth*.2,1.8,3,2,p.roof);
  // Keep the existing central entrance clear, including on corner storefronts.
  panel(0,-1.45,1.45,.18,3.55,layer * 5,p.trim);
  panel(0,-1.18,1.18,.2,3.3,layer * 6,p.window);
  panel(0,.72,.86,1.35,1.65,layer * 7,p.trim);
  if (!commercial) ledge(0,-2,2,3.8,.9,.25,p.trim);
  const mesh=g.mesh(scene,name,material,x,z);
  mesh.rotation.y=facing*Math.PI/2;
  mesh.metadata={district,buildingStyle:pitched?"pitched":stepped?"stepped":"commercial",landmark,streetSides};
  const meshes=[mesh];
  if (district === "downtown" && (landmark || seed%13===0)) {
    const sign = new CityGeometry();
    const color=p.neon[seed%2],sx=landmark?width*.35:0,sy=landmark?height*.45:5;
    sign.box(sx,sy,-depth/2-.9,landmark?1.8:6.5,landmark?11:2,.5,p.window);
    // Small vector lettering shares the sign mesh: no text textures or extra draw calls.
    const glyphs: Record<string,string[]> = {
      C:["111","100","100","100","111"], A:["010","101","111","101","101"],
      F:["111","100","110","100","100"], E:["111","100","110","100","111"],
      H:["101","101","111","101","101"], O:["111","101","101","101","111"],
      T:["111","010","010","010","010"], L:["100","100","100","100","111"],
    };
    const word=landmark?"HOTEL":"CAFE",pixel=.25;
    for(let letter=0;letter<word.length;letter++) {
      const left=landmark?sx-.375:sx-word.length*.65+letter*1.3;
      const top=landmark?sy+4-letter*1.7:sy+.625;
      glyphs[word[letter]].forEach((row,r)=>{
        for(let c=0;c<row.length;c++) {
          if(row[c]!=="1")continue;
          const start=c;while(c+1<row.length&&row[c+1]==="1")c++;
          const a=left+start*pixel,b=left+(c+1)*pixel,y=top-r*pixel;
          sign.face([[a,y-pixel,-depth/2-1.15-layer],[b,y-pixel,-depth/2-1.15-layer],
            [b,y,-depth/2-1.15-layer],[a,y,-depth/2-1.15-layer]],color);
        }
      });
    }
    const glow=sign.mesh(scene,`${name}-neon`,neonMaterial,x,z);
    glow.rotation.y=mesh.rotation.y;meshes.push(glow);
  }
  return meshes;
}
