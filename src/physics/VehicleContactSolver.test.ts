import { describe, expect, it } from "vitest";
import { beginBodyStep, createVehicleBody, endBodyStep, setBodySize, type VehicleBody } from "./VehicleBody";
import { VehicleContactSolver } from "./VehicleContactSolver";
import { WorldQuery } from "../world/WorldQuery";
import { GAME_CONFIG } from "../game/config";

function body(id: number, x: number, z: number, vx = 0, vz = 0, heading = 0): VehicleBody {
  const b = createVehicleBody(id); setBodySize(b, 5.4, 9.4);
  beginBodyStep(b, x, z, heading); endBodyStep(b, x, z, heading, vx, vz, 0, 0);
  return b;
}
const energy = (b: VehicleBody) => (b.velocityX ** 2 + b.velocityZ ** 2) / (2 * b.inverseMass)
  + b.angularVelocity ** 2 / (2 * b.inverseInertia);
function solve(a: VehicleBody, b: VehicleBody) {
  const solver = new VehicleContactSolver(); solver.begin(); solver.addPair(a, b); solver.step([a, b], 0); return solver;
}
function advance(b: VehicleBody, dt: number) {
  beginBodyStep(b, b.x, b.z, b.heading);
  endBodyStep(b, b.x + b.velocityX * dt, b.z + b.velocityZ * dt, b.heading + b.angularVelocity * dt,
    b.velocityX, b.velocityZ, b.angularVelocity, dt);
}

describe("shared vehicle contact response", () => {
  it("shares forward momentum in a centered rear hit without inventing a spin", () => {
    const a = body(1, 0, -9, 0, 40), b = body(2, 0, 0);
    const initialEnergy = energy(a) + energy(b); solve(a, b);
    expect(a.velocityZ).toBeGreaterThan(15); expect(b.velocityZ).toBeGreaterThan(15);
    expect(a.velocityZ + b.velocityZ).toBeCloseTo(40, 8);
    expect(Math.abs(a.angularVelocity)).toBeLessThan(.03); expect(Math.abs(b.angularVelocity)).toBeLessThan(.03);
    expect(energy(a) + energy(b)).toBeLessThanOrEqual(initialEnergy + 1e-8);
  });

  it("mirrors rear-quarter rotation and reverses it at the front quarter", () => {
    const hit = (side: number, z: number) => {
      const attacker = body(1, side * 5.2, z, -side * 30, 25), target = body(2, 0, 0, 0, 25);
      solve(attacker, target); return target;
    };
    const rearRight = hit(1, -3.5), rearLeft = hit(-1, -3.5), frontRight = hit(1, 3.5);
    expect(rearRight.angularVelocity).toBeGreaterThan(.5);
    expect(rearLeft.angularVelocity).toBeCloseTo(-rearRight.angularVelocity, 2);
    expect(frontRight.angularVelocity).toBeLessThan(-.5);
  });

  it("a centered side hit mostly translates; a glancing scrape retains forward motion", () => {
    const a = body(1, 5.2, 0, -30, 0), b = body(2, 0, 0); solve(a, b);
    expect(b.velocityX).toBeLessThan(-10); expect(Math.abs(b.angularVelocity)).toBeLessThan(.1);
    const scrape = body(3, 5.3, 0, -1, 50), other = body(4, 0, 0, 0, 50); solve(scrape, other);
    expect(scrape.velocityZ).toBeGreaterThan(49); expect(Math.abs(other.angularVelocity)).toBeLessThan(.1);
  });

  it("keeps the same rear-quarter response when the entire encounter is rotated", () => {
    const attacker = body(1, 5.2, -3.5, -30, 25), target = body(2, 0, 0, 0, 25);
    solve(attacker, target);
    for (const angle of [.3, Math.PI / 2, 2.7]) {
      const s = Math.sin(angle), c = Math.cos(angle);
      const a = body(1, 5.2 * c - 3.5 * s, -3.5 * c - 5.2 * s, -30 * c + 25 * s, 25 * c + 30 * s, angle);
      const b = body(2, 0, 0, 25 * s, 25 * c, angle);
      const initial = energy(a) + energy(b);
      solve(a, b);
      expect(b.velocityX).toBeCloseTo(target.velocityX * c + target.velocityZ * s, 6);
      expect(b.velocityZ).toBeCloseTo(target.velocityZ * c - target.velocityX * s, 6);
      expect(b.angularVelocity).toBeCloseTo(target.angularVelocity, 6);
      expect(a.angularVelocity).toBeCloseTo(attacker.angularVelocity, 6);
      expect(energy(a) + energy(b)).toBeLessThanOrEqual(initial + 1e-8);
    }
  });

  it("stops equal head-on momentum with only a small rebound", () => {
    const a = body(1, 0, -9, 0, 40), b = body(2, 0, 0, 0, -40, Math.PI); solve(a, b);
    expect(Math.abs(a.velocityZ)).toBeLessThan(3); expect(Math.abs(b.velocityZ)).toBeLessThan(3);
    expect(a.velocityZ + b.velocityZ).toBeCloseTo(0, 8);
  });

  it("heavier vehicles change speed less, with equal-and-opposite momentum and torque", () => {
    const a = body(1, 1.5, -9, 0, 50), b = body(2, 0, 0);
    a.inverseMass /= 1.5; a.inverseInertia /= 1.5;
    const initial = energy(a) + energy(b), pz = a.velocityZ / a.inverseMass;
    const angular = (v: VehicleBody) => v.angularVelocity / v.inverseInertia
      + (v.startZ * v.velocityX - v.startX * v.velocityZ) / v.inverseMass;
    const beforeAngular = angular(a) + angular(b);
    solve(a, b);
    expect(a.velocityZ / a.inverseMass + b.velocityZ / b.inverseMass).toBeCloseTo(pz, 8);
    expect(a.velocityX / a.inverseMass + b.velocityX / b.inverseMass).toBeCloseTo(0, 8);
    expect(angular(a) + angular(b)).toBeCloseTo(beforeAngular, 8);
    expect(energy(a) + energy(b)).toBeLessThanOrEqual(initial + 1e-8);
  });

  it("does not kick separating contacts or inject energy into an overlapping spawn", () => {
    const a = body(1, 0, -9, 0, -10), b = body(2, 0, 0, 0, 10); solve(a, b);
    expect(a.velocityZ).toBe(-10); expect(b.velocityZ).toBe(10);
    const c = body(3, 0, 0), d = body(4, 0, 0); solve(c, d);
    expect(energy(c) + energy(d)).toBe(0);
    expect(Math.hypot(c.x - d.x, c.z - d.z)).toBeGreaterThan(0);
    expect(Math.hypot(c.x, c.z)).toBeLessThanOrEqual(GAME_CONFIG.vehicleCollisions.maximumCorrection);
  });

  it("uses bounded substeps to resolve a maximum-speed encounter before deep penetration", () => {
    const a = body(1, -5, 0, 220, 0, Math.PI / 2), b = body(2, 5, 0, -220, 0, -Math.PI / 2);
    advance(a, 1 / 60); advance(b, 1 / 60);
    const solver = new VehicleContactSolver(); solver.begin(); solver.addPair(a, b); solver.step([a, b], 1 / 60);
    expect(solver.events).toHaveLength(1); expect(solver.lastSubsteps).toBeGreaterThan(1);
    expect(solver.lastSubsteps).toBeLessThanOrEqual(4);
    expect(a.x).toBeLessThan(b.x); expect(a.velocityX).toBeLessThan(20);
  });

  it("keeps sustained pushing and three-car pileups finite without adding bounce each frame", () => {
    const cars = [body(1, 0, -9, 0, 20), body(2, 0, 0), body(3, 0, 9)];
    const solver = new VehicleContactSolver();
    for (let frame = 0; frame < 300; frame++) {
      cars[0].velocityZ += .03;
      for (const car of cars) advance(car, 1 / 60);
      solver.begin(); solver.addPair(cars[0], cars[1]); solver.addPair(cars[1], cars[2]); solver.step(cars, 1 / 60);
      for (const car of cars) {
        expect(Number.isFinite(energy(car))).toBe(true); expect(Math.abs(car.angularVelocity)).toBeLessThan(.2);
        expect(car.velocityZ).toBeGreaterThan(-.1); expect(car.velocityZ).toBeLessThan(21);
      }
    }
    expect(cars[1].z).toBeGreaterThan(25); expect(cars[2].z).toBeGreaterThan(cars[1].z);
  });

  it("resolves a sliding NPC against real walls while leaving tangential motion", () => {
    const world = new WorldQuery([{ x: 5, z: 0, halfX: 1, halfZ: 30 }], [], 1, 1, 64);
    const a = body(1, 2, 0, 15, 10); a.dynamic = true;
    const solver = new VehicleContactSolver(); solver.begin(); solver.step([a], 0, world);
    expect(a.velocityX).toBeLessThan(1); expect(a.velocityZ).toBeGreaterThan(5);
    expect(a.x).toBeLessThan(2); expect(solver.events).toHaveLength(0);
  });

  it("preserves exact controller poses when there are no contacts, without allocating events", () => {
    const a = body(1, 1, 2, 20, 30, .3); advance(a, 1 / 60);
    const expected = [a.x, a.z, a.heading];
    const solver = new VehicleContactSolver(); solver.begin(); solver.step([a], 1 / 60);
    expect([a.x, a.z, a.heading]).toEqual(expected); expect(a.changed).toBe(false);
    expect(solver.events).toHaveLength(0); expect(solver.lastSubsteps).toBe(1);
  });
});

it("reports opt-in static damage once per wall before impulses, independently of vehicle events",()=>{
  const wall={x:5,z:0,halfX:1,halfZ:30},world=new WorldQuery([wall],[],1,1,64);
  const a=body(1,2,0,80,10);a.dynamic=true;a.reportStaticImpacts=true;
  const solver=new VehicleContactSolver();solver.begin();solver.step([a],0,world);
  expect(solver.staticEvents).toHaveLength(1);expect(solver.staticEvents[0].collider).toBe(wall);
  expect(solver.staticEvents[0].closingSpeed).toBe(80);expect(solver.events).toHaveLength(0);
  const b=body(2,2,0,80,10);b.dynamic=true;solver.begin();solver.step([b],0,world);
  expect(solver.staticEvents).toHaveLength(0);
});
