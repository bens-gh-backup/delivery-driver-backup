import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";

export type Point3 = readonly [number, number, number];

/** Convex, planar faces with independent vertices for crisp, outward-facing normals. */
export function createFacetedMesh(scene: Scene, name: string, points: readonly Point3[], faces: readonly (readonly number[])[]): Mesh {
  const center = [0, 0, 0];
  for (const p of points) for (let a = 0; a < 3; a++) center[a] += p[a] / points.length;
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [], normals: number[] = [];
  for (const source of faces) {
    const face = [...source];
    const [a, b, c] = face.map(i => points[i]);
    const u = a.map((v, i) => v - b[i]), v = c.map((n, i) => n - b[i]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (normal.reduce((dot, n, i) => dot + n * (a[i] - center[i]), 0) < 0) face.reverse();
    const offset = positions.length / 3;
    for (const index of face) { positions.push(...points[index]); uvs.push(0, 0); }
    for (let i = 1; i < face.length - 1; i++) indices.push(offset, offset + i, offset + i + 1);
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  Object.assign(data, { positions, indices, normals, uvs });
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  return mesh;
}

export function createLoftMesh(scene: Scene, name: string, rings: readonly (readonly Point3[])[]): Mesh {
  const count = rings[0].length;
  const faces: number[][] = [Array.from({ length: count }, (_, i) => i)];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      faces.push([r * count + i, r * count + next, (r + 1) * count + next, (r + 1) * count + i]);
    }
  }
  faces.push(Array.from({ length: count }, (_, i) => (rings.length - 1) * count + i));
  return createFacetedMesh(scene, name, rings.flat(), faces);
}

export function beveledRing(width: number, depth: number, y: number, bevel: number): Point3[] {
  const x = width / 2, z = depth / 2, b = Math.min(bevel, x * 0.4, z * 0.4);
  return [[-x + b, y, -z], [x - b, y, -z], [x, y, -z + b], [x, y, z - b],
    [x - b, y, z], [-x + b, y, z], [-x, y, z - b], [-x, y, -z + b]];
}
