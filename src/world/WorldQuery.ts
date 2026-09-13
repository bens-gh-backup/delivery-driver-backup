import { GAME_CONFIG } from "../game/config";
import type { BoxCollider, RoadContext, RoadDefinition } from "../game/types";

export class WorldQuery {
  lastCollisionCandidateCount = 0;
  private readonly cells = new Map<number, Map<number, BoxCollider[]>>();
  private readonly oversizedColliders: BoxCollider[] = [];
  private maxIndexedHalfX = 0;
  private maxIndexedHalfZ = 0;
  private readonly roadSpacingX: number;
  private readonly roadSpacingZ: number;
  private readonly northSouthRoads: readonly RoadDefinition[];
  private readonly eastWestRoads: readonly RoadDefinition[];
  private readonly roadPositionsX: readonly number[];
  private readonly roadPositionsZ: readonly number[];

  constructor(
    colliders: BoxCollider[],
    roads: readonly RoadDefinition[],
    private readonly roadHalfWidth: number,
    private readonly sidewalkOuterHalfWidth: number,
    private readonly cellSize: number,
    private readonly legalDrivingAreas: BoxCollider[] = [],
  ) {
    this.northSouthRoads = roads.filter((road) => road.axis === "northSouth").sort((a, b) => a.index - b.index);
    this.eastWestRoads = roads.filter((road) => road.axis === "eastWest").sort((a, b) => a.index - b.index);
    this.roadPositionsX = this.northSouthRoads.map((road) => road.center);
    this.roadPositionsZ = this.eastWestRoads.map((road) => road.center);
    this.roadSpacingX = this.roadPositionsX.length > 1 ? this.roadPositionsX[1] - this.roadPositionsX[0] : 1;
    this.roadSpacingZ = this.roadPositionsZ.length > 1 ? this.roadPositionsZ[1] - this.roadPositionsZ[0] : 1;
    for (const collider of colliders) this.addCollider(collider);
  }

  getNearbyColliders(x: number, z: number, radius: number, results: BoxCollider[]): void {
    results.length = 0;
    const minCellX = this.cellFor(x - radius - this.maxIndexedHalfX);
    const maxCellX = this.cellFor(x + radius + this.maxIndexedHalfX);
    const minCellZ = this.cellFor(z - radius - this.maxIndexedHalfZ);
    const maxCellZ = this.cellFor(z + radius + this.maxIndexedHalfZ);

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      const column = this.cells.get(cellX);
      if (!column) continue;
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const bucket = column.get(cellZ);
        if (bucket) results.push(...bucket);
      }
    }
    results.push(...this.oversizedColliders);
    this.lastCollisionCandidateCount = results.length;
  }

  isOnSidewalk(x: number, z: number): boolean {
    const nearRoadX = this.nearestRoadDistance(x, this.roadPositionsX, this.roadSpacingX);
    const nearRoadZ = this.nearestRoadDistance(z, this.roadPositionsZ, this.roadSpacingZ);
    const onRoad = nearRoadX <= this.roadHalfWidth || nearRoadZ <= this.roadHalfWidth;
    const onSidewalk = nearRoadX <= this.sidewalkOuterHalfWidth || nearRoadZ <= this.sidewalkOuterHalfWidth;
    return !onRoad && onSidewalk;
  }

  isOnPavedRoad(x: number, z: number): boolean {
    const nearRoadX = this.nearestRoadDistance(x, this.roadPositionsX, this.roadSpacingX);
    const nearRoadZ = this.nearestRoadDistance(z, this.roadPositionsZ, this.roadSpacingZ);
    return nearRoadX <= this.roadHalfWidth || nearRoadZ <= this.roadHalfWidth;
  }

  isInLegalDrivingArea(x: number, z: number): boolean {
    for (const area of this.legalDrivingAreas) {
      if (
        x >= area.x - area.halfX
        && x <= area.x + area.halfX
        && z >= area.z - area.halfZ
        && z <= area.z + area.halfZ
      ) {
        return true;
      }
    }
    return false;
  }

  getRoadContext(x: number, z: number, velocityX: number, velocityZ: number): RoadContext {
    const nearestXIndex = this.nearestRoadIndex(x, this.roadPositionsX, this.roadSpacingX);
    const nearestZIndex = this.nearestRoadIndex(z, this.roadPositionsZ, this.roadSpacingZ);
    const nearestXPosition = this.roadPositionsX[nearestXIndex] ?? 0;
    const nearestZPosition = this.roadPositionsZ[nearestZIndex] ?? 0;
    const nearestXDistance = Math.abs(x - nearestXPosition);
    const nearestZDistance = Math.abs(z - nearestZPosition);
    const inRoadX = nearestXDistance <= this.roadHalfWidth;
    const inRoadZ = nearestZDistance <= this.roadHalfWidth;
    let axis: RoadContext["axis"];

    if (inRoadX !== inRoadZ) {
      axis = inRoadX ? "northSouth" : "eastWest";
    } else if (Math.abs(velocityX) !== Math.abs(velocityZ)) {
      axis = Math.abs(velocityZ) > Math.abs(velocityX) ? "northSouth" : "eastWest";
    } else {
      axis = nearestXDistance <= nearestZDistance ? "northSouth" : "eastWest";
    }

    const distanceToIntersection = axis === "northSouth" ? nearestZDistance : nearestXDistance;
    const road = axis === "northSouth"
      ? this.northSouthRoads[nearestXIndex]
      : this.eastWestRoads[nearestZIndex];
    return {
      road,
      axis,
      roadCenter: axis === "northSouth" ? nearestXPosition : nearestZPosition,
      lateralOffset: axis === "northSouth" ? x - nearestXPosition : z - nearestZPosition,
      distanceToIntersection,
      inIntersection: inRoadX && inRoadZ,
      inTurningGap: distanceToIntersection <= this.roadHalfWidth + GAME_CONFIG.world.roadMarkings.intersectionBuffer,
      inLegalDrivingArea: this.isInLegalDrivingArea(x, z),
    };
  }

  private addCollider(collider: BoxCollider): void {
    if (collider.halfX > this.cellSize || collider.halfZ > this.cellSize) {
      this.oversizedColliders.push(collider);
      return;
    }
    this.maxIndexedHalfX = Math.max(this.maxIndexedHalfX, collider.halfX);
    this.maxIndexedHalfZ = Math.max(this.maxIndexedHalfZ, collider.halfZ);
    const cellX = this.cellFor(collider.x);
    const cellZ = this.cellFor(collider.z);
    let column = this.cells.get(cellX);
    if (!column) {
      column = new Map<number, BoxCollider[]>();
      this.cells.set(cellX, column);
    }
    let bucket = column.get(cellZ);
    if (!bucket) {
      bucket = [];
      column.set(cellZ, bucket);
    }
    bucket.push(collider);
  }

  private nearestRoadDistance(value: number, positions: readonly number[], spacing: number): number {
    if (positions.length === 0) return Number.POSITIVE_INFINITY;
    const index = this.nearestRoadIndex(value, positions, spacing);
    return Math.abs(value - positions[index]);
  }

  private nearestRoadIndex(value: number, positions: readonly number[], spacing: number): number {
    if (positions.length === 0) return 0;
    return Math.max(0, Math.min(positions.length - 1, Math.round((value - positions[0]) / spacing)));
  }

  private cellFor(value: number): number {
    return Math.floor(value / this.cellSize);
  }
}
