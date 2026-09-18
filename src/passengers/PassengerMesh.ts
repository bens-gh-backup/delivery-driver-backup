import "@babylonjs/core/Meshes/instancedMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { GAME_CONFIG } from "../game/config";
import passenger from "./assets/passenger.json";
import patient from "./assets/patient.json";

/** Four static palette sources, one opaque material, no per-person geometry or animation. */
export class PassengerMeshes {
  private readonly sources: Mesh[];
  private readonly material: StandardMaterial;

  constructor(scene: Scene, kind: "taxi" | "patient" = "taxi") {
    const asset = kind === "patient" ? patient : passenger;
    this.material = new StandardMaterial(`${kind}-person-colors`, scene);
    this.material.diffuseColor = Color3.White();
    this.material.specularColor = Color3.Black();
    this.sources = asset.themes.map((theme, index) => {
      const palette = theme.map(hex => Color3.FromHexString(hex));
      const data = new VertexData();
      data.positions = asset.positions; data.normals = asset.normals; data.indices = asset.indices;
      data.colors = asset.colorRoles.flatMap(role => [...palette[role].asArray(), 1]);
      const mesh = new Mesh(`${kind}-person-source-${index}`, scene);
      data.applyToMesh(mesh); mesh.material = this.material;
      mesh.useVertexColors = true; mesh.hasVertexAlpha = false;
      mesh.isVisible = false; mesh.isPickable = false;
      return mesh;
    });
  }

  create(id: string, palette: number, x: number, y: number, z: number, heading: number): InstancedMesh {
    const mesh = this.sources[palette % this.sources.length].createInstance(id);
    mesh.position.set(x, y, z); mesh.rotation.y = heading;
    mesh.scaling.setAll(GAME_CONFIG.passengers.modelWorldScale);
    mesh.isVisible = true; mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    return mesh;
  }

  dispose(): void { for (const mesh of this.sources) mesh.dispose(); this.material.dispose(); }
}
