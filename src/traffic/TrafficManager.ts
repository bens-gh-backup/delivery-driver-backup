import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { GAME_CONFIG } from "../game/config";
import type { BoxCollider, TrafficCollisionInfo, TrafficWaypoint, TrafficVehicleRole } from "../game/types";
import { seededRandom } from "../utils/math";
import { TrafficCar, type Direction, type TrafficDriver } from "./TrafficCar";
import { TrafficSignalController } from "./TrafficSignalController";
import { TrafficTurnSignals } from "./TrafficTurnSignals";
import type { PlayerCar } from "../player/PlayerCar";
import { chaseImpactDamage } from "../chase/ChaseRules";
import { collisionDamagePercent } from "../player/DamageManager";
import { VehicleContactSolver } from "../physics/VehicleContactSolver";
import type { VehicleBody } from "../physics/VehicleBody";
import type { WorldQuery } from "../world/WorldQuery";

interface SafetyConflictDecision {
  allowCrash: boolean;
  yielderId: number;
}

export class TrafficManager {
  readonly cars: TrafficCar[] = [];
  readonly policeCars: TrafficCar[] = [];
  readonly trafficSignals: TrafficSignalController;
  private readonly turnSignals: TrafficTurnSignals;
  chaseActive = false;
  private readonly staticPrevious = new Map<number, Set<BoxCollider>>();
  private readonly staticCurrent = new Map<number, Set<BoxCollider>>();
  private playerStaticCooldown = 0;
  private maximumVehicleRadius = Math.hypot(GAME_CONFIG.traffic.hitboxWidth, GAME_CONFIG.traffic.hitboxLength) / 2;
  activeCarCount = 0;
  lastCollisionCandidateCount = 0;
  private readonly rng = seededRandom(3777);
  private readonly materials: StandardMaterial[];
  private readonly prototypes: Mesh[];
  private readonly spatialHash = new Map<number, Map<number, TrafficCar[]>>();
  private readonly columnPool: Array<Map<number, TrafficCar[]>> = [];
  private readonly bucketPool: TrafficCar[][] = [];
  private readonly nearbyByCar: TrafficCar[][] = [];
  private readonly updateAccumulatorByCar: number[] = [];
  private readonly updateDeltaByCar: number[] = [];
  private readonly fullSimulationByCar: boolean[] = [];
  private readonly damageCooldownByCar: number[] = [];
  private readonly indexByCar = new Map<TrafficCar, number>();
  private readonly contactSolver = new VehicleContactSolver();
  private readonly collisionBodies: VehicleBody[] = [];
  private lastPlayerResetGeneration = -1;
  private readonly playerQueryResults: TrafficCar[] = [];
  private readonly trafficCollisionQueryResults: TrafficCar[] = [];
  private readonly previousContacts = new Set<string>();
  private readonly currentContacts = new Set<string>();
  private readonly safetyConflictDecisions = new Map<string, SafetyConflictDecision>();
  private readonly currentSafetyConflicts = new Set<string>();
  private recycleCursor = 0;
  private suspended = false;
  private readonly noCollision: TrafficCollisionInfo = {
    ridePenaltyMph: 0, damagePercent: 0, collisionViolationSeverity: 0,
    policeCollisionOfficerId: null, policeCollisionSeverity: 0,
  };

  get isSuspended(): boolean { return this.suspended; }

  setSuspended(suspended: boolean, player?: PlayerCar): void {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    this.previousContacts.clear();
    this.currentContacts.clear();
    this.safetyConflictDecisions.clear();
    this.updateAccumulatorByCar.fill(0);
    this.updateDeltaByCar.fill(0);
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (!suspended && player && Math.hypot(car.mesh.position.x - player.root.position.x,
        car.mesh.position.z - player.root.position.z) < GAME_CONFIG.racing.trafficResumeClearance) {
        this.recycleCar(car, i, player);
      }
      // Normal visibility filtering resumes on the next simulation step.
      car.mesh.setEnabled(false);
    }
    this.activeCarCount = 0;
    this.lastCollisionCandidateCount = 0;
    this.turnSignals.update(0);
  }

  constructor(
    scene: Scene,
    private readonly waypoints: TrafficWaypoint[],
    private readonly roadPositionsX: number[],
    private readonly roadPositionsZ: number[],
  ) {
    this.trafficSignals = new TrafficSignalController(scene, roadPositionsX, roadPositionsZ);
    this.materials = [
      this.material(scene, "traffic-red", new Color3(0.76, 0.18, 0.14)),
      this.material(scene, "traffic-blue", new Color3(0.12, 0.36, 0.72)),
      this.material(scene, "traffic-white", new Color3(0.82, 0.85, 0.82)),
      this.material(scene, "traffic-teal", new Color3(0.1, 0.55, 0.5)),
      this.material(scene, "traffic-police", Color3.White()),
    ];
    this.prototypes = this.materials.slice(0, 4)
      .map((material, index) => TrafficCar.createPrototype(scene, material, index));
    const policePrototype = TrafficCar.createPolicePrototype(scene, this.materials[4]);
    this.prototypes.push(policePrototype);
    for (const material of this.materials) material.freeze();

    const shuffled = [...this.waypoints].sort(() => this.rng() - 0.5);
    const spawnRounds = Math.ceil(GAME_CONFIG.traffic.vehicleCount / shuffled.length);
    for (let i = 0; i < GAME_CONFIG.traffic.vehicleCount; i++) {
      const waypoint = shuffled[i % shuffled.length];
      const direction = this.pickValidDirection(waypoint, this.roadPositionsX.length, this.roadPositionsZ.length);
      const speed = GAME_CONFIG.traffic.minSpeed + this.rng() * (GAME_CONFIG.traffic.maxSpeed - GAME_CONFIG.traffic.minSpeed);
      const spawnRound = Math.floor(i / shuffled.length);
      const spawnProgress = spawnRound === 0 ? 0 : spawnRound / spawnRounds;
      const role = i < GAME_CONFIG.police.vehicleCount ? "police" : "civilian";
      const car = new TrafficCar(
        i,
        role,
        waypoint,
        direction,
        speed,
        this.roadPositionsX,
        this.roadPositionsZ,
        this.rng,
        role === "police" ? policePrototype : this.prototypes[i % 4],
        spawnProgress,
      );
      this.cars.push(car);
      if (role === "police") this.policeCars.push(car);
      this.indexByCar.set(car, i);
      this.nearbyByCar.push([]);
      this.updateAccumulatorByCar.push(0);
      this.updateDeltaByCar.push(0);
      this.fullSimulationByCar.push(false);
      this.damageCooldownByCar.push(0);
    }
    this.turnSignals = new TrafficTurnSignals(scene, this.cars);
  }

  /** Append one reserved slot once; IDs remain stable for the contact solver's array lookup. */
  addManagedCar(prototype: Mesh, driver: TrafficDriver, role: TrafficVehicleRole = "suspect"): TrafficCar {
    const id = this.cars.length, waypoint = this.waypoints[0];
    const car = new TrafficCar(id, role, waypoint,
      this.pickValidDirection(waypoint, this.roadPositionsX.length, this.roadPositionsZ.length),
      0, this.roadPositionsX, this.roadPositionsZ, this.rng, prototype);
    car.driver = driver; car.syncCollisionBody(0); car.mesh.setEnabled(false);
    this.maximumVehicleRadius = Math.max(this.maximumVehicleRadius, Math.hypot(car.collisionBody.halfWidth, car.collisionBody.halfLength));
    this.cars.push(car); this.indexByCar.set(car,id); this.nearbyByCar.push([]);
    this.updateAccumulatorByCar.push(0); this.updateDeltaByCar.push(0);
    this.fullSimulationByCar.push(false); this.damageCooldownByCar.push(0);
    return car;
  }

  queryVehicles(x: number, z: number, radius: number, results: TrafficCar[]): void {
    this.queryNearby(x,z,radius,results);
  }

  update(deltaTime: number, player: PlayerCar, world?: WorldQuery): TrafficCollisionInfo {
    if (this.suspended) return this.noCollision;
    this.trafficSignals.update(deltaTime);
    this.playerStaticCooldown = Math.max(0, this.playerStaticCooldown - deltaTime);
    for (let index = 0; index < this.damageCooldownByCar.length; index++) {
      this.damageCooldownByCar[index] = Math.max(0, this.damageCooldownByCar[index] - deltaTime);
    }
    this.prepareUpdates(deltaTime, player);
    this.rebuildSpatialHash();
    this.prepareNpcSafety();
    for (let index = 0; index < this.cars.length; index++) {
      const updateDelta = this.updateDeltaByCar[index];
      const car = this.cars[index];
      if (updateDelta <= 0) { car.syncCollisionBody(0); continue; }
      const nearby = this.nearbyByCar[index];
      this.queryNearby(car.mesh.position.x, car.mesh.position.z, GAME_CONFIG.traffic.lookAheadDistance, nearby);
      car.update(updateDelta, nearby, this.trafficSignals.aspectFor(car.direction), world, player.collisionBody);
    }
    for (const car of this.cars) car.beginCollisionFrame();
    this.currentContacts.clear();
    this.rebuildSpatialHash();
    const collisionInfo = this.resolveVehicleCollisions(deltaTime, player, world);
    this.previousContacts.clear();
    for (const contact of this.currentContacts) this.previousContacts.add(contact);
    this.turnSignals.update(deltaTime);
    return collisionInfo;
  }

  dispose(): void {
    this.turnSignals.dispose();
    this.trafficSignals.dispose();
    for (const car of this.cars) {
      car.dispose();
    }
    for (const prototype of this.prototypes) prototype.dispose();
    for (const material of this.materials) material.dispose();
  }

  private resolveVehicleCollisions(dt: number, player: PlayerCar, world?: WorldQuery): TrafficCollisionInfo {
    if (player.resetGeneration !== this.lastPlayerResetGeneration) {
      this.previousContacts.clear(); this.damageCooldownByCar.fill(0);
      this.lastPlayerResetGeneration = player.resetGeneration;
      this.staticPrevious.clear(); this.staticCurrent.clear(); this.playerStaticCooldown = 0;
    }
    player.collisionBody.reportStaticImpacts = this.chaseActive;
    player.syncCollisionBody(dt);
    const solver = this.contactSolver;
    solver.begin(); this.collisionBodies.length = 0; this.collisionBodies.push(player.collisionBody);
    let maxTravel = Math.hypot(player.collisionBody.endX - player.collisionBody.startX,
      player.collisionBody.endZ - player.collisionBody.startZ);
    const trafficRadius = this.maximumVehicleRadius;
    for (let i = 0; i < this.cars.length; i++) {
      if (!this.fullSimulationByCar[i]) continue;
      const body = this.cars[i].collisionBody;
      this.collisionBodies.push(body);
      maxTravel = Math.max(maxTravel, Math.hypot(body.endX - body.startX, body.endZ - body.startZ));
    }
    const playerRadius = Math.hypot(player.vehicleWidth, player.vehicleLength) / 2;
    const margin = 2 * maxTravel + 2 * GAME_CONFIG.vehicleCollisions.maximumCorrection;
    this.queryNearby(player.root.position.x, player.root.position.z,
      Math.max(GAME_CONFIG.traffic.playerCollisionQueryRadius, playerRadius + trafficRadius + margin), this.playerQueryResults);
    this.lastCollisionCandidateCount = this.playerQueryResults.length;
    for (const car of this.playerQueryResults) {
      if (!this.fullSimulationByCar[this.indexByCar.get(car)!]) continue;
      if (Math.hypot(car.mesh.position.x - player.root.position.x, car.mesh.position.z - player.root.position.z)
        <= playerRadius + trafficRadius + margin) solver.addPair(player.collisionBody, car.collisionBody);
    }
    for (let i = 0; i < this.cars.length; i++) {
      if (!this.fullSimulationByCar[i]) continue;
      const first = this.cars[i];
      this.queryNearby(first.mesh.position.x, first.mesh.position.z, 2 * trafficRadius + margin, this.trafficCollisionQueryResults);
      for (const second of this.trafficCollisionQueryResults) {
        const j = this.indexByCar.get(second)!;
        if (j <= i || !this.fullSimulationByCar[j]) continue;
        this.lastCollisionCandidateCount++;
        if (Math.hypot(first.mesh.position.x - second.mesh.position.x, first.mesh.position.z - second.mesh.position.z)
          <= 2 * trafficRadius + margin) solver.addPair(first.collisionBody, second.collisionBody);
      }
    }
    solver.step(this.collisionBodies, dt, world);
    player.applyCollisionBody();
    for (let i = 0; i < this.cars.length; i++) if (this.fullSimulationByCar[i]) this.cars[i].applyCollisionBody();
    let ridePenaltyMph = 0, damagePercent = 0, collisionViolationSeverity = 0, policeCollisionSeverity = 0;
    let policeCollisionOfficerId: number | null = null;
    for (const event of solver.events) {
      const car = this.cars[event.b.id], first = event.a.id < 0 ? null : this.cars[event.a.id];
      const key = first ? `t:${first.id}:${first.respawnGeneration}:${car.id}:${car.respawnGeneration}`
        : `p:${car.id}:${car.respawnGeneration}`;
      this.currentContacts.add(key);
      car.markCollisionContact(first?.id ?? -1); first?.markCollisionContact(car.id);
      if (this.previousContacts.has(key)) continue;
      const closingMph = event.closingSpeed * GAME_CONFIG.ride.mphPerWorldUnitPerSecond;
      const directness = event.relativeSpeed > 0 ? event.closingSpeed / event.relativeSpeed : 0;
      if (first) {
        const damage = collisionDamagePercent(closingMph, directness);
        const serious = closingMph >= GAME_CONFIG.traffic.seriousCollisionSpeedMph;
        const suspectDamage = chaseImpactDamage(closingMph, directness, false);
        first.registerCollision(car.id, first.role === "suspect" ? suspectDamage : damage, serious, false);
        car.registerCollision(first.id, car.role === "suspect" ? suspectDamage : damage, serious, false);
        continue;
      }
      const npcResponsible = isNpcResponsibleForPlayerCollision(event.bHeading, event.normalX, event.normalZ,
        event.bVelocityX, event.bVelocityZ, event.aVelocityX, event.aVelocityZ);
      if (!npcResponsible) ridePenaltyMph = Math.max(ridePenaltyMph,
        Math.hypot(event.aVelocityX, event.aVelocityZ) * GAME_CONFIG.ride.mphPerWorldUnitPerSecond);
      const index = this.indexByCar.get(car)!;
      if (this.damageCooldownByCar[index] > 0) continue;
      // Ram commitment still controls damage/recovery, but never adds a second physical impulse.
      const ram = car.createRamImpact(closingMph, directness, {
        x: event.aX, z: event.aZ, heading: event.aHeading, vehicleLength: player.vehicleLength,
      }, { x: event.bX, z: event.bZ, heading: event.bHeading });
      const damage = ram?.damage ?? collisionDamagePercent(closingMph, directness);
      damagePercent += this.chaseActive ? chaseImpactDamage(closingMph,directness,true) : damage;
      car.registerCollision(-1, car.role === "suspect" ? chaseImpactDamage(closingMph,directness,false) : damage, ram !== null || closingMph >= GAME_CONFIG.traffic.seriousCollisionSpeedMph);
      const severity = Math.min(1, closingMph / GAME_CONFIG.police.collisionFullSeveritySpeedMph);
      if (!this.chaseActive && !npcResponsible && damage >= GAME_CONFIG.police.collisionPoliceDamageThreshold) {
        if (car.role === "police" && policeCollisionOfficerId === null) {
          policeCollisionOfficerId = car.id; policeCollisionSeverity = severity;
        }
        const playerImpactMph = Math.max(0, -(event.aVelocityX * event.normalX + event.aVelocityZ * event.normalZ))
          * GAME_CONFIG.ride.mphPerWorldUnitPerSecond;
        if (playerImpactMph >= GAME_CONFIG.police.collisionMinimumImpactSpeedMph)
          collisionViolationSeverity = Math.max(collisionViolationSeverity,
            Math.min(1, playerImpactMph / GAME_CONFIG.police.collisionFullSeveritySpeedMph));
      }
      this.damageCooldownByCar[index] = GAME_CONFIG.traffic.damageCooldownSeconds;
    }
    for (const contacts of this.staticCurrent.values()) contacts.clear();
    for (const event of solver.staticEvents) {
      const id = event.body.id;
      let contacts = this.staticCurrent.get(id);
      if (!contacts) { contacts = new Set(); this.staticCurrent.set(id,contacts); }
      contacts.add(event.collider);
      if (this.staticPrevious.get(id)?.has(event.collider)) continue;
      const directness = event.relativeSpeed > 0 ? event.closingSpeed/event.relativeSpeed : 0;
      const amount = chaseImpactDamage(event.closingSpeed * GAME_CONFIG.ride.mphPerWorldUnitPerSecond,directness,id<0);
      if (id < 0) {
        if (this.chaseActive && this.playerStaticCooldown <= 0 && amount > 0) {
          damagePercent += amount; this.playerStaticCooldown = GAME_CONFIG.policeChase.damageCooldownSeconds;
        }
      } else this.cars[id].driver?.damage(amount);
    }
    for (const contacts of this.staticPrevious.values()) contacts.clear();
    for (const [id,contacts] of this.staticCurrent) {
      let previous = this.staticPrevious.get(id);
      if (!previous) { previous = new Set(); this.staticPrevious.set(id,previous); }
      for (const collider of contacts) previous.add(collider);
    }
    return { ridePenaltyMph, damagePercent, collisionViolationSeverity, policeCollisionOfficerId, policeCollisionSeverity };
  }

  private prepareNpcSafety(): void {
    for (const car of this.cars) car.setSafetyBrakeMode(null);
    this.currentSafetyConflicts.clear();
    const horizon = GAME_CONFIG.traffic.predictiveSafetyHorizonSeconds;
    const queryRadius = GAME_CONFIG.traffic.lookAheadDistance
      + GAME_CONFIG.traffic.maxSpeed * horizon;
    for (let firstIndex = 0; firstIndex < this.cars.length; firstIndex++) {
      if (!this.fullSimulationByCar[firstIndex]) continue;
      const first = this.cars[firstIndex];
      if (first.isPursuing || first.role === "suspect") continue;
      this.queryNearby(
        first.mesh.position.x,
        first.mesh.position.z,
        queryRadius,
        this.trafficCollisionQueryResults,
      );
      for (const second of this.trafficCollisionQueryResults) {
        const secondIndex = this.indexByCar.get(second) ?? -1;
        if (secondIndex <= firstIndex || !this.fullSimulationByCar[secondIndex] || second.isPursuing || second.role === "suspect") continue;
        if (!willVehiclesConflict(first, second, horizon, GAME_CONFIG.traffic.predictiveSafetyClearance)) {
          continue;
        }
        const key = `s:${first.id}:${second.id}`;
        this.currentSafetyConflicts.add(key);
        let decision = this.safetyConflictDecisions.get(key);
        if (!decision) {
          decision = {
            allowCrash: first.role !== "race_waiting" && second.role !== "race_waiting" && shouldAllowIntentionalCrash(
              this.rng,
              GAME_CONFIG.traffic.intentionalCrashChanceDenominator,
            ),
            yielderId: first.role === "race_waiting" ? second.id : second.role === "race_waiting" ? first.id : chooseSafetyYielder(first, second).id,
          };
          this.safetyConflictDecisions.set(key, decision);
        }
        const yielder = first.id === decision.yielderId ? first : second;
        yielder.setSafetyBrakeMode(decision.allowCrash ? "light" : "hard");
      }
    }
    for (const key of this.safetyConflictDecisions.keys()) {
      if (!this.currentSafetyConflicts.has(key)) this.safetyConflictDecisions.delete(key);
    }
  }

  private rebuildSpatialHash(): void {
    for (const column of this.spatialHash.values()) {
      for (const bucket of column.values()) {
        bucket.length = 0;
        this.bucketPool.push(bucket);
      }
      column.clear();
      this.columnPool.push(column);
    }
    this.spatialHash.clear();
    for (const car of this.cars) {
      if (!car.mesh.isEnabled()) continue;
      const cellX = this.cellFor(car.mesh.position.x);
      const cellZ = this.cellFor(car.mesh.position.z);
      let column = this.spatialHash.get(cellX);
      if (!column) {
        column = this.columnPool.pop() ?? new Map<number, TrafficCar[]>();
        this.spatialHash.set(cellX, column);
      }
      let bucket = column.get(cellZ);
      if (!bucket) {
        bucket = this.bucketPool.pop() ?? [];
        column.set(cellZ, bucket);
      }
      bucket.push(car);
    }
  }

  private queryNearby(x: number, z: number, radius: number, results: TrafficCar[]): void {
    results.length = 0;
    const cellSize = GAME_CONFIG.traffic.spatialCellSize;
    const minCellX = Math.floor((x - radius) / cellSize);
    const maxCellX = Math.floor((x + radius) / cellSize);
    const minCellZ = Math.floor((z - radius) / cellSize);
    const maxCellZ = Math.floor((z + radius) / cellSize);

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const bucket = this.spatialHash.get(cellX)?.get(cellZ);
        if (!bucket) {
          continue;
        }
        for (const car of bucket) {
          results.push(car);
        }
      }
    }

  }

  private cellFor(value: number): number {
    return Math.floor(value / GAME_CONFIG.traffic.spatialCellSize);
  }

  private prepareUpdates(deltaTime: number, player: PlayerCar): void {
    const fullRadiusSquared = GAME_CONFIG.traffic.fullSimulationRadius ** 2;
    const reducedRadiusSquared = GAME_CONFIG.traffic.reducedSimulationRadius ** 2;
    this.activeCarCount = 0;
    for (let index = 0; index < this.cars.length; index++) {
      const car = this.cars[index];
      let dx = car.mesh.position.x - player.root.position.x;
      let dz = car.mesh.position.z - player.root.position.z;
      let distanceSquared = dx * dx + dz * dz;
      if (!car.driver && !car.isPursuing && distanceSquared > GAME_CONFIG.traffic.recycleRadius ** 2) {
        this.recycleCar(car, index, player);
        dx = car.mesh.position.x - player.root.position.x;
        dz = car.mesh.position.z - player.root.position.z;
        distanceSquared = dx * dx + dz * dz;
      }
      const enabled = car.driver ? car.driver.enabled : distanceSquared <= reducedRadiusSquared;
      car.mesh.setEnabled(enabled);
      this.updateDeltaByCar[index] = 0;
      this.fullSimulationByCar[index] = false;
      if (!enabled) continue;
      this.activeCarCount += 1;
      if (car.driver || distanceSquared <= fullRadiusSquared || car.collisionBody.dynamic) {
        this.fullSimulationByCar[index] = true;
        this.updateDeltaByCar[index] = deltaTime;
        continue;
      }
      this.updateAccumulatorByCar[index] += deltaTime;
      if (this.updateAccumulatorByCar[index] >= GAME_CONFIG.traffic.reducedUpdateInterval) {
        this.updateDeltaByCar[index] = this.updateAccumulatorByCar[index];
        this.updateAccumulatorByCar[index] = 0;
      }
    }
  }

  private recycleCar(car: TrafficCar, carIndex: number, player: PlayerCar): void {
    if (car.driver) return;
    const minDistanceSquared = GAME_CONFIG.traffic.respawnMinRadius ** 2;
    const maxDistanceSquared = GAME_CONFIG.traffic.respawnMaxRadius ** 2;
    for (let attempt = 0; attempt < this.waypoints.length; attempt++) {
      const waypoint = this.waypoints[this.recycleCursor % this.waypoints.length];
      this.recycleCursor += 1;
      const dx = waypoint.position.x - player.root.position.x;
      const dz = waypoint.position.z - player.root.position.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared < minDistanceSquared || distanceSquared > maxDistanceSquared) continue;
      const direction = this.pickValidDirection(waypoint, this.roadPositionsX.length, this.roadPositionsZ.length);
      const progress = ((carIndex % 5) + 1) / 6;
      car.respawn(waypoint, direction, progress);
      const spawnedDx = car.mesh.position.x - player.root.position.x;
      const spawnedDz = car.mesh.position.z - player.root.position.z;
      const spawnedDistanceSquared = spawnedDx * spawnedDx + spawnedDz * spawnedDz;
      if (spawnedDistanceSquared < minDistanceSquared || spawnedDistanceSquared > maxDistanceSquared) {
        car.respawn(waypoint, direction, 0);
      }
      this.updateAccumulatorByCar[carIndex] = 0;
      this.damageCooldownByCar[carIndex] = 0;
      return;
    }
  }

  private pickValidDirection(waypoint: TrafficWaypoint, maxX: number, maxZ: number): Direction {
    const options: Direction[] = [];
    if (waypoint.iz > 0) options.push("north");
    if (waypoint.iz < maxZ - 1) options.push("south");
    if (waypoint.ix > 0) options.push("west");
    if (waypoint.ix < maxX - 1) options.push("east");
    return options[Math.floor(this.rng() * options.length)];
  }

  private material(scene: Scene, name: string, color: Color3): StandardMaterial {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
    return mat;
  }
}

export function willVehiclesConflict(
  first: TrafficCar,
  second: TrafficCar,
  horizonSeconds: number,
  clearance: number,
): boolean {
  const offsetX = second.mesh.position.x - first.mesh.position.x;
  const offsetZ = second.mesh.position.z - first.mesh.position.z;
  const relativeVelocityX = second.getVelocityX() - first.getVelocityX();
  const relativeVelocityZ = second.getVelocityZ() - first.getVelocityZ();
  const relativeSpeedSquared = relativeVelocityX * relativeVelocityX
    + relativeVelocityZ * relativeVelocityZ;
  if (relativeSpeedSquared <= 1e-4) return false;
  const approachRate = offsetX * relativeVelocityX + offsetZ * relativeVelocityZ;
  if (approachRate >= 0) return false;
  const closestTime = Math.max(0, Math.min(horizonSeconds, -approachRate / relativeSpeedSquared));
  const closestX = offsetX + relativeVelocityX * closestTime;
  const closestZ = offsetZ + relativeVelocityZ * closestTime;
  return closestX * closestX + closestZ * closestZ <= clearance * clearance;
}

export function shouldAllowIntentionalCrash(rng: () => number, denominator: number): boolean {
  return denominator > 0 && rng() < 1 / denominator;
}

export function isNpcResponsibleForPlayerCollision(
  npcHeading: number,
  collisionNormalX: number,
  collisionNormalZ: number,
  npcVelocityX: number,
  npcVelocityZ: number,
  playerVelocityX: number,
  playerVelocityZ: number,
): boolean {
  const npcForwardX = Math.sin(npcHeading);
  const npcForwardZ = Math.cos(npcHeading);
  const frontAlignment = npcForwardX * collisionNormalX + npcForwardZ * collisionNormalZ;
  if (frontAlignment < GAME_CONFIG.traffic.npcFrontImpactAlignment) return false;

  const npcImpactSpeed = Math.max(
    0,
    npcVelocityX * collisionNormalX + npcVelocityZ * collisionNormalZ,
  );
  const playerImpactSpeed = Math.max(
    0,
    -(playerVelocityX * collisionNormalX + playerVelocityZ * collisionNormalZ),
  );
  return npcImpactSpeed > playerImpactSpeed;
}

function chooseSafetyYielder(first: TrafficCar, second: TrafficCar): TrafficCar {
  const firstSpeed = Math.hypot(first.getVelocityX(), first.getVelocityZ());
  const secondSpeed = Math.hypot(second.getVelocityX(), second.getVelocityZ());
  if (firstSpeed < 0.5 && secondSpeed >= 0.5) return second;
  if (secondSpeed < 0.5 && firstSpeed >= 0.5) return first;

  const firstForwardX = firstSpeed >= 0.5
    ? first.getVelocityX() / firstSpeed
    : Math.sin(first.mesh.rotation.y);
  const firstForwardZ = firstSpeed >= 0.5
    ? first.getVelocityZ() / firstSpeed
    : Math.cos(first.mesh.rotation.y);
  const secondForwardX = secondSpeed >= 0.5
    ? second.getVelocityX() / secondSpeed
    : Math.sin(second.mesh.rotation.y);
  const secondForwardZ = secondSpeed >= 0.5
    ? second.getVelocityZ() / secondSpeed
    : Math.cos(second.mesh.rotation.y);
  const alignment = firstForwardX * secondForwardX + firstForwardZ * secondForwardZ;
  if (alignment > 0.7) {
    const offsetX = second.mesh.position.x - first.mesh.position.x;
    const offsetZ = second.mesh.position.z - first.mesh.position.z;
    return offsetX * firstForwardX + offsetZ * firstForwardZ > 0 ? first : second;
  }
  return first.id > second.id ? first : second;
}
