import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { WORLD_SURFACES } from "../world/SurfaceLayout";
import cab from "./assets/cab.json";

/** The exported Blender geometry uses the same single-material renderer as other cars. */
export function createBlenderCabMesh(
  scene: Scene, name: string, material: StandardMaterial,
  dimensions: { bodyWidth: number; bodyLength: number },
): Mesh {
  return createStaticVehiclePart(scene, name, material, dimensions, cab, cab, true, "blender-cab");
}

interface StaticVehicleGeometry {
  minimum: number[]; maximum: number[];
  positions: number[]; normals: number[]; colors: number[]; indices: number[];
}

/** All parts share the body transform, including the separate emergency lenses. */
export function createStaticVehiclePart(scene: Scene, name: string, material: StandardMaterial,
  dimensions: { bodyWidth: number; bodyLength: number }, asset: StaticVehicleGeometry,
  bounds: Pick<StaticVehicleGeometry, "minimum" | "maximum">, shadow: boolean, model: string): Mesh {
  // Fit the existing collision footprint, including mirrors. Preserve the model's
  // height/length ratio rather than squashing the new silhouette to the old roof.
  const sx = dimensions.bodyWidth / (bounds.maximum[0] - bounds.minimum[0]);
  const sz = dimensions.bodyLength / (bounds.maximum[2] - bounds.minimum[2]);
  const sy = sz;
  const ground = WORLD_SURFACES.road - 0.9 + 0.015; // Player root is 0.9 above ground.
  const positions = new Float32Array(asset.positions.length + (shadow ? 8 * 3 : 0));
  const normals = new Float32Array(asset.normals.length + (shadow ? 8 * 3 : 0));
  const colors = new Float32Array(asset.colors.length + (shadow ? 8 * 4 : 0));
  const indices = new Uint16Array(asset.indices.length + (shadow ? 6 * 3 : 0));
  const centerX = (bounds.minimum[0] + bounds.maximum[0]) / 2;
  const centerZ = (bounds.minimum[2] + bounds.maximum[2]) / 2;
  for (let i = 0; i < asset.positions.length; i += 3) {
    positions[i] = (asset.positions[i] - centerX) * sx;
    positions[i + 1] = (asset.positions[i + 1] - bounds.minimum[1]) * sy + ground;
    positions[i + 2] = (asset.positions[i + 2] - centerZ) * sz;
    // Inverse-transpose scaling keeps beveled surfaces lit correctly.
    const nx = asset.normals[i] / sx, ny = asset.normals[i + 1] / sy, nz = asset.normals[i + 2] / sz;
    const length = Math.hypot(nx, ny, nz);
    normals[i] = nx / length; normals[i + 1] = ny / length; normals[i + 2] = nz / length;
  }
  colors.set(asset.colors);
  indices.set(asset.indices);
  // One opaque octagon under the chassis; no extra draw call or shadow light.
  if (shadow) {
    const first = asset.positions.length / 3;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      positions.set([Math.cos(angle) * dimensions.bodyWidth * .40, ground - .005,
        Math.sin(angle) * dimensions.bodyLength * .43], (first + i) * 3);
      normals.set([0, 1, 0], (first + i) * 3);
      colors.set([.025, .027, .029, 1], (first + i) * 4);
    }
    for (let i = 1; i < 7; i++) indices.set([first, first + i, first + i + 1], asset.indices.length + (i - 1) * 3);
  }
  const data = new VertexData();
  data.positions = positions; data.normals = normals; data.colors = colors; data.indices = indices;
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  mesh.material = material;
  mesh.useVertexColors = true;
  mesh.hasVertexAlpha = false;
  mesh.isPickable = false;
  mesh.metadata = { vehicleModel: model };
  return mesh;
}
