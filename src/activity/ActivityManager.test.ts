import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it } from "vitest";
import { ActivityManager, type Activity } from "./ActivityManager";

function activityAt(position: Vector3): Activity & { isActive: boolean } {
  return {
    isActive: true,
    getObjectivePosition: () => position,
  };
}

describe("ActivityManager", () => {
  it("allows one activity at a time and releases it after completion", () => {
    const manager = new ActivityManager();
    const first = activityAt(new Vector3(10, 0, 20));
    const second = activityAt(new Vector3(30, 0, 40));

    expect(manager.start(first, () => true)).toBe(true);
    expect(manager.start(second, () => true)).toBe(false);
    expect(manager.getObjectivePosition()).toBe(first.getObjectivePosition());

    first.isActive = false;
    manager.update();

    expect(manager.start(second, () => true)).toBe(true);
  });
});
