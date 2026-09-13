import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { GAME_CONFIG } from "../game/config";
import type { TrafficCollisionInfo, TrafficWaypoint } from "../game/types";
import { seededRandom } from "../utils/math";
import { TrafficCar, type Direction } from "./TrafficCar";
import { TrafficSignalController } from "./TrafficSignalController";
import { TrafficTurnSignals } from "./TrafficTurnSignals";
import type { PlayerCar } from "../player/PlayerCar";
import { collisionDamagePercent } from "../player/DamageManager";
import { findOrientedBoxCollision } from "./OrientedBoxCollision";

interface SafetyConflictDecision {
  allowCrash: boolean;
  yielderId: number;
}

export class TrafficManager {
  readonly cars: TrafficCar[] = [];
  readonly policeCars: TrafficCar[] = [];
  readonly trafficSignals: TrafficSignalController;
  private readonly turnSignals: TrafficTurnSignals;
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

  update(deltaTime: number, player: PlayerCar): TrafficCollisionInfo {
    if (this.suspended) return this.noCollision;
    this.trafficSignals.update(deltaTime);
    for (let index = 0; index < this.damageCooldownByCar.length; index++) {
      this.damageCooldownByCar[index] = Math.max(0, this.damageCooldownByCar[index] - deltaTime);
    }
    this.prepareUpdates(deltaTime, player);
    this.rebuildSpatialHash();
    this.prepareNpcSafety();
    for (let index = 0; index < this.cars.length; index++) {
      const updateDelta = this.updateDeltaByCar[index];
      if (updateDelta <= 0) continue;
      const car = this.cars[index];
      const nearby = this.nearbyByCar[index];
      this.queryNearby(car.mesh.position.x, car.mesh.position.z, GAME_CONFIG.traffic.lookAheadDistance, nearby);
      car.update(updateDelta, nearby, this.trafficSignals.aspectFor(car.direction));
    }
    for (const car of this.cars) car.beginCollisionFrame();
    this.currentContacts.clear();
    this.rebuildSpatialHash();
    const collisionInfo = this.resolvePlayerCollisions(player);
    this.resolveTrafficCollisions();
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

  private resolvePlayerCollisions(player: PlayerCar): TrafficCollisionInfo {
    const playerX = player.root.position.x;
    const playerZ = player.root.position.z;
    const playerBoundingRadius = Math.hypot(player.vehicleWidth / 2, player.vehicleLength / 2);
    const trafficBoundingRadius = Math.hypot(
      GAME_CONFIG.traffic.hitboxWidth / 2,
      GAME_CONFIG.traffic.hitboxLength / 2,
    );
    const maximumCollisionDistance = playerBoundingRadius + trafficBoundingRadius;
    let ridePenaltyMph = 0;
    let damagePercent = 0;
    let collisionViolationSeverity = 0;
    let policeCollisionOfficerId: number | null = null;
    let policeCollisionSeverity = 0;
    this.queryNearby(
      playerX,
      playerZ,
      Math.max(GAME_CONFIG.traffic.playerCollisionQueryRadius, maximumCollisionDistance),
      this.playerQueryResults,
    );
    const nearbyCars = this.playerQueryResults;
    this.lastCollisionCandidateCount = nearbyCars.length;
    for (const car of nearbyCars) {
      const dx = playerX - car.mesh.position.x;
      const dz = playerZ - car.mesh.position.z;
      if (dx * dx + dz * dz >= maximumCollisionDistance * maximumCollisionDistance) {
        continue;
      }
      const collision = findOrientedBoxCollision(
        {
          x: playerX,
          z: playerZ,
          heading: player.heading,
          halfWidth: player.vehicleWidth / 2,
          halfLength: player.vehicleLength / 2,
        },
        {
          x: car.mesh.position.x,
          z: car.mesh.position.z,
          heading: car.mesh.rotation.y,
          halfWidth: GAME_CONFIG.traffic.hitboxWidth / 2,
          halfLength: GAME_CONFIG.traffic.hitboxLength / 2,
        },
      );
      if (!collision) {
        continue;
      }
      const contactKey = `p:${car.id}`;
      this.currentContacts.add(contactKey);
      car.markCollisionContact(-1);
      const newContact = !this.previousContacts.has(contactKey);
      const { normalX: nx, normalZ: nz, depth } = collision;
      const playerVelocityX = player.getVelocityX();
      const playerVelocityZ = player.getVelocityZ();
      const carVelocityX = car.getVelocityX();
      const carVelocityZ = car.getVelocityZ();
      const relativeVelocityX = playerVelocityX - carVelocityX;
      const relativeVelocityZ = playerVelocityZ - carVelocityZ;
      const relativeSpeedMph = Math.hypot(relativeVelocityX, relativeVelocityZ) * GAME_CONFIG.ride.mphPerWorldUnitPerSecond;
      const closingSpeedMph = Math.max(0, -(relativeVelocityX * nx + relativeVelocityZ * nz) * GAME_CONFIG.ride.mphPerWorldUnitPerSecond);
      const playerImpactSpeedMph = Math.max(
        0,
        -(playerVelocityX * nx + playerVelocityZ * nz)
          * GAME_CONFIG.ride.mphPerWorldUnitPerSecond,
      );
      const npcResponsible = isNpcResponsibleForPlayerCollision(
        car.mesh.rotation.y,
        nx,
        nz,
        carVelocityX,
        carVelocityZ,
        playerVelocityX,
        playerVelocityZ,
      );
      const directness = relativeSpeedMph > 0 ? closingSpeedMph / relativeSpeedMph : 0;
      if (newContact && !npcResponsible) {
        ridePenaltyMph = Math.max(ridePenaltyMph, player.getSpeedMph());
      }
      let ramImpact: import("./PursuitImpact").PursuitImpact | null = null;
      const carIndex = this.indexByCar.get(car) ?? -1;
      if (newContact && carIndex >= 0 && this.damageCooldownByCar[carIndex] <= 0) {
        const impactSeverity = Math.min(
          1,
          closingSpeedMph / GAME_CONFIG.police.collisionFullSeveritySpeedMph,
        );
        ramImpact = car.createRamImpact(closingSpeedMph, directness, {
          x: playerX, z: playerZ, heading: player.heading, vehicleLength: player.vehicleLength,
        });
        const impactDamage = ramImpact?.damage ?? collisionDamagePercent(closingSpeedMph, directness);
        damagePercent += impactDamage;
        car.registerCollision(
          -1,
          impactDamage,
          ramImpact !== null || closingSpeedMph >= GAME_CONFIG.traffic.seriousCollisionSpeedMph,
        );
        const seriousEnoughForPolice = impactDamage >= GAME_CONFIG.police.collisionPoliceDamageThreshold;
        if (!npcResponsible && seriousEnoughForPolice && car.role === "police" && policeCollisionOfficerId === null) {
          policeCollisionOfficerId = car.id;
          policeCollisionSeverity = impactSeverity;
        }
        if (!npcResponsible
          && seriousEnoughForPolice
          && playerImpactSpeedMph >= GAME_CONFIG.police.collisionMinimumImpactSpeedMph) {
          collisionViolationSeverity = Math.max(
            collisionViolationSeverity,
            Math.min(1, playerImpactSpeedMph / GAME_CONFIG.police.collisionFullSeveritySpeedMph),
          );
        }
        this.damageCooldownByCar[carIndex] = GAME_CONFIG.traffic.damageCooldownSeconds;
      }
      player.applyTrafficCollision(nx, nz, depth, newContact);
      if (ramImpact) {
        player.applyPursuitImpact(ramImpact);
        car.applyPursuitImpact(ramImpact);
      }
      car.push(-nx * depth * 0.35, -nz * depth * 0.35);
    }
    return {
      ridePenaltyMph,
      damagePercent,
      collisionViolationSeverity,
      policeCollisionOfficerId,
      policeCollisionSeverity,
    };
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
      if (first.isPursuing) continue;
      this.queryNearby(
        first.mesh.position.x,
        first.mesh.position.z,
        queryRadius,
        this.trafficCollisionQueryResults,
      );
      for (const second of this.trafficCollisionQueryResults) {
        const secondIndex = this.indexByCar.get(second) ?? -1;
        if (secondIndex <= firstIndex || !this.fullSimulationByCar[secondIndex] || second.isPursuing) continue;
        if (!willVehiclesConflict(first, second, horizon, GAME_CONFIG.traffic.predictiveSafetyClearance)) {
          continue;
        }
        const key = `s:${first.id}:${second.id}`;
        this.currentSafetyConflicts.add(key);
        let decision = this.safetyConflictDecisions.get(key);
        if (!decision) {
          decision = {
            allowCrash: shouldAllowIntentionalCrash(
              this.rng,
              GAME_CONFIG.traffic.intentionalCrashChanceDenominator,
            ),
            yielderId: chooseSafetyYielder(first, second).id,
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

  private resolveTrafficCollisions(): void {
    const boundingRadius = Math.hypot(
      GAME_CONFIG.traffic.hitboxWidth / 2,
      GAME_CONFIG.traffic.hitboxLength / 2,
    );
    const maximumCollisionDistance = boundingRadius * 2;
    let candidateCount = 0;
    for (let firstIndex = 0; firstIndex < this.cars.length; firstIndex++) {
      if (!this.fullSimulationByCar[firstIndex]) continue;
      const first = this.cars[firstIndex];
      this.queryNearby(
        first.mesh.position.x,
        first.mesh.position.z,
        maximumCollisionDistance,
        this.trafficCollisionQueryResults,
      );
      for (const second of this.trafficCollisionQueryResults) {
        const secondIndex = this.indexByCar.get(second) ?? -1;
        if (secondIndex <= firstIndex || !this.fullSimulationByCar[secondIndex]) continue;
        candidateCount += 1;
        const dx = first.mesh.position.x - second.mesh.position.x;
        const dz = first.mesh.position.z - second.mesh.position.z;
        if (dx * dx + dz * dz >= maximumCollisionDistance * maximumCollisionDistance) continue;
        const collision = findOrientedBoxCollision(
          {
            x: first.mesh.position.x,
            z: first.mesh.position.z,
            heading: first.mesh.rotation.y,
            halfWidth: GAME_CONFIG.traffic.hitboxWidth / 2,
            halfLength: GAME_CONFIG.traffic.hitboxLength / 2,
          },
          {
            x: second.mesh.position.x,
            z: second.mesh.position.z,
            heading: second.mesh.rotation.y,
            halfWidth: GAME_CONFIG.traffic.hitboxWidth / 2,
            halfLength: GAME_CONFIG.traffic.hitboxLength / 2,
          },
        );
        if (!collision) continue;

        const contactKey = `t:${first.id}:${second.id}`;
        this.currentContacts.add(contactKey);
        first.markCollisionContact(second.id);
        second.markCollisionContact(first.id);
        const relativeVelocityX = first.getVelocityX() - second.getVelocityX();
        const relativeVelocityZ = first.getVelocityZ() - second.getVelocityZ();
        const relativeSpeedMph = Math.hypot(relativeVelocityX, relativeVelocityZ)
          * GAME_CONFIG.ride.mphPerWorldUnitPerSecond;
        const closingSpeedMph = Math.max(
          0,
          -(relativeVelocityX * collision.normalX + relativeVelocityZ * collision.normalZ)
            * GAME_CONFIG.ride.mphPerWorldUnitPerSecond,
        );
        if (!this.previousContacts.has(contactKey)) {
          const directness = relativeSpeedMph > 0 ? closingSpeedMph / relativeSpeedMph : 0;
          const impactDamage = collisionDamagePercent(closingSpeedMph, directness);
          const serious = closingSpeedMph >= GAME_CONFIG.traffic.seriousCollisionSpeedMph;
          first.registerCollision(second.id, impactDamage, serious, false);
          second.registerCollision(first.id, impactDamage, serious, false);
        }
        first.push(collision.normalX * collision.depth * 0.5, collision.normalZ * collision.depth * 0.5);
        second.push(-collision.normalX * collision.depth * 0.5, -collision.normalZ * collision.depth * 0.5);
      }
    }
    this.lastCollisionCandidateCount += candidateCount;
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
      if (!car.isPursuing && distanceSquared > GAME_CONFIG.traffic.recycleRadius ** 2) {
        this.recycleCar(car, index, player);
        dx = car.mesh.position.x - player.root.position.x;
        dz = car.mesh.position.z - player.root.position.z;
        distanceSquared = dx * dx + dz * dz;
      }
      const enabled = distanceSquared <= reducedRadiusSquared;
      car.mesh.setEnabled(enabled);
      this.updateDeltaByCar[index] = 0;
      this.fullSimulationByCar[index] = false;
      if (!enabled) continue;
      this.activeCarCount += 1;
      if (distanceSquared <= fullRadiusSquared) {
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
