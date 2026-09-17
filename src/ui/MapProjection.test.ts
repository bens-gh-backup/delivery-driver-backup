import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { projectMapHeight, projectMapPoint, projectMapWidth, unprojectMapPoint } from "./MapProjection";

describe("MapProjection", () => {
  const totalX = GAME_CONFIG.world.blocksX * GAME_CONFIG.world.blockSize
    + (GAME_CONFIG.world.blocksX + 1) * GAME_CONFIG.world.roadWidth;
  const totalZ = GAME_CONFIG.world.blocksZ * GAME_CONFIG.world.blockSize
    + (GAME_CONFIG.world.blocksZ + 1) * GAME_CONFIG.world.roadWidth;
  const bounds = {
    minX: -totalX / 2,
    maxX: totalX / 2,
    minZ: -totalZ / 2,
    maxZ: totalZ / 2,
  };

  it("maps all four world corners without distorting edge coordinates", () => {
    expect(projectMapPoint(bounds.minX, bounds.maxZ, bounds)).toEqual({ x: 0, y: 0 });
    expect(projectMapPoint(bounds.maxX, bounds.minZ, bounds)).toEqual({ x: 100, y: 100 });
    expect(projectMapPoint(0, 0, bounds)).toEqual({ x: 50, y: 50 });
  });

  it("projects every generated road center at the town's real spacing", () => {
    const roadCenters = Array.from(
      { length: GAME_CONFIG.world.blocksX + 1 },
      (_, index) => bounds.minX
        + GAME_CONFIG.world.roadWidth / 2
        + index * (GAME_CONFIG.world.blockSize + GAME_CONFIG.world.roadWidth),
    );
    const projected = roadCenters.map((center) => projectMapPoint(center, 0, bounds).x);

    const edgeInsetPercent = GAME_CONFIG.world.roadWidth / 2 / totalX * 100;
    const roadSpacingPercent = (GAME_CONFIG.world.blockSize + GAME_CONFIG.world.roadWidth) / totalX * 100;
    expect(projected).toHaveLength(GAME_CONFIG.world.blocksX + 1);
    expect(projected[0]).toBeCloseTo(edgeInsetPercent, 3);
    expect(projected[1] - projected[0]).toBeCloseTo(roadSpacingPercent, 3);
    expect(projected.at(-1)).toBeCloseTo(100 - edgeInsetPercent, 3);
  });

  it("preserves both curb sides on both road axes without the small marker covering the centerline", () => {
    const stopOffset = GAME_CONFIG.world.roadWidth * .35;
    const markerDiameter = GAME_CONFIG.world.roadWidth * .5;
    const center = projectMapPoint(0, 0, bounds);
    for (const side of [-1, 1]) {
      const vertical = projectMapPoint(side * stopOffset, 150, bounds);
      const horizontal = projectMapPoint(150, side * stopOffset, bounds);
      expect(Math.sign(vertical.x - center.x)).toBe(side);
      expect(Math.sign(horizontal.y - center.y)).toBe(-side);
      expect(Math.abs(vertical.x - center.x)).toBeGreaterThan(projectMapWidth(markerDiameter, bounds) / 2);
      expect(Math.abs(horizontal.y - center.y)).toBeGreaterThan(projectMapHeight(markerDiameter, bounds) / 2);
    }
  });

  it("scales road width independently on each map axis", () => {
    expect(projectMapWidth(GAME_CONFIG.world.roadWidth, bounds)).toBeCloseTo(
      GAME_CONFIG.world.roadWidth / totalX * 100,
      3,
    );
    expect(projectMapHeight(GAME_CONFIG.world.roadWidth, bounds)).toBeCloseTo(
      GAME_CONFIG.world.roadWidth / totalZ * 100,
      3,
    );
  });

  it("inverts clicks at corners and arbitrary points for square and rectangular worlds", () => {
    for (const area of [bounds, { minX: -300, maxX: 900, minZ: -100, maxZ: 450 }]) {
      expect(unprojectMapPoint(0, 0, area)).toEqual({ x: area.minX, z: area.maxZ });
      expect(unprojectMapPoint(100, 100, area)).toEqual({ x: area.maxX, z: area.minZ });
      for (const [x, y] of [[0, 100], [100, 0], [50, 50], [17.83, 93.22]]) {
        const world = unprojectMapPoint(x, y, area);
        const point = projectMapPoint(world.x, world.z, area);
        expect(point.x).toBeCloseTo(x, 10);
        expect(point.y).toBeCloseTo(y, 10);
      }
    }
  });
});
