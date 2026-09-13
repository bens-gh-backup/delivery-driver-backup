import { describe, expect, it } from "vitest";
import { advanceRaceProgress, checkpointCrossing, rankRacers, type RacerProgress } from "./RaceProgress";

const racer = (id = 0): RacerProgress => ({ id, checkpointIndex: 0, finishTime: null, position: { x: 0, z: 0 } });
describe("ordered race progress", () => {
  it("detects a high-speed crossing even when both endpoints are outside", () => {
    expect(checkpointCrossing({ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 50, z: 0 }, 10)).toBeCloseTo(.4);
    const progress = racer();
    advanceRaceProgress(progress, { x: 0, z: 0 }, { x: 100, z: 0 }, [{ x: 50, z: 0 }], 10, 3, .1);
    expect(progress.finishTime).toBeCloseTo(3.04);
  });
  it("never grants a later checkpoint when the next required checkpoint is missed", () => {
    const progress = racer();
    advanceRaceProgress(progress, { x: 0, z: 0 }, { x: 100, z: 0 }, [{ x: 50, z: 40 }, { x: 80, z: 0 }], 10, 0, 1);
    expect(progress.checkpointIndex).toBe(0);
  });
  it("cannot consume geometrically reversed checkpoints in one sweep", () => {
    const progress = racer();
    advanceRaceProgress(progress, { x: 0, z: 0 }, { x: 100, z: 0 }, [{ x: 80, z: 0 }, { x: 20, z: 0 }], 5, 0, 1);
    expect(progress.checkpointIndex).toBe(1);
  });
  it("sorts same-step finishes by crossing time, then progress and remaining distance", () => {
    const racers = [racer(0), racer(1), racer(2), racer(3), racer(4)];
    racers[0].finishTime = 10.8; racers[1].finishTime = 10.1;
    racers[2].checkpointIndex = 1; racers[2].position.x = 70;
    racers[3].checkpointIndex = 1; racers[3].position.x = 90;
    racers[4].position.x = 100;
    expect(rankRacers(racers, [{ x: 50, z: 0 }, { x: 100, z: 0 }]).map(r => r.id)).toEqual([1, 0, 3, 2, 4]);
  });
});
