import { Color3 } from "@babylonjs/core/Maths/math.color";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Point3 } from "../graphics/FacetedMesh";
import type { BoxCollider } from "../game/types";

export type CityDistrict = "downtown" | "residential" | "park";
export interface DistrictBlock { bx: number; bz: number; district: CityDistrict }
export interface BuildingLot {
  x: number; z: number; width: number; depth: number; height: number;
  district: CityDistrict; landmark: boolean;
  facing: number;
  frontage?: BuildingFrontage;
}

export interface BuildingFrontage {
  id: string;
  blockId: string;
  /** Local faces: front, right, rear, left. */
  streetSides: number[];
  coveredHeights: number[];
  sideClearances?: number[];
  neighborHeights?: number[];
  colorSeed: number;
  yard?: BoxCollider;
  /** Disjoint, connected pieces owned by this house, including its frontage. */
  property?: BoxCollider[];
}

export const CITY_STYLE = {
  palette: {
    downtown: ["#d9c8a9", "#788e92", "#abb8b0", "#b98c81"],
    residential: ["#c89285", "#cfbc9c", "#a4b4a5", "#9babb4"],
    window: "#254951", windowFrame: "#526966", buildingBase: "#647774",
    awning: ["#a65e55", "#416a64", "#4f6570"], gutter: "#647574", roof: "#45575d", trim: "#e4d3b3",
    lawn: "#708b79", foliage: ["#4b7164", "#668577", "#8b9d78"],
    trunk: "#6a6558", path: "#c3b59d", road: "#34484d", sidewalk: "#c4bfad",
    ground: "#677d71", neon: ["#55d6c8", "#eb8eaa"],
    curb: "#ddd1b5", seam: "#a7a795", crack: "#949987", sign: "#355d58",
  },
  districts: {
    downtown: { minHeight: 32, maxHeight: 65 },
    residential: { minHeight: 10, maxHeight: 23 },
  },
  // Larger floor/bay spacing produces fewer, more widely spaced facade openings.
  floorHeight: 6.5,
  maximumWindowRows: 10,
  maximumWindowColumns: 6,
  facades: {
    // Minimum projection between decorative layers; tiny offsets shimmer at driving distances.
    surfaceStep: .16,
    bayWidth: 7,
    windowWidth: 2.8,
    windowHeight: 3.8,
    sillProjection: .5,
    shopHeight: 5.3,
  },
  parkTrees: 28,
  streetDetails: {
    curbWidth: 0.65,
    curbHeight: 0.36,
    pavingJointSpacing: 14,
    cracksPerEdge: 1,
    pavingStripWidth: 6,
    curbJointSpacing: 28,
    gutterWidth: .65,
    entranceClearLength: 14,
    entranceClearHalfWidth: 3,
    treeCanopyRadius: 2.8,
  },
  lighting: {
    sky: "#9caeaf", sun: "#ffe0ad", ambient: "#abc6d5", ground: "#50636f",
    ambientIntensity: 0.72, sunIntensity: 0.8, signIntensity: 0.8,
    direction: [-0.8, -1, 0.45] as const,
  },
};

export function districtForBlock(bx: number, bz: number, blocksX: number, blocksZ: number): CityDistrict {
  const cx = Math.floor(blocksX / 2), cz = Math.floor(blocksZ / 2);
  if (Math.abs(bx - cx) <= 1 && Math.abs(bz - cz) <= 1) return "downtown";
  if (bx > cx + 1 && bx <= cx + 3 && bz >= cz - 1 && bz <= cz) return "park";
  return "residential";
}

export function visualSeed(name: string): number {
  let hash = 2166136261;
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

/** Writes colored faces directly, avoiding temporary scene meshes for every window or trim. */
export class CityGeometry {
  private positions: number[] = [];
  private indices: number[] = [];
  private colors: number[] = [];

  face(points: readonly Point3[], color: string): void {
    const offset = this.positions.length / 3;
    const c = Color3.FromHexString(color);
    for (const p of points) { this.positions.push(...p); this.colors.push(c.r, c.g, c.b, 1); }
    for (let i = 1; i < points.length - 1; i++) this.indices.push(offset, offset + i, offset + i + 1);
  }

  solid(points: readonly Point3[], faces: readonly (readonly number[])[], color: string): void {
    const center = [0, 0, 0];
    for (const p of points) for (let a = 0; a < 3; a++) center[a] += p[a] / points.length;
    for (const ids of faces) {
      const face = ids.map(i => points[i]);
      const [a,b,c] = face;
      const u = a.map((v,i) => v-b[i]), v = c.map((n,i) => n-b[i]);
      const normal = [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
      if (normal.reduce((dot,n,i) => dot+n*(a[i]-center[i]),0)<0) face.reverse();
      this.face(face,color);
    }
  }

  box(x: number,y: number,z: number,w: number,h: number,d: number,color: string): void {
    const a=w/2,b=h/2,c=d/2;
    this.solid([[x-a,y-b,z-c],[x+a,y-b,z-c],[x+a,y-b,z+c],[x-a,y-b,z+c],
      [x-a,y+b,z-c],[x+a,y+b,z-c],[x+a,y+b,z+c],[x-a,y+b,z+c]],
    [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]],color);
  }

  roof(x: number,y: number,z: number,w: number,d: number,rise: number,color: string): void {
    const a=w/2,b=d/2;
    this.solid([[x-a,y,z-b],[x+a,y,z-b],[x+a,y,z+b],[x-a,y,z+b],[x,y+rise,z-b],[x,y+rise,z+b]],
      [[0,1,2,3],[0,4,1],[3,2,5],[0,3,5,4],[1,4,5,2]],color);
  }

  tree(x: number,z: number,size: number,color: string): void {
    this.box(x,size*.22,z,1.3,size*.44,1.3,CITY_STYLE.palette.trunk);
    this.solid([[x-size*.28,size*.38,z],[x,size*.38,z-size*.28],[x+size*.28,size*.38,z],
      [x,size*.38,z+size*.28],[x,size,z],[x,size*.2,z]],
      [[0,1,4],[1,2,4],[2,3,4],[3,0,4],[1,0,5],[2,1,5],[3,2,5],[0,3,5]],color);
  }

  mesh(scene: Scene,name: string,material: StandardMaterial,x=0,z=0): Mesh {
    const normals: number[]=[];
    VertexData.ComputeNormals(this.positions,this.indices,normals);
    const data=new VertexData();
    Object.assign(data,{positions:this.positions,indices:this.indices,normals,colors:this.colors});
    const mesh=new Mesh(name,scene);data.applyToMesh(mesh);mesh.material=material;
    mesh.position.set(x,0,z);return mesh;
  }
}
