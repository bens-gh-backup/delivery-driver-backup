import type { RoadAxis } from "../game/types";
import { GAME_CONFIG } from "../game/config";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

/** One opaque texture per word, shared by every sign; no runtime text updates. */
export function serviceSignMaterial(scene: Scene, word: "GAS" | "REPAIR" | "CARS"): StandardMaterial {
  const material = new StandardMaterial(`service-lettering-${word}`, scene);
  material.disableLighting = true;
  // Physical clearance is primary. A small depth bias protects grazing/distant views.
  material.zOffset = -1;
  material.zOffsetUnits = -1;
  material.emissiveColor = Color3.White();
  if (typeof document !== "undefined") {
    const height = word === "GAS" ? 256 : 128;
    const texture = new DynamicTexture(`service-text-${word}`, { width: 1024, height }, scene, true);
    const context = texture.getContext() as CanvasRenderingContext2D;
    context.fillStyle = word === "GAS" ? "#14443e" : word === "REPAIR" ? "#552913" : "#223b62";
    context.fillRect(0, 0, 1024, height);
    context.fillStyle = "#fff5d8";
    context.font = `900 ${word === "GAS" ? 200 : 130}px Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(word, 512, height * .54, 930);
    texture.update();
    material.emissiveTexture = texture;
    material.diffuseTexture = texture;
  }
  return material;
}

/** Four correctly oriented faces stay readable from either road approach and up close. */
export function addServiceFascia(
  scene: Scene, name: string, x: number, y: number, z: number,
  width: number, depth: number, textWidth: number, height: number, material: StandardMaterial,
): Mesh[] {
  const gap = GAME_CONFIG.presentation.serviceSigns.surfaceGap;
  return [
    { x, z: z - depth / 2 - gap, rotation: 0, width },
    { x, z: z + depth / 2 + gap, rotation: Math.PI, width },
    { x: x - width / 2 - gap, z, rotation: Math.PI / 2, width: depth },
    { x: x + width / 2 + gap, z, rotation: -Math.PI / 2, width: depth },
  ].map((face, index) => {
    const mesh = MeshBuilder.CreatePlane(`${name}-${index}`, { width: Math.min(textWidth, face.width - 1), height }, scene);
    mesh.position.set(face.x, y, face.z);
    mesh.rotation.y = face.rotation;
    mesh.material = material;
    return mesh;
  });
}

/** Shared roadside silhouette: one blue post, one board, and two readable faces. */
export function addServiceBillboard(
  scene: Scene, name: string, x: number, z: number, word: "GAS" | "REPAIR",
  postMaterial: StandardMaterial, backingMaterial: StandardMaterial, lettering: StandardMaterial,
  roadAxis: RoadAxis = "northSouth",
): Mesh[] {
  const acrossX = roadAxis === "eastWest";
  const centerY = GAME_CONFIG.presentation.serviceSigns.billboardHeight;
  const width = word === "GAS" ? 14 : 24, height = 9, depth = 1.3;
  const postHeight = centerY - height / 2;
  const post = MeshBuilder.CreateBox(`${name}-billboard-post`, { width: 1.5, height: postHeight, depth: 1.5 }, scene);
  post.position.set(x, postHeight / 2, z); post.material = postMaterial;
  const board = MeshBuilder.CreateBox(`${name}-billboard`, { width: acrossX ? depth : width, height, depth: acrossX ? width : depth }, scene);
  board.position.set(x, centerY, z); board.material = backingMaterial;
  const faces = [-1, 1].map(side => {
    const face = MeshBuilder.CreatePlane(`${name}-billboard-text-${side}`, {
      width: width - 1.5, height: (width - 1.5) * (word === "GAS" ? .25 : .125),
    }, scene);
    const offset = side * (depth / 2 + GAME_CONFIG.presentation.serviceSigns.surfaceGap);
    face.position.set(x + (acrossX ? offset : 0), centerY, z + (acrossX ? 0 : offset));
    face.rotation.y = (side === -1 ? 0 : Math.PI) + (acrossX ? Math.PI / 2 : 0); face.material = lettering;
    return face;
  });
  return [post, board, ...faces];
}
