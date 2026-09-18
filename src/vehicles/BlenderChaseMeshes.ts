import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { WORLD_SURFACES } from "../world/SurfaceLayout";
import type { Scene } from "@babylonjs/core/scene";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { GAME_CONFIG } from "../game/config";
import { createStaticVehiclePart } from "./BlenderCabMesh";
import police from "./assets/police.json";
import suspect from "./assets/suspect.json";

export function createBlenderPoliceMeshes(scene: Scene, material: StandardMaterial,
  dimensions: { bodyWidth: number; bodyLength: number }, lightMaterials: StandardMaterial[]) {
  const body = createStaticVehiclePart(scene,"police-body",material,dimensions,police.body,police.body,true,"blender-police");
  const lights = police.lights.map((part,index)=>createStaticVehiclePart(scene,`police-lens-${index}`,
    lightMaterials[index],dimensions,part,police.body,false,"police-lens"));
  return {body,lights};
}

export function createSuspectPrototype(scene: Scene, material: StandardMaterial) {
  const size={bodyWidth:GAME_CONFIG.traffic.vehicleWidth,bodyLength:GAME_CONFIG.traffic.vehicleLength};
  const body=createStaticVehiclePart(scene,"getaway-prototype",material,size,suspect.body,suspect.body,true,"blender-getaway");
  const gunner=createStaticVehiclePart(scene,"getaway-gunner",material,size,suspect.lights[0],suspect.body,false,"getaway-gunner");
  gunner.parent=body;
  body.setEnabled(false);
  return body;
}

/** Rearmost face of the separate gunner mesh is the barrel tip. Match the baked body transform. */
export function getSuspectMuzzleOffset(): Vector3 {
  const part = suspect.lights[0], bounds = suspect.body;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < part.positions.length; i += 3) {
    if (Math.abs(part.positions[i + 2] - part.minimum[2]) > .0001) continue;
    minX = Math.min(minX, part.positions[i]); maxX = Math.max(maxX, part.positions[i]);
    minY = Math.min(minY, part.positions[i + 1]); maxY = Math.max(maxY, part.positions[i + 1]);
  }
  const sx = GAME_CONFIG.traffic.vehicleWidth / (bounds.maximum[0] - bounds.minimum[0]);
  const sz = GAME_CONFIG.traffic.vehicleLength / (bounds.maximum[2] - bounds.minimum[2]);
  return new Vector3(((minX + maxX) / 2 - (bounds.minimum[0] + bounds.maximum[0]) / 2) * sx,
    ((minY + maxY) / 2 - bounds.minimum[1]) * sz + WORLD_SURFACES.road - .9 + .015,
    (part.minimum[2] - (bounds.minimum[2] + bounds.maximum[2]) / 2) * sz - .06);
}
