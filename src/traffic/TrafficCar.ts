import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GAME_CONFIG } from "../game/config";
import type { TrafficVehicleRole, TrafficWaypoint } from "../game/types";
import { clamp, lerp, normalizeAngle, randomBetween } from "../utils/math";
import { createLowPolyVehicleMesh } from "../vehicles/VehicleMeshFactory";
import type { TrafficSignalAspect } from "./TrafficSignalController";

import { createPursuitImpact, type PursuitImpact } from "./PursuitImpact";

export type PursuitPhase = "catchUp" | "align" | "ram" | "recover" | "disabled";

type Direction = "north" | "south" | "east" | "west";
export type TurnSignal = "off" | "left" | "right";

export function turnSignalForDirections(incoming: Direction, outgoing: Direction): TurnSignal {
  if (incoming === outgoing) return "off";
  const a = directionVector(incoming);
  const b = directionVector(outgoing);
  // The existing U-turn arc crosses toward the opposing lane on the left.
  // Babylon's left-handed scene uses local +X as the driver's right.
  return a.x * b.z - a.z * b.x < 0 ? "right" : "left";
}

export interface TrafficPosition {
  x: number;
  z: number;
}

export interface TrafficPursuitTarget extends TrafficPosition {
  heading?: number;
  velocityX?: number;
  velocityZ?: number;
  vehicleLength?: number;
  vehicleWidth?: number;
}

interface ResolvedTrafficPursuitTarget extends TrafficPosition {
  heading: number;
  velocityX: number;
  velocityZ: number;
  vehicleLength: number;
  vehicleWidth: number;
}

export type TrafficAccidentState =
  | "driving"
  | "minorRecovery"
  | "braking"
  | "backing"
  | "waiting"
  | "pullingOver"
  | "stopped"
  | "pursuitRecovery";

interface LeadVehicle {
  bumperGap: number;
  forwardSpeed: number;
}

function createQuadraticTurnPath(
  start: Vector3,
  control: Vector3,
  end: Vector3,
  segments: number,
): Vector3[] {
  const points: Vector3[] = [];
  const segmentCount = Math.max(1, Math.floor(segments));
  for (let segment = 1; segment <= segmentCount; segment++) {
    const t = segment / segmentCount;
    const inverse = 1 - t;
    points.push(new Vector3(
      inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
      end.y,
      inverse * inverse * start.z + 2 * inverse * t * control.z + t * t * end.z,
    ));
  }
  return points;
}

export function createTrafficTurnPath(
  start: Vector3,
  end: Vector3,
  incomingDirection: Direction,
  segments: number,
): Vector3[] {
  const incomingIsHorizontal = incomingDirection === "east" || incomingDirection === "west";
  const control = new Vector3(
    incomingIsHorizontal ? end.x : start.x,
    end.y,
    incomingIsHorizontal ? start.z : end.z,
  );
  return createQuadraticTurnPath(start, control, end, segments);
}

export function createTrafficUTurnPath(
  start: Vector3,
  end: Vector3,
  incomingDirection: Direction,
  segments: number,
): Vector3[] {
  const points: Vector3[] = [];
  const segmentCount = Math.max(2, Math.floor(segments));
  const centerX = (start.x + end.x) / 2;
  const centerZ = (start.z + end.z) / 2;
  const radialX = start.x - centerX;
  const radialZ = start.z - centerZ;
  const radius = Math.hypot(radialX, radialZ);
  const forward = directionVector(incomingDirection);
  for (let segment = 1; segment <= segmentCount; segment++) {
    const angle = Math.PI * segment / segmentCount;
    points.push(new Vector3(
      centerX + radialX * Math.cos(angle) + forward.x * radius * Math.sin(angle),
      end.y,
      centerZ + radialZ * Math.cos(angle) + forward.z * radius * Math.sin(angle),
    ));
  }
  return points;
}

export function choosePursuitDirection(
  waypoint: TrafficWaypoint,
  currentDirection: Direction,
  target: TrafficPosition,
  roadPositionsX: number[],
  roadPositionsZ: number[],
  allowReverse = true,
): Direction {
  const valid = validDirectionsAt(waypoint, roadPositionsX.length, roadPositionsZ.length);
  const reverse = oppositeDirection(currentDirection);
  const nonReversing = valid.filter((direction) => direction !== reverse);
  const options = allowReverse || nonReversing.length === 0 ? valid : nonReversing;
  let best = options[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const direction of options) {
    const next = nextIndices(waypoint.ix, waypoint.iz, direction);
    const score = Math.abs(roadPositionsX[next.ix] - target.x)
      + Math.abs(roadPositionsZ[next.iz] - target.z)
      + (direction === reverse ? GAME_CONFIG.police.pursuitReverseDirectionPenalty : 0)
      + (direction === currentDirection ? 0 : 0.001);
    if (score < bestScore) {
      best = direction;
      bestScore = score;
    }
  }
  return best;
}

export function shouldStartPursuitUTurn(
  position: TrafficPosition,
  previousWaypoint: TrafficWaypoint,
  nextWaypoint: TrafficWaypoint,
  direction: Direction,
  target: TrafficPosition,
  roadPositionsX: number[],
  roadPositionsZ: number[],
): boolean {
  const forward = directionVector(direction);
  const targetLongitudinalDistance = (target.x - position.x) * forward.x
    + (target.z - position.z) * forward.z;
  if (targetLongitudinalDistance >= -GAME_CONFIG.police.pursuitUTurnMinimumBehindDistance) {
    return false;
  }

  const previousCenter = {
    x: roadPositionsX[previousWaypoint.ix],
    z: roadPositionsZ[previousWaypoint.iz],
  };
  const nextCenter = {
    x: roadPositionsX[nextWaypoint.ix],
    z: roadPositionsZ[nextWaypoint.iz],
  };
  const forwardCost = Math.hypot(nextCenter.x - position.x, nextCenter.z - position.z)
    + Math.abs(nextCenter.x - target.x)
    + Math.abs(nextCenter.z - target.z);
  const reverseCost = Math.hypot(previousCenter.x - position.x, previousCenter.z - position.z)
    + Math.abs(previousCenter.x - target.x)
    + Math.abs(previousCenter.z - target.z)
    + GAME_CONFIG.police.pursuitReverseDirectionPenalty;
  return forwardCost - reverseCost >= GAME_CONFIG.police.pursuitUTurnRequiredRouteSavings;
}

export function trafficSignalSpeedLimit(
  aspect: TrafficSignalAspect,
  speed: number,
  distanceToIntersection: number,
): number | null {
  if (aspect === "green") return null;
  const intersectionHalfWidth = GAME_CONFIG.world.roadWidth / 2;
  if (distanceToIntersection <= intersectionHalfWidth) return null;

  const stopCenterDistance = intersectionHalfWidth
    + GAME_CONFIG.trafficSignals.stopLineSetback
    + GAME_CONFIG.traffic.hitboxLength / 2;
  const availableStoppingDistance = Math.max(0, distanceToIntersection - stopCenterDistance);
  if (availableStoppingDistance > GAME_CONFIG.trafficSignals.lookAheadDistance) return null;

  if (aspect === "yellow") {
    const stoppingDistance = speed * speed / (2 * GAME_CONFIG.traffic.braking);
    if (availableStoppingDistance <= stoppingDistance + GAME_CONFIG.trafficSignals.yellowStoppingBuffer) {
      return null;
    }
  }

  return Math.sqrt(2 * GAME_CONFIG.traffic.braking * availableStoppingDistance);
}

export class TrafficCar {
  readonly mesh: Mesh;
  respawnGeneration = 0;
  direction: Direction;
  speed: number;
  waypoint: TrafficWaypoint;
  target: TrafficWaypoint;
  private velocityX = 0;
  private velocityZ = 0;
  private completingTurn = false;
  private signalIntent: TurnSignal = "off";
  private turningSignal: TurnSignal = "off";
  private plannedDirection: Direction;
  private readonly turnTargets: TrafficWaypoint[] = [];
  private cruiseSpeed: number;
  private speedChangeTimeRemaining: number;
  private pursuitTarget: ResolvedTrafficPursuitTarget | null = null;
  private pursuitUTurnRequested = false;
  private pursuitUTurnCooldown = 0;
  private pursuitAvoidanceOffset = 0;
  private pursuitAvoidanceTimeRemaining = 0;
  private pursuitPathBlocked = false;
  private pursuitPhaseValue: PursuitPhase = "catchUp";
  private attackTimeRemaining = 0;
  private attackRetryRemaining = 0;
  private attackSide = 1;
  private attackHeading = 0;
  private collisionYawRate = 0;
  private accidentStateValue: TrafficAccidentState = "driving";
  private accidentStateTimeRemaining = 0;
  private accidentPartnerId: number | null = null;
  private accidentReverseRemaining = 0;
  private accidentPullOverTarget: Vector3 | null = null;
  private readonly activeContactIds = new Set<number>();
  private damagePercentValue = 0;
  private safetyBrakeMode: "hard" | "light" | null = null;
  private resumeAfterAccident = false;

  constructor(
    readonly id: number,
    readonly role: TrafficVehicleRole,
    waypoint: TrafficWaypoint,
    direction: Direction,
    speed: number,
    private readonly roadPositionsX: number[],
    private readonly roadPositionsZ: number[],
    private readonly rng: () => number,
    prototype: Mesh,
    spawnProgress = 0,
  ) {
    this.waypoint = waypoint;
    this.direction = direction;
    this.speed = speed;
    this.cruiseSpeed = speed;
    this.speedChangeTimeRemaining = this.randomSpeedChangeInterval();
    this.plannedDirection = direction;
    this.target = waypoint;
    this.mesh = prototype.clone("traffic-car", null, false)!;
    this.mesh.setEnabled(false);
    this.respawn(waypoint, direction, spawnProgress);
  }

  update(
    deltaTime: number,
    nearbyTraffic: TrafficCar[],
    signalAspect: TrafficSignalAspect = "green",
  ): void {
    this.refreshTurnSignal();
    this.pursuitUTurnCooldown = Math.max(0, this.pursuitUTurnCooldown - deltaTime);
    this.pursuitAvoidanceTimeRemaining = Math.max(0, this.pursuitAvoidanceTimeRemaining - deltaTime);
    this.accidentStateTimeRemaining = Math.max(0, this.accidentStateTimeRemaining - deltaTime);
    if (!this.pursuitTarget) this.updateCruiseSpeed(deltaTime);
    this.attackRetryRemaining = Math.max(0, this.attackRetryRemaining - deltaTime);
    if (this.isPursuitDisabled && this.accidentStateValue !== "pursuitRecovery") {
      this.pursuitPhaseValue = "disabled";
      this.speed = this.velocityX = this.velocityZ = 0;
      return;
    }
    if (this.accidentStateValue === "pursuitRecovery") {
      this.updatePursuitRecovery(deltaTime);
      return;
    }
    if (this.pursuitTarget) this.updatePursuitAttack(deltaTime, nearbyTraffic);

    if (this.accidentStateValue === "stopped") {
      this.speed = 0;
      this.velocityX = 0;
      this.velocityZ = 0;
      return;
    }
    if (this.accidentStateValue === "waiting") {
      this.speed = 0;
      this.velocityX = 0;
      this.velocityZ = 0;
      if (this.accidentStateTimeRemaining <= 0) {
        this.accidentStateValue = "driving";
        this.resumeAfterAccident = false;
      } else {
        return;
      }
    }
    if (this.accidentStateValue === "backing") {
      this.updateBacking(deltaTime);
      return;
    }
    if (this.accidentStateValue === "pullingOver") {
      this.updatePullingOver(deltaTime, nearbyTraffic);
      return;
    }
    if (this.accidentStateValue === "minorRecovery" && this.accidentStateTimeRemaining <= 0) {
      this.accidentStateValue = "driving";
    }

    if (this.pursuitTarget && this.pursuitUTurnRequested && !this.completingTurn) {
      this.beginUTurn(this.direction, this.target);
    }

    let routeDx = this.target.position.x - this.mesh.position.x;
    let routeDz = this.target.position.z - this.mesh.position.z;
    let routeDistance = Math.hypot(routeDx, routeDz);
    if (!this.completingTurn
      && this.plannedDirection !== this.direction
      && routeDistance <= GAME_CONFIG.traffic.turnCurveRadius) {
      if (this.plannedDirection === oppositeDirection(this.direction)) {
        this.beginUTurn(this.direction, this.target);
      } else {
        this.beginTurn(this.direction, this.target);
      }
      routeDx = this.target.position.x - this.mesh.position.x;
      routeDz = this.target.position.z - this.mesh.position.z;
      routeDistance = Math.hypot(routeDx, routeDz);
    }
    let routeAdvances = 0;
    while (routeDistance < 0.05 && routeAdvances <= GAME_CONFIG.traffic.turnCurveSegments + 1) {
      this.advanceRoute();
      routeDx = this.target.position.x - this.mesh.position.x;
      routeDz = this.target.position.z - this.mesh.position.z;
      routeDistance = Math.hypot(routeDx, routeDz);
      routeAdvances += 1;
    }
    if (routeDistance < 0.05) return;

    const driveTarget = this.chooseDriveTarget(nearbyTraffic);
    const dx = driveTarget.x - this.mesh.position.x;
    const dz = driveTarget.z - this.mesh.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.05) {
      this.speed = 0;
      this.velocityX = 0;
      this.velocityZ = 0;
      return;
    }

    const dirX = dx / distance;
    const dirZ = dz / distance;
    // The nearby steering target is not the intersection: using its distance brakes mid-attack.
    let desiredSpeed = this.desiredSpeed(routeDistance, dirX, dirZ, nearbyTraffic, signalAspect);
    if (this.accidentStateValue === "braking") {
      desiredSpeed = 0;
    }
    const accelerationDamageMultiplier = this.damageMultiplier(
      GAME_CONFIG.player.damageEffects.accelerationMultiplierAtMaxDamage,
    );
    const brakingDamageMultiplier = this.damageMultiplier(
      GAME_CONFIG.player.damageEffects.brakingMultiplierAtMaxDamage,
    );
    const speedChangeRate = desiredSpeed < this.speed
      ? (this.safetyBrakeMode === "light"
        ? GAME_CONFIG.traffic.intentionalCrashBraking
        : (this.pursuitTarget ? GAME_CONFIG.police.pursuitBraking : GAME_CONFIG.traffic.braking) * brakingDamageMultiplier)
      : (this.pursuitTarget ? GAME_CONFIG.police.pursuitAcceleration : GAME_CONFIG.traffic.acceleration) * accelerationDamageMultiplier;
    const maximumSpeedChange = speedChangeRate * deltaTime;
    this.speed += clamp(desiredSpeed - this.speed, -maximumSpeedChange, maximumSpeedChange);
    if (this.pursuitTarget) this.speed = Math.min(this.speed, GAME_CONFIG.police.pursuitSpeed
      * this.damageMultiplier(GAME_CONFIG.player.damageEffects.topSpeedMultiplierAtMaxDamage));

    const desiredHeading = Math.atan2(dirX, dirZ);
    const turningDamageMultiplier = this.damageMultiplier(
      GAME_CONFIG.player.damageEffects.steeringResponseMultiplierAtMaxDamage,
    );
    const headingChange = normalizeAngle(desiredHeading - this.mesh.rotation.y)
      * Math.min(1, deltaTime * 6 * turningDamageMultiplier);
    this.mesh.rotation.y = normalizeAngle(this.mesh.rotation.y + (this.pursuitTarget && !this.completingTurn
      ? clamp(headingChange, -GAME_CONFIG.police.pursuitSteeringRate * deltaTime,
        GAME_CONFIG.police.pursuitSteeringRate * deltaTime) : headingChange));
    const step = Math.min(distance, this.speed * deltaTime);
    this.velocityX = deltaTime > 0 ? (this.pursuitTarget && !this.completingTurn ? Math.sin(this.mesh.rotation.y) : dirX) * step / deltaTime : 0;
    this.velocityZ = deltaTime > 0 ? (this.pursuitTarget && !this.completingTurn ? Math.cos(this.mesh.rotation.y) : dirZ) * step / deltaTime : 0;
    this.mesh.position.x += this.velocityX * deltaTime;
    this.mesh.position.z += this.velocityZ * deltaTime;

    if (this.accidentStateValue === "braking" && this.speed <= GAME_CONFIG.traffic.accidentStopSpeed) {
      this.speed = 0;
      if (this.hasAccidentPartnerContact()) {
        this.accidentStateValue = "backing";
        this.accidentReverseRemaining = GAME_CONFIG.traffic.accidentReverseDistance;
      } else {
        this.finishAccidentBraking();
      }
    }
  }

  push(x: number, z: number): void {
    this.mesh.position.x += x;
    this.mesh.position.z += z;
  }

  getVelocityX(): number {
    return this.velocityX;
  }

  getVelocityZ(): number {
    return this.velocityZ;
  }

  get targetCruiseSpeed(): number {
    return this.cruiseSpeed;
  }

  get isTurning(): boolean {
    return this.completingTurn;
  }

  get turnSignal(): TurnSignal {
    return this.signalIntent;
  }

  refreshTurnSignal(): void {
    if (this.isPursuing || this.accidentStateValue !== "driving") {
      this.signalIntent = "off";
    } else if (this.completingTurn) {
      this.signalIntent = this.turningSignal;
    } else {
      const intended = turnSignalForDirections(this.direction, this.plannedDirection);
      const config = GAME_CONFIG.traffic.turnSignals;
      const entryDistance = Math.hypot(
        this.target.position.x - this.mesh.position.x,
        this.target.position.z - this.mesh.position.z,
      ) - GAME_CONFIG.traffic.turnCurveRadius;
      const threshold = clamp(this.cruiseSpeed * config.leadSeconds, config.minimumDistance, config.maximumDistance);
      this.signalIntent = intended !== "off" && (this.signalIntent === intended || entryDistance <= threshold)
        ? intended : "off";
    }
  }

  get isPursuing(): boolean {
    return this.pursuitTarget !== null;
  }

  get accidentState(): TrafficAccidentState {
    return this.accidentStateValue;
  }

  get damagePercent(): number {
    return this.damagePercentValue;
  }

  get isInPlayerContact(): boolean {
    return this.activeContactIds.has(-1);
  }

  beginCollisionFrame(): void {
    this.activeContactIds.clear();
  }

  markCollisionContact(otherId: number): void {
    this.activeContactIds.add(otherId);
  }

  registerCollision(
    otherId: number,
    damagePercent: number,
    serious: boolean,
    pullOverAfterSerious = true,
  ): void {
    this.signalIntent = "off";
    this.damagePercentValue = clamp(this.damagePercentValue + Math.max(0, damagePercent), 0, 1);
    this.speed *= GAME_CONFIG.player.collisionSpeedLoss;
    this.accidentPartnerId = otherId;
    if (this.pursuitTarget) {
      if (this.accidentStateValue !== "pursuitRecovery"
        && (serious || damagePercent >= GAME_CONFIG.police.collisionPoliceDamageThreshold)) {
        this.accidentStateValue = "pursuitRecovery";
        this.pursuitPhaseValue = "recover";
        this.accidentStateTimeRemaining = GAME_CONFIG.police.pursuitRecoverySeconds;
        this.velocityX *= GAME_CONFIG.player.collisionSpeedLoss;
        this.velocityZ *= GAME_CONFIG.player.collisionSpeedLoss;
        this.collisionYawRate = (this.rng() < 0.5 ? -1 : 1) * GAME_CONFIG.police.pursuitSpinRate;
        this.completingTurn = false;
        this.turnTargets.length = 0;
      }
      return;
    }
    if (serious) {
      this.resumeAfterAccident = !pullOverAfterSerious;
      this.accidentStateValue = "braking";
      return;
    }
    if (this.accidentStateValue === "driving" || this.accidentStateValue === "minorRecovery") {
      this.accidentStateValue = "minorRecovery";
      this.accidentStateTimeRemaining = GAME_CONFIG.traffic.minorCollisionRecoverySeconds;
    }
  }

  setSafetyBrakeMode(mode: "hard" | "light" | null): void {
    if (mode === null || mode === "hard" || this.safetyBrakeMode !== "hard") {
      this.safetyBrakeMode = mode;
    }
  }

  setPursuitTarget(target: TrafficPursuitTarget): void {
    if (this.role !== "police") return;
    this.signalIntent = "off";
    const wasPursuing = this.pursuitTarget !== null;
    this.pursuitTarget = {
      x: target.x,
      z: target.z,
      heading: target.heading ?? 0,
      velocityX: target.velocityX ?? 0,
      velocityZ: target.velocityZ ?? 0,
      vehicleLength: target.vehicleLength ?? GAME_CONFIG.player.length,
      vehicleWidth: target.vehicleWidth ?? GAME_CONFIG.player.width,
    };
    if (this.isPursuitDisabled) return;
    if (this.accidentStateValue === "minorRecovery"
      || this.accidentStateValue === "braking"
      || this.accidentStateValue === "backing"
      || this.accidentStateValue === "waiting"
      || this.accidentStateValue === "pullingOver"
      || this.accidentStateValue === "stopped") {
      this.accidentStateValue = "pursuitRecovery";
      this.accidentStateTimeRemaining = GAME_CONFIG.police.pursuitRecoverySeconds;
      this.accidentPullOverTarget = null;
    }
    if (this.accidentStateValue === "pursuitRecovery") return;
    if (!this.completingTurn) {
      if (!wasPursuing) this.retargetCurrentLane();
      const distanceToIntersection = Math.hypot(
        this.target.position.x - this.mesh.position.x,
        this.target.position.z - this.mesh.position.z,
      );
      this.pursuitUTurnRequested = this.pursuitUTurnCooldown <= 0
        && distanceToIntersection > GAME_CONFIG.police.pursuitTurnCommitDistance
        && shouldStartPursuitUTurn(
          this.mesh.position,
          this.waypoint,
          this.target,
          this.direction,
          target,
          this.roadPositionsX,
          this.roadPositionsZ,
        );
      if (!this.pursuitUTurnRequested
        && (!wasPursuing || distanceToIntersection > GAME_CONFIG.police.pursuitTurnCommitDistance)) {
        this.plannedDirection = this.chooseDirectionAt(this.target);
      }
    }
  }

  clearPursuit(): void {
    if (!this.pursuitTarget) return;
    this.pursuitTarget = null;
    this.pursuitPhaseValue = "catchUp";
    this.attackTimeRemaining = this.attackRetryRemaining = this.collisionYawRate = 0;
    this.pursuitUTurnRequested = false;
    this.pursuitAvoidanceOffset = 0;
    this.pursuitAvoidanceTimeRemaining = 0;
    this.pursuitPathBlocked = false;
    if (this.accidentStateValue === "pursuitRecovery") {
      this.accidentStateValue = "minorRecovery";
      this.accidentStateTimeRemaining = GAME_CONFIG.traffic.minorCollisionRecoverySeconds;
    }
    if (!this.completingTurn) {
      this.retargetCurrentLane();
      this.plannedDirection = this.chooseDirectionAt(this.target);
    }
  }

  respawn(waypoint: TrafficWaypoint, direction: Direction, progress: number): void {
    this.signalIntent = "off";
    this.turningSignal = "off";
    this.respawnGeneration += 1;
    this.waypoint = this.laneWaypoint(waypoint, direction);
    this.direction = direction;
    this.target = this.nextWaypoint();
    this.completingTurn = false;
    this.turnTargets.length = 0;
    this.pursuitUTurnRequested = false;
    this.pursuitUTurnCooldown = 0;
    this.pursuitAvoidanceOffset = 0;
    this.pursuitAvoidanceTimeRemaining = 0;
    this.pursuitPathBlocked = false;
    this.pursuitTarget = null;
    this.pursuitPhaseValue = "catchUp";
    this.attackTimeRemaining = this.attackRetryRemaining = this.collisionYawRate = 0;
    this.accidentStateValue = "driving";
    this.accidentStateTimeRemaining = 0;
    this.accidentPartnerId = null;
    this.accidentReverseRemaining = 0;
    this.accidentPullOverTarget = null;
    this.activeContactIds.clear();
    this.damagePercentValue = 0;
    this.safetyBrakeMode = null;
    this.resumeAfterAccident = false;
    this.plannedDirection = this.chooseDirectionAt(this.target);
    Vector3.LerpToRef(this.waypoint.position, this.target.position, progress, this.mesh.position);
    this.mesh.position.y = 1;
    this.velocityX = 0;
    this.velocityZ = 0;
    this.faceTarget();
  }

  dispose(): void {
    this.mesh.dispose();
  }

  static createPrototype(scene: import("@babylonjs/core/scene").Scene, material: StandardMaterial, index: number): Mesh {
    const width = GAME_CONFIG.traffic.vehicleWidth;
    const length = GAME_CONFIG.traffic.vehicleLength;
    const bodyColor = material.diffuseColor.clone();
    material.diffuseColor = Color3.White();
    const prototype = createLowPolyVehicleMesh(scene, `traffic-source-${index}`, material, {
      bodyColor,
      bodyLength: length,
      bodyWidth: width,
      bodyHeight: 1.5,
      cabinLength: length * 0.4,
      cabinWidth: width * 0.72,
      cabinHeight: 1.05,
    });
    prototype.position.y = -10000;
    return prototype;
  }

  static createPolicePrototype(scene: import("@babylonjs/core/scene").Scene, material: StandardMaterial): Mesh {
    const width = GAME_CONFIG.traffic.vehicleWidth;
    const length = GAME_CONFIG.traffic.vehicleLength;
    material.diffuseColor = Color3.White();
    const prototype = createLowPolyVehicleMesh(scene, "police-source", material, {
      bodyColor: new Color3(0.035, 0.055, 0.075),
      bodyLength: length,
      bodyWidth: width,
      bodyHeight: 1.5,
      cabinLength: length * 0.4,
      cabinWidth: width * 0.72,
      cabinHeight: 1.05,
      police: true,
    });
    prototype.position.y = -10000;
    return prototype;
  }

  private updateCruiseSpeed(deltaTime: number): void {
    this.speedChangeTimeRemaining -= deltaTime;
    if (this.speedChangeTimeRemaining > 0) return;
    this.cruiseSpeed = randomBetween(this.rng, GAME_CONFIG.traffic.minSpeed, GAME_CONFIG.traffic.maxSpeed);
    this.speedChangeTimeRemaining = this.randomSpeedChangeInterval();
  }

  private randomSpeedChangeInterval(): number {
    return randomBetween(
      this.rng,
      GAME_CONFIG.traffic.minSpeedChangeSeconds,
      GAME_CONFIG.traffic.maxSpeedChangeSeconds,
    );
  }

  private chooseDirectionAt(waypoint: TrafficWaypoint): Direction {
    if (this.pursuitTarget) {
      const predictedTarget = this.predictedPursuitTarget();
      return choosePursuitDirection(
        waypoint,
        this.direction,
        predictedTarget,
        this.roadPositionsX,
        this.roadPositionsZ,
        this.pursuitUTurnCooldown <= 0,
      );
    }
    const valid = this.validDirectionsAt(waypoint);
    const nonReversing = valid.filter((direction) => direction !== this.oppositeDirection());
    const options = nonReversing.length > 0 ? nonReversing : valid;
    if (options.includes(this.direction) && this.rng() < 0.55) {
      return this.direction;
    }
    return options[Math.floor(this.rng() * options.length)];
  }

  private validDirectionsAt(waypoint: TrafficWaypoint): Direction[] {
    return validDirectionsAt(waypoint, this.roadPositionsX.length, this.roadPositionsZ.length);
  }

  private oppositeDirection(): Direction {
    return oppositeDirection(this.direction);
  }

  private advanceRoute(): void {
    this.mesh.position.x = this.target.position.x;
    this.mesh.position.z = this.target.position.z;
    this.waypoint = this.target;

    if (this.completingTurn && this.turnTargets.length > 0) {
      this.target = this.turnTargets.shift()!;
      return;
    }
    if (this.completingTurn) {
      this.completingTurn = false;
      this.signalIntent = "off";
      this.turningSignal = "off";
      this.target = this.nextWaypoint();
      this.plannedDirection = this.chooseDirectionAt(this.target);
      return;
    }

    const previousDirection = this.direction;
    this.direction = this.plannedDirection;
    if (this.direction === previousDirection) {
      this.target = this.nextWaypoint();
      this.plannedDirection = this.chooseDirectionAt(this.target);
      return;
    }

    if (this.direction === oppositeDirection(previousDirection)) {
      this.beginUTurn(previousDirection, this.waypoint);
      return;
    }

    this.beginTurn(previousDirection, this.waypoint);
  }

  private beginUTurn(previousDirection: Direction, routeWaypoint: TrafficWaypoint): void {
    this.turningSignal = turnSignalForDirections(previousDirection, oppositeDirection(previousDirection));
    this.pursuitUTurnRequested = false;
    if (this.pursuitTarget) {
      this.pursuitUTurnCooldown = GAME_CONFIG.police.pursuitUTurnCooldownSeconds;
    }
    this.direction = oppositeDirection(previousDirection);
    this.plannedDirection = this.direction;
    const turnEnd = this.mesh.position.clone();
    const roadCenter = previousDirection === "east" || previousDirection === "west"
      ? this.roadPositionsZ[routeWaypoint.iz]
      : this.roadPositionsX[routeWaypoint.ix];
    const laneOffset = this.pursuitTarget
      ? GAME_CONFIG.police.pursuitLaneOffset
      : GAME_CONFIG.traffic.laneOffset;
    if (this.direction === "east") turnEnd.z = roadCenter - laneOffset;
    if (this.direction === "west") turnEnd.z = roadCenter + laneOffset;
    if (this.direction === "north") turnEnd.x = roadCenter - laneOffset;
    if (this.direction === "south") turnEnd.x = roadCenter + laneOffset;

    this.turnTargets.length = 0;
    const points = createTrafficUTurnPath(
      this.mesh.position,
      turnEnd,
      previousDirection,
      GAME_CONFIG.traffic.turnCurveSegments * 2,
    );
    this.turnTargets.push(...points.map((position) => ({
      position,
      ix: routeWaypoint.ix,
      iz: routeWaypoint.iz,
    })));
    this.target = this.turnTargets.shift()!;
    this.completingTurn = true;
  }

  private beginTurn(previousDirection: Direction, intersectionWaypoint: TrafficWaypoint): void {
    this.turningSignal = turnSignalForDirections(previousDirection, this.plannedDirection);
    this.direction = this.plannedDirection;
    const intersection = new Vector3(
      this.roadPositionsX[intersectionWaypoint.ix],
      1,
      this.roadPositionsZ[intersectionWaypoint.iz],
    );
    const turnEnd = this.laneWaypoint({
      position: intersection,
      ix: intersectionWaypoint.ix,
      iz: intersectionWaypoint.iz,
    }, this.direction);
    this.moveAlongDirection(turnEnd.position, this.direction, GAME_CONFIG.traffic.turnCurveRadius);
    this.turnTargets.length = 0;
    const points = createTrafficTurnPath(
      this.mesh.position,
      turnEnd.position,
      previousDirection,
      GAME_CONFIG.traffic.turnCurveSegments,
    );
    this.turnTargets.push(...points.map((position) => ({
      position,
      ix: intersectionWaypoint.ix,
      iz: intersectionWaypoint.iz,
    })));
    this.target = this.turnTargets.shift()!;
    this.completingTurn = true;
  }

  private moveAlongDirection(position: Vector3, direction: Direction, distance: number): void {
    if (direction === "north") position.z -= distance;
    if (direction === "south") position.z += distance;
    if (direction === "west") position.x -= distance;
    if (direction === "east") position.x += distance;
  }

  private nextWaypoint(): TrafficWaypoint {
    const next = nextIndices(this.waypoint.ix, this.waypoint.iz, this.direction);
    const ix = Math.max(0, Math.min(this.roadPositionsX.length - 1, next.ix));
    const iz = Math.max(0, Math.min(this.roadPositionsZ.length - 1, next.iz));
    return this.laneWaypoint({
      position: new Vector3(this.roadPositionsX[ix], 1, this.roadPositionsZ[iz]),
      ix,
      iz,
    }, this.direction);
  }

  private laneWaypoint(waypoint: TrafficWaypoint, direction: Direction): TrafficWaypoint {
    const position = waypoint.position.clone();
    const offset = this.pursuitTarget
      ? GAME_CONFIG.police.pursuitLaneOffset
      : GAME_CONFIG.traffic.laneOffset;
    if (direction === "north") position.x -= offset;
    if (direction === "south") position.x += offset;
    if (direction === "east") position.z -= offset;
    if (direction === "west") position.z += offset;
    return { position, ix: waypoint.ix, iz: waypoint.iz };
  }

  private retargetCurrentLane(): void {
    this.target = this.laneWaypoint({
      position: new Vector3(
        this.roadPositionsX[this.target.ix],
        1,
        this.roadPositionsZ[this.target.iz],
      ),
      ix: this.target.ix,
      iz: this.target.iz,
    }, this.direction);
  }

  private faceTarget(): void {
    const dx = this.target.position.x - this.mesh.position.x;
    const dz = this.target.position.z - this.mesh.position.z;
    this.mesh.rotation.y = Math.atan2(dx, dz);
  }

  get pursuitPhase(): PursuitPhase {
    return this.isPursuitDisabled ? "disabled"
      : this.accidentStateValue === "pursuitRecovery" ? "recover" : this.pursuitPhaseValue;
  }

  get isPursuitDisabled(): boolean {
    return this.role === "police" && this.damagePercentValue >= 1;
  }

  get pursuitRecoveryRemaining(): number {
    return this.accidentStateValue === "pursuitRecovery" ? this.accidentStateTimeRemaining : 0;
  }

  createRamImpact(
    closingSpeedMph: number,
    directness: number,
    contactTarget: { x: number; z: number; heading: number; vehicleLength: number } = this.pursuitTarget!,
  ): PursuitImpact | null {
    if (!this.pursuitTarget || this.pursuitPhase !== "ram"
      || closingSpeedMph < GAME_CONFIG.police.pursuitRamMinimumImpactMph) return null;
    const target = contactTarget;
    const dx = this.mesh.position.x - target.x;
    const dz = this.mesh.position.z - target.z;
    const behind = -(dx * Math.sin(target.heading) + dz * Math.cos(target.heading));
    if (behind < target.vehicleLength * 0.2
      || Math.abs(normalizeAngle(this.mesh.rotation.y - target.heading)) > Math.PI / 3) return null;
    const side = Math.sign(dx * Math.cos(target.heading) - dz * Math.sin(target.heading)) || this.attackSide;
    return createPursuitImpact(closingSpeedMph, directness, target.heading, side, this.rng());
  }

  applyPursuitImpact(impact: PursuitImpact): void {
    // registerCollision has already reduced forward momentum and started recovery.
    this.velocityX -= impact.velocityX;
    this.velocityZ -= impact.velocityZ;
    this.collisionYawRate = -impact.yawRate;
  }

  private cancelAttack(): void {
    this.pursuitPhaseValue = "catchUp";
    this.attackTimeRemaining = 0;
    this.attackRetryRemaining = GAME_CONFIG.police.pursuitRamRetrySeconds;
  }

  private updatePursuitAttack(deltaTime: number, traffic: TrafficCar[]): void {
    const target = this.pursuitTarget!;
    const dx = this.mesh.position.x - target.x;
    const dz = this.mesh.position.z - target.z;
    const behind = -(dx * Math.sin(target.heading) + dz * Math.cos(target.heading));
    const lateral = dx * Math.cos(target.heading) - dz * Math.sin(target.heading);
    const speedMph = Math.hypot(target.velocityX, target.velocityZ) * GAME_CONFIG.ride.mphPerWorldUnitPerSecond;
    if (this.pursuitPhaseValue === "align" || this.pursuitPhaseValue === "ram") {
      this.attackTimeRemaining -= deltaTime;
      if (this.completingTurn || this.attackTimeRemaining <= 0 || behind < 0
        || speedMph < GAME_CONFIG.police.pursuitArrestSpeedMph
        || Math.abs(normalizeAngle(target.heading - this.attackHeading)) > Math.PI / 4
        || !this.sharedRoadCorridor(target.x, target.z)) {
        this.cancelAttack();
        return;
      }
      if (this.pursuitPhaseValue === "align" && behind < 22
        && Math.abs(lateral - this.attackSide * target.vehicleWidth * 0.55) < 1.8) {
        this.pursuitPhaseValue = "ram";
        this.attackTimeRemaining = GAME_CONFIG.police.pursuitRamCommitSeconds;
      }
      return;
    }
    if (this.completingTurn || this.attackRetryRemaining > 0 || behind <= 0
      || Math.hypot(dx, dz) * GAME_CONFIG.ride.metersPerWorldUnit > GAME_CONFIG.police.pursuitAttackRangeMeters
      || speedMph < GAME_CONFIG.police.pursuitArrestSpeedMph
      || Math.abs(normalizeAngle(this.mesh.rotation.y - target.heading)) > Math.PI / 4) return;
    const corridor = this.sharedRoadCorridor(target.x, target.z);
    if (!corridor) return;
    let bestSide = 0;
    let bestScore = -Infinity;
    for (const side of [-1, 1]) {
      const x = target.x - Math.sin(target.heading) * 15 + Math.cos(target.heading) * side * target.vehicleWidth * 0.55;
      const z = target.z - Math.cos(target.heading) * 15 - Math.sin(target.heading) * side * target.vehicleWidth * 0.55;
      const clamped = this.clampToRoadCorridor(x, z, corridor);
      if (Math.hypot(clamped.x - x, clamped.z - z) > 0.1) continue;
      const clearance = this.pathClearance(x, z, traffic);
      if (clearance < GAME_CONFIG.police.pursuitAvoidanceClearance) continue;
      const score = Math.min(clearance, 30) - Math.abs(lateral - side * target.vehicleWidth * 0.55);
      if (score > bestScore) { bestScore = score; bestSide = side; }
    }
    if (!bestSide) {
      this.attackRetryRemaining = GAME_CONFIG.police.pursuitRamRetrySeconds;
      return;
    }
    this.attackSide = bestSide;
    this.attackHeading = target.heading;
    this.attackTimeRemaining = GAME_CONFIG.police.pursuitAlignTimeoutSeconds;
    this.pursuitPhaseValue = "align";
    this.pursuitAvoidanceTimeRemaining = 0;
  }

  private updatePursuitRecovery(deltaTime: number): void {
    this.mesh.rotation.y = normalizeAngle(this.mesh.rotation.y + this.collisionYawRate * deltaTime);
    this.collisionYawRate *= Math.exp(-GAME_CONFIG.police.pursuitSpinDamping * deltaTime);
    const drag = Math.exp(-3 * deltaTime);
    this.velocityX *= drag;
    this.velocityZ *= drag;
    const nextX = this.mesh.position.x + this.velocityX * deltaTime;
    const nextZ = this.mesh.position.z + this.velocityZ * deltaTime;
    // Keep the sliding collision body on the road; NPCs do not use the player's building solver.
    const roadX = nearestValue(this.roadPositionsX, this.mesh.position.x);
    const roadZ = nearestValue(this.roadPositionsZ, this.mesh.position.z);
    const corridor = Math.abs(this.mesh.position.x - roadX) < Math.abs(this.mesh.position.z - roadZ)
      ? { axis: "x" as const, center: roadX } : { axis: "z" as const, center: roadZ };
    const constrained = this.clampToRoadCorridor(nextX, nextZ, corridor);
    this.mesh.position.x = constrained.x;
    this.mesh.position.z = constrained.z;
    if (constrained.x !== nextX) this.velocityX = 0;
    if (constrained.z !== nextZ) this.velocityZ = 0;
    this.speed = Math.hypot(this.velocityX, this.velocityZ);
    if (this.accidentStateTimeRemaining > 1e-6) return;
    this.speed = this.velocityX = this.velocityZ = this.collisionYawRate = 0;
    this.accidentStateValue = this.isPursuitDisabled ? "stopped" : "driving";
    this.pursuitPhaseValue = this.isPursuitDisabled ? "disabled" : "catchUp";
    this.attackRetryRemaining = GAME_CONFIG.police.pursuitRamRetrySeconds;
    this.accidentPartnerId = null;
    this.pursuitUTurnRequested = false;
    // Rebuild the route from the crash location, without changing the physical heading or position.
    const horizontal = corridor.axis === "z";
    const target = this.pursuitTarget!;
    this.direction = horizontal ? (target.x >= this.mesh.position.x ? "east" : "west")
      : (target.z >= this.mesh.position.z ? "south" : "north");
    const ix = this.roadPositionsX.indexOf(roadX);
    const iz = this.roadPositionsZ.indexOf(roadZ);
    this.waypoint = this.laneWaypoint({ position: new Vector3(roadX, 1, roadZ), ix, iz }, this.direction);
    this.target = this.nextWaypoint();
    this.plannedDirection = this.chooseDirectionAt(this.target);
  }

  private predictedPursuitTarget(): ResolvedTrafficPursuitTarget {
    const target = this.pursuitTarget!;
    const seconds = GAME_CONFIG.police.pursuitPredictionSeconds;
    return {
      ...target,
      x: target.x + target.velocityX * seconds,
      z: target.z + target.velocityZ * seconds,
    };
  }

  private chooseDriveTarget(traffic: TrafficCar[]): { x: number; z: number } {
    if (!this.pursuitTarget || this.completingTurn) {
      this.pursuitPathBlocked = false;
      return this.target.position;
    }

    const target = this.predictedPursuitTarget();
    const centerDistance = Math.hypot(target.x - this.mesh.position.x, target.z - this.mesh.position.z);
    let baseX = this.target.position.x;
    let baseZ = this.target.position.z;
    if (centerDistance <= GAME_CONFIG.police.pursuitDirectSteeringDistance) {
      let pursuitX = target.x;
      let pursuitZ = target.z;
      if (this.pursuitPhaseValue === "align" || this.pursuitPhaseValue === "ram") {
        const live = this.pursuitTarget;
        const ram = this.pursuitPhaseValue === "ram";
        const lead = ram ? 0.08 : 0;
        const behind = ram ? live.vehicleLength * 0.3
          : live.vehicleLength / 2 + GAME_CONFIG.traffic.vehicleLength / 2 + 6;
        const side = this.attackSide * live.vehicleWidth * (ram ? 0.15 : 0.55);
        pursuitX = live.x + live.velocityX * lead - Math.sin(live.heading) * behind + Math.cos(live.heading) * side;
        pursuitZ = live.z + live.velocityZ * lead - Math.cos(live.heading) * behind - Math.sin(live.heading) * side;
      } else if (centerDistance <= GAME_CONFIG.police.pursuitTrailingTargetDistance
        && Math.hypot(target.velocityX, target.velocityZ) * GAME_CONFIG.ride.mphPerWorldUnitPerSecond < GAME_CONFIG.police.pursuitArrestSpeedMph) {
        const followingDistance = target.vehicleLength / 2
          + GAME_CONFIG.traffic.vehicleLength / 2
          + GAME_CONFIG.police.pursuitDesiredGapMeters / GAME_CONFIG.ride.metersPerWorldUnit;
        pursuitX -= Math.sin(target.heading) * followingDistance;
        pursuitZ -= Math.cos(target.heading) * followingDistance;
      }
      if (this.sharedRoadCorridor(pursuitX, pursuitZ)) {
        baseX = pursuitX;
        baseZ = pursuitZ;
      }
    }

    const corridor = this.sharedRoadCorridor(baseX, baseZ);
    if (!corridor) {
      this.pursuitPathBlocked = false;
      return { x: baseX, z: baseZ };
    }
    const dx = baseX - this.mesh.position.x;
    const dz = baseZ - this.mesh.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.1) return { x: baseX, z: baseZ };
    const forwardX = dx / distance;
    const forwardZ = dz / distance;
    const steeringDistance = Math.min(distance, GAME_CONFIG.police.pursuitAvoidanceLookAheadDistance);
    const steeringBaseX = this.mesh.position.x + forwardX * steeringDistance;
    const steeringBaseZ = this.mesh.position.z + forwardZ * steeringDistance;
    const rightX = forwardZ;
    const rightZ = -forwardX;
    const candidateOffsets = this.pursuitAvoidanceTimeRemaining > 0
      ? [this.pursuitAvoidanceOffset]
      : [0, -GAME_CONFIG.police.pursuitAvoidanceOffset, GAME_CONFIG.police.pursuitAvoidanceOffset];
    let bestOffset = candidateOffsets[0];
    let bestClearance = -1;
    for (const offset of candidateOffsets) {
      const candidate = this.clampToRoadCorridor(
        steeringBaseX + rightX * offset,
        steeringBaseZ + rightZ * offset,
        corridor,
      );
      const clearance = this.pathClearance(candidate.x, candidate.z, traffic);
      if (clearance > bestClearance) {
        bestClearance = clearance;
        bestOffset = offset;
      }
      if (offset === 0 && clearance >= GAME_CONFIG.police.pursuitAvoidanceClearance) break;
    }
    if (this.pursuitAvoidanceTimeRemaining <= 0 && bestOffset !== 0) {
      this.pursuitAvoidanceOffset = bestOffset;
      this.pursuitAvoidanceTimeRemaining = GAME_CONFIG.police.pursuitAvoidanceCommitSeconds;
    }
    if (this.pursuitAvoidanceTimeRemaining <= 0 && bestOffset === 0) {
      this.pursuitAvoidanceOffset = 0;
    }
    this.pursuitPathBlocked = bestClearance < GAME_CONFIG.police.pursuitAvoidanceClearance;
    return this.clampToRoadCorridor(
      steeringBaseX + rightX * bestOffset,
      steeringBaseZ + rightZ * bestOffset,
      corridor,
    );
  }

  private sharedRoadCorridor(targetX: number, targetZ: number): { axis: "x" | "z"; center: number } | null {
    const roadHalfWidth = GAME_CONFIG.world.roadWidth / 2;
    const roadsideAllowance = GAME_CONFIG.world.sidewalkWidth + GAME_CONFIG.player.width / 2;
    const nearestX = nearestValue(this.roadPositionsX, this.mesh.position.x);
    const targetNearestX = nearestValue(this.roadPositionsX, targetX);
    const nearestZ = nearestValue(this.roadPositionsZ, this.mesh.position.z);
    const targetNearestZ = nearestValue(this.roadPositionsZ, targetZ);
    const sharesVertical = nearestX === targetNearestX
      && Math.abs(this.mesh.position.x - nearestX) <= roadHalfWidth
      && Math.abs(targetX - nearestX) <= roadHalfWidth + roadsideAllowance;
    const sharesHorizontal = nearestZ === targetNearestZ
      && Math.abs(this.mesh.position.z - nearestZ) <= roadHalfWidth
      && Math.abs(targetZ - nearestZ) <= roadHalfWidth + roadsideAllowance;
    if (sharesVertical && sharesHorizontal && this.pursuitTarget) {
      return Math.abs(Math.sin(this.pursuitTarget.heading)) >= Math.abs(Math.cos(this.pursuitTarget.heading))
        ? { axis: "z", center: nearestZ }
        : { axis: "x", center: nearestX };
    }
    if (sharesHorizontal) return { axis: "z", center: nearestZ };
    if (sharesVertical) return { axis: "x", center: nearestX };
    return null;
  }

  private clampToRoadCorridor(
    x: number,
    z: number,
    corridor: { axis: "x" | "z"; center: number },
  ): { x: number; z: number } {
    const inset = GAME_CONFIG.world.roadWidth / 2
      - GAME_CONFIG.traffic.vehicleWidth / 2
      - GAME_CONFIG.traffic.accidentCurbClearance;
    if (corridor.axis === "x") {
      return { x: clamp(x, corridor.center - inset, corridor.center + inset), z };
    }
    return { x, z: clamp(z, corridor.center - inset, corridor.center + inset) };
  }

  private pathClearance(targetX: number, targetZ: number, traffic: TrafficCar[]): number {
    let minimum = Number.POSITIVE_INFINITY;
    const prediction = GAME_CONFIG.police.pursuitAvoidancePredictionSeconds;
    // The pursuit target is the destination of this path, not an obstacle.
    // Including it here made every direct pursuit path look blocked and could
    // reduce a distant officer's speed to zero.
    for (const other of traffic) {
      if (other === this) continue;
      const predictedX = other.mesh.position.x + other.velocityX * prediction;
      const predictedZ = other.mesh.position.z + other.velocityZ * prediction;
      minimum = Math.min(minimum, pointSegmentDistance(
        predictedX,
        predictedZ,
        this.mesh.position.x,
        this.mesh.position.z,
        targetX,
        targetZ,
      ));
    }
    return minimum;
  }

  private updateBacking(deltaTime: number): void {
    if (!this.hasAccidentPartnerContact() || this.accidentReverseRemaining <= 0) {
      this.finishAccidentBraking();
      return;
    }
    const step = Math.min(
      this.accidentReverseRemaining,
      GAME_CONFIG.traffic.accidentReverseSpeed * deltaTime,
    );
    const forwardX = Math.sin(this.mesh.rotation.y);
    const forwardZ = Math.cos(this.mesh.rotation.y);
    this.mesh.position.x -= forwardX * step;
    this.mesh.position.z -= forwardZ * step;
    this.velocityX = deltaTime > 0 ? -forwardX * step / deltaTime : 0;
    this.velocityZ = deltaTime > 0 ? -forwardZ * step / deltaTime : 0;
    this.accidentReverseRemaining -= step;
  }

  private finishAccidentBraking(): void {
    if (this.resumeAfterAccident) {
      this.accidentStateValue = "waiting";
      this.accidentStateTimeRemaining = GAME_CONFIG.traffic.npcCollisionWaitSeconds;
      this.accidentPartnerId = null;
      this.speed = 0;
      this.velocityX = 0;
      this.velocityZ = 0;
      return;
    }
    this.beginPullingOver();
  }

  private beginPullingOver(): void {
    const forward = directionVector(this.direction);
    const roadHalfWidth = GAME_CONFIG.world.roadWidth / 2;
    const curbInset = GAME_CONFIG.traffic.vehicleWidth / 2 + GAME_CONFIG.traffic.accidentCurbClearance;
    const lateral = roadHalfWidth - curbInset;
    let x = this.mesh.position.x + forward.x * GAME_CONFIG.traffic.accidentPullOverForwardDistance;
    let z = this.mesh.position.z + forward.z * GAME_CONFIG.traffic.accidentPullOverForwardDistance;
    if (this.direction === "north") x = nearestValue(this.roadPositionsX, this.mesh.position.x) - lateral;
    if (this.direction === "south") x = nearestValue(this.roadPositionsX, this.mesh.position.x) + lateral;
    if (this.direction === "east") z = nearestValue(this.roadPositionsZ, this.mesh.position.z) - lateral;
    if (this.direction === "west") z = nearestValue(this.roadPositionsZ, this.mesh.position.z) + lateral;
    this.accidentPullOverTarget = new Vector3(x, 1, z);
    this.accidentStateValue = "pullingOver";
    this.accidentPartnerId = null;
  }

  private updatePullingOver(deltaTime: number, traffic: TrafficCar[]): void {
    const target = this.accidentPullOverTarget;
    if (!target) {
      this.accidentStateValue = "stopped";
      return;
    }
    const dx = target.x - this.mesh.position.x;
    const dz = target.z - this.mesh.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.5) {
      this.mesh.position.x = target.x;
      this.mesh.position.z = target.z;
      this.speed = 0;
      this.velocityX = 0;
      this.velocityZ = 0;
      this.accidentStateValue = "stopped";
      return;
    }
    const dirX = dx / distance;
    const dirZ = dz / distance;
    const leader = this.findLeadVehicle(dirX, dirZ, traffic);
    const desiredSpeed = leader && leader.bumperGap < GAME_CONFIG.traffic.minimumFollowingGap
      ? 0
      : GAME_CONFIG.traffic.accidentPullOverSpeed;
    this.speed += clamp(
      desiredSpeed - this.speed,
      -GAME_CONFIG.traffic.braking * deltaTime,
      GAME_CONFIG.traffic.acceleration * deltaTime,
    );
    const step = Math.min(distance, this.speed * deltaTime);
    this.mesh.position.x += dirX * step;
    this.mesh.position.z += dirZ * step;
    this.velocityX = deltaTime > 0 ? dirX * step / deltaTime : 0;
    this.velocityZ = deltaTime > 0 ? dirZ * step / deltaTime : 0;
    const desiredHeading = Math.atan2(dirX, dirZ);
    this.mesh.rotation.y += normalizeAngle(desiredHeading - this.mesh.rotation.y) * Math.min(1, deltaTime * 4);
  }

  private hasAccidentPartnerContact(): boolean {
    return this.accidentPartnerId !== null && this.activeContactIds.has(this.accidentPartnerId);
  }

  private damageMultiplier(multiplierAtMaxDamage: number): number {
    return lerp(1, multiplierAtMaxDamage, this.damagePercentValue);
  }

  private desiredSpeed(
    distanceToTarget: number,
    forwardX: number,
    forwardZ: number,
    traffic: TrafficCar[],
    signalAspect: TrafficSignalAspect,
  ): number {
    let cruisingSpeed = this.pursuitTarget ? GAME_CONFIG.police.pursuitSpeed : this.cruiseSpeed;
    let turnSpeed = this.pursuitTarget ? GAME_CONFIG.police.pursuitTurnSpeed : GAME_CONFIG.traffic.turnSpeed;
    if (this.pursuitTarget) {
      const speedMultiplier = this.damageMultiplier(
        GAME_CONFIG.player.damageEffects.topSpeedMultiplierAtMaxDamage,
      );
      const turnMultiplier = this.damageMultiplier(
        GAME_CONFIG.player.damageEffects.yawRateMultiplierAtMaxDamage,
      );
      const playerSpeed = Math.hypot(this.pursuitTarget.velocityX, this.pursuitTarget.velocityZ);
      cruisingSpeed *= speedMultiplier;
      turnSpeed *= turnMultiplier;
      const centerDistance = Math.hypot(
        this.pursuitTarget.x - this.mesh.position.x,
        this.pursuitTarget.z - this.mesh.position.z,
      );
      if (playerSpeed * GAME_CONFIG.ride.mphPerWorldUnitPerSecond < GAME_CONFIG.police.pursuitArrestSpeedMph
        && centerDistance <= GAME_CONFIG.police.pursuitDirectSteeringDistance) {
        const desiredCenterDistance = this.pursuitTarget.vehicleLength / 2
          + GAME_CONFIG.traffic.vehicleLength / 2
          + GAME_CONFIG.police.pursuitDesiredGapMeters / GAME_CONFIG.ride.metersPerWorldUnit;
        const gap = Math.max(0, centerDistance - desiredCenterDistance);
        cruisingSpeed = Math.min(cruisingSpeed, playerSpeed + gap * GAME_CONFIG.police.pursuitGapSpeedCorrection);
      } else if (this.pursuitPhaseValue === "align" || this.pursuitPhaseValue === "ram") {
        const closing = this.pursuitPhaseValue === "ram" ? GAME_CONFIG.police.pursuitRamClosingSpeedMph : 12;
        cruisingSpeed = Math.min(cruisingSpeed, playerSpeed + closing / GAME_CONFIG.ride.mphPerWorldUnitPerSecond);
      }
      if (this.pursuitPathBlocked) cruisingSpeed = 0;
    }
    let targetSpeed = cruisingSpeed;
    const approachingTurn = !this.completingTurn && this.plannedDirection !== this.direction;
    if (this.completingTurn) {
      targetSpeed = Math.min(targetSpeed, turnSpeed);
    } else if (approachingTurn && distanceToTarget < GAME_CONFIG.traffic.turnSlowdownDistance) {
      const turnAmount = 1 - distanceToTarget / GAME_CONFIG.traffic.turnSlowdownDistance;
      targetSpeed = Math.min(
        targetSpeed,
        lerp(cruisingSpeed, turnSpeed, clamp(turnAmount, 0, 1)),
      );
    }

    if (!this.pursuitTarget && !this.completingTurn) {
      const signalLimit = trafficSignalSpeedLimit(signalAspect, this.speed, distanceToTarget);
      if (signalLimit !== null) targetSpeed = Math.min(targetSpeed, signalLimit);
    }

    if (this.safetyBrakeMode === "hard") {
      targetSpeed = 0;
    } else if (this.safetyBrakeMode === "light") {
      targetSpeed = Math.min(targetSpeed, Math.max(0, this.speed - 5));
    }

    const leader = this.findLeadVehicle(forwardX, forwardZ, traffic);
    if (!leader) return targetSpeed;
    const minimumGap = this.pursuitTarget
      ? GAME_CONFIG.police.pursuitMinimumFollowingGap
      : GAME_CONFIG.traffic.minimumFollowingGap;
    const timeHeadway = this.pursuitTarget
      ? GAME_CONFIG.police.pursuitFollowingTimeHeadway
      : GAME_CONFIG.traffic.followingTimeHeadway;
    const desiredGap = minimumGap + this.speed * timeHeadway;
    if (this.pursuitTarget && leader.bumperGap > minimumGap) return targetSpeed;
    const followingTarget = Math.max(
      0,
      leader.forwardSpeed
        + (leader.bumperGap - desiredGap) * GAME_CONFIG.traffic.followingSpeedCorrection,
    );
    return Math.min(targetSpeed, followingTarget);
  }

  private findLeadVehicle(forwardX: number, forwardZ: number, traffic: TrafficCar[]): LeadVehicle | null {
    let nearest: LeadVehicle | null = null;
    for (const other of traffic) {
      if (other === this) continue;
      const offsetX = other.mesh.position.x - this.mesh.position.x;
      const offsetZ = other.mesh.position.z - this.mesh.position.z;
      const forwardDistance = forwardX * offsetX + forwardZ * offsetZ;
      if (forwardDistance <= 0 || forwardDistance > GAME_CONFIG.traffic.lookAheadDistance) continue;
      const lateralDistance = Math.abs(-forwardZ * offsetX + forwardX * offsetZ);
      if (lateralDistance > GAME_CONFIG.traffic.sameLaneTolerance) continue;

      const otherVelocityLength = Math.hypot(other.velocityX, other.velocityZ);
      const otherForwardX = otherVelocityLength > 0.1
        ? other.velocityX / otherVelocityLength
        : Math.sin(other.mesh.rotation.y);
      const otherForwardZ = otherVelocityLength > 0.1
        ? other.velocityZ / otherVelocityLength
        : Math.cos(other.mesh.rotation.y);
      if (forwardX * otherForwardX + forwardZ * otherForwardZ < GAME_CONFIG.traffic.sameDirectionAlignment) continue;

      const bumperGap = forwardDistance - GAME_CONFIG.traffic.hitboxLength;
      if (nearest && bumperGap >= nearest.bumperGap) continue;
      nearest = {
        bumperGap,
        forwardSpeed: Math.max(0, other.velocityX * forwardX + other.velocityZ * forwardZ),
      };
    }
    return nearest;
  }
}

function validDirectionsAt(waypoint: TrafficWaypoint, maxX: number, maxZ: number): Direction[] {
  const options: Direction[] = [];
  if (waypoint.iz > 0) options.push("north");
  if (waypoint.iz < maxZ - 1) options.push("south");
  if (waypoint.ix > 0) options.push("west");
  if (waypoint.ix < maxX - 1) options.push("east");
  return options;
}

function oppositeDirection(direction: Direction): Direction {
  if (direction === "north") return "south";
  if (direction === "south") return "north";
  if (direction === "east") return "west";
  return "east";
}

function nextIndices(ix: number, iz: number, direction: Direction): { ix: number; iz: number } {
  if (direction === "north") return { ix, iz: iz - 1 };
  if (direction === "south") return { ix, iz: iz + 1 };
  if (direction === "west") return { ix: ix - 1, iz };
  return { ix: ix + 1, iz };
}

function directionVector(direction: Direction): { x: number; z: number } {
  if (direction === "north") return { x: 0, z: -1 };
  if (direction === "south") return { x: 0, z: 1 };
  if (direction === "west") return { x: -1, z: 0 };
  return { x: 1, z: 0 };
}

function nearestValue(values: number[], target: number): number {
  let nearest = values[0];
  let nearestDistance = Math.abs(target - nearest);
  for (let index = 1; index < values.length; index++) {
    const distance = Math.abs(target - values[index]);
    if (distance < nearestDistance) {
      nearest = values[index];
      nearestDistance = distance;
    }
  }
  return nearest;
}

function pointSegmentDistance(
  pointX: number,
  pointZ: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-6) return Math.hypot(pointX - startX, pointZ - startZ);
  const t = clamp(((pointX - startX) * dx + (pointZ - startZ) * dz) / lengthSquared, 0, 1);
  return Math.hypot(pointX - (startX + dx * t), pointZ - (startZ + dz * t));
}

export type { Direction };
