import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GAME_CONFIG } from "../game/config";
import type { BoxCollider, TrafficWaypoint } from "../game/types";
import { clamp, lerp, normalizeAngle } from "../utils/math";
import { resolveCircleBoxValues } from "../world/collisions";
import type { Input } from "./Input";
import type { WorldQuery } from "../world/WorldQuery";
import { STARTER_VEHICLE } from "../vehicles/VehicleCatalog";
import type { VehicleDefinition, VehicleStats } from "../vehicles/VehicleTypes";
import { createLowPolyVehicleMesh } from "../vehicles/VehicleMeshFactory";
import { createBlenderCabMesh } from "../vehicles/BlenderCabMesh";
import { createBlenderPoliceMeshes } from "../vehicles/BlenderChaseMeshes";
import { createBlenderAmbulanceMeshes } from "../vehicles/BlenderAmbulanceMesh";
import { hasEnhancedGraphics, usesBlenderCab } from "../graphics/GraphicsMode";

import { beginBodyStep, createVehicleBody, endBodyStep, setBodySize } from "../physics/VehicleBody";

export class PlayerCar {
  readonly root: Mesh;
  readonly collisionBody = createVehicleBody(-1);
  heading = 0;
  resetGeneration = 0;
  private velocityX = 0;
  private velocityZ = 0;
  private yawRate = 0;
  private collisionYawRate = 0;
  private collisionSlideRemaining = 0;
  private readonly collisionCandidates: BoxCollider[] = [];
  private readonly config = GAME_CONFIG.player;
  private vehicleDefinition: VehicleDefinition;
  private effectiveStats: VehicleStats;
  private vehicleMeshes: Mesh[] = [];
  private vehicleMaterials: StandardMaterial[] = [];
  private emergencyLights: Mesh[] = [];
  private emergencyElapsed = 0;
  private emergencyPhase = -1;

  constructor(
    private readonly scene: Scene,
    private readonly roadSpawnPoints: TrafficWaypoint[],
    vehicle: VehicleDefinition = STARTER_VEHICLE,
    effectiveStats: VehicleStats = vehicle.stats,
  ) {
    this.vehicleDefinition = vehicle;
    this.effectiveStats = { ...effectiveStats };
    this.root = new Mesh("player-car-root", scene);
    this.createMesh(vehicle);
    this.reset();
  }

  update(deltaTime: number, input: Input, worldQuery: WorldQuery, canAccelerate = true, damagePercent = 0, deferStaticCollisions = false): void {
    if (input.consumeReset()) {
      this.reset();
      return;
    }

    beginBodyStep(this.collisionBody, this.root.position.x, this.root.position.z, this.heading);
    input.updateDriving(deltaTime);
    const onSidewalk = worldQuery.isOnSidewalk(this.root.position.x, this.root.position.z);
    this.simulateHandling(deltaTime, input, onSidewalk, canAccelerate, damagePercent);
    this.updateEmergencyLights(deltaTime);

    this.root.position.x += this.velocityX * deltaTime;
    this.root.position.z += this.velocityZ * deltaTime;
    this.root.rotation.y = this.heading;

    if (!deferStaticCollisions) this.resolveStaticCollisions(worldQuery);
    this.syncCollisionBody(deltaTime);
  }

  reset(): void {
    this.resetGeneration += 1;
    const roadside = this.findNearestRoadsideSpawn();
    const nearest = roadside ? null : this.findNearestRoadPoint();
    this.root.position.copyFrom(roadside?.position ?? nearest!.position);
    this.root.position.y = 0.9;
    if (roadside) {
      this.heading = roadside.heading;
    } else {
      const maxRoadX = this.roadSpawnPoints.reduce((max, point) => Math.max(max, point.ix), 0);
      const driveEast = nearest!.ix < maxRoadX;
      this.heading = driveEast ? Math.PI / 2 : -Math.PI / 2;
      this.root.position.z += driveEast ? -GAME_CONFIG.traffic.laneOffset : GAME_CONFIG.traffic.laneOffset;
    }
    this.velocityX = 0;
    this.velocityZ = 0;
    this.yawRate = 0;
    this.collisionYawRate = 0;
    this.collisionSlideRemaining = 0;
    this.syncCollisionBody(0);
    this.root.rotation.set(0, this.heading, 0);
  }

  /** Reposition without retaining slide/impact motion; callers synchronize camera/interpolation. */
  teleportTo(x: number, z: number, heading: number): void {
    this.resetGeneration += 1;
    this.root.position.set(x, 0.9, z);
    this.heading = heading;
    this.velocityX = 0;
    this.velocityZ = 0;
    this.yawRate = 0;
    this.collisionYawRate = 0;
    this.collisionSlideRemaining = 0;
    this.syncCollisionBody(0);
    this.root.rotation.set(0, heading, 0);
  }

  getForwardToRef(result: Vector3): void {
    result.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  getTravelDirectionToRef(result: Vector3): void {
    const speed = Math.hypot(this.velocityX, this.velocityZ);
    if (speed < 0.5) {
      this.getForwardToRef(result);
      return;
    }
    result.set(this.velocityX / speed, 0, this.velocityZ / speed);
  }

  getSpeedMph(): number {
    return Math.hypot(this.velocityX, this.velocityZ) * GAME_CONFIG.ride.mphPerWorldUnitPerSecond;
  }

  getVelocityX(): number {
    return this.velocityX;
  }

  getVelocityZ(): number {
    return this.velocityZ;
  }

  getMaxForwardSpeed(): number {
    return this.effectiveStats.topSpeed;
  }

  get vehicleWidth(): number {
    return this.vehicleDefinition.appearance.bodyWidth;
  }

  get vehicleLength(): number {
    return this.vehicleDefinition.appearance.bodyLength;
  }

  get equippedVehicleId(): string {
    return this.vehicleDefinition.id;
  }

  get isPoliceCar(): boolean { return this.vehicleDefinition.appearance.role === "police"; }

  get isAmbulance(): boolean { return this.vehicleDefinition.appearance.role === "ambulance"; }

  get colliderRadius(): number {
    return this.config.radius * (this.vehicleWidth / this.config.width);
  }

  equipVehicle(vehicle: VehicleDefinition, effectiveStats: VehicleStats, preserveMotion = false): void {
    this.resetGeneration += 1;
    const vx = this.velocityX, vz = this.velocityZ;
    this.vehicleDefinition = vehicle;
    this.effectiveStats = { ...effectiveStats };
    this.velocityX = preserveMotion ? vx : 0;
    this.velocityZ = preserveMotion ? vz : 0;
    if (preserveMotion) {
      const speed = Math.hypot(this.velocityX,this.velocityZ);
      if (speed > effectiveStats.topSpeed) { this.velocityX *= effectiveStats.topSpeed/speed; this.velocityZ *= effectiveStats.topSpeed/speed; }
    }
    this.yawRate = 0;
    this.collisionYawRate = 0;
    this.collisionSlideRemaining = 0;
    this.syncCollisionBody(0);
    this.createMesh(vehicle);
  }

  applyEffectiveStats(effectiveStats: VehicleStats): void {
    this.effectiveStats = { ...effectiveStats };
  }

  syncCollisionBody(dt: number): void {
    setBodySize(this.collisionBody, this.vehicleWidth, this.vehicleLength);
    this.collisionBody.staticRadius = this.colliderRadius;
    this.collisionBody.dynamic = true;
    endBodyStep(this.collisionBody, this.root.position.x, this.root.position.z, this.heading,
      this.getVelocityX(), this.getVelocityZ(), this.yawRate + this.collisionYawRate, dt);
  }

  applyCollisionBody(): void {
    const body = this.collisionBody;
    if (!body.changed) return;
    this.root.position.x = body.x; this.root.position.z = body.z;
    this.heading = this.root.rotation.y = body.heading;
    this.velocityX = body.velocityX; this.velocityZ = body.velocityZ;
    this.collisionYawRate = body.angularVelocity - this.yawRate;
    if (body.impulse >= GAME_CONFIG.vehicleCollisions.slideImpactThreshold)
      this.collisionSlideRemaining = GAME_CONFIG.vehicleCollisions.gripRecoverySeconds;
  }

  private createMesh(vehicle: VehicleDefinition): void {
    for (const mesh of this.vehicleMeshes) mesh.dispose();
    for (const material of this.vehicleMaterials) material.dispose();
    this.vehicleMeshes = [];
    this.vehicleMaterials = [];
    this.emergencyLights = [];
    const appearance = vehicle.appearance;
    const material = new StandardMaterial(`player-vehicle-mat-${vehicle.id}`, this.scene);
    material.diffuseColor = Color3.White();
    material.specularColor = new Color3(0.16, 0.16, 0.16);
    const ambulance = appearance.role === "ambulance", police = appearance.role === "police";
    const lightMaterials = ambulance || police ? [-1, 1].map(side => {
      const lightMaterial = new StandardMaterial(`ambulance-light-${side}`, this.scene);
      lightMaterial.diffuseColor.set(1, 1, 1);
      lightMaterial.specularColor.set(.08, .08, .08);
      return lightMaterial;
    }) : [];
    const model = police ? createBlenderPoliceMeshes(this.scene, material, appearance, lightMaterials)
      : ambulance && hasEnhancedGraphics(this.scene)
      ? createBlenderAmbulanceMeshes(this.scene, material, appearance, lightMaterials) : null;
    const mesh = model?.body ?? (vehicle.id === STARTER_VEHICLE.id && usesBlenderCab(this.scene)
      ? createBlenderCabMesh(this.scene, `player-vehicle-${vehicle.id}`, material, appearance)
      : createLowPolyVehicleMesh(this.scene, `player-vehicle-${vehicle.id}`, material, {
        bodyColor: Color3.FromHexString(appearance.bodyColor),
        bodyLength: appearance.bodyLength, bodyWidth: appearance.bodyWidth,
        bodyHeight: appearance.bodyHeight, cabinLength: appearance.cabinLength,
        cabinWidth: appearance.cabinWidth, cabinHeight: appearance.cabinHeight, ambulance,
      }));
    mesh.parent = this.root;
    material.freeze();
    this.vehicleMaterials.push(material, ...lightMaterials);
    this.vehicleMeshes.push(mesh);
    if (ambulance || police) {
      this.emergencyLights = model?.lights ?? [-1, 1].map((side, index) => {
        const light = MeshBuilder.CreateBox(`ambulance-roof-light-${side}`,
          { width: 2.3, height: .32, depth: .75 }, this.scene);
        light.position.set(side * 1.3, appearance.bodyHeight * .55 + appearance.cabinHeight + .2, -.8);
        light.material = lightMaterials[index];
        lightMaterials[index].diffuseColor.set(...(index === 0 ? [1, .04, .04] : [.04, .22, 1]) as [number, number, number]);
        return light;
      });
      for (const light of this.emergencyLights) light.parent = this.root;
      this.vehicleMeshes.push(...this.emergencyLights);
      this.emergencyElapsed = 0;
      this.emergencyPhase = -1;
      this.updateEmergencyLights(0);
    }
  }

  private updateEmergencyLights(deltaTime: number): void {
    if (this.emergencyLights.length !== 2) return;
    this.emergencyElapsed += deltaTime;
    const active = Math.floor(this.emergencyElapsed / (this.isPoliceCar ? GAME_CONFIG.policeChase.lightFlashSeconds : GAME_CONFIG.ambulanceDriver.lightFlashSeconds)) % 2;
    if (active === this.emergencyPhase) return;
    this.emergencyPhase = active;
    // Keep the unlit lens physically present; only change emission twice per cycle.
    for (let i = 0; i < 2; i++) {
      const material = this.emergencyLights[i].material as StandardMaterial;
      if (i !== active) material.emissiveColor.set(0, 0, 0);
      else if (i === 0) material.emissiveColor.set(1, .04, .04);
      else material.emissiveColor.set(.04, .22, 1);
    }
  }

  private simulateHandling(deltaTime: number, input: Input, onSidewalk: boolean, canAccelerate: boolean, damagePercent: number): void {
    const forwardX = Math.sin(this.heading);
    const forwardZ = Math.cos(this.heading);
    const rightX = Math.cos(this.heading);
    const rightZ = -Math.sin(this.heading);
    let forwardSpeed = this.velocityX * forwardX + this.velocityZ * forwardZ;
    const previousForwardSpeed = forwardSpeed;
    let lateralSpeed = this.velocityX * rightX + this.velocityZ * rightZ;
    const damage = this.isPoliceCar ? 0 : clamp(damagePercent, 0, 1);
    const damageEffects = this.config.damageEffects;
    const accelerationRatio = this.effectiveStats.acceleration / this.config.acceleration;
    const turningRatio = this.effectiveStats.turning;
    const accelerationDamageMultiplier = damageStatMultiplier(damage, damageEffects.accelerationMultiplierAtMaxDamage);
    const topSpeedDamageMultiplier = damageStatMultiplier(damage, damageEffects.topSpeedMultiplierAtMaxDamage);
    const reverseDamageMultiplier = damageStatMultiplier(damage, damageEffects.reverseMultiplierAtMaxDamage);
    const brakingDamageMultiplier = damageStatMultiplier(damage, damageEffects.brakingMultiplierAtMaxDamage);
    const yawRateDamageMultiplier = damageStatMultiplier(damage, damageEffects.yawRateMultiplierAtMaxDamage);
    const steeringResponseDamageMultiplier = damageStatMultiplier(damage, damageEffects.steeringResponseMultiplierAtMaxDamage);
    const gripDamageMultiplier = damageStatMultiplier(damage, damageEffects.gripMultiplierAtMaxDamage);
    const yawRecoveryDamageMultiplier = damageStatMultiplier(damage, damageEffects.yawRecoveryMultiplierAtMaxDamage);
    const handlingMultiplier = onSidewalk ? this.config.sidewalkHandlingMultiplier : 1;
    const maxForwardSpeed = this.effectiveStats.topSpeed * handlingMultiplier * topSpeedDamageMultiplier;
    const maxReverseSpeed = this.config.maxReverseSpeed * handlingMultiplier * reverseDamageMultiplier;
    const throttle = canAccelerate ? input.throttle : 0;
    const brake = input.brake;

    if (brake > 0.01) {
      if (forwardSpeed > 0.5) {
        forwardSpeed = this.moveTowards(forwardSpeed, 0, this.effectiveStats.braking * brakingDamageMultiplier * brake * deltaTime);
      } else if (forwardSpeed > -maxReverseSpeed) {
        forwardSpeed -= this.config.reverseAcceleration * handlingMultiplier * reverseDamageMultiplier * brake * deltaTime;
      }
    } else if (throttle > 0.01) {
      if (forwardSpeed < -0.5) {
        forwardSpeed = this.moveTowards(forwardSpeed, 0, this.effectiveStats.braking * brakingDamageMultiplier * throttle * deltaTime);
      } else if (forwardSpeed < maxForwardSpeed) {
        const speedRatio = clamp(Math.max(0, forwardSpeed) / maxForwardSpeed, 0, 1);
        const acceleration = lerp(
          this.effectiveStats.acceleration,
          this.config.highSpeedAcceleration * accelerationRatio,
          Math.pow(speedRatio, this.config.accelerationFalloffPower),
        );
        forwardSpeed += acceleration * handlingMultiplier * accelerationDamageMultiplier * throttle * deltaTime;
      }
    }

    const drag = this.config.rollingResistance
      + this.config.aerodynamicDrag * forwardSpeed * forwardSpeed
      + damageEffects.extraDragAtMaxDamage * damage;
    forwardSpeed = this.moveTowards(forwardSpeed, 0, drag * deltaTime);
    if (onSidewalk && Math.abs(forwardSpeed) > maxForwardSpeed) {
      forwardSpeed = this.moveTowards(forwardSpeed, 0, this.config.sidewalkExtraDrag * deltaTime);
    }
    // An impact may carry a car faster than its engine (or reverse gear) can drive it.
    // Preserve that momentum while drag/brakes dissipate it; the engine cannot add more.
    forwardSpeed = clamp(forwardSpeed, Math.min(-maxReverseSpeed, previousForwardSpeed),
      Math.max(maxForwardSpeed, previousForwardSpeed));

    const baseSpeedRatio = clamp(Math.abs(forwardSpeed) / this.effectiveStats.topSpeed, 0, 1);
    const steeringActivation = clamp(
      (Math.abs(forwardSpeed) - this.config.minimumSteeringSpeed)
        / (this.config.fullSteeringSpeed - this.config.minimumSteeringSpeed),
      0,
      1,
    );
    const steeringDirection = forwardSpeed >= 0 ? 1 : -1;
    const availableYawRate = lerp(this.config.lowSpeedYawRate, this.config.highSpeedYawRate, baseSpeedRatio)
      * turningRatio
      * yawRateDamageMultiplier;
    const desiredYawRate = input.steering
      * steeringDirection
      * availableYawRate
      * steeringActivation
      * handlingMultiplier;

    const surfaceGrip = (onSidewalk ? this.config.sidewalkGripMultiplier : 1) * gripDamageMultiplier;
    const tractionCapacity = this.config.maxLateralAcceleration
      * turningRatio
      * surfaceGrip
      * (1 - brake * this.config.brakeGripLoss);
    const lateralDemand = Math.abs(forwardSpeed * desiredYawRate);
    const demandSlip = clamp((lateralDemand / Math.max(1, tractionCapacity) - 1) / 0.55, 0, 1);
    const groundSpeed = Math.hypot(forwardSpeed, lateralSpeed);
    const existingSlip = clamp((Math.abs(lateralSpeed) / Math.max(groundSpeed, 4) - 0.12) / 0.36, 0, 1);
    const slip = Math.max(demandSlip, existingSlip * 0.75);
    const counterSteering = input.steering * this.yawRate < -0.02;
    const steeringResponse = this.config.steeringResponse
      * (counterSteering ? this.config.counterSteerResponseMultiplier : 1)
      * turningRatio
      * steeringResponseDamageMultiplier
      * (1 - slip * 0.62);
    const yawBlend = 1 - Math.exp(-steeringResponse * deltaTime);
    this.yawRate += (desiredYawRate - this.yawRate) * yawBlend;

    if (slip > 0 && Math.abs(input.steering) > 0.05 && !counterSteering) {
      this.yawRate += Math.sign(desiredYawRate)
        * this.config.spinOutTorque
        * slip
        * baseSpeedRatio
        * deltaTime;
    }
    if (brake > 0 && Math.abs(this.yawRate) > 0.03) {
      this.yawRate += this.yawRate
        * this.config.brakeOversteer
        * brake
        * baseSpeedRatio
        * (0.2 + slip)
        * deltaTime;
    }
    if (Math.abs(input.steering) < 0.05) {
      this.yawRate *= Math.exp(-this.config.yawRecovery * yawRecoveryDamageMultiplier * deltaTime);
    }
    const maxYawRate = this.config.maxYawRate * turningRatio;
    this.yawRate = clamp(this.yawRate, -maxYawRate, maxYawRate);

    this.collisionSlideRemaining = Math.max(0, this.collisionSlideRemaining - deltaTime);
    const collisionSlip = this.collisionSlideRemaining / Math.max(1e-6, GAME_CONFIG.vehicleCollisions.gripRecoverySeconds);
    const handlingGrip = lerp(this.config.lateralGrip, this.config.slidingGrip, slip);
    const impactGrip = lerp(this.config.lateralGrip, GAME_CONFIG.vehicleCollisions.impactGrip, collisionSlip);
    const lateralGrip = Math.min(handlingGrip, impactGrip) * surfaceGrip;
    const collisionCounterSteer = input.steering * this.collisionYawRate < -0.02;
    this.collisionYawRate *= Math.exp(-(GAME_CONFIG.vehicleCollisions.angularDamping
      + (collisionCounterSteer ? GAME_CONFIG.vehicleCollisions.counterSteerDamping : 0)) * deltaTime);
    lateralSpeed *= Math.exp(-lateralGrip * deltaTime);

    this.velocityX = forwardX * forwardSpeed + rightX * lateralSpeed;
    this.velocityZ = forwardZ * forwardSpeed + rightZ * lateralSpeed;
    this.heading = normalizeAngle(this.heading + (this.yawRate + this.collisionYawRate) * deltaTime);

    if (groundSpeed < 0.08 && throttle < 0.01 && brake < 0.01) {
      this.velocityX = 0;
      this.velocityZ = 0;
      this.yawRate = 0;
    }
  }

  private resolveStaticCollisions(worldQuery: WorldQuery): void {
    const radius = this.colliderRadius;
    worldQuery.getNearbyColliders(this.root.position.x, this.root.position.z, radius, this.collisionCandidates);
    for (const collider of this.collisionCandidates) {
      const hit = resolveCircleBoxValues(this.root.position.x, this.root.position.z, radius, collider);
      if (!hit) {
        continue;
      }
      this.root.position.x += hit.x * hit.depth;
      this.root.position.z += hit.z * hit.depth;
      this.applyCollisionResponse(hit.x, hit.z);
    }
  }

  private findNearestRoadPoint(): TrafficWaypoint {
    let nearest = this.roadSpawnPoints[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const point of this.roadSpawnPoints) {
      const dx = point.position.x - this.root.position.x;
      const dz = point.position.z - this.root.position.z;
      const distance = dx * dx + dz * dz;
      if (distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private findNearestRoadsideSpawn(): { position: Vector3; heading: number } | null {
    const maxIx = this.roadSpawnPoints.reduce((max, point) => Math.max(max, point.ix), 0);
    const maxIz = this.roadSpawnPoints.reduce((max, point) => Math.max(max, point.iz), 0);
    if (maxIx < 3 || maxIz < 2) return null;
    const points = new Map(this.roadSpawnPoints.map(point => [`${point.ix}:${point.iz}`, point]));
    const curbOffset = GAME_CONFIG.world.roadWidth / 2 - this.colliderRadius - this.config.parkedCurbClearance;
    let best: { position: Vector3; heading: number } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    // Use interior east-west streets and the midpoint between intersections. The
    // negative-Z curb is the right side of the road for an east-facing car.
    for (let iz = 1; iz < maxIz; iz++) for (let ix = 1; ix < maxIx - 1; ix++) {
      const left = points.get(`${ix}:${iz}`), right = points.get(`${ix + 1}:${iz}`);
      if (!left || !right) continue;
      const position = new Vector3((left.position.x + right.position.x) / 2, 0,
        left.position.z - curbOffset);
      const distance = Vector3.DistanceSquared(position, this.root.position);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = { position, heading: Math.PI / 2 };
    }
    return best;
  }

  private applyCollisionResponse(normalX: number, normalZ: number): void {
    const velocityIntoSurface = this.velocityX * normalX + this.velocityZ * normalZ;
    if (velocityIntoSurface < 0) {
      const restitution = 0.08;
      this.velocityX -= normalX * velocityIntoSurface * (1 + restitution);
      this.velocityZ -= normalZ * velocityIntoSurface * (1 + restitution);
    }
    // Preserve motion along a wall; contact friction belongs to the shared vehicle solver.
  }

  private moveTowards(current: number, target: number, maxDelta: number): number {
    if (Math.abs(target - current) <= maxDelta) {
      return target;
    }
    return current + Math.sign(target - current) * maxDelta;
  }
}

export function damageStatMultiplier(damagePercent: number, multiplierAtMaxDamage: number): number {
  return lerp(1, multiplierAtMaxDamage, clamp(damagePercent, 0, 1));
}
