import { WORLD_SURFACES } from "./SurfaceLayout";
import type { BoxCollider } from "../game/types";
import { CITY_STYLE, CityGeometry, type BuildingLot } from "./CityStyle";

export function entranceApproach(building: BuildingLot): BoxCollider {
  const rules = CITY_STYLE.streetDetails;
  const ns = building.facing % 2 === 0;
  const sign = building.facing < 2 ? -1 : 1;
  const offset = (ns ? building.depth : building.width) / 2 + rules.entranceClearLength / 2;
  return {
    x: building.x + (ns ? 0 : sign * offset),
    z: building.z + (ns ? sign * offset : 0),
    halfX: ns ? rules.entranceClearHalfWidth : rules.entranceClearLength / 2,
    halfZ: ns ? rules.entranceClearLength / 2 : rules.entranceClearHalfWidth,
  };
}

export function overlapsArea(x: number, z: number, radius: number, area: BoxCollider): boolean {
  return Math.abs(x - area.x) < area.halfX + radius && Math.abs(z - area.z) < area.halfZ + radius;
}

/** Subtract service entrances from a straight curb, including overlapping openings. */
export function curbSegments(start: number, end: number, cuts: readonly (readonly [number, number])[]): [number, number][] {
  const segments: [number, number][] = [];
  let cursor = start;
  for (const [a, b] of [...cuts].sort((a, b) => a[0] - b[0])) {
    if (b <= cursor || a >= end) continue;
    if (a > cursor) segments.push([cursor, Math.min(a, end)]);
    cursor = Math.max(cursor, b);
    if (cursor >= end) break;
  }
  if (cursor < end) segments.push([cursor, end]);
  return segments;
}

export function addPavementDetails(
  geometry: CityGeometry, centerX: number, centerZ: number, halfBlock: number,
  clearAreas: readonly BoxCollider[], seed: number,
): BoxCollider[] {
  const rules = CITY_STYLE.streetDetails, colors = CITY_STYLE.palette;
  const footprints: BoxCollider[] = [];
  for (let side = 0; side < 4; side++) {
    const ns = side % 2 === 0, sign = side < 2 ? -1 : 1;
    const fixed = sign * (halfBlock - rules.curbWidth / 2);
    const cuts: [number, number][] = [];
    for (const area of clearAreas) {
      const perpendicular = ns ? area.z - centerZ : area.x - centerX;
      const across = ns ? area.halfZ : area.halfX;
      if (Math.abs(perpendicular - fixed) > across + 4) continue;
      const along = ns ? area.x - centerX : area.z - centerZ;
      const extent = ns ? area.halfX : area.halfZ;
      cuts.push([along - extent - 2, along + extent + 2]);
    }
    // Horizontal sides own the corner stones; perpendicular sides butt against them.
    const inset = ns ? 0 : rules.curbWidth;
    const segments = curbSegments(-halfBlock + inset, halfBlock - inset, cuts);
    const point = (along: number, inward: number): [number, number] => ns
      ? [along, fixed - sign * inward] : [fixed - sign * inward, along];
    for (const [a, b] of segments) {
      const [x, z] = point((a + b) / 2, 0);
      const width = ns ? b - a : rules.curbWidth, depth = ns ? rules.curbWidth : b - a;
      geometry.box(x, rules.curbHeight / 2, z, width, rules.curbHeight, depth, colors.curb);
      footprints.push({ x: centerX + x, z: centerZ + z, halfX: width / 2, halfZ: depth / 2 });
      // Two rows of slabs; joints stop short of corners and every service opening.
      const start = Math.max(a + .15, -halfBlock + rules.pavingStripWidth);
      const end = Math.min(b - .15, halfBlock - rules.pavingStripWidth);
      if (end > start) {
        groundLine(geometry, point(start, rules.pavingStripWidth/2),
          point(end, rules.pavingStripWidth/2), .06, colors.seam);
        groundLine(geometry, point(start, rules.pavingStripWidth),
          point(end, rules.pavingStripWidth), .06, colors.seam);
        for (let along = Math.ceil(start / rules.pavingJointSpacing) * rules.pavingJointSpacing;
          along < end; along += rules.pavingJointSpacing) {
          groundLine(geometry, point(along, rules.curbWidth/2+.12),
            point(along, rules.pavingStripWidth), .06, colors.seam);
        }
        // Gutter is a flat color strip, not a new obstacle or simulated drainage system.
        groundLine(geometry, point(start, -rules.curbWidth/2-rules.gutterWidth/2),
          point(end, -rules.curbWidth/2-rules.gutterWidth/2), rules.gutterWidth, colors.gutter, WORLD_SURFACES.gutter);
        for (let along = Math.ceil(start / rules.curbJointSpacing) * rules.curbJointSpacing;
          along < end; along += rules.curbJointSpacing) {
          groundLine(geometry, point(along, -rules.curbWidth/2), point(along, rules.curbWidth/2),
            .055, colors.seam, rules.curbHeight+CITY_STYLE.facades.surfaceStep);
        }
        // One small grate on selected block edges, kept inside a continuous curb segment.
        if ((seed + side) % 3 === 0 && end-start > 30) {
          const along = start+(end-start)*.55, inward = -rules.curbWidth/2-rules.gutterWidth/2;
          groundLine(geometry, point(along-.8,inward),point(along+.8,inward), .5, colors.roof, WORLD_SURFACES.grate);
          for (let bar=0;bar<4;bar++) {
            const u=along-.6+bar*.4;
            groundLine(geometry,point(u,inward-.2),point(u,inward+.2),.09,colors.gutter,WORLD_SURFACES.grateBars);
          }
        }
      }
      for (let crack = 0; crack < rules.cracksPerEdge && b-a > 5; crack++) {
        const along = a + (b - a) * (.2 + ((seed + side * 7 + crack * 17) % 53) / 100);
        groundLine(geometry, point(along, 2.8), point(along + .55, 3.7), .1, colors.crack);
        groundLine(geometry, point(along + .55, 3.7), point(along + .3, 4.9), .1, colors.crack);
      }
    }
  }
  return footprints;
}

function groundLine(g: CityGeometry, a: [number, number], b: [number, number], width: number, color: string, y: number = WORLD_SURFACES.pavementDetail): void {
  const dx = b[0] - a[0], dz = b[1] - a[1], scale = width / (2 * Math.hypot(dx, dz));
  const px = -dz * scale, pz = dx * scale;
  g.face([[a[0]+px,y,a[1]+pz],[a[0]-px,y,a[1]-pz],
    [b[0]-px,y,b[1]-pz],[b[0]+px,y,b[1]+pz]], color);
}

/** A single, two-sided street blade. Letter strokes are opaque geometry in the city batch. */
export function addStreetSign(g: CityGeometry, x: number, z: number, avenue: number): void {
  const p = CITY_STYLE.palette;
  g.box(x, 3.5, z, .22, 7, .22, p.roof);
  g.box(x, 6.5, z, 5.5, 1.25, .22, p.sign);
  const digits = ["111101101101111", "010110010010111", "111001111100111", "111001111001111",
    "101101111001001", "111100111001111", "111100111101111", "111001010010010", "111101111101111"];
  const glyphs = [digits[avenue], "010101111101101", "101101101101010"]; // numbered avenue
  for (const side of [-1, 1]) for (let letter = 0; letter < glyphs.length; letter++) {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if (glyphs[letter][r * 3 + c] !== "1") continue;
      const a = x + side * (-1.3 + letter * .95 + c * .2), b = a + side * .2;
      const y = 7 - r * .2, front = z - side * (.11 + CITY_STYLE.facades.surfaceStep);
      g.face([[a,y-.2,front],[b,y-.2,front],[b,y,front],[a,y,front]], p.trim);
    }
  }
}
