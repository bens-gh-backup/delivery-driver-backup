import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Activity } from "../activity/ActivityManager";
import { GAME_CONFIG } from "../game/config";
import type { PlayerCar } from "../player/PlayerCar";
import type { Town } from "../world/Town";
import { findOrientedBoxCollision } from "../traffic/OrientedBoxCollision";
import { createRaceCourses, type RaceCourse, type RacePoint } from "./RaceCourse";
import { RaceCar } from "./RaceCar";
import { advanceRaceProgress, rankRacers, type RacerProgress } from "./RaceProgress";

export type RaceState = "IDLE" | "COUNTDOWN" | "RACING" | "FINISHED";
export interface RaceResult { regionId: string; finishPlace: number; }
export interface RaceSnapshot {
  state: RaceState; regionId: string; position: number; checkpoint: number;
  checkpointCount: number; countdown: number; finishPlace: number | null;
  route: readonly RacePoint[];
  opponents: { id: number; x: number; z: number; heading: number; speed: number; checkpoint: number; color: string; visible: boolean }[];
}

export class RaceManager implements Activity {
  readonly courses: ReadonlyMap<string, RaceCourse>;
  private stateValue: RaceState = "IDLE";
  private course: RaceCourse | null = null;
  private readonly cars: RaceCar[] = [];
  private playerProgress: RacerProgress | null = null;
  private readonly previousPlayer: RacePoint = { x: 0, z: 0 };
  private readonly previousCars: RacePoint[] = [];
  private elapsed = 0;
  private countdown = 0;
  private finishPlace: number | null = null;
  private result: RaceResult | null = null;
  private marker: Mesh | null = null;
  private markerMaterial: StandardMaterial | null = null;
  private readonly objective = Vector3.Zero();
  private readonly contacts = new Set<string>();
  private readonly currentContacts = new Set<string>();

  constructor(private readonly scene: Scene, town: Pick<Town, "roadPositionsX" | "roadPositionsZ">) {
    this.courses = createRaceCourses(town);
  }

  get state(): RaceState { return this.stateValue; }
  get isActive(): boolean { return this.stateValue !== "IDLE"; }
  getCourse(regionId: string): RaceCourse | undefined { return this.courses.get(regionId); }

  start(regionId: string, player: PlayerCar): boolean {
    if (this.isActive) return false;
    const course = this.courses.get(regionId);
    if (!course) return false;
    this.course = course;
    this.elapsed = 0; this.countdown = GAME_CONFIG.racing.countdownSeconds;
    this.finishPlace = null; this.result = null;
    const forwardX = Math.sin(course.heading), forwardZ = Math.cos(course.heading);
    const grid = (index: number): RacePoint => {
      const backward = (Math.floor(index / 2) + 1) * Math.max(GAME_CONFIG.racing.grid.longitudinalSpacing, player.vehicleLength + 2);
      const lateral = (index % 2 === 0 ? -1 : 1) * GAME_CONFIG.racing.grid.lateralSpacing / 2;
      return { x: course.start.x - forwardX * backward + forwardZ * lateral,
        z: course.start.z - forwardZ * backward - forwardX * lateral };
    };
    const position = grid(3);
    player.teleportTo(position.x, position.z, course.heading);
    this.previousPlayer.x = position.x; this.previousPlayer.z = position.z;
    this.playerProgress = { id: 0, checkpointIndex: 0, finishTime: null, position: { ...position } };
    for (let i = 0; i < GAME_CONFIG.racing.aiCount; i++) {
      const stats = GAME_CONFIG.racing.racers[i % GAME_CONFIG.racing.racers.length];
      const opponentPosition = grid(i < 3 ? i : i + 1);
      this.cars.push(new RaceCar(this.scene, i + 1, course, stats, opponentPosition, course.heading));
      this.previousCars.push({ ...opponentPosition });
    }
    this.stateValue = "COUNTDOWN";
    this.createMarker(); this.updateMarker();
    return true;
  }

  update(dt: number, player: PlayerCar): void {
    if (!this.course || !this.playerProgress || !Number.isFinite(dt) || dt <= 0) return;
    if (this.stateValue === "COUNTDOWN") {
      this.countdown = Math.max(0, this.countdown - dt);
      if (this.countdown <= 1e-8) { this.countdown = 0; this.stateValue = "RACING"; }
      return;
    }
    if (this.stateValue !== "RACING") return;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      this.previousCars[i].x = car.mesh.position.x; this.previousCars[i].z = car.mesh.position.z;
      car.tryOvertake(this.cars);
      car.update(dt);
    }
    this.resolveContacts(player);
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (!car.recoveredThisStep) advanceRaceProgress(car.progress, this.previousCars[i], car.mesh.position,
        this.course.checkpoints, GAME_CONFIG.racing.checkpointRadius, this.elapsed, dt);
    }
    advanceRaceProgress(this.playerProgress, this.previousPlayer, player.root.position,
      this.course.checkpoints, GAME_CONFIG.racing.checkpointRadius, this.elapsed, dt);
    this.previousPlayer.x = player.root.position.x; this.previousPlayer.z = player.root.position.z;
    this.elapsed += dt;
    if (this.playerProgress.finishTime !== null) {
      this.finishPlace = this.placement();
      this.result = { regionId: this.course.regionId, finishPlace: this.finishPlace };
      this.stateValue = "FINISHED";
      for (const car of this.cars) {
        car.speed = 0;
        if (car.progress.finishTime !== null) car.mesh.setEnabled(false);
      }
      // Clear residual player velocity while preserving the finish pose.
      player.teleportTo(player.root.position.x, player.root.position.z, player.heading);
    }
    this.updateMarker();
  }

  resetPlayer(player: PlayerCar): void {
    if (!this.course || !this.playerProgress || this.stateValue !== "RACING") return;
    const index = this.playerProgress.checkpointIndex;
    const anchor = index > 0 ? this.course.checkpoints[index - 1] : this.course.start;
    const target = this.course.checkpoints[index];
    player.teleportTo(anchor.x, anchor.z, Math.atan2(target.x - anchor.x, target.z - anchor.z));
    this.previousPlayer.x = anchor.x; this.previousPlayer.z = anchor.z;
    this.playerProgress.position.x = anchor.x; this.playerProgress.position.z = anchor.z;
  }

  get snapshot(): RaceSnapshot {
    return { state: this.stateValue, regionId: this.course?.regionId ?? "",
      position: this.stateValue === "COUNTDOWN" ? 4 : this.finishPlace ?? this.placement(), checkpoint: this.course && this.playerProgress
        ? Math.min(this.playerProgress.checkpointIndex + 1, this.course.checkpoints.length) : 0,
      checkpointCount: this.course?.checkpoints.length ?? 0, countdown: Math.ceil(this.countdown),
      finishPlace: this.finishPlace, route: this.course?.route ?? [],
      opponents: this.cars.map(car => ({ id: car.id, x: car.mesh.position.x, z: car.mesh.position.z,
        heading: car.mesh.rotation.y, speed: car.speed, checkpoint: car.progress.checkpointIndex, color: car.stats.color, visible: car.mesh.isEnabled() })) };
  }

  getObjectivePosition(): Vector3 | null {
    return this.isActive && this.stateValue !== "FINISHED" ? this.objective : null;
  }

  consumeResult(): RaceResult | null { const result = this.result; this.result = null; return result; }

  abort(): void {
    for (const car of this.cars) car.dispose();
    this.cars.length = 0; this.previousCars.length = 0;
    this.marker?.dispose(); this.markerMaterial?.dispose(); this.marker = null; this.markerMaterial = null;
    this.stateValue = "IDLE"; this.course = null; this.playerProgress = null;
    this.result = null; this.finishPlace = null; this.countdown = 0;
    this.contacts.clear(); this.currentContacts.clear();
  }

  dispose(): void { this.abort(); }

  private placement(): number {
    if (!this.course || !this.playerProgress) return 0;
    return rankRacers([this.playerProgress, ...this.cars.map(car => car.progress)], this.course.checkpoints)
      .findIndex(progress => progress.id === 0) + 1;
  }

  private createMarker(): void {
    this.markerMaterial = new StandardMaterial("race-checkpoint-material", this.scene);
    this.markerMaterial.diffuseColor = new Color3(.1, .85, .95);
    this.markerMaterial.emissiveColor = new Color3(.05, .5, .6);
    this.markerMaterial.alpha = .45;
    this.marker = MeshBuilder.CreateCylinder("race-checkpoint", {
      diameter: GAME_CONFIG.racing.checkpointRadius * 2, height: .25, tessellation: 32,
    }, this.scene);
    this.marker.material = this.markerMaterial;
    const beam = MeshBuilder.CreateCylinder("race-checkpoint-beam", { diameter: 3, height: 45, tessellation: 12 }, this.scene);
    beam.material = this.markerMaterial; beam.parent = this.marker; beam.position.y = 22.5;
    this.marker.isPickable = beam.isPickable = false;
  }

  private updateMarker(): void {
    const point = this.course?.checkpoints[this.playerProgress?.checkpointIndex ?? 0];
    if (!point || this.stateValue === "FINISHED") { this.marker?.setEnabled(false); return; }
    this.objective.set(point.x, .2, point.z);
    this.marker?.position.copyFrom(this.objective);
  }

  private resolveContacts(player: PlayerCar): void {
    this.currentContacts.clear();
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (car.progress.finishTime !== null || car.recoveredThisStep) continue;
      const box = { x: car.mesh.position.x, z: car.mesh.position.z, heading: car.mesh.rotation.y,
        halfWidth: car.width / 2, halfLength: car.length / 2 };
      const playerHit = findOrientedBoxCollision({ x: player.root.position.x, z: player.root.position.z,
        heading: player.heading, halfWidth: player.vehicleWidth / 2, halfLength: player.vehicleLength / 2 }, box);
      if (playerHit) {
        const key = `p-${i}`; this.currentContacts.add(key);
        player.applyTrafficCollision(playerHit.normalX, playerHit.normalZ, playerHit.depth / 2, !this.contacts.has(key));
        car.mesh.position.x -= playerHit.normalX * playerHit.depth / 2;
        car.mesh.position.z -= playerHit.normalZ * playerHit.depth / 2;
        if (!this.contacts.has(key)) car.speed *= GAME_CONFIG.racing.collision.speedRetention;
      }
      for (let j = i + 1; j < this.cars.length; j++) {
        const other = this.cars[j];
        if (other.progress.finishTime !== null || other.recoveredThisStep) continue;
        box.x = car.mesh.position.x; box.z = car.mesh.position.z;
        const hit = findOrientedBoxCollision(box, { x: other.mesh.position.x, z: other.mesh.position.z,
          heading: other.mesh.rotation.y, halfWidth: other.width / 2, halfLength: other.length / 2 });
        if (!hit) continue;
        const key = `${i}-${j}`; this.currentContacts.add(key);
        car.mesh.position.x += hit.normalX * hit.depth / 2; car.mesh.position.z += hit.normalZ * hit.depth / 2;
        other.mesh.position.x -= hit.normalX * hit.depth / 2; other.mesh.position.z -= hit.normalZ * hit.depth / 2;
        if (!this.contacts.has(key)) { car.speed *= GAME_CONFIG.racing.collision.speedRetention; other.speed *= GAME_CONFIG.racing.collision.speedRetention; }
      }
    }
    this.contacts.clear(); for (const key of this.currentContacts) this.contacts.add(key);
  }
}
