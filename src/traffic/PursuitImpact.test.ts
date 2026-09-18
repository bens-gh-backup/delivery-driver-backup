import { describe, expect, it } from "vitest";
import { createPursuitImpact } from "./PursuitImpact";

describe("pursuit impact", () => {
  it("scales clean hits to a quarter of a car and keeps glances weaker", () => {
    const clean = createPursuitImpact(20, 1);
    expect(clean.damage).toBe(0.25);
    expect(createPursuitImpact(100, 1).damage).toBe(0.25);
    expect(createPursuitImpact(8, 0.3).damage).toBeLessThan(0.1);
    expect(createPursuitImpact(0, 1).damage).toBe(0);
  });

  it("returns damage without scripted velocity or spin", () => {
    expect(createPursuitImpact(20, 1)).toEqual({ damage: 0.25 });
  });
});
