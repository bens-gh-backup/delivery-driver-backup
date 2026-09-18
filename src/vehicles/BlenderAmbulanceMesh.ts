import type { Scene } from "@babylonjs/core/scene";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { createStaticVehiclePart } from "./BlenderCabMesh";
import ambulance from "./assets/ambulance.json";

export function createBlenderAmbulanceMeshes(scene: Scene, material: StandardMaterial,
  dimensions: { bodyWidth: number; bodyLength: number }, lightMaterials: StandardMaterial[]) {
  const body = createStaticVehiclePart(scene, "ambulance-body", material, dimensions,
    ambulance.body, ambulance.body, true, "blender-ambulance");
  const lights = ambulance.lights.map((part, index) => createStaticVehiclePart(scene,
    `ambulance-lens-${index}`, lightMaterials[index], dimensions, part, ambulance.body, false, "ambulance-lens"));
  return { body, lights };
}
