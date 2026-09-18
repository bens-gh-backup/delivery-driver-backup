import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { createColoredAsset } from "../graphics/ColoredAsset";
import type { NeighborhoodModel } from "../graphics/GraphicsMode";
import { TAILLIGHT_COLOR } from "./VehicleLightLayout";
import kit from "./assets/sedan.json";

/** One prototype per existing paint color; TrafficCar clones continue sharing its geometry. */
export function createBlenderSedanMesh(scene: Scene, name: string, material: StandardMaterial,
  bodyColor: Color3, width: number, length: number, model: Exclude<NeighborhoodModel,"procedural">) {
  const part = kit.parts[model === "blender6k" ? "sedan-6k" : "sedan-3k"];
  const palette = kit.roles.map((role, i) => role === "paint" ? bodyColor : role === "paint_light"
    ? Color3.Lerp(bodyColor, Color3.White(), .12) : role === "paint_dark" ? bodyColor.scale(.72)
    : role === "tail" ? new Color3(...TAILLIGHT_COLOR) : Color3.FromArray(kit.palette[i]));
  const mesh = createColoredAsset(scene, name, part, material, palette, [width/5.4,1,length/9.4]);
  mesh.metadata = { trafficModel: model };
  return mesh;
}
