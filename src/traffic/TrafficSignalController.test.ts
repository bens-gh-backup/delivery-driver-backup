import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import {
  TrafficSignalController,
  trafficSignalAspect,
  trafficSignalPhaseAt,
} from "./TrafficSignalController";

describe("TrafficSignalController", () => {
  it("cycles both road axes through green, yellow, and an all-red clearance", () => {
    const { greenSeconds, yellowSeconds, allRedSeconds } = GAME_CONFIG.trafficSignals;
    const eastWestStart = greenSeconds + yellowSeconds + allRedSeconds;

    expect(trafficSignalPhaseAt(0)).toBe("northSouthGreen");
    expect(trafficSignalPhaseAt(greenSeconds)).toBe("northSouthYellow");
    expect(trafficSignalPhaseAt(greenSeconds + yellowSeconds)).toBe(
      allRedSeconds > 0 ? "allRedToEastWest" : "eastWestGreen",
    );
    expect(trafficSignalPhaseAt(eastWestStart)).toBe("eastWestGreen");
    expect(trafficSignalPhaseAt(eastWestStart + greenSeconds)).toBe("eastWestYellow");
    expect(trafficSignalPhaseAt(eastWestStart + greenSeconds + yellowSeconds)).toBe(
      allRedSeconds > 0 ? "allRedToNorthSouth" : "northSouthGreen",
    );
    expect(trafficSignalPhaseAt((greenSeconds + yellowSeconds + allRedSeconds) * 2)).toBe("northSouthGreen");
  });

  it("maps a global phase to the correct aspect for each direction", () => {
    expect(trafficSignalAspect("northSouthGreen", "north")).toBe("green");
    expect(trafficSignalAspect("northSouthGreen", "south")).toBe("green");
    expect(trafficSignalAspect("northSouthGreen", "east")).toBe("red");
    expect(trafficSignalAspect("eastWestYellow", "west")).toBe("yellow");
    expect(trafficSignalAspect("allRedToNorthSouth", "north")).toBe("red");
    expect(trafficSignalAspect("allRedToNorthSouth", "east")).toBe("red");
  });

  it("creates one synchronized signal set for every supplied intersection", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const controller = new TrafficSignalController(scene, [0, 400], [0, 400, 800]);

    expect(controller.intersectionCount).toBe(6);
    expect(controller.aspectFor("north")).toBe("green");
    expect(controller.aspectFor("east")).toBe("red");
    expect(scene.meshes).toHaveLength(8);

    controller.update(GAME_CONFIG.trafficSignals.greenSeconds);
    expect(controller.aspectFor("north")).toBe("yellow");
    controller.dispose();
    expect(scene.meshes).toHaveLength(0);
    scene.dispose();
    engine.dispose();
  });
});
