import { GAME_CONFIG } from "../game/config";
import type { BoxCollider } from "../game/types";
import { clamp, normalizeAngle } from "../utils/math";
import { createBoxContact, findOrientedBoxCollision, type OrientedBoxCollision } from "../traffic/OrientedBoxCollision";
import { resolveCircleBoxValues } from "../world/collisions";
import type { WorldQuery } from "../world/WorldQuery";
import { createVehicleBody, type VehicleBody } from "./VehicleBody";

export interface VehicleContactEvent {
  a: VehicleBody; b: VehicleBody;
  normalX: number; normalZ: number;
  aVelocityX: number; aVelocityZ: number; bVelocityX: number; bVelocityZ: number;
  aHeading: number; bHeading: number;
  aX: number; aZ: number; bX: number; bZ: number;
  closingSpeed: number; relativeSpeed: number;
}
export interface StaticContactEvent { body: VehicleBody; collider: BoxCollider; closingSpeed: number; relativeSpeed: number }
interface Pair { a: VehicleBody; b: VehicleBody; reported: boolean; }
interface Constraint {
  a: VehicleBody; b: VehicleBody; nx: number; nz: number;
  rax: number; raz: number; rbx: number; rbz: number;
  normalImpulse: number; tangentImpulse: number; bounce: number;
}

/** Bounded contact work on an externally spatially-filtered list; no renderer or gameplay effects. */
export class VehicleContactSolver {
  readonly events: VehicleContactEvent[] = [];
  readonly staticEvents: StaticContactEvent[] = [];
  private readonly staticEventPool: StaticContactEvent[] = [];
  lastSubsteps = 1;
  private readonly pairs: Pair[] = [];
  private pairCount = 0;
  private readonly constraints: Constraint[] = [];
  private constraintCount = 0;
  private readonly eventPool: VehicleContactEvent[] = [];
  private readonly staticBodies: VehicleBody[] = [];
  private staticCount = 0;
  private readonly nearby: BoxCollider[] = [];
  private readonly hit = createBoxContact();

  begin(): void { this.pairCount = 0; this.events.length = 0; this.staticEvents.length = 0; }

  addPair(a: VehicleBody, b: VehicleBody): void {
    const radius = Math.hypot(a.halfWidth, a.halfLength) + Math.hypot(b.halfWidth, b.halfLength)
      + Math.hypot(a.endX - a.startX, a.endZ - a.startZ) + Math.hypot(b.endX - b.startX, b.endZ - b.startZ)
      + 2 * GAME_CONFIG.vehicleCollisions.maximumCorrection;
    if ((a.endX - b.endX) ** 2 + (a.endZ - b.endZ) ** 2 > radius * radius) return;
    const pair = this.pairs[this.pairCount] ??= { a, b, reported: false };
    pair.a = a; pair.b = b; pair.reported = false; this.pairCount++;
  }

  step(bodies: readonly VehicleBody[], dt: number, world?: WorldQuery): void {
    const c = GAME_CONFIG.vehicleCollisions;
    let steps = 1;
    for (let i = 0; i < this.pairCount; i++) {
      const { a, b } = this.pairs[i];
      const travel = Math.hypot(a.endX - a.startX, a.endZ - a.startZ)
        + Math.hypot(b.endX - b.startX, b.endZ - b.startZ);
      const extent = 2 * Math.min(a.halfWidth, a.halfLength, b.halfWidth, b.halfLength);
      steps = Math.max(steps, Math.ceil(travel / (extent * c.travelPerSubstepFraction)));
    }
    // Fast slides into thin walls also subdivide, even if no vehicle is close.
    for (const body of bodies) {
      if (body.staticRadius || body.dynamic) steps = Math.max(steps,
        Math.ceil(Math.hypot(body.endX - body.startX, body.endZ - body.startZ)
          / (2 * Math.min(body.halfWidth, body.halfLength) * c.travelPerSubstepFraction)));
      body.x = body.startX; body.z = body.startZ; body.heading = body.startHeading;
    }
    this.lastSubsteps = steps = Math.min(c.maxContactSubsteps, steps);
    for (let step = 1; step <= steps; step++) {
      for (const body of bodies) {
        if (body.changed) {
          body.x += body.velocityX * dt / steps; body.z += body.velocityZ * dt / steps;
          body.heading = normalizeAngle(body.heading + body.angularVelocity * dt / steps);
        } else {
          // Preserve controller motion exactly until an actual contact changes it.
          body.x = body.startX + (body.endX - body.startX) * step / steps;
          body.z = body.startZ + (body.endZ - body.startZ) * step / steps;
          body.heading = normalizeAngle(body.startHeading + normalizeAngle(body.endHeading - body.startHeading) * step / steps);
        }
      }
      this.constraintCount = this.staticCount = 0;
      for (let i = 0; i < this.pairCount; i++) {
        const pair = this.pairs[i];
        if (!findOrientedBoxCollision(pair.a, pair.b, this.hit)) continue;
        pair.a.dynamic = pair.b.dynamic = true;
        if (!pair.reported) { this.report(pair, this.hit); pair.reported = true; }
        this.addConstraints(pair.a, pair.b, this.hit);
      }
      if (world) this.visitStatics(bodies, world, false);
      // No contact can need separation if the first pass found none. Avoid
      // repeating SAT and world queries on ordinary driving frames.
      if (this.constraintCount === 0) continue;
      for (let iteration = 0; iteration < c.velocityIterations; iteration++) {
        // Alternate order to avoid favouring one end of a flat bumper.
        for (let n = 0; n < this.constraintCount; n++) {
          const i = iteration % 2 ? this.constraintCount - 1 - n : n;
          solveVelocity(this.constraints[i]);
        }
      }
      for (let iteration = 0; iteration < c.positionIterations; iteration++) {
        for (let i = 0; i < this.pairCount; i++) {
          const { a, b } = this.pairs[i];
          if (findOrientedBoxCollision(a, b, this.hit)) correctPosition(a, b, this.hit);
        }
        if (world) this.visitStatics(bodies, world, true);
      }
    }
  }

  private report(pair: Pair, hit: OrientedBoxCollision): void {
    const { a, b } = pair;
    const event = this.eventPool[this.events.length] ??= {} as VehicleContactEvent;
    event.a = a; event.b = b; event.normalX = hit.normalX; event.normalZ = hit.normalZ;
    event.aVelocityX = a.velocityX; event.aVelocityZ = a.velocityZ;
    event.bVelocityX = b.velocityX; event.bVelocityZ = b.velocityZ;
    event.aHeading = a.heading; event.bHeading = b.heading;
    event.aX = a.x; event.aZ = a.z; event.bX = b.x; event.bZ = b.z;
    const vx = a.velocityX - b.velocityX, vz = a.velocityZ - b.velocityZ;
    event.closingSpeed = Math.max(0, -(vx * hit.normalX + vz * hit.normalZ));
    event.relativeSpeed = Math.hypot(vx, vz);
    this.events.push(event);
  }

  private addConstraints(a: VehicleBody, b: VehicleBody, hit: OrientedBoxCollision): void {
    for (let i = 0; i < hit.pointCount; i++) {
      const point = this.constraints[this.constraintCount++] ??= {} as Constraint;
      point.a = a; point.b = b; point.nx = hit.normalX; point.nz = hit.normalZ;
      const x = i ? hit.point2X : hit.point1X, z = i ? hit.point2Z : hit.point1Z;
      point.rax = x - a.x; point.raz = z - a.z; point.rbx = x - b.x; point.rbz = z - b.z;
      point.normalImpulse = point.tangentImpulse = 0;
      const speed = relativeSpeedAtPoint(point, point.nx, point.nz);
      point.bounce = speed < -GAME_CONFIG.vehicleCollisions.bounceThreshold
        ? -speed * GAME_CONFIG.vehicleCollisions.restitution : 0;
    }
  }

  private visitStatics(bodies: readonly VehicleBody[], world: WorldQuery, correction: boolean): void {
    for (const a of bodies) {
      if (!a.staticRadius && !a.dynamic && !a.changed) continue;
      world.getNearbyColliders(a.x, a.z, Math.hypot(a.halfWidth, a.halfLength), this.nearby);
      for (const box of this.nearby) {
        const b = this.staticBodies[this.staticCount] ??= createVehicleBody(-2);
        b.x = box.x; b.z = box.z; b.heading = 0; b.halfWidth = box.halfX; b.halfLength = box.halfZ;
        b.inverseMass = b.inverseInertia = 0;
        let hit: OrientedBoxCollision | null;
        if (a.staticRadius) {
          const circle = resolveCircleBoxValues(a.x, a.z, a.staticRadius, box);
          hit = circle ? this.hit : null;
          if (circle) {
            Object.assign(this.hit, { normalX: circle.x, normalZ: circle.z, depth: circle.depth,
              pointCount: 1, point1X: a.x - circle.x * a.staticRadius, point1Z: a.z - circle.z * a.staticRadius });
          }
        } else hit = findOrientedBoxCollision(a, b, this.hit);
        if (!hit) continue;
        if (correction) correctPosition(a, b, hit);
        else {
          if (a.reportStaticImpacts && !this.staticEvents.some(e => e.body === a && e.collider === box)) {
            const event = this.staticEventPool[this.staticEvents.length] ??= {} as StaticContactEvent;
            event.body = a; event.collider = box;
            event.closingSpeed = Math.max(0, -(a.velocityX * hit.normalX + a.velocityZ * hit.normalZ));
            event.relativeSpeed = Math.hypot(a.velocityX, a.velocityZ);
            this.staticEvents.push(event);
          }
          this.addConstraints(a, b, hit); this.staticCount++;
        }
      }
    }
  }
}

function lever(rx: number, rz: number, nx: number, nz: number): number { return rz * nx - rx * nz; }
function relativeSpeedAtPoint(p: Constraint, nx: number, nz: number): number {
  return (p.a.velocityX + p.a.angularVelocity * p.raz - p.b.velocityX - p.b.angularVelocity * p.rbz) * nx
    + (p.a.velocityZ - p.a.angularVelocity * p.rax - p.b.velocityZ + p.b.angularVelocity * p.rbx) * nz;
}
function impulse(p: Constraint, nx: number, nz: number, j: number): void {
  const { a, b } = p;
  a.velocityX += nx * j * a.inverseMass; a.velocityZ += nz * j * a.inverseMass;
  b.velocityX -= nx * j * b.inverseMass; b.velocityZ -= nz * j * b.inverseMass;
  a.angularVelocity += lever(p.rax, p.raz, nx, nz) * j * a.inverseInertia;
  b.angularVelocity -= lever(p.rbx, p.rbz, nx, nz) * j * b.inverseInertia;
  if (Math.abs(j) > 1e-8) {
    a.changed = true; a.impulse += Math.abs(j) * a.inverseMass;
    if (b.inverseMass) { b.changed = true; b.impulse += Math.abs(j) * b.inverseMass; }
  }
}
function effectiveMass(p: Constraint, nx: number, nz: number): number {
  const a = lever(p.rax, p.raz, nx, nz), b = lever(p.rbx, p.rbz, nx, nz);
  return p.a.inverseMass + p.b.inverseMass + a * a * p.a.inverseInertia + b * b * p.b.inverseInertia;
}
function solveVelocity(p: Constraint): void {
  const normal = Math.max(0, p.normalImpulse + (p.bounce - relativeSpeedAtPoint(p, p.nx, p.nz)) / effectiveMass(p, p.nx, p.nz));
  impulse(p, p.nx, p.nz, normal - p.normalImpulse); p.normalImpulse = normal;
  const tx = -p.nz, tz = p.nx, limit = GAME_CONFIG.vehicleCollisions.contactFriction * normal;
  const tangent = clamp(p.tangentImpulse - relativeSpeedAtPoint(p, tx, tz) / effectiveMass(p, tx, tz), -limit, limit);
  impulse(p, tx, tz, tangent - p.tangentImpulse); p.tangentImpulse = tangent;
}
function correctPosition(a: VehicleBody, b: VehicleBody, hit: OrientedBoxCollision): void {
  const c = GAME_CONFIG.vehicleCollisions;
  const depth = Math.min(c.maximumCorrection, Math.max(0, hit.depth - c.penetrationSlop) * c.correctionFraction);
  if (depth <= 0) return;
  const correction = depth / (a.inverseMass + b.inverseMass);
  a.x += hit.normalX * correction * a.inverseMass; a.z += hit.normalZ * correction * a.inverseMass;
  b.x -= hit.normalX * correction * b.inverseMass; b.z -= hit.normalZ * correction * b.inverseMass;
  a.changed = true; if (b.inverseMass) b.changed = true;
}
