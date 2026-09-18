import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Frustum } from "@babylonjs/core/Maths/math.frustum";
import type { Scene } from "@babylonjs/core/scene";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { GAME_CONFIG } from "../game/config";
import { createPatientOffer, eligiblePatientClinics } from "../delivery/PatientOffer";
import type { PackageDeliveryOffer } from "../delivery/PackageDeliveryManager";
import type { RideOffer, RideTier } from "../game/types";
import { getMissionLicense } from "../missions/MissionLicenseCatalog";
import { createRideOffer } from "../ride/RideFactory";
import type { PlayerCar } from "../player/PlayerCar";
import type { Town } from "../world/Town";
import type { WorldQuery } from "../world/WorldQuery";
import { randomSeed, seededRandom } from "../utils/math";
import { PassengerMeshes } from "./PassengerMesh";
import { isBesidePassenger, passengerLocations, type PassengerLocation } from "./PassengerLocations";

interface WaitingPerson {
  readonly location: PassengerLocation;
  readonly mesh: InstancedMesh;
}
export interface WaitingPassenger extends WaitingPerson { readonly kind: "taxi"; readonly offer: RideOffer }
export interface WaitingPatient extends WaitingPerson { readonly kind: "patient"; readonly offer: PackageDeliveryOffer }
export type WaitingEncounter = WaitingPassenger | WaitingPatient;
export type CurbsideCue = "taxi" | "patient" | "license" | "pursuit" | null;

export class PassengerManager {
  readonly waiting: WaitingEncounter[] = [];
  readonly locations: readonly PassengerLocation[];
  readonly targetCount: number;
  readonly taxiTargetCount: number;
  readonly patientTargetCount: number;
  readonly patientLocations: readonly PassengerLocation[];
  nearbyCue: CurbsideCue = null;
  nearbyPassenger = false;
  private readonly meshes: PassengerMeshes | null;
  private readonly patientMeshes: PassengerMeshes | null;
  private readonly rng: () => number;
  private readonly replacements: {kind: WaitingEncounter["kind"]; at: number}[] = [];
  private clock = 0;
  private nextSpawnCheck = 0;
  private nextId = 1;
  private candidate: WaitingEncounter | null = null;
  private stoppedSeconds = 0;

  constructor(private readonly scene: Scene, private readonly town: Town, world: WorldQuery,
    player: PlayerCar, firstRide: boolean, seed = randomSeed()) {
    this.rng = seededRandom(seed);
    this.locations = passengerLocations(town, world, this.rng);
    const blocks = new Set(this.locations.map(p => p.blockId));
    this.patientLocations = GAME_CONFIG.gameplay.ambulanceJobsEnabled
      ? passengerLocations(town,world,this.rng,"patient").filter(p => eligiblePatientClinics(p.pickupPoint,town.clinics).length > 0) : [];
    const count = (density: number, locations: readonly PassengerLocation[]) => Number.isFinite(density)
      ? Math.min(locations.length, Math.max(0, Math.round(blocks.size * density))) : 0;
    this.taxiTargetCount = count(GAME_CONFIG.passengers.averagePedestriansPerBlock,this.locations);
    this.patientTargetCount = count(GAME_CONFIG.ambulanceDriver.averagePatientsPerBlock,this.patientLocations);
    this.targetCount = this.taxiTargetCount + this.patientTargetCount;
    this.meshes = this.taxiTargetCount > 0 ? new PassengerMeshes(scene) : null;
    this.patientMeshes = this.patientTargetCount > 0 ? new PassengerMeshes(scene,"patient") : null;
    if (firstRide && this.taxiTargetCount > 0) {
      const pose = player.root.position;
      const d = GAME_CONFIG.passengers.firstPassengerDistanceMeters / GAME_CONFIG.ride.metersPerWorldUnit;
      const target = new Vector3(pose.x + Math.sin(player.heading) * d, pose.y, pose.z + Math.cos(player.heading) * d);
      const ahead = this.locations.filter(p => isBesidePassenger(p, pose)
        && (p.position.x-pose.x)*Math.sin(player.heading)+(p.position.z-pose.z)*Math.cos(player.heading) > 15);
      ahead.sort((a,b) => Vector3.DistanceSquared(a.position,target)-Vector3.DistanceSquared(b.position,target));
      if (ahead[0]) this.spawn(ahead[0],"taxi");
    }
    for (const kind of ["taxi","patient"] as const) {
      const count = kind === "taxi" ? this.taxiTargetCount : this.patientTargetCount;
      for (let i = this.waiting.filter(p=>p.kind===kind).length; i < count; i++) {
        const location = this.chooseLocation(player,false,kind);
        if (location) this.spawn(location,kind); else this.replacements.push({kind,at:0});
      }
    }
  }

  resetPickup(): void { this.candidate = null; this.stoppedSeconds = 0; this.nearbyPassenger = false; this.nearbyCue = null; }

  update(delta: number, player: PlayerCar, canPickUp: boolean, board: (encounter: WaitingEncounter) => boolean, licensed = true, pursuit = false): void {
    this.clock += delta;
    if (this.clock >= this.nextSpawnCheck && this.replacements.length) {
      this.nextSpawnCheck = this.clock + 1;
      // Try each ready kind so an unavailable patient destination cannot starve taxi respawns.
      for (let i=0;i<this.replacements.length;i++) {
        const pending = this.replacements[i];
        if (pending.at > this.clock) continue;
        const location = this.chooseLocation(player,true,pending.kind);
        if (location) { this.spawn(location,pending.kind); this.replacements.splice(i,1); break; }
      }
    }

    if (!canPickUp) { this.resetPickup(); return; }
    let nearest: WaitingEncounter | null = null;
    let distance = (GAME_CONFIG.passengers.pickupRadiusMeters / GAME_CONFIG.ride.metersPerWorldUnit) ** 2;
    for (const passenger of this.waiting) {
      const p = passenger.location.position, car = player.root.position;
      const squared = (p.x-car.x)**2 + (p.z-car.z)**2;
      if (squared <= distance && isBesidePassenger(passenger.location, car)) { nearest = passenger; distance = squared; }
    }
    this.nearbyPassenger = nearest !== null;
    const stopped = player.getSpeedMph() < GAME_CONFIG.passengers.maximumPickupSpeedMph;
    this.nearbyCue = nearest?.kind ?? null;
    if (nearest?.kind === "patient" && (!licensed || pursuit)) {
      this.candidate = null; this.stoppedSeconds = 0;
      this.nearbyCue = stopped ? (!licensed ? "license" : "pursuit") : null;
      return;
    }
    if (nearest !== this.candidate || player.getSpeedMph() >= GAME_CONFIG.passengers.maximumPickupSpeedMph) this.stoppedSeconds = 0;
    this.candidate = nearest;
    if (!nearest || player.getSpeedMph() >= GAME_CONFIG.passengers.maximumPickupSpeedMph) return;
    this.stoppedSeconds += delta;
    if (this.stoppedSeconds < GAME_CONFIG.passengers.pickupStopSeconds) return;
    if (board(nearest)) {
      nearest.mesh.dispose(); this.waiting.splice(this.waiting.indexOf(nearest),1);
      this.replacements.push({kind:nearest.kind,at:this.clock + GAME_CONFIG.passengers.respawnDelaySeconds});
    }
    this.resetPickup();
  }

  private spawn(location: PassengerLocation, kind: WaitingEncounter["kind"]): void {
    if (kind === "patient") {
      const id = `curbside-patient-${this.nextId++}`;
      const offer = createPatientOffer(location.pickupPoint,this.town.clinics,this.rng,id);
      if (!offer) return;
      const {x,y,z} = location.position;
      this.waiting.push({kind,location,offer,mesh:this.patientMeshes!.create(id,Math.floor(this.rng()*4),x,y,z,location.heading)});
      return;
    }
    const id = `curbside-${this.nextId++}`;
    const tier = (["SHORT","MEDIUM","LONG"] as RideTier[])[Math.floor(this.rng()*3)];
    const offer = createRideOffer(this.town.deliveryPoints, location.pickupPoint, tier,
      getMissionLicense("taxi")!, this.rng, id);
    const {x,y,z} = location.position;
    this.waiting.push({ kind, location, offer: {...offer, curbside:true},
      mesh:this.meshes!.create(id, Math.floor(this.rng()*4),x,y,z,location.heading) });
  }

  private chooseLocation(player: PlayerCar, replacing: boolean, kind: WaitingEncounter["kind"]): PassengerLocation | null {
    if (replacing && this.scene.activeCamera) {
      this.scene.activeCamera.getViewMatrix();
      this.scene.activeCamera.getProjectionMatrix();
    }
    const planes = replacing && this.scene.activeCamera
      ? Frustum.GetPlanes(this.scene.activeCamera.getTransformationMatrix()) : null;
    const counts = new Map<string, number>();
    for (const p of this.waiting) counts.set(p.location.blockId, (counts.get(p.location.blockId) ?? 0)+1);
    const minDistance = GAME_CONFIG.passengers.minimumRespawnDistanceMeters / GAME_CONFIG.ride.metersPerWorldUnit;
    const spacing = GAME_CONFIG.passengers.minimumSpacingMeters / GAME_CONFIG.ride.metersPerWorldUnit;
    const candidates = new Map<string, PassengerLocation[]>();
    for (const location of kind === "taxi" ? this.locations : this.patientLocations) {
      if (this.waiting.some(p => Vector3.DistanceSquared(location.position,p.location.position) < spacing**2)) continue;
      if (replacing && (Vector3.DistanceSquared(location.position,player.root.position) < minDistance**2
        || !planes || planes.every(plane => plane.dotCoordinate(location.position) >= -5))) continue;
      const list = candidates.get(location.blockId) ?? []; list.push(location); candidates.set(location.blockId,list);
    }
    const least = Math.min(...[...candidates.keys()].map(id => counts.get(id) ?? 0));
    const blocks = [...candidates.keys()].filter(id => (counts.get(id) ?? 0) === least);
    const points = candidates.get(blocks[Math.floor(this.rng()*blocks.length)]);
    return points?.[Math.floor(this.rng()*points.length)] ?? null;
  }

  dispose(): void {
    for (const p of this.waiting) p.mesh.dispose();
    this.waiting.length = 0; this.meshes?.dispose(); this.patientMeshes?.dispose();
  }
}
