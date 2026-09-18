import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { GAME_CONFIG } from "../game/config";
import type { ApartmentModel } from "../graphics/GraphicsMode";
import { visualSeed, type BuildingLot } from "./CityStyle";
import kit from "./assets/apartment.json";

type Point = [number, number, number];
type Part = (typeof kit.parts)[keyof typeof kit.parts];
const palettes = kit.themes.map(theme => kit.roles.map(role =>
  Color3.FromHexString(theme[role as keyof typeof theme])));
export const APARTMENT_COLOR_NAMES = kit.themes.map(theme => theme.name);

/** Visual selection only. Layout, entrances, services and collision boxes stay untouched. */
export function selectApartmentLots(lots: readonly BuildingLot[], mode: ApartmentModel): Map<string, number> {
  const selected = new Map<string, number>();
  if (mode === "procedural") return selected;
  const config = GAME_CONFIG.graphics.apartmentPilot;
  for (const lot of lots) {
    const f = lot.frontage;
    if (lot.district !== "downtown" || lot.landmark || !f || !f.streetSides.includes(0)) continue;
    // Preserve the original four-building comparison, while all also upgrades corners/cafes.
    if (mode === "pilot" && (f.streetSides.length !== 1 || visualSeed(f.id) % 13 === 0
      || f.blockId !== config.blockId || lot.facing !== config.facing || selected.size >= config.count)) continue;
    selected.set(f.id, mode === "pilot" ? selected.size % palettes.length : visualSeed(f.id) % palettes.length);
  }
  return selected;
}

/** Assemble the Blender facade pieces once, then let Town merge them into its normal city chunks. */
export function createBlenderApartment(scene: Scene, name: string, lot: BuildingLot,
  material: StandardMaterial, variant: number): Mesh {
  const width = lot.facing % 2 === 0 ? lot.width : lot.depth;
  const depth = lot.facing % 2 === 0 ? lot.depth : lot.width;
  const palette = palettes[((variant % palettes.length) + palettes.length) % palettes.length];
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const roof = lot.height - kit.corniceHeight;
  const floors = Math.max(1, Math.round((roof - kit.groundHeight) / kit.floorHeight));
  const floorScale = (roof - kit.groundHeight) / (floors * kit.floorHeight);
  const columns = Math.max(2, Math.min(4, Math.round(width / kit.bayWidth)));
  const bay = width / columns, projection = kit.bayProjection;
  const firstBay = Math.floor((columns - 1) / 2), lastBay = Math.floor(columns / 2);
  const bayLeft = -width / 2 + firstBay * bay, bayRight = -width / 2 + (lastBay + 1) * bay;
  function add(part: Part, transform: (x: number, y: number, z: number) => Point): void {
    const offset = positions.length / 3;
    for (let i = 0; i < part.positions.length; i += 3) {
      positions.push(...transform(part.positions[i], part.positions[i + 1], part.positions[i + 2]));
      const c = palette[part.roles[i / 3]];
      colors.push(c.r, c.g, c.b, 1);
    }
    for (const index of part.indices) indices.push(offset + index);
  }
  function face(points: Point[], role: string): void {
    const offset = positions.length / 3, c = palette[kit.roles.indexOf(role)];
    for (const p of points) { positions.push(...p); colors.push(c.r, c.g, c.b, 1); }
    for (let i = 1; i < points.length - 1; i++) indices.push(offset, offset + i, offset + i + 1);
  }
  for (let col = 0; col < 3; col++) add(col === 1 ? kit.parts.entry : kit.parts.shop,
    (x, y, z) => [x * width / 30 + (col - 1) * width / 3, y, z - depth / 2]);
  for (let floor = 0; floor < floors; floor++) for (let col = 0; col < columns; col++) {
    const center = -width / 2 + (col + .5) * bay;
    const out = col >= firstBay && col <= lastBay ? projection : 0;
    add(kit.parts.upper, (x, y, z) => [x * bay / kit.bayWidth + center,
      kit.groundHeight + floor * kit.floorHeight * floorScale + y * floorScale, z - depth / 2 - out]);
  }
  const streetSides = lot.frontage?.streetSides ?? [0];
  // Corner returns use the same kit on their second street face. Keep them flat;
  // only the primary facade projects, so the shared cornice closes cleanly at corners.
  const sidePoint = (side: number, u: number, y: number, z: number): Point => {
    if (side === 1) return [width/2-z,y,u];
    if (side === 2) return [-u,y,depth/2-z];
    return [-width/2+z,y,-u];
  };
  for (let side = 1; side < 4; side++) {
    const span = side % 2 === 0 ? width : depth;
    if (!streetSides.includes(side)) {
      // Full alley/courtyard walls remain visible across every open gap.
      face([sidePoint(side,-span/2,0,0),sidePoint(side,span/2,0,0),
        sidePoint(side,span/2,roof,0),sidePoint(side,-span/2,roof,0)], "wall");
      continue;
    }
    for (let col = 0; col < 3; col++) add(col === 1 ? kit.parts.entry : kit.parts.shop,
      (x,y,z) => sidePoint(side,x*span/30+(col-1)*span/3,y,z));
    const count = Math.max(2,Math.min(4,Math.round(span/kit.bayWidth))), spacing = span/count;
    for (let floor = 0; floor < floors; floor++) for (let col = 0; col < count; col++)
      add(kit.parts.upper,(x,y,z) => sidePoint(side,x*spacing/kit.bayWidth-span/2+(col+.5)*spacing,
        kit.groundHeight+floor*kit.floorHeight*floorScale+y*floorScale,z));
  }
  const z = -depth / 2, front = z - projection;
  face([[bayLeft,kit.groundHeight,z],[bayLeft,kit.groundHeight,front],[bayLeft,roof,front],[bayLeft,roof,z]], "wall");
  face([[bayRight,kit.groundHeight,front],[bayRight,kit.groundHeight,z],[bayRight,roof,z],[bayRight,roof,front]], "wall");
  face([[bayLeft,kit.groundHeight,z],[bayRight,kit.groundHeight,z],[bayRight,kit.groundHeight,front],[bayLeft,kit.groundHeight,front]], "base");
  for (const [a,b] of [[-width/2,bayLeft],[bayRight,width/2]])
    face([[a,roof,z],[b,roof,z],[b,roof,front],[a,roof,front]], "stone");
  // Mitered cornice rings share edges. Side projections stay inside alley gaps;
  // the front's shallow bay can project toward the street above the clear entrance.
  const extent = (side: number, out: number) => out < 0 ? out
    : Math.min(out, (lot.frontage?.sideClearances?.[side] ?? Infinity) / 4);
  for (let side = 0; side < 4; side++) add(kit.parts.cornice, (u, y, z) => {
    const out = -z, left = -width / 2 - extent(3,out), right = width / 2 + extent(1,out);
    const front = -depth / 2 - projection - extent(0,out), back = depth / 2 + extent(2,out);
    if (side === 0) return [left + (u + .5) * (right - left), roof + y, front];
    if (side === 1) return [right, roof + y, front + (u + .5) * (back - front)];
    if (side === 2) return [right - (u + .5) * (right - left), roof + y, back];
    return [left, roof + y, back - (u + .5) * (back - front)];
  });
  // The inner parapet ends at .32 inset and .2 above the wall top.
  face([[-width/2+.32,roof+.2,front+.32],[width/2-.32,roof+.2,front+.32],
    [width/2-.32,roof+.2,depth/2-.32],[-width/2+.32,roof+.2,depth/2-.32]], "roof");
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData(); Object.assign(data, { positions, normals, colors, indices });
  const mesh = new Mesh(name, scene); data.applyToMesh(mesh); mesh.material = material;
  mesh.position.set(lot.x, 0, lot.z); mesh.rotation.y = lot.facing * Math.PI / 2;
  mesh.useVertexColors = true; mesh.hasVertexAlpha = false; mesh.isPickable = false;
  mesh.metadata = { district: lot.district, buildingStyle: "apartment", landmark: false,
    streetSides: lot.frontage?.streetSides, apartmentColor: APARTMENT_COLOR_NAMES[variant % palettes.length], floors };
  return mesh;
}
