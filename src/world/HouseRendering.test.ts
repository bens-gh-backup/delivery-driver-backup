import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { createBlenderHouse, createInstancedHouse } from "./BlenderHouse";
import { resolveWorldRendering } from "../graphics/GraphicsMode";
import { TownGenerator } from "./Town";
import type { BuildingLot } from "./CityStyle";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(fn => fn()));
function fixture() {
  const engine = new NullEngine(), scene = new Scene(engine), material = new StandardMaterial("house", scene);
  cleanups.push(() => { scene.dispose(); engine.dispose(); });
  return { scene, material };
}
const lot: BuildingLot = { x: 13, z: 27, width: 28, depth: 36, height: 23, facing: 0, district: "residential", landmark: false };

describe("shared house rendering", () => {
  it("preserves high-detail positions and transformed normals at every orientation", () => {
    const { scene, material } = fixture();
    for (const height of [10, 23]) for (let facing = 0; facing < 4; facing++) {
      const dimensions = { ...lot, height, facing };
      const original = createBlenderHouse(scene, "same-color", dimensions, material, "blender6k");
      const instance = createInstancedHouse(scene, "same-color", dimensions, material, "blender6k");
      original.computeWorldMatrix(true);
      const originalNormal = Matrix.Transpose(Matrix.Invert(original.getWorldMatrix()));
      const instanceNormal = Matrix.Transpose(Matrix.Invert(instance.getWorldMatrix()));
      for (const kind of [VertexBuffer.PositionKind, VertexBuffer.NormalKind]) {
        const a = original.getVerticesData(kind)!, b = instance.getVerticesData(kind)!;
        expect(a.length).toBe(b.length);
        // Sample across the asset, including detailed roof/porch geometry.
        for (let i = 0; i < a.length; i += 39) {
          const va = Vector3.FromArray(a, i), vb = Vector3.FromArray(b, i);
          const pa = kind === VertexBuffer.PositionKind ? Vector3.TransformCoordinates(va, original.getWorldMatrix()) : Vector3.TransformNormal(va, originalNormal).normalize();
          const pb = kind === VertexBuffer.PositionKind ? Vector3.TransformCoordinates(vb, instance.getWorldMatrix()) : Vector3.TransformNormal(vb, instanceNormal).normalize();
          expect(Vector3.Distance(pa, pb)).toBeLessThan(.0001);
        }
      }
      expect(instance.sourceMesh.nonUniformScaling).toBe(true);
      expect(instance.sourceMesh.isVisible).toBe(false);
      expect(instance.getVerticesData(VertexBuffer.ColorKind)).toEqual(original.getVerticesData(VertexBuffer.ColorKind));
    }
  });

  it("shares buffers across lots and selects each instance's LOD using its own position", () => {
    const { scene, material } = fixture();
    const a = createInstancedHouse(scene, "same", lot, material, "blender6k");
    const b = createInstancedHouse(scene, "same", { ...lot, x: lot.x + 800 }, material, "blender6k");
    const camera = new UniversalCamera("camera", new Vector3(lot.x, 20, lot.z - 40), scene);
    camera.getViewMatrix();
    expect(a.sourceMesh).toBe(b.sourceMesh);
    expect(scene.geometries).toHaveLength(2);
    expect(a.getLOD(camera)?.metadata.houseModel).toBe("blender6k");
    expect(b.getLOD(camera)?.metadata.houseModel).toBe("blender3k");
    const before = scene.geometries.length;
    for (const distance of [100, 299, 301, 600, 100]) {
      camera.position.set(lot.x, lot.height / 2, lot.z - distance); camera.getViewMatrix();
      expect(a.getLOD(camera)?.metadata.houseModel).toBe(distance > 300 ? "blender3k" : "blender6k");
    }
    expect(scene.geometries).toHaveLength(before);
  });

  it("respects comparison modes without silently adding a higher detail tier", () => {
    const { scene, material } = fixture();
    scene.metadata = { houseLod: false };
    const house = createInstancedHouse(scene, "one", lot, material, "blender6k");
    expect(house.sourceMesh.getLODLevels()).toHaveLength(0);
    const low = createInstancedHouse(scene, "two", lot, material, "blender3k");
    expect(low.sourceMesh.getLODLevels()).toHaveLength(0);
    expect(resolveWorldRendering("?houseInstances=off&houseLod=off&worldChunks=2").houseInstancing).toBe(true);
    expect(resolveWorldRendering("?debug&houseInstances=off&houseLod=off&worldChunks=2"))
      .toMatchObject({ houseInstancing: false, houseLod: false, worldChunkBlocks: 2 });
  });

  it("builds identical gameplay data synchronously and incrementally with bounded shared geometry", async () => {
    const a = fixture(), b = fixture();
    const sync = new TownGenerator(a.scene).generate();
    const progress: number[] = [];
    let yields = 0;
    const asyncTown = await new TownGenerator(b.scene).generateAsync({ budgetMs: 0,
      yieldToBrowser: async () => { yields++; }, onProgress: p => progress.push(p) });
    const { meshes: first, ...firstData } = sync, { meshes: second, ...secondData } = asyncTown;
    expect(secondData).toEqual(firstData);
    expect(yields).toBeGreaterThan(100);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true);
    expect(first.length).toBe(second.length);
    const sources = a.scene.meshes.filter(m => m.metadata?.housePrototype);
    expect(sources.length).toBeLessThanOrEqual(16);
    expect(first.filter(m => m.isAnInstance)).toHaveLength(623);
    expect(sources.every(m => !m.isVisible)).toBe(true);
  });
});
