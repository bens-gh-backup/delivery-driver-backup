import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { GAME_CONFIG } from "../game/config";
import type { Direction } from "./TrafficCar";

export type TrafficSignalAspect = "green" | "yellow" | "red";
export type TrafficSignalPhase =
  | "northSouthGreen"
  | "northSouthYellow"
  | "allRedToEastWest"
  | "eastWestGreen"
  | "eastWestYellow"
  | "allRedToNorthSouth";

interface SignalMeshes {
  northSouthRed: Mesh;
  northSouthYellow: Mesh;
  northSouthGreen: Mesh;
  eastWestRed: Mesh;
  eastWestYellow: Mesh;
  eastWestGreen: Mesh;
}

export function trafficSignalPhaseAt(elapsedSeconds: number): TrafficSignalPhase {
  const { greenSeconds, yellowSeconds, allRedSeconds } = GAME_CONFIG.trafficSignals;
  const halfCycle = greenSeconds + yellowSeconds + allRedSeconds;
  const cycleSeconds = halfCycle * 2;
  const time = ((elapsedSeconds % cycleSeconds) + cycleSeconds) % cycleSeconds;
  if (time < greenSeconds) return "northSouthGreen";
  if (time < greenSeconds + yellowSeconds) return "northSouthYellow";
  if (time < halfCycle) return "allRedToEastWest";
  if (time < halfCycle + greenSeconds) return "eastWestGreen";
  if (time < halfCycle + greenSeconds + yellowSeconds) return "eastWestYellow";
  return "allRedToNorthSouth";
}

export function trafficSignalAspect(
  phase: TrafficSignalPhase,
  direction: Direction,
): TrafficSignalAspect {
  const northSouth = direction === "north" || direction === "south";
  if (phase === "northSouthGreen") return northSouth ? "green" : "red";
  if (phase === "northSouthYellow") return northSouth ? "yellow" : "red";
  if (phase === "eastWestGreen") return northSouth ? "red" : "green";
  if (phase === "eastWestYellow") return northSouth ? "red" : "yellow";
  return "red";
}

export class TrafficSignalController {
  readonly intersectionCount: number;
  private elapsedSeconds = 0;
  private phaseValue: TrafficSignalPhase = trafficSignalPhaseAt(0);
  private readonly materials: StandardMaterial[];
  private readonly ownedMeshes: Mesh[];
  private readonly signalMeshes: SignalMeshes;

  constructor(
    scene: Scene,
    roadPositionsX: readonly number[],
    roadPositionsZ: readonly number[],
  ) {
    this.intersectionCount = roadPositionsX.length * roadPositionsZ.length;
    const dark = this.material(scene, "traffic-signal-hardware", new Color3(0.045, 0.055, 0.05));
    const line = this.material(scene, "traffic-signal-stop-line", new Color3(0.88, 0.88, 0.76));
    const red = this.emissiveMaterial(scene, "traffic-signal-red", new Color3(1, 0.06, 0.025));
    const yellow = this.emissiveMaterial(scene, "traffic-signal-yellow", new Color3(1, 0.62, 0.02));
    const green = this.emissiveMaterial(scene, "traffic-signal-green", new Color3(0.04, 0.9, 0.18));
    this.materials = [dark, line, red, yellow, green];

    const hardware: Mesh[] = [];
    const stopLines: Mesh[] = [];
    const northSouthRed: Mesh[] = [];
    const northSouthYellow: Mesh[] = [];
    const northSouthGreen: Mesh[] = [];
    const eastWestRed: Mesh[] = [];
    const eastWestYellow: Mesh[] = [];
    const eastWestGreen: Mesh[] = [];

    for (const x of roadPositionsX) {
      for (const z of roadPositionsZ) {
        for (const direction of ["north", "south", "east", "west"] as const) {
          const northSouth = direction === "north" || direction === "south";
          this.createApproachVisual(
            scene,
            x,
            z,
            direction,
            dark,
            line,
            hardware,
            stopLines,
            northSouth ? northSouthRed : eastWestRed,
            northSouth ? northSouthYellow : eastWestYellow,
            northSouth ? northSouthGreen : eastWestGreen,
            red,
            yellow,
            green,
          );
        }
      }
    }

    const hardwareMesh = this.merge(hardware, "traffic-signal-hardware-merged");
    const stopLineMesh = this.merge(stopLines, "traffic-signal-stop-lines-merged");
    this.signalMeshes = {
      northSouthRed: this.merge(northSouthRed, "traffic-signals-ns-red"),
      northSouthYellow: this.merge(northSouthYellow, "traffic-signals-ns-yellow"),
      northSouthGreen: this.merge(northSouthGreen, "traffic-signals-ns-green"),
      eastWestRed: this.merge(eastWestRed, "traffic-signals-ew-red"),
      eastWestYellow: this.merge(eastWestYellow, "traffic-signals-ew-yellow"),
      eastWestGreen: this.merge(eastWestGreen, "traffic-signals-ew-green"),
    };
    this.ownedMeshes = [hardwareMesh, stopLineMesh, ...Object.values(this.signalMeshes)];
    for (const mesh of this.ownedMeshes) {
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
    }
    for (const material of this.materials) material.freeze();
    this.applyVisualPhase();
  }

  get phase(): TrafficSignalPhase {
    return this.phaseValue;
  }

  aspectFor(direction: Direction): TrafficSignalAspect {
    return trafficSignalAspect(this.phaseValue, direction);
  }

  update(deltaTime: number): void {
    this.elapsedSeconds += Math.max(0, deltaTime);
    const nextPhase = trafficSignalPhaseAt(this.elapsedSeconds);
    if (nextPhase === this.phaseValue) return;
    this.phaseValue = nextPhase;
    this.applyVisualPhase();
  }

  dispose(): void {
    for (const mesh of this.ownedMeshes) mesh.dispose();
    for (const material of this.materials) material.dispose();
  }

  private applyVisualPhase(): void {
    const ns = trafficSignalAspect(this.phaseValue, "north");
    const ew = trafficSignalAspect(this.phaseValue, "east");
    this.signalMeshes.northSouthRed.setEnabled(ns === "red");
    this.signalMeshes.northSouthYellow.setEnabled(ns === "yellow");
    this.signalMeshes.northSouthGreen.setEnabled(ns === "green");
    this.signalMeshes.eastWestRed.setEnabled(ew === "red");
    this.signalMeshes.eastWestYellow.setEnabled(ew === "yellow");
    this.signalMeshes.eastWestGreen.setEnabled(ew === "green");
  }

  private createApproachVisual(
    scene: Scene,
    intersectionX: number,
    intersectionZ: number,
    direction: Direction,
    hardwareMaterial: StandardMaterial,
    lineMaterial: StandardMaterial,
    hardware: Mesh[],
    stopLines: Mesh[],
    redLamps: Mesh[],
    yellowLamps: Mesh[],
    greenLamps: Mesh[],
    redMaterial: StandardMaterial,
    yellowMaterial: StandardMaterial,
    greenMaterial: StandardMaterial,
  ): void {
    const roadHalf = GAME_CONFIG.world.roadWidth / 2;
    const laneOffset = GAME_CONFIG.traffic.laneOffset;
    const cornerInset = 2;
    const headInset = 4;
    let headX = intersectionX;
    let headZ = intersectionZ;
    let poleX = intersectionX;
    let poleZ = intersectionZ;
    let heading = 0;

    if (direction === "east") {
      headX += roadHalf - headInset;
      headZ -= laneOffset;
      poleX += roadHalf - headInset;
      poleZ -= roadHalf - cornerInset;
      heading = Math.PI / 2;
    } else if (direction === "west") {
      headX -= roadHalf - headInset;
      headZ += laneOffset;
      poleX -= roadHalf - headInset;
      poleZ += roadHalf - cornerInset;
      heading = -Math.PI / 2;
    } else if (direction === "north") {
      headX -= laneOffset;
      headZ -= roadHalf - headInset;
      poleX -= roadHalf - cornerInset;
      poleZ -= roadHalf - headInset;
      heading = Math.PI;
    } else {
      headX += laneOffset;
      headZ += roadHalf - headInset;
      poleX += roadHalf - cornerInset;
      poleZ += roadHalf - headInset;
    }

    const poleHeight = 12;
    const headY = 9.3;
    const pole = MeshBuilder.CreateBox("traffic-signal-pole", {
      width: 0.45,
      height: poleHeight,
      depth: 0.45,
    }, scene);
    pole.position.set(poleX, poleHeight / 2, poleZ);
    pole.material = hardwareMaterial;
    hardware.push(pole);

    const arm = MeshBuilder.CreateBox("traffic-signal-arm", {
      width: Math.max(0.45, Math.abs(headX - poleX) + 0.45),
      height: 0.4,
      depth: Math.max(0.45, Math.abs(headZ - poleZ) + 0.45),
    }, scene);
    arm.position.set((headX + poleX) / 2, poleHeight - 0.25, (headZ + poleZ) / 2);
    arm.material = hardwareMaterial;
    hardware.push(arm);

    const housing = MeshBuilder.CreateBox("traffic-signal-housing", {
      width: 2.2,
      height: 4.6,
      depth: 0.9,
    }, scene);
    housing.position.set(headX, headY, headZ);
    housing.rotation.y = heading;
    housing.material = hardwareMaterial;
    hardware.push(housing);

    const travel = directionVector(direction);
    const lampX = headX - travel.x * 0.52;
    const lampZ = headZ - travel.z * 0.52;
    for (const [heightOffset, material, group] of [
      [1.35, redMaterial, redLamps],
      [0, yellowMaterial, yellowLamps],
      [-1.35, greenMaterial, greenLamps],
    ] as const) {
      const lamp = MeshBuilder.CreateBox("traffic-signal-lamp", {
        width: 0.9,
        height: 0.9,
        depth: 0.18,
      }, scene);
      lamp.position.set(lampX, headY + heightOffset, lampZ);
      lamp.rotation.y = heading;
      lamp.material = material;
      group.push(lamp);
    }

    const setback = GAME_CONFIG.trafficSignals.stopLineSetback;
    const laneWidth = roadHalf - 4;
    const stopLine = MeshBuilder.CreateBox("traffic-signal-stop-line", {
      width: direction === "east" || direction === "west" ? 0.7 : laneWidth,
      height: 0.04,
      depth: direction === "north" || direction === "south" ? 0.7 : laneWidth,
    }, scene);
    if (direction === "east") {
      stopLine.position.set(intersectionX - roadHalf - setback, 0.13, intersectionZ - roadHalf / 2);
    } else if (direction === "west") {
      stopLine.position.set(intersectionX + roadHalf + setback, 0.13, intersectionZ + roadHalf / 2);
    } else if (direction === "north") {
      stopLine.position.set(intersectionX - roadHalf / 2, 0.13, intersectionZ + roadHalf + setback);
    } else {
      stopLine.position.set(intersectionX + roadHalf / 2, 0.13, intersectionZ - roadHalf - setback);
    }
    stopLine.material = lineMaterial;
    stopLines.push(stopLine);
  }

  private merge(meshes: Mesh[], name: string): Mesh {
    const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (!merged) throw new Error(`Unable to merge ${name}`);
    merged.name = name;
    return merged;
  }

  private material(scene: Scene, name: string, color: Color3): StandardMaterial {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = color;
    material.specularColor = Color3.Black();
    return material;
  }

  private emissiveMaterial(scene: Scene, name: string, color: Color3): StandardMaterial {
    const material = this.material(scene, name, color.scale(0.45));
    material.emissiveColor = color;
    return material;
  }
}

function directionVector(direction: Direction): { x: number; z: number } {
  if (direction === "north") return { x: 0, z: -1 };
  if (direction === "south") return { x: 0, z: 1 };
  if (direction === "west") return { x: -1, z: 0 };
  return { x: 1, z: 0 };
}
