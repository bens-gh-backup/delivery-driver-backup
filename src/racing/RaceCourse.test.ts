import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { createRaceCourses } from "./RaceCourse";

export const raceTown = {
  roadPositionsX: Array.from({ length: 7 }, (_, i) => (i - 3) * 425),
  roadPositionsZ: Array.from({ length: 7 }, (_, i) => (i - 3) * 425),
};
describe("regional courses", () => {
  it("generates 36 deterministic closed road routes that leave their home region", () => {
    const courses = createRaceCourses(raceTown);
    expect(courses.size).toBe(36);
    expect([...createRaceCourses(raceTown)]).toEqual([...courses]);
    for (const course of courses.values()) {
      const [, bxString, bzString] = course.regionId.split("-");
      const bx = Number(bxString), bz = Number(bzString);
      const inside = (p: { x: number; z: number }) => p.x >= raceTown.roadPositionsX[bx]
        && p.x <= raceTown.roadPositionsX[bx + 1] && p.z >= raceTown.roadPositionsZ[bz]
        && p.z <= raceTown.roadPositionsZ[bz + 1];
      expect(inside(course.start)).toBe(true);
      expect(course.checkpoints.at(-1)).toEqual(course.start);
      expect(course.checkpoints.some(p => !inside(p))).toBe(true);
      expect(course.length).toBeGreaterThanOrEqual(GAME_CONFIG.racing.course.minLength);
      expect(course.length).toBeLessThanOrEqual(GAME_CONFIG.racing.course.maxLength);
      for (let i = 1; i < course.route.length; i++) {
        const a = course.route[i - 1], b = course.route[i];
        expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(1);
        for (let step = 0; step <= 10; step++) {
          const x = a.x + (b.x - a.x) * step / 10, z = a.z + (b.z - a.z) * step / 10;
          const distance = Math.min(...raceTown.roadPositionsX.map(v => Math.abs(v - x)), ...raceTown.roadPositionsZ.map(v => Math.abs(v - z)));
          expect(distance).toBeLessThan(GAME_CONFIG.world.roadWidth / 2);
        }
      }
    }
  });
  it("fails clearly when configured length bounds cannot make a valid loop", () => {
    expect(() => createRaceCourses(raceTown, { seed: 1, minLength: 1, targetLength: 2, maxLength: 3 })).toThrow("No valid race course");
  });
});
