import { GAME_CONFIG } from "../game/config";
import type {
  DrivingViolationRates,
  DrivingViolationSeverity,
  DrivingViolationTotals,
  RoadContext,
} from "../game/types";
import { clamp } from "../utils/math";
import type { WorldQuery } from "../world/WorldQuery";
import type { PlayerCar } from "./PlayerCar";

export interface DrivingBehaviorSample {
  x: number;
  z: number;
  heading: number;
  velocityX: number;
  velocityZ: number;
  speedMph: number;
  width: number;
  length: number;
  reverseDistanceMeters?: number;
}

export class DrivingBehaviorManager {
  readonly current: DrivingViolationSeverity = emptySeverity();
  readonly totals: DrivingViolationTotals = {
    speeding: 0,
    wrongSide: 0,
    sidewalk: 0,
    total: 0,
  };
  readonly rates: DrivingViolationRates = {
    speeding: 0,
    wrongSide: 0,
    sidewalk: 0,
    total: 0,
  };
  private reverseDistanceMeters = 0;

  update(deltaTime: number, player: PlayerCar, worldQuery: WorldQuery): void {
    const forwardX = Math.sin(player.heading);
    const forwardZ = Math.cos(player.heading);
    const longitudinalSpeed = player.getVelocityX() * forwardX + player.getVelocityZ() * forwardZ;
    if (longitudinalSpeed < 0) {
      this.reverseDistanceMeters += Math.hypot(player.getVelocityX(), player.getVelocityZ())
        * deltaTime * GAME_CONFIG.ride.metersPerWorldUnit;
    } else {
      this.reverseDistanceMeters = 0;
    }
    evaluateDrivingViolations({
      x: player.root.position.x,
      z: player.root.position.z,
      heading: player.heading,
      velocityX: player.getVelocityX(),
      velocityZ: player.getVelocityZ(),
      speedMph: player.getSpeedMph(),
      width: player.vehicleWidth,
      length: player.vehicleLength,
      reverseDistanceMeters: this.reverseDistanceMeters,
    }, worldQuery, this.current);

    const rules = GAME_CONFIG.drivingRules;
    this.rates.speeding = rules.speedingPointsPerSecond * this.current.speeding ** 2;
    this.rates.wrongSide = rules.wrongSidePointsPerSecond * this.current.wrongSide ** 2;
    this.rates.sidewalk = rules.sidewalkPointsPerSecond * this.current.sidewalk ** 2;
    this.rates.total = this.rates.speeding + this.rates.wrongSide + this.rates.sidewalk;
    const speedingPoints = this.rates.speeding * deltaTime;
    const wrongSidePoints = this.rates.wrongSide * deltaTime;
    const sidewalkPoints = this.rates.sidewalk * deltaTime;
    this.totals.speeding += speedingPoints;
    this.totals.wrongSide += wrongSidePoints;
    this.totals.sidewalk += sidewalkPoints;
    this.totals.total += speedingPoints + wrongSidePoints + sidewalkPoints;
  }
}

export function evaluateDrivingViolations(
  sample: DrivingBehaviorSample,
  worldQuery: WorldQuery,
  result: DrivingViolationSeverity = emptySeverity(),
): DrivingViolationSeverity {
  const rules = GAME_CONFIG.drivingRules;
  const context = worldQuery.getRoadContext(
    sample.x,
    sample.z,
    sample.velocityX,
    sample.velocityZ,
  );
  const speedingStart = context.road.speedLimitMph + rules.speedToleranceMph;
  const fullSpeedingMph = context.road.speedLimitMph + rules.fullSpeedingOverLimitMph;
  result.speeding = clamp(
    (sample.speedMph - speedingStart) / (fullSpeedingMph - speedingStart),
    0,
    1,
  );
  result.wrongSide = 0;
  result.sidewalk = 0;

  if (sample.speedMph >= rules.minimumEvaluationSpeedMph) {
    if (!context.inLegalDrivingArea) {
      result.sidewalk = sidewalkOverlap(sample, worldQuery);
      result.wrongSide = wrongSideOverlap(sample, context);
      if (sample.reverseDistanceMeters !== undefined && sample.reverseDistanceMeters > 0) {
        const grace = rules.reverseWrongWayGraceDistanceMeters;
        const ramp = Math.max(0.001, rules.reverseWrongWayRampDistanceMeters);
        result.wrongSide *= clamp((sample.reverseDistanceMeters - grace) / ramp, 0, 1);
      }
    }
  }

  result.combined = clamp(result.speeding + result.wrongSide + result.sidewalk, 0, 1);
  return result;
}

function wrongSideOverlap(sample: DrivingBehaviorSample, context: RoadContext): number {
  if (context.inIntersection || context.inTurningGap) {
    return 0;
  }

  const forwardX = Math.sin(sample.heading);
  const forwardZ = Math.cos(sample.heading);
  const rightX = Math.cos(sample.heading);
  const rightZ = -Math.sin(sample.heading);
  const halfExtent = context.axis === "northSouth"
    ? Math.abs(rightX) * sample.width / 2 + Math.abs(forwardX) * sample.length / 2
    : Math.abs(rightZ) * sample.width / 2 + Math.abs(forwardZ) * sample.length / 2;
  const longitudinalVelocity = context.axis === "northSouth" ? sample.velocityZ : sample.velocityX;
  const longitudinalMph = Math.abs(longitudinalVelocity) * GAME_CONFIG.ride.mphPerWorldUnitPerSecond;
  if (longitudinalMph < GAME_CONFIG.drivingRules.minimumEvaluationSpeedMph || halfExtent <= 0) {
    return 0;
  }

  const legalSideSign = context.axis === "northSouth"
    ? (longitudinalVelocity > 0 ? 1 : -1)
    : (longitudinalVelocity < 0 ? 1 : -1);
  const signedCenter = context.lateralOffset * legalSideSign;
  const markings = GAME_CONFIG.world.roadMarkings;
  const protectedCenterHalfWidth = markings.lineGap / 2 + markings.lineWidth;
  const overlap = protectedCenterHalfWidth - (signedCenter - halfExtent);
  return clamp(overlap / (halfExtent * 2), 0, 1);
}

function sidewalkOverlap(sample: DrivingBehaviorSample, worldQuery: WorldQuery): number {
  const forwardX = Math.sin(sample.heading);
  const forwardZ = Math.cos(sample.heading);
  const rightX = Math.cos(sample.heading);
  const rightZ = -Math.sin(sample.heading);
  const widthSamples = 5;
  const lengthSamples = 5;
  let illegalSamples = 0;

  for (let widthIndex = 0; widthIndex < widthSamples; widthIndex++) {
    const across = widthIndex / (widthSamples - 1) * 2 - 1;
    for (let lengthIndex = 0; lengthIndex < lengthSamples; lengthIndex++) {
      const along = lengthIndex / (lengthSamples - 1) * 2 - 1;
      const x = sample.x + rightX * across * sample.width / 2 + forwardX * along * sample.length / 2;
      const z = sample.z + rightZ * across * sample.width / 2 + forwardZ * along * sample.length / 2;
      if (!worldQuery.isOnPavedRoad(x, z) && !worldQuery.isInLegalDrivingArea(x, z)) {
        illegalSamples += 1;
      }
    }
  }

  return illegalSamples / (widthSamples * lengthSamples);
}

function emptySeverity(): DrivingViolationSeverity {
  return { speeding: 0, wrongSide: 0, sidewalk: 0, combined: 0 };
}
