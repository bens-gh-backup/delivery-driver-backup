import { describe, expect, it } from "vitest";
import { findOrientedBoxCollision, type OrientedBox2D } from "./OrientedBoxCollision";

const parkedCar: OrientedBox2D = {
  x: 0,
  z: 0,
  heading: 0,
  halfWidth: 2,
  halfLength: 5,
};

describe("findOrientedBoxCollision", () => {
  it("does not collide when bounding circles overlap but side panels do not", () => {
    const other = { ...parkedCar, x: 4.1 };

    expect(Math.hypot(other.x, other.z)).toBeLessThan(Math.hypot(2, 5) * 2);
    expect(findOrientedBoxCollision(other, parkedCar)).toBeNull();
  });

  it("returns the shallowest outward correction for an overlap", () => {
    const other = { ...parkedCar, x: 3.5 };

    const collision = findOrientedBoxCollision(other, parkedCar);
    expect(collision?.normalX).toBeCloseTo(1);
    expect(collision?.normalZ).toBeCloseTo(0);
    expect(collision?.depth).toBeCloseTo(0.5);
  });

  it("detects collisions between perpendicular vehicles", () => {
    const crossingCar = { ...parkedCar, x: 6.5, heading: Math.PI / 2 };

    const collision = findOrientedBoxCollision(crossingCar, parkedCar);
    expect(collision).not.toBeNull();
    expect(collision?.depth).toBeCloseTo(0.5);
    expect(collision?.normalX).toBeCloseTo(1);
    expect(collision?.normalZ).toBeCloseTo(0);
  });
});
