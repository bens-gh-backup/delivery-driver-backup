import { Color3 } from "@babylonjs/core/Maths/math.color";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { Scene } from "@babylonjs/core/scene";
import { GAME_CONFIG } from "../game/config";
import type { TrafficCar, TurnSignal } from "./TrafficCar";
import { TAILLIGHT_COLOR, vehicleLightLayout } from "../vehicles/VehicleLightLayout";

/** Shared geometry/material; at most two instanced draws for all NPC indicators. */
export class TrafficTurnSignals {
  private readonly material: StandardMaterial;
  private readonly sources: Mesh[];
  private readonly entries: {
    car: TrafficCar;
    lamps: InstancedMesh[];
    signal: TurnSignal;
    generation: number;
    elapsed: number;
  }[];

  constructor(scene: Scene, cars: readonly TrafficCar[]) {
    const config = GAME_CONFIG.traffic.turnSignals;
    this.material = new StandardMaterial("npc-turn-signal", scene);
    this.material.disableLighting = true;
    this.material.emissiveColor = Color3.White();
    this.material.diffuseColor = Color3.Black();
    this.material.specularColor = Color3.Black();
    // Draw over the identical lamp faces without enlarging or moving them.
    this.material.zOffset = -1;
    this.material.freeze();
    this.sources = [-1, 1].map((side) => {
      const parts: Mesh[] = [];
      for (const end of [-1, 1]) {
        const layout = vehicleLightLayout(GAME_CONFIG.traffic.vehicleWidth, GAME_CONFIG.traffic.vehicleLength, 1.5, side, end === 1);
        const lamp = MeshBuilder.CreateBox("signal-corner", layout, scene);
        lamp.position.set(layout.x, layout.y, layout.z);
        const color = end === 1 ? config.color : TAILLIGHT_COLOR;
        lamp.setVerticesData(VertexBuffer.ColorKind,
          Array.from({ length: lamp.getTotalVertices() }, () => [...color, 1]).flat());
        parts.push(lamp);
      }
      const source = Mesh.MergeMeshes(parts, true, true)!;
      source.name = side === -1 ? "npc-left-signal" : "npc-right-signal";
      source.material = this.material;
      source.useVertexColors = true;
      source.isVisible = false;
      source.isPickable = false;
      return source;
    });
    this.entries = cars.map((car) => ({
      car, signal: "off", generation: car.respawnGeneration, elapsed: 0,
      lamps: this.sources.map((source) => {
        const lamp = source.createInstance(`${source.name}-${car.id}`);
        lamp.parent = car.mesh;
        lamp.isPickable = false;
        lamp.setEnabled(false);
        return lamp;
      }),
    }));
  }

  update(deltaTime: number): void {
    const halfPeriod = GAME_CONFIG.traffic.turnSignals.blinkHalfPeriod;
    for (const entry of this.entries) {
      const { car, lamps } = entry;
      car.refreshTurnSignal();
      if (entry.generation !== car.respawnGeneration || entry.signal !== car.turnSignal) {
        entry.elapsed = 0;
        entry.signal = car.turnSignal;
        entry.generation = car.respawnGeneration;
      } else {
        entry.elapsed = (entry.elapsed + deltaTime) % (2 * halfPeriod);
      }
      const on = car.mesh.isEnabled() && entry.elapsed < halfPeriod;
      lamps[0].setEnabled(on && entry.signal === "left");
      lamps[1].setEnabled(on && entry.signal === "right");
    }
  }

  dispose(): void {
    for (const entry of this.entries) for (const lamp of entry.lamps) lamp.dispose();
    for (const source of this.sources) source.dispose();
    this.material.dispose();
  }
}
