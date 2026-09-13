import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GAME_CONFIG } from "../game/config";
import { PassengerDrivingEvents, type PassengerDrivingEvent } from "./PassengerDrivingEvents";
import type { TrafficSignalAspect } from "../traffic/TrafficSignalController";
import type { Direction } from "../traffic/TrafficCar";

const half = GAME_CONFIG.world.roadWidth / 2;
const lane = half / 2;
const outside = half + GAME_CONFIG.trafficSignals.stopLineSetback + 5;
function drive(points: [number, number][], aspect: TrafficSignalAspect = "green") {
  const detector = new PassengerDrivingEvents([0, 360], [0, 360]);
  const events: PassengerDrivingEvent[] = [];
  detector.reset({ x: points[0][0], z: points[0][1] });
  for (const [x, z] of points.slice(1)) events.push(...detector.update({ x, z }, () => aspect));
  return events;
}

describe("passenger driving events", () => {
  it.each([true, false])("snapshots the live car's Vector3 coordinates (explicit reset: %s)", (reset) => {
    const detector = new PassengerDrivingEvents([0], [0]);
    const position = new Vector3(lane, 0.9, -outside);
    if (reset) detector.reset(position);
    else expect(detector.update(position, () => "red")).toEqual([]);
    // The game mutates the same Vector3 on every step. The saved position must
    // remain independent and read its public getters, not enumerable internals.
    position.z = 0;
    expect(detector.update(position, () => "red")).toEqual(["redLight"]);
    expect(detector.update(position, () => "red")).toEqual([]);

    position.z = -outside;
    detector.reset(position); // Same lifecycle as the next passenger's pickup.
    position.z = 0;
    expect(detector.update(position, () => "yellow")).toEqual(["yellowIntersection"]);
    expect(detector.update(position, () => "yellow")).toEqual([]);
  });

  it.each([
    [[lane, -outside], [lane, outside]],
    [[-lane, outside], [-lane, -outside]],
    [[-outside, -lane], [outside, -lane]],
    [[outside, lane], [-outside, lane]],
  ] as [number, number][][])("detects a high-speed red crossing in either road axis: %j", (...points) => {
    expect(drive(points)).not.toContain("opposingLane");
    expect(drive(points, "red")).toEqual(["redLight"]);
  });

  it("does not count stopping before the line, or red changing while clearing", () => {
    const d = new PassengerDrivingEvents([0], [0]);
    d.reset({ x: lane, z: -outside });
    expect(d.update({ x: lane, z: -outside + 1 }, () => "red")).toEqual([]);
    expect(d.update({ x: lane, z: 0 }, () => "green")).toEqual([]);
    expect(d.update({ x: lane, z: outside }, () => "red")).toEqual([]);
  });

  it("awards yellow once per visit, including a phase change while stationary inside", () => {
    const d = new PassengerDrivingEvents([0], [0]);
    d.reset({ x: lane, z: -outside });
    expect(d.update({ x: lane, z: 0 }, () => "green")).toEqual([]);
    expect(d.update({ x: lane, z: 0 }, () => "yellow")).toEqual(["yellowIntersection"]);
    for (let i = 0; i < 10; i++) expect(d.update({ x: lane, z: 0 }, () => "yellow")).toEqual([]);
    expect(d.update({ x: lane, z: outside }, () => "yellow")).toEqual([]);
    d.update({ x: -lane, z: outside + 10 }, () => "green");
    expect(d.update({ x: -lane, z: 0 }, () => "yellow")).toContain("yellowIntersection");
  });

  it("uses the entry approach signal throughout a legal left turn", () => {
    const d = new PassengerDrivingEvents([0], [0]);
    const aspects = (direction: Direction): TrafficSignalAspect => direction === "south" ? "green" : "yellow";
    d.reset({ x: lane, z: -outside });
    expect(d.update({ x: lane, z: -lane }, aspects)).toEqual([]);
    expect(d.update({ x: half - 1, z: -lane }, aspects)).toEqual([]);
    expect(d.update({ x: outside, z: -lane }, aspects)).toEqual([]);
  });

  it.each([
    [[lane, -outside], [lane, -lane], [outside, -lane]],
    [[lane, -outside], [lane, lane], [-outside, lane]],
    [[-lane, outside], [-lane, lane], [-outside, lane]],
    [[-lane, outside], [-lane, -lane], [outside, -lane]],
    [[-outside, -lane], [-lane, -lane], [-lane, -outside]],
    [[-outside, -lane], [lane, -lane], [lane, outside]],
    [[outside, lane], [lane, lane], [lane, outside]],
    [[outside, lane], [-lane, lane], [-lane, -outside]],
  ] as [number, number][][])("allows legal left and right turns: %j", (...points) => {
    expect(drive(points)).toEqual([]);
  });

  it("counts a U-turn once, including a reversal inside the intersection", () => {
    expect(drive([[lane, -outside], [lane, 0], [-lane, 0], [-lane, -outside]])).toEqual(["opposingLane"]);
  });

  it("does not mistake backing out in the same lane for a center-line crossing", () => {
    expect(drive([[lane, -outside], [lane, -lane], [lane, -outside]])).toEqual([]);
  });

  it("counts a wrong-way intersection exit once", () => {
    expect(drive([[lane, -outside], [lane, lane], [outside, lane], [outside + 10, lane]])).toEqual(["opposingLane"]);
  });

  it("counts opposing-lane entry but not sustained wrong-way driving or returning to the legal lane", () => {
    expect(drive([[lane, 100], [lane, 101], [-lane, 120], [-lane, 140], [lane, 160], [lane, 170]]))
      .toEqual(["opposingLane"]);
  });

  it("counts midblock U-turns even if longitudinal motion reverses before crossing the line", () => {
    expect(drive([[lane, 100], [lane, 110], [lane / 2, 115], [1, 113], [-lane, 105], [-lane, 95]]))
      .toEqual(["opposingLane"]);
  });

  it("does not charge a passenger for returning from an opposing lane occupied before pickup", () => {
    expect(drive([[-lane, 100], [-lane, 110], [lane, 130], [lane, 140]])).toEqual([]);
  });

  it("counts a second distinct center-line crossing and ignores center-line jitter", () => {
    expect(drive([[lane, 100], [lane, 101], [-lane, 120], [lane, 140], [lane, 150], [-lane, 170]]))
      .toEqual(["opposingLane", "opposingLane"]);
    expect(drive([[lane, 100], [lane, 101], [0.1, 120], [-0.1, 121], [0.1, 122], [lane, 140]]))
      .toEqual([]);
  });

  it("resets event latches between passengers", () => {
    const d = new PassengerDrivingEvents([0], [0]);
    for (let i = 0; i < 2; i++) {
      d.reset({ x: lane, z: -outside });
      expect(d.update({ x: lane, z: outside }, () => "yellow")).toEqual(["yellowIntersection"]);
    }
  });
});
