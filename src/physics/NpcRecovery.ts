import { GAME_CONFIG } from "../game/config";
import type { BoxCollider } from "../game/types";
import { createBoxContact, findOrientedBoxCollision, type OrientedBox2D } from "../traffic/OrientedBoxCollision";
import { clamp, lerp, normalizeAngle } from "../utils/math";
import type { WorldQuery } from "../world/WorldQuery";
import type { VehicleBody } from "./VehicleBody";

export interface RecoveryHandling {
  topSpeed: number; turning: number; acceleration: number; braking: number;
}
export interface RecoveryIntent {
  x: number; z: number; speed: number;
  handling: RecoveryHandling;
  stop?: boolean;
  allowPause?: boolean;
  reactionSeconds?: number;
  steeringRecoverySeconds?: number;
  forceManeuver?: boolean;
}
export interface RecoveryVehicle {
  readonly collisionBody: VehicleBody;
  readonly mesh?: { isEnabled(): boolean };
}

/** Steering envelope shared by real recovery motion and its inexpensive obstacle probes. */
export function recoveryYawLimit(speed: number, handling: RecoveryHandling): number {
  const p = GAME_CONFIG.player, movement = Math.abs(speed);
  const activation = clamp((movement - p.minimumSteeringSpeed) / (p.fullSteeringSpeed - p.minimumSteeringSpeed), 0, 1);
  const rate = lerp(p.lowSpeedYawRate, p.highSpeedYawRate, clamp(movement / handling.topSpeed, 0, 1))
    * handling.turning * activation;
  const radius = p.fullSteeringSpeed / (p.lowSpeedYawRate * handling.turning);
  return Math.min(rate, movement / radius);
}

/** One impact episode. Never reset its pause/watchdog just because contact persists. */
export class NpcRecovery {
  active = false;
  pauseRemaining = 0;
  pauseUsed = false;
  maneuvering = false;
  noProgressSeconds = 0;
  steeringYaw = 0;
  gear = 1;
  steering = 0;
  blocked = false;
  probeCount = 0;
  private referenceHeading = 0;
  private confirmSeconds = 0;
  private age = 0;
  private gripAge = 0;
  private probeRemaining = 0;
  private bestDistance = Infinity;
  private bestError = Infinity;
  private targetX = Infinity;
  private targetZ = Infinity;
  private readonly colliders: BoxCollider[] = [];
  private readonly probe: OrientedBox2D = { x: 0, z: 0, heading: 0, halfWidth: 0, halfLength: 0 };
  private readonly obstacle: OrientedBox2D = { x: 0, z: 0, heading: 0, halfWidth: 0, halfLength: 0 };
  private readonly hit = createBoxContact();

  reset(): void {
    this.active = this.pauseUsed = this.maneuvering = this.blocked = false;
    this.pauseRemaining = this.confirmSeconds = this.age = this.gripAge = this.probeRemaining = 0;
    this.noProgressSeconds = this.steeringYaw = this.steering = this.probeCount = 0;
    this.gear = 1;
    this.bestDistance = this.bestError = this.targetX = this.targetZ = Infinity;
  }

  impact(body: VehicleBody): void {
    if (!this.active) {
      this.reset(); this.active = true;
      this.referenceHeading = body.startHeading;
    }
    if (body.impulse >= GAME_CONFIG.vehicleCollisions.slideImpactThreshold) this.gripAge = 0;
  }

  drive(body: VehicleBody, dt: number, intent: RecoveryIntent, world?: WorldQuery,
    vehicles?: readonly RecoveryVehicle[], player?: VehicleBody): boolean {
    const c = GAME_CONFIG.vehicleCollisions;
    this.age += dt; this.gripAge += dt; this.probeRemaining -= dt;
    const fx = Math.sin(body.heading), fz = Math.cos(body.heading);
    let forward = body.velocityX * fx + body.velocityZ * fz;
    let lateral = body.velocityX * fz - body.velocityZ * fx;
    const speedMph = Math.hypot(forward, lateral) * GAME_CONFIG.ride.mphPerWorldUnitPerSecond;
    if (!this.pauseUsed && intent.allowPause !== false) {
      const severe = speedMph <= c.spinoutSpeedMph
        && Math.abs(normalizeAngle(body.heading - this.referenceHeading)) >= c.spinoutAngleDegrees * Math.PI / 180;
      this.confirmSeconds = severe ? this.confirmSeconds + dt : 0;
      if (this.confirmSeconds + 1e-8 >= c.spinoutConfirmSeconds) {
        this.pauseUsed = true; this.pauseRemaining = c.spinoutPauseSeconds; this.noProgressSeconds = 0;
        this.probeRemaining = 0;
      }
    }
    const paused = this.pauseRemaining > 1e-8;
    const error = normalizeAngle(Math.atan2(intent.x - body.x, intent.z - body.z) - body.heading);
    const absError = Math.abs(error);
    if (intent.stop) {
      this.maneuvering = this.blocked = false; this.gear = 1; this.steering = 0;
      this.probeRemaining = 0;
    }
    if (!intent.stop && !paused) {
      if (!this.maneuvering && (intent.forceManeuver || absError > c.maneuverEntryDegrees * Math.PI / 180)) {
        this.maneuvering = true; this.probeRemaining = 0;
      } else if (this.maneuvering && !intent.forceManeuver && absError < c.maneuverExitDegrees * Math.PI / 180 && forward >= 0) {
        this.maneuvering = false; this.gear = 1; this.blocked = false;
      }
      if (this.maneuvering && this.probeRemaining <= 1e-8) {
        this.chooseArc(body, intent, world, vehicles, player);
        this.probeRemaining = c.maneuverProbeSeconds;
      }
    }
    const authority = paused ? 0 : clamp((this.age - (intent.reactionSeconds ?? c.reactionSeconds)) / Math.max(1e-6, intent.steeringRecoverySeconds ?? c.steeringRecoverySeconds), 0, 1);
    let targetSpeed = Math.max(0, Math.cos(error)) * intent.speed;
    if (this.maneuvering) targetSpeed = this.gear > 0 ? c.maneuverForwardSpeed : -c.maneuverReverseSpeed;
    const switchingGear = targetSpeed * forward < 0
      && Math.abs(forward) * GAME_CONFIG.ride.mphPerWorldUnitPerSecond > c.gearChangeSpeedMph;
    const braking = paused || intent.stop || this.blocked || switchingGear;
    if (braking) targetSpeed = 0;
    const rate = braking || targetSpeed * forward < 0 || Math.abs(targetSpeed) < Math.abs(forward)
      ? intent.handling.braking : intent.handling.acceleration;
    forward += clamp(targetSpeed - forward, -rate * dt * (braking ? 1 : authority), rate * dt * (braking ? 1 : authority));
    const resistance = GAME_CONFIG.player.rollingResistance + GAME_CONFIG.player.aerodynamicDrag * forward * forward;
    forward -= Math.sign(forward) * Math.min(Math.abs(forward), resistance * dt);

    // Only tire steering is constrained by speed. The solver's angular impulse keeps its momentum.
    const impactYaw = (body.angularVelocity - this.steeringYaw) * Math.exp(-c.angularDamping * dt);
    const limit = recoveryYawLimit(forward, intent.handling) * authority;
    const wantedYaw = paused || intent.stop || this.blocked ? 0 : this.maneuvering
      ? this.steering * Math.sign(forward) * limit : clamp(error * 2, -limit, limit);
    this.steeringYaw += clamp(wantedYaw - this.steeringYaw,
      -c.recoverySteeringAcceleration * dt, c.recoverySteeringAcceleration * dt);
    this.steeringYaw = clamp(this.steeringYaw, -limit, limit);
    body.angularVelocity = impactYaw + this.steeringYaw;
    const grip = lerp(c.impactGrip, GAME_CONFIG.player.lateralGrip, clamp(this.gripAge / Math.max(1e-6, c.gripRecoverySeconds), 0, 1));
    lateral *= Math.exp(-grip * dt);
    body.velocityX = fx * forward + fz * lateral; body.velocityZ = fz * forward - fx * lateral;
    body.x += body.velocityX * dt; body.z += body.velocityZ * dt;
    body.heading = normalizeAngle(body.heading + body.angularVelocity * dt);
    if (paused) {
      this.pauseRemaining = Math.max(0, this.pauseRemaining - dt);
      if (this.pauseRemaining < 1e-8) this.pauseRemaining = 0;
    }
    else this.updateProgress(body, dt, intent, absError);
    return !paused && !this.maneuvering && authority >= 1 && Math.abs(lateral) < c.settledSideSpeed
      && Math.abs(body.angularVelocity) < c.settledYawRate && (intent.stop || absError < c.settledHeadingError);
  }

  private updateProgress(body: VehicleBody, dt: number, intent: RecoveryIntent, error: number): void {
    if (Math.hypot(intent.x - this.targetX, intent.z - this.targetZ) > 1) {
      this.targetX = intent.x; this.targetZ = intent.z; this.bestDistance = this.bestError = Infinity;
    }
    const distance = Math.hypot(intent.x - body.x, intent.z - body.z);
    if (distance < this.bestDistance - 1 || error < this.bestError - Math.PI / 18) {
      this.noProgressSeconds = 0;
      this.bestDistance = Math.min(this.bestDistance, distance); this.bestError = Math.min(this.bestError, error);
    } else this.noProgressSeconds += dt;
  }

  private chooseArc(body: VehicleBody, intent: RecoveryIntent, world?: WorldQuery,
    vehicles?: readonly RecoveryVehicle[], player?: VehicleBody): void {
    const c = GAME_CONFIG.vehicleCollisions;
    this.probeCount++;
    const radius = Math.hypot(body.halfWidth, body.halfLength);
    world?.getNearbyColliders(body.x, body.z, radius
      + Math.max(c.maneuverForwardSpeed, Math.hypot(body.velocityX, body.velocityZ)) * c.maneuverHorizonSeconds, this.colliders);
    if (!world) this.colliders.length = 0;
    let bestScore = Infinity, bestGear = this.gear, bestSteering = this.steering;
    const distance = Math.hypot(intent.x - body.x, intent.z - body.z);
    for (const gear of [1, -1]) for (const steering of [-1, 1]) {
      const p = this.probe;
      p.x = body.x; p.z = body.z; p.heading = body.heading;
      p.halfWidth = body.halfWidth; p.halfLength = body.halfLength;
      const desiredSpeed = gear > 0 ? c.maneuverForwardSpeed : -c.maneuverReverseSpeed;
      let speed = body.velocityX * Math.sin(body.heading) + body.velocityZ * Math.cos(body.heading);
      let steeringYaw = this.steeringYaw, impactYaw = body.angularVelocity - steeringYaw;
      const step = c.maneuverHorizonSeconds / c.maneuverProbeSamples;
      let clear = true;
      for (let sample = 0; sample < c.maneuverProbeSamples; sample++) {
        const changingGear = speed * desiredSpeed < 0
          && Math.abs(speed) * GAME_CONFIG.ride.mphPerWorldUnitPerSecond > c.gearChangeSpeedMph;
        const targetSpeed = changingGear ? 0 : desiredSpeed;
        const rate = changingGear || Math.abs(targetSpeed) < Math.abs(speed)
          ? intent.handling.braking : intent.handling.acceleration;
        speed += clamp(targetSpeed - speed, -rate * step, rate * step);
        const limit = recoveryYawLimit(speed, intent.handling);
        steeringYaw += clamp(steering * Math.sign(speed) * limit - steeringYaw,
          -c.recoverySteeringAcceleration * step, c.recoverySteeringAcceleration * step);
        steeringYaw = clamp(steeringYaw, -limit, limit);
        impactYaw *= Math.exp(-c.angularDamping * step);
        const yaw = steeringYaw + impactYaw;
        p.x += Math.sin(p.heading + yaw * step / 2) * speed * step;
        p.z += Math.cos(p.heading + yaw * step / 2) * speed * step;
        p.heading = normalizeAngle(p.heading + yaw * step);
        if (this.obstructed(body, vehicles, player)) { clear = false; break; }
      }
      if (!clear) continue;
      const error = Math.abs(normalizeAngle(Math.atan2(intent.x - p.x, intent.z - p.z) - p.heading));
      const progress = (Math.hypot(intent.x - p.x, intent.z - p.z) - distance) / Math.max(1, radius);
      const score = error + progress * .25 + (gear < 0 ? .08 : 0)
        - (gear === this.gear && steering === this.steering ? c.maneuverSwitchMargin : 0);
      if (score < bestScore) { bestScore = score; bestGear = gear; bestSteering = steering; }
    }
    this.blocked = !Number.isFinite(bestScore);
    if (!this.blocked) { this.gear = bestGear; this.steering = bestSteering; }
  }

  private obstructed(body: VehicleBody, vehicles?: readonly RecoveryVehicle[], player?: VehicleBody): boolean {
    const p = this.probe, o = this.obstacle;
    for (const box of this.colliders) {
      if (Math.abs(p.x - box.x) > Math.hypot(p.halfWidth, p.halfLength) + box.halfX
        || Math.abs(p.z - box.z) > Math.hypot(p.halfWidth, p.halfLength) + box.halfZ) continue;
      o.x = box.x; o.z = box.z; o.heading = 0; o.halfWidth = box.halfX; o.halfLength = box.halfZ;
      if (findOrientedBoxCollision(p, o, this.hit)) return true;
    }
    if (player && player !== body && this.overlapsVehicle(player)) return true;
    if (vehicles) for (const other of vehicles) {
      if (other.mesh && !other.mesh.isEnabled()) continue;
      if (other.collisionBody !== body && this.overlapsVehicle(other.collisionBody)) return true;
    }
    return false;
  }

  private overlapsVehicle(other: VehicleBody): boolean {
    const p = this.probe;
    const radius = Math.hypot(p.halfWidth, p.halfLength) + Math.hypot(other.halfWidth, other.halfLength);
    return (p.x - other.x) ** 2 + (p.z - other.z) ** 2 < radius * radius
      && findOrientedBoxCollision(p, other, this.hit) !== null;
  }
}
