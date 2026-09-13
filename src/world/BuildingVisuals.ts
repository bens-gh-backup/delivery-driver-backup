import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { CITY_STYLE, CityGeometry, visualSeed, type CityDistrict } from "./CityStyle";

/** Bounded generation-time bay count; opening dimensions stay consistent as facades grow. */
export function facadeColumnCount(span: number): number {
  return Math.max(1, Math.min(CITY_STYLE.maximumWindowColumns, Math.floor(span / CITY_STYLE.facades.bayWidth)));
}

export function createNoirBuilding(
  scene: Scene, name: string, x: number, z: number, width: number, depth: number, height: number,
  material: StandardMaterial, neonMaterial: StandardMaterial, district: CityDistrict,
  landmark = false, facing = 0, cornerSide: number | null = null, streetFrontage = true,
): Mesh[] {
  const seed = visualSeed(name), p = CITY_STYLE.palette, rules = CITY_STYLE.facades;
  const palette = district === "downtown" ? p.downtown : p.residential;
  const wall = palette[seed % palette.length], g = new CityGeometry();
  if (facing % 2 !== 0) [width, depth] = [depth, width];
  const pitched = district === "residential" && seed % 3 !== 0;
  const stepped = landmark || (district === "downtown" && seed % 3 === 0);
  const commercial = district === "downtown";
  const streetSides = !streetFrontage ? [] : cornerSide === 1 || cornerSide === 3 ? [0, cornerSide] : [0];

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
      const half = (side % 2 === 0 ? w : d) / 2;
      panel(side, -half-projection, half+projection, y-thickness, y, projection, p.trim, w, d);
      // Opposite top strips own the corners, so the cornice closes without overlapping faces.
      const topHalf = half + (side % 2 === 0 ? projection : 0);
      g.face([point(side,-topHalf,y,projection,w,d),point(side,topHalf,y,projection,w,d),
        point(side,topHalf,y,.025,w,d),point(side,-topHalf,y,.025,w,d)],p.trim);
    }
  }
  function windows(w: number, d: number, bottom: number, top: number): void {
    for (let side = 0; side < 4; side++) {
      const span = side % 2 === 0 ? w : d;
      const columns = streetFrontage ? facadeColumnCount(span) : Math.min(3, facadeColumnCount(span));
      const bay = span / columns;
      const half = Math.min(rules.windowWidth / 2, bay * .28);
      const detailed = streetSides.includes(side);
      const firstY = commercial ? rules.shopHeight + 1.2 : 1.5;
      // A shared floor grid continues across setbacks; window rows never stretch with the wall.
      for (let row = 0; row < CITY_STYLE.maximumWindowRows; row++) {
        const y = firstY + row * CITY_STYLE.floorHeight;
        if (y < bottom + .65 || y + rules.windowHeight > top - 1) continue;
        for (let col = 0; col < columns; col++) {
          const center = -span / 2 + (col + .5) * bay;
          if (!commercial && side === 0 && row === 0 && Math.abs(center) < half + 1.6) continue;
          panel(side, center-half, center+half, y, y+rules.windowHeight, .085, p.window, w, d);
          if (detailed) ledge(side, center-half-.3, center+half+.3, y, rules.sillProjection, .3, p.trim, w, d);
        }
      }
    }
  }

  if (stepped) {
    const baseHeight = height * .55, upperWidth = width * .72, upperDepth = depth * .72;
    g.box(0, baseHeight/2, 0, width, baseHeight, depth, wall);
    g.box(0, baseHeight+(height-baseHeight)/2, 0, upperWidth, height-baseHeight, upperDepth, wall);
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
    g.box(0, wallHeight/2, 0, width, wallHeight, depth, wall);
    if (pitched) g.roof(0, wallHeight, 0, width+.6, depth+.6, rise, p.roof);
    if (!pitched) belt(wallHeight+.15, width, depth, .6, .65);
    windows(width, depth, 0, wallHeight);
  }
  // A continuous masonry base grounds the building without additional collision geometry.
  for (let side = 0; side < 4; side++) {
    const span = side % 2 === 0 ? width : depth;
    panel(side, -span/2, span/2, .12, commercial ? rules.shopHeight : .65, .02, p.buildingBase);
  }
  if (commercial) {
    belt(rules.shopHeight, width, depth, .5, .4);
    for (const side of streetSides) {
      const span = side % 2 === 0 ? width : depth;
      const columns = facadeColumnCount(span), bay = span / columns;
      for (let col = 0; col < columns; col++) {
        const center = -span/2+(col+.5)*bay, half = bay*.38;
        panel(side, center-half-.12, center+half+.12, .35, rules.shopHeight-.8, .06, p.trim);
        panel(side, center-half, center+half, .55, rules.shopHeight-1, .09, p.window);
        // One narrow mullion is enough to read as shop glazing from the driving camera.
        panel(side, center-.09, center+.09, .55, rules.shopHeight-1, .12, p.windowFrame);
        if (seed % 3 !== 1) {
          const awningY = rules.shopHeight-.45, outerY = awningY-.65;
          for (let stripe = 0; stripe < 4; stripe++) {
            const a = center-half + stripe*(half/2), b = a+half/2;
            const color = stripe % 2 ? p.trim : p.awning[seed % p.awning.length];
            g.face([point(side,a,outerY,1.7),point(side,b,outerY,1.7),
              point(side,b,awningY,.13),point(side,a,awningY,.13)],color);
            panel(side,a,b,outerY-.2,outerY,1.7,color);
          }
        }
      }
    }
  } else {
    g.face([[-width/2-3,.16,-depth/2-3],[width/2+3,.16,-depth/2-3],
      [width/2+3,.16,depth/2+3],[-width/2-3,.16,depth/2+3]],p.lawn);
    g.face([[-1.6,.18,-depth/2-7],[1.6,.18,-depth/2-7],
      [1.6,.18,-depth/2],[-1.6,.18,-depth/2]],p.path);
    if(seed%3===0) g.box(width*.32,height-.6,depth*.2,1.8,3,2,p.roof);
  }
  // Keep the existing central entrance clear, including on corner storefronts.
  panel(0,-1.45,1.45,.18,3.55,.15,p.trim);
  panel(0,-1.18,1.18,.2,3.3,.18,p.window);
  panel(0,.72,.86,1.35,1.65,.2,p.trim);
  if (!commercial) ledge(0,-2,2,3.8,.9,.25,p.trim);
  const mesh=g.mesh(scene,name,material,x,z);
  mesh.rotation.y=facing*Math.PI/2;
  mesh.metadata={district,buildingStyle:pitched?"pitched":stepped?"stepped":"commercial",landmark,streetSides};
  const meshes=[mesh];
  if (district === "downtown" && (landmark || seed%13===0)) {
    const sign = new CityGeometry();
    const color=p.neon[seed%2],sx=landmark?width*.35:0,sy=landmark?height*.45:5;
    sign.box(sx,sy,-depth/2-.3,landmark?1.8:6.5,landmark?11:2,.5,p.window);
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
          sign.face([[a,y-pixel,-depth/2-.56],[b,y-pixel,-depth/2-.56],
            [b,y,-depth/2-.56],[a,y,-depth/2-.56]],color);
        }
      });
    }
    const glow=sign.mesh(scene,`${name}-neon`,neonMaterial,x,z);
    glow.rotation.y=mesh.rotation.y;meshes.push(glow);
  }
  return meshes;
}
