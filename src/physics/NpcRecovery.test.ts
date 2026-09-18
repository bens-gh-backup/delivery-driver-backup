import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { normalizeAngle } from "../utils/math";
import { WorldQuery } from "../world/WorldQuery";
import { beginBodyStep, createVehicleBody, endBodyStep, setBodySize } from "./VehicleBody";
import { NpcRecovery, recoveryYawLimit, type RecoveryIntent } from "./NpcRecovery";
import { VehicleContactSolver } from "./VehicleContactSolver";

const dt = 1 / 60;
const handling = { topSpeed: 90, turning: 1, acceleration: 20, braking: 25 };
const intent: RecoveryIntent = { x: 0, z: 500, speed: 50, handling };
function fixture(heading = Math.PI, speed = 0, spin = 0) {
  const body = createVehicleBody(1); setBodySize(body, 5.4, 9.4);
  beginBodyStep(body, 0, 0, 0);
  endBodyStep(body, 0, 0, heading, Math.sin(heading) * speed, Math.cos(heading) * speed, spin, dt);
  body.impulse = 20; body.dynamic = true;
  const recovery = new NpcRecovery(); recovery.impact(body);
  return { body, recovery };
}

describe("NPC steering and spin-out recovery", () => {
  it("has no steering at rest, reverses steering with gear, and respects the player-like minimum radius", () => {
    expect(recoveryYawLimit(0, handling)).toBe(0);
    expect(recoveryYawLimit(-8, handling)).toBe(recoveryYawLimit(8, handling));
    const radius = GAME_CONFIG.player.fullSteeringSpeed / GAME_CONFIG.player.lowSpeedYawRate;
    for (const speed of [1, 5, 9, 40, 100]) expect(recoveryYawLimit(speed, handling)).toBeLessThanOrEqual(speed / radius);
    const { body, recovery } = fixture();
    for (let i = 0; i < 8; i++) recovery.drive(body, dt, intent);
    expect(body.heading).toBe(Math.PI); expect(body.angularVelocity).toBe(0);
    expect(Math.hypot(body.velocityX, body.velocityZ)).toBe(0);
  });

  it("preserves collision rotation even when the wheels are stopped", () => {
    const { body, recovery } = fixture(0, 0, 2);
    recovery.drive(body, dt, { ...intent, stop: true });
    expect(body.angularVelocity).toBeGreaterThan(1.8);
    expect(body.heading).toBeGreaterThan(0); expect(recovery.steeringYaw).toBe(0);
  });

  it("keeps a moving thirty-degree knock responsive without a pause", () => {
    const { body, recovery } = fixture(Math.PI / 6, 35);
    for (let i = 0; i < 120; i++) {
      recovery.drive(body, dt, intent);
      expect(recovery.pauseRemaining).toBe(0);
      expect(Math.hypot(body.velocityX, body.velocityZ)).toBeGreaterThan(25);
    }
    expect(Math.abs(body.heading)).toBeLessThan(.15);
    expect(body.z).toBeGreaterThan(55);
  });

  it("mirrors steering recovery for left and right knocks", () => {
    const left = fixture(-Math.PI / 6, 35), right = fixture(Math.PI / 6, 35);
    for (let i = 0; i < 120; i++) {
      left.recovery.drive(left.body, dt, intent); right.recovery.drive(right.body, dt, intent);
    }
    expect(left.body.x).toBeCloseTo(-right.body.x, 6);
    expect(left.body.z).toBeCloseTo(right.body.z, 6);
    expect(left.body.heading).toBeCloseTo(-right.body.heading, 6);
  });

  it("pauses a stopped half-turn once, then drives an arc instead of rotating in place", () => {
    const { body, recovery } = fixture();
    for (let i = 0; i < 9; i++) recovery.drive(body, dt, intent);
    expect(recovery.pauseUsed).toBe(true); expect(recovery.pauseRemaining).toBeCloseTo(3 - dt);
    for (let i = 0; i < 178; i++) {
      recovery.impact(body); // Sustained contact cannot extend the pause.
      recovery.drive(body, dt, intent);
      expect(body.heading).toBe(Math.PI);
      expect(Math.hypot(body.x, body.z)).toBe(0);
      expect(recovery.noProgressSeconds).toBe(0);
    }
    recovery.drive(body, dt, intent);
    expect(recovery.pauseRemaining).toBeCloseTo(0);
    let maximumExcursion = 0;
    for (let i = 0; i < 600; i++) {
      recovery.drive(body, dt, intent);
      maximumExcursion = Math.max(maximumExcursion, Math.hypot(body.x, body.z));
    }
    expect(Math.abs(normalizeAngle(body.heading))).toBeLessThan(.3);
    expect(maximumExcursion).toBeGreaterThan(10);
    expect(recovery.pauseRemaining).toBe(0);
    recovery.reset();
    expect(recovery.active).toBe(false); expect(recovery.pauseUsed).toBe(false);
  });

  it("backs away from a blocked front, using the actual world solver and bounded probes", () => {
    const { body, recovery } = fixture();
    const wall = { x: 0, z: -7, halfX: 30, halfZ: .5 };
    const world = new WorldQuery([wall], [], 1, 1, 64);
    const solver = new VehicleContactSolver();
    for (let i = 0; i < 300; i++) {
      beginBodyStep(body, body.x, body.z, body.heading);
      recovery.drive(body, dt, intent, world);
      endBodyStep(body, body.x, body.z, body.heading, body.velocityX, body.velocityZ, body.angularVelocity, dt);
      solver.begin(); solver.step([body], dt, world);
      if (i === 190) expect(recovery.gear).toBe(-1);
      if (i === 205) {
        expect(body.velocityX * Math.sin(body.heading) + body.velocityZ * Math.cos(body.heading)).toBeLessThan(0);
        expect(recovery.steeringYaw * recovery.steering).toBeLessThan(0);
      }
      expect(body.z).toBeGreaterThan(-2);
      expect(Number.isFinite(body.angularVelocity)).toBe(true);
    }
    expect(body.z).toBeGreaterThan(2);
    expect(recovery.probeCount).toBeLessThanOrEqual(9);
  });

  it("brakes while switching gear and does not rotate at a blocked standstill", () => {
    const { body, recovery } = fixture(Math.PI, 8);
    const world = new WorldQuery([{ x: 0, z: -7, halfX: 30, halfZ: .5 }], [], 1, 1, 64);
    for (let i = 0; i < 20; i++) {
      const previous = body.velocityX * Math.sin(body.heading) + body.velocityZ * Math.cos(body.heading);
      recovery.drive(body, dt, { ...intent, allowPause: false }, world);
      const next = body.velocityX * Math.sin(body.heading) + body.velocityZ * Math.cos(body.heading);
      if (previous * GAME_CONFIG.ride.mphPerWorldUnitPerSecond > GAME_CONFIG.vehicleCollisions.gearChangeSpeedMph)
        expect(next).toBeGreaterThanOrEqual(0);
    }
    expect(recovery.gear).toBe(-1);
    // Drive control first brakes the forward motion before crossing into reverse.
    const enclosed = new WorldQuery([{ x: 0, z: 0, halfX: 20, halfZ: 20 }], [], 1, 1, 64);
    const stopped = fixture();
    for (let i = 0; i < 300; i++) stopped.recovery.drive(stopped.body, dt, { ...intent, allowPause: false }, enclosed);
    expect(stopped.recovery.blocked).toBe(true); expect(stopped.body.heading).toBe(Math.PI);
    expect(Math.hypot(stopped.body.velocityX, stopped.body.velocityZ)).toBe(0);
    expect(stopped.recovery.noProgressSeconds).toBeGreaterThan(4);
  });

  it("checks nearby vehicles and the player, while ignoring self and hidden cars", () => {
    const obstacle = createVehicleBody(2); setBodySize(obstacle, 50, 50);
    for (const kind of ["visible", "hidden", "player"] as const) {
      const { body, recovery } = fixture();
      recovery.drive(body, dt, { ...intent, allowPause: false }, undefined,
        [{ collisionBody: body }, { collisionBody: obstacle, mesh: { isEnabled: () => kind === "visible" } }],
        kind === "player" ? obstacle : undefined);
      expect(recovery.blocked).toBe(kind !== "hidden");
    }
  });
});
