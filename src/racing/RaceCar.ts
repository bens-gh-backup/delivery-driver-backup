import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { GAME_CONFIG } from "../game/config";
import { createLowPolyVehicleMesh } from "../vehicles/VehicleMeshFactory";
import { clamp, normalizeAngle } from "../utils/math";
import type { RaceCourse, RacePoint } from "./RaceCourse";
import type { RacerProgress } from "./RaceProgress";

export interface RaceCarStats { topSpeed: number; acceleration: number; turning: number; braking: number; color: string; }
interface NavigationPoint extends RacePoint { checkpointIndex: number; corner: boolean; distanceToCorner: number; normalX?: number; normalZ?: number; }

export class RaceCar {
  readonly mesh: Mesh;
  readonly progress: RacerProgress;
  readonly width = GAME_CONFIG.player.width;
  readonly length = GAME_CONFIG.player.length;
  laneOffset = 0;
  speed = 0;
  recoveredThisStep = false;
  private readonly material: StandardMaterial;
  private readonly navigation: NavigationPoint[];
  private navigationIndex = 0;
  private staleSeconds = 0;
  private bestDistance = Infinity;
  private lastCheckpoint = 0;
  private finishExitTravelled = 0;

  constructor(scene: Scene, readonly id: number, private readonly course: RaceCourse,
    readonly stats: RaceCarStats, position: RacePoint, heading: number) {
    this.material = new StandardMaterial(`race-car-material-${id}`, scene);
    this.material.diffuseColor = Color3.White();
    this.mesh = createLowPolyVehicleMesh(scene, `race-car-${id}`, this.material, {
      bodyWidth: this.width, bodyLength: this.length, bodyHeight: 1.8,
      cabinWidth: this.width * .8, cabinLength: this.length * .44, cabinHeight: 1.4,
      bodyColor: Color3.FromHexString(stats.color),
    });
    this.material.freeze();
    this.mesh.position.set(position.x, .9, position.z);
    this.mesh.rotation.y = heading;
    this.progress = { id, checkpointIndex: 0, finishTime: null, position: { ...position } };
    this.navigation = createNavigation(course);
    this.laneOffset = ((id - 1) % 3 - 1) * GAME_CONFIG.racing.grid.lateralSpacing;
  }

  update(dt: number): void {
    this.recoveredThisStep = false;
    if (this.progress.finishTime !== null) { this.updateFinishExit(dt); return; }
    const position = this.mesh.position;
    const targetCheckpoint = this.course.checkpoints[this.progress.checkpointIndex];
    const distance = Math.hypot(position.x - targetCheckpoint.x, position.z - targetCheckpoint.z);
    if (this.lastCheckpoint !== this.progress.checkpointIndex || distance < this.bestDistance - 1) {
      this.staleSeconds = 0; this.bestDistance = distance; this.lastCheckpoint = this.progress.checkpointIndex;
    } else this.staleSeconds += dt;
    const previous = this.progress.checkpointIndex > 0 ? this.course.checkpoints[this.progress.checkpointIndex - 1] : this.course.start;
    const offCourse = distanceToSegment(position, previous, targetCheckpoint);
    if (this.staleSeconds >= GAME_CONFIG.racing.ai.recoverySeconds || offCourse > GAME_CONFIG.racing.ai.offCourseDistance) {
      this.recover(); return;
    }
    let target = this.navigation[this.navigationIndex];
    if (!target) { this.recover(); return; }
    let remaining = Math.hypot(this.targetX(target) - position.x, this.targetZ(target) - position.z);
    const cornerSpeed = GAME_CONFIG.racing.ai.cornerSpeed * this.stats.turning;
    const brakingDistance = target.corner ? remaining : remaining + target.distanceToCorner;
    const desiredSpeed = Math.min(this.stats.topSpeed,
      Math.sqrt(cornerSpeed * cornerSpeed + 2 * this.stats.braking * Math.max(0, brakingDistance - GAME_CONFIG.racing.ai.lookahead)));
    const rate = desiredSpeed < this.speed ? this.stats.braking : this.stats.acceleration;
    this.speed += clamp(desiredSpeed - this.speed, -rate * dt, rate * dt);
    let movement = this.speed * dt;
    // Navigation is assisted, like civilian path following; steering controls visible yaw and corner pace.
    for (let consumed = 0; movement > 0 && target && consumed < 16; consumed++) {
      remaining = Math.hypot(this.targetX(target) - position.x, this.targetZ(target) - position.z);
      if (remaining < .001) { target = this.navigation[++this.navigationIndex]; continue; }
      const step = Math.min(remaining, movement), dx = (this.targetX(target) - position.x) / remaining, dz = (this.targetZ(target) - position.z) / remaining;
      const heading = Math.atan2(dx, dz);
      const response = 1 - Math.exp(-GAME_CONFIG.racing.ai.steeringResponse * this.stats.turning * dt);
      const yaw = normalizeAngle(heading - this.mesh.rotation.y) * response;
      this.mesh.rotation.y = normalizeAngle(this.mesh.rotation.y + clamp(yaw, -this.stats.turning * dt, this.stats.turning * dt));
      position.x += dx * step; position.z += dz * step; movement -= step;
      if (step >= remaining) target = this.navigation[++this.navigationIndex];
    }
  }

  private updateFinishExit(dt: number): void {
    if (!this.mesh.isEnabled()) return;
    // The finish lies halfway along a street; never let tuning carry a finisher into the next turn.
    const nextIntersection = this.course.checkpoints[0];
    const availableStreet = Math.max(0, Math.hypot(nextIntersection.x - this.course.start.x,
      nextIntersection.z - this.course.start.z) - this.length);
    const exitDistance = Math.min(Math.max(0, GAME_CONFIG.racing.finishExitDistance), availableStreet);
    const step = Math.min(Math.max(0, exitDistance - this.finishExitTravelled),
      Math.max(this.speed, GAME_CONFIG.racing.ai.cornerSpeed) * dt);
    this.mesh.position.x += Math.sin(this.course.heading) * step;
    this.mesh.position.z += Math.cos(this.course.heading) * step;
    this.mesh.rotation.y = this.course.heading;
    this.finishExitTravelled += step;
    if (this.finishExitTravelled >= exitDistance) {
      this.speed = 0;
      this.mesh.setEnabled(false);
    }
  }

  private targetX(point: NavigationPoint): number { return point.x + (point.normalX ?? 0) * this.laneOffset; }
  private targetZ(point: NavigationPoint): number { return point.z + (point.normalZ ?? 0) * this.laneOffset; }

  tryOvertake(cars: readonly RaceCar[]): void {
    if (this.navigation[this.navigationIndex]?.corner || this.progress.finishTime !== null) return;
    const fx = Math.sin(this.mesh.rotation.y), fz = Math.cos(this.mesh.rotation.y);
    const blocked = cars.some(car => {
      const dx = car.mesh.position.x - this.mesh.position.x, dz = car.mesh.position.z - this.mesh.position.z;
      const forward = dx * fx + dz * fz;
      return car !== this && car.progress.finishTime === null && car.laneOffset === this.laneOffset && forward > 0
        && forward < GAME_CONFIG.racing.ai.lookahead * 2 && Math.abs(dx * fz - dz * fx) < this.width * 2
        && this.stats.topSpeed > car.stats.topSpeed;
    });
    if (!blocked) return;
    for (const lane of [-GAME_CONFIG.racing.grid.lateralSpacing, 0, GAME_CONFIG.racing.grid.lateralSpacing]) {
      if (lane === this.laneOffset) continue;
      if (cars.every(car => car === this || car.progress.finishTime !== null || car.laneOffset !== lane
        || Math.hypot(car.mesh.position.x - this.mesh.position.x, car.mesh.position.z - this.mesh.position.z) > GAME_CONFIG.racing.ai.lookahead * 2)) {
        this.laneOffset = lane; return;
      }
    }
  }

  recover(): void {
    const index = this.progress.checkpointIndex;
    const anchor = index > 0 ? this.course.checkpoints[index - 1] : this.course.start;
    const target = this.course.checkpoints[index];
    this.mesh.position.set(anchor.x, .9, anchor.z);
    this.mesh.rotation.y = Math.atan2(target.x - anchor.x, target.z - anchor.z);
    this.speed = 0; this.staleSeconds = 0; this.bestDistance = Infinity;
    this.navigationIndex = this.navigation.findIndex(point => point.checkpointIndex >= index);
    if (this.navigationIndex < 0) this.navigationIndex = this.navigation.length - 1;
    this.progress.position.x = anchor.x; this.progress.position.z = anchor.z;
    this.recoveredThisStep = true;
  }

  dispose(): void { this.mesh.dispose(false, false); this.material.dispose(); }
}

function createNavigation(course: RaceCourse): NavigationPoint[] {
  const points: NavigationPoint[] = [];
  const radius = Math.min(GAME_CONFIG.racing.ai.lookahead, GAME_CONFIG.world.roadWidth / 2 - GAME_CONFIG.player.width);
  for (let i = 0; i < course.checkpoints.length; i++) {
    const p = i === 0 ? course.start : course.checkpoints[i - 1];
    const q = course.checkpoints[i], r = course.checkpoints[i + 1];
    if (!r) { points.push({ ...q, checkpointIndex: i, corner: false, distanceToCorner: Infinity }); continue; }
    const incoming = Math.hypot(q.x - p.x, q.z - p.z), outgoing = Math.hypot(r.x - q.x, r.z - q.z);
    const ix = (q.x - p.x) / incoming, iz = (q.z - p.z) / incoming;
    const ox = (r.x - q.x) / outgoing, oz = (r.z - q.z) / outgoing;
    if (Math.abs(ix * oz - iz * ox) < .5) {
      points.push({ ...q, checkpointIndex: i, corner: false, distanceToCorner: Infinity }); continue;
    }
    const turnRadius = Math.min(radius, incoming / 3, outgoing / 3);
    const a = { x: q.x - ix * turnRadius, z: q.z - iz * turnRadius };
    const b = { x: q.x + ox * turnRadius, z: q.z + oz * turnRadius };
    for (let n = 0; n <= GAME_CONFIG.traffic.turnCurveSegments; n++) {
      const t = n / GAME_CONFIG.traffic.turnCurveSegments, u = 1 - t;
      points.push({ x: u * u * a.x + 2 * u * t * q.x + t * t * b.x,
        z: u * u * a.z + 2 * u * t * q.z + t * t * b.z, checkpointIndex: i, corner: true, distanceToCorner: 0 });
    }
  }
  for (let i = 0; i < points.length; i++) {
    const previous = i === 0 ? course.start : points[i - 1];
    const next = points[i + 1] ?? points[i];
    const dx = next.x - previous.x, dz = next.z - previous.z, length = Math.hypot(dx, dz);
    points[i].normalX = length > 0 ? dz / length : 0;
    points[i].normalZ = length > 0 ? -dx / length : 0;
  }
  let distance = Infinity;
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i];
    if (point.corner) distance = 0;
    else if (i + 1 < points.length) distance += Math.hypot(points[i + 1].x - point.x, points[i + 1].z - point.z);
    point.distanceToCorner = distance;
  }
  return points;
}

function distanceToSegment(point: RacePoint, a: RacePoint, b: RacePoint): number {
  const dx = b.x - a.x, dz = b.z - a.z, lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > 0 ? clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared, 0, 1) : 0;
  return Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t);
}
