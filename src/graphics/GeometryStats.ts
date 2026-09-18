import type { Scene } from "@babylonjs/core/scene";
import type { Buffer } from "@babylonjs/core/Buffers/buffer";
import type { DataBuffer } from "@babylonjs/core/Buffers/dataBuffer";

/** Geometry buffers only: excludes textures, JS objects, driver overhead and instance matrices. */
export function geometryBufferBytes(scene: Scene): number {
  let bytes = 0;
  const vertices = new Set<Buffer>(), indices = new Set<DataBuffer>();
  for (const geometry of scene.geometries) {
    for (const buffer of Object.values(geometry.getVertexBuffers() ?? {})) {
      const shared = buffer.getWrapperBuffer();
      if (vertices.has(shared)) continue;
      vertices.add(shared);
      const data = buffer.getData();
      bytes += data ? (Array.isArray(data) ? data.length * 4 : data.byteLength) : 0;
    }
    const index = geometry.getIndexBuffer();
    if (index && !indices.has(index)) {
      indices.add(index);
      bytes += geometry.getTotalIndices() * (index.is32Bits ? 4 : 2);
    }
  }
  return bytes;
}

export function renderedGeometry(scene: Scene) {
  let detailedHouses = 0, simpleHouses = 0;
  const active = scene.getActiveMeshes();
  for (let i = 0; i < active.length; i++) {
    const mesh = active.data[i];
    if (!mesh.isAnInstance || mesh.metadata?.buildingStyle !== "bungalow") continue;
    const selected = mesh.getLOD(scene.activeCamera!);
    if (selected?.metadata?.houseModel === "blender6k") detailedHouses++;
    else simpleHouses++;
  }
  // Babylon counts rendered LOD indices multiplied by actual instance count.
  return { triangles: scene.getActiveIndices() / 3, detailedHouses, simpleHouses };
}
