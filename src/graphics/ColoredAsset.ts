import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Color3 } from "@babylonjs/core/Maths/math.color";

export interface ColoredAsset {
  positions: number[]; normals: number[]; indices: number[]; roles: number[];
  bounds: { min: number[]; max: number[] }; triangles: number;
}

/** Static, opaque geometry. Transform once at construction, never during the frame loop. */
export function createColoredAsset(scene: Scene, name: string, source: ColoredAsset,
  material: StandardMaterial, palette: readonly Color3[],
  scale: readonly number[] = [1,1,1], offset: readonly number[] = [0,0,0]): Mesh {
  const positions = new Float32Array(source.positions.length), normals = new Float32Array(positions.length);
  const colors = new Float32Array(source.roles.length * 4);
  for (let i = 0; i < positions.length; i += 3) {
    let lengthSquared = 0;
    for (let axis = 0; axis < 3; axis++) {
      positions[i+axis] = source.positions[i+axis] * scale[axis] + offset[axis];
      const n = source.normals[i+axis] / scale[axis];
      normals[i+axis] = n; lengthSquared += n*n;
    }
    const inverseLength = 1 / Math.sqrt(lengthSquared);
    for (let axis = 0; axis < 3; axis++) normals[i+axis] *= inverseLength;
    const color = palette[source.roles[i/3]], c = i/3*4;
    colors[c] = color.r; colors[c+1] = color.g; colors[c+2] = color.b; colors[c+3] = 1;
  }
  const data = new VertexData(); Object.assign(data, { positions, normals, colors, indices: source.indices });
  const mesh = new Mesh(name, scene); data.applyToMesh(mesh);
  mesh.material = material; mesh.useVertexColors = true; mesh.hasVertexAlpha = false; mesh.isPickable = false;
  return mesh;
}
