import { describe, expect, it } from "vitest";
import { createPursuitImpact } from "./PursuitImpact";

describe("pursuit impact", () => {
  it("scales clean hits to a quarter of a car and keeps glances weaker", () => {
    const clean = createPursuitImpact(20, 1, 0, 1, 0.5);
    expect(clean.damage).toBe(0.25);
    expect(createPursuitImpact(100, 1, 0, 1, 0.5).damage).toBe(0.25);
    expect(createPursuitImpact(8, 0.3, 0, 1, 0.5).damage).toBeLessThan(0.1);
    expect(createPursuitImpact(0, 1, 0, 1, 0.5).damage).toBe(0);
  });

  it("mirrors the physical impulse for opposite rear corners and bounds variation", () => {
    const left = createPursuitImpact(20, 1, 0, -1, 0.5);
    const right = createPursuitImpact(20, 1, 0, 1, 0.5);
    expect(left.yawRate).toBe(-right.yawRate);
    expect(left.velocityX).toBe(-right.velocityX);
    expect(createPursuitImpact(20, 1, 0, 1, 0).yawRate / right.yawRate).toBeCloseTo(0.9);
    expect(createPursuitImpact(20, 1, 0, 1, 1).yawRate / right.yawRate).toBeCloseTo(1.1);
  });
});
