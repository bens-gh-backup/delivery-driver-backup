import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { createColoredAsset } from "../graphics/ColoredAsset";
import type { NeighborhoodModel } from "../graphics/GraphicsMode";
import { CITY_STYLE, visualSeed, type BuildingLot } from "./CityStyle";
import kit from "./assets/houses.json";
import "@babylonjs/core/Meshes/instancedMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { GAME_CONFIG } from "../game/config";

const prototypes = new WeakMap<Scene, Map<string, Mesh>>();

const palettes = CITY_STYLE.palette.residential.map(hex => {
  const paint = Color3.FromHexString(hex);
  return kit.roles.map((role, i) => role === "paint" ? paint : role === "paint_light"
    ? Color3.Lerp(paint, Color3.White(), .10) : role === "paint_dark" ? paint.scale(.72)
    : Color3.FromArray(kit.palette[i]));
});

/** Includes roof, porch and steps inside the existing lot; placement and colliders are unchanged. */
export function createBlenderHouse(scene: Scene, name: string, lot: BuildingLot,
  material: StandardMaterial, model: Exclude<NeighborhoodModel, "procedural">) {
  const stories = lot.height > 16 ? 2 : 1;
  const key = `house-${model === "blender6k" ? "6k" : "3k"}-${stories}floor` as keyof typeof kit.parts;
  const part = kit.parts[key], { min, max } = part.bounds;
  const width = lot.facing % 2 === 0 ? lot.width : lot.depth;
  const depth = lot.facing % 2 === 0 ? lot.depth : lot.width;
  const scale = [width/(max[0]-min[0]), lot.height/(max[1]-min[1]), depth/(max[2]-min[2])];
  const offset = [-(min[0]+max[0])/2*scale[0], -min[1]*scale[1], -(min[2]+max[2])/2*scale[2]];
  const variant = visualSeed(name) % palettes.length;
  const mesh = createColoredAsset(scene, name, part, material, palettes[variant], scale, offset);
  mesh.position.set(lot.x, 0, lot.z); mesh.rotation.y = lot.facing*Math.PI/2;
  mesh.metadata = { district: "residential", buildingStyle: "bungalow", houseModel: model, stories, variant };
  return mesh;
}

/** Normalized shared prototypes keep both LODs in the exact same lot envelope. */
export function createInstancedHouse(scene: Scene, name: string, lot: BuildingLot,
  material: StandardMaterial, model: Exclude<NeighborhoodModel, "procedural">) {
  let cache = prototypes.get(scene);
  if (!cache) { cache = new Map(); prototypes.set(scene, cache); }
  const stories = lot.height > 16 ? 2 : 1, variant = visualSeed(name) % palettes.length;
  const useLod = model === "blender6k" && (scene.metadata?.houseLod ?? GAME_CONFIG.graphics.houseLodEnabled);
  function prototype(tier: "blender3k" | "blender6k"): Mesh {
    const key = `${material.uniqueId}-${tier}-${stories}-${variant}`;
    const existing = cache!.get(key);
    if (existing) return existing;
    const part = kit.parts[`house-${tier === "blender6k" ? "6k" : "3k"}-${stories}floor`];
    const { min, max } = part.bounds;
    const scale = max.map((v, i) => 1 / (v - min[i]));
    const offset = [-(min[0]+max[0])/2*scale[0], -min[1]*scale[1], -(min[2]+max[2])/2*scale[2]];
    const mesh = createColoredAsset(scene, `house-prototype-${key}`, part, material, palettes[variant], scale, offset);
    mesh.isVisible = false;
    // The instanced shader inherits this flag from its source. Every lot has nonuniform scale.
    // The source itself is hidden; individual instance matrices set the actual dimensions.
    mesh.scaling.set(1, 2, 1);
    mesh.computeWorldMatrix(true); mesh.freezeWorldMatrix();
    mesh.metadata = { housePrototype: true, houseModel: tier, stories, variant };
    cache!.set(key, mesh);
    return mesh;
  }
  const source = prototype(model);
  if (useLod && source.getLODLevels().length === 0) {
    source.addLODLevel(scene.metadata?.houseLodDistance ?? GAME_CONFIG.graphics.houseLodDistance, prototype("blender3k"));
  }
  const instance = source.createInstance(name);
  instance.position.set(lot.x, 0, lot.z);
  instance.rotation.y = lot.facing * Math.PI / 2;
  instance.scaling.set(lot.facing % 2 === 0 ? lot.width : lot.depth, lot.height,
    lot.facing % 2 === 0 ? lot.depth : lot.width);
  instance.isPickable = false;
  instance.computeWorldMatrix(true); instance.freezeWorldMatrix();
  instance.metadata = { district: "residential", buildingStyle: "bungalow", houseModel: model, stories, variant };
  return instance;
}

export async function warmHouseShaders(scene: Scene): Promise<void> {
  const warmed = new Set<number>();
  for (const source of prototypes.get(scene)?.values() ?? []) {
    // Both tiers share the same opaque shader and vertex attributes. Compile once per material.
    const material = source.material;
    if (!material || warmed.has(material.uniqueId)) continue;
    await material.forceCompilationAsync(source, { useInstances: true });
    warmed.add(material.uniqueId);
  }
}
