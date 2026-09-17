import { PackageOfferBoard } from "./PackageOfferBoard";
import type { TrainingReward, TrainingContext, TrainingRegion } from "../training/Training";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { GAME_CONFIG } from "../game/config";
import type { Clinic, DeliveryPoint } from "../game/types";
import type { PlayerCar } from "../player/PlayerCar";
import type { PlayerProfile } from "../player/PlayerProfile";
import { clamp, distanceXZ } from "../utils/math";

export enum PackageDeliveryState {
  Idle = "IDLE",
  DrivingToPickup = "DRIVING_TO_PICKUP",
  CarryingPackage = "PATIENT_ONBOARD",
}

export interface PackageDeliveryOffer {
  readonly training?: TrainingContext;
  id: string;
  pickupPoint: DeliveryPoint;
  destinationPoint: DeliveryPoint;
  pickupDistance: number;
  tripDistance: number;
  initialPayout: number;
}

export interface PackageDeliveryResult {
  initialPayout: number;
  payout: number;
  pickupDistance: number;
  tripDistance: number;
  durationSeconds: number;
}

export class PackageDeliveryManager {
  state = PackageDeliveryState.Idle;
  readonly offers: PackageOfferBoard;
  get offer(): PackageDeliveryOffer { return this.activeOffer ?? this.offers.getOffers(this.offers.regions[0]?.id)[0]; }
  activeOffer: PackageDeliveryOffer | null = null;
  elapsedSeconds = 0;
  lastResult: PackageDeliveryResult | null = null;
  lastTrainingReward: TrainingReward | null = null;
  resultTimeRemaining = 0;
  private marker: Mesh | null = null;
  private markerMaterial: StandardMaterial | null = null;

  constructor(
    private readonly scene: Scene,
    points: readonly DeliveryPoint[],
    private readonly player: PlayerCar,
    private readonly profile: PlayerProfile,
    regions: readonly TrainingRegion[] = [],
    clinics: readonly Clinic[] = [],
  ) {
    this.offers = new PackageOfferBoard(points, player, regions, clinics);
  }

  get isActive(): boolean {
    return this.activeOffer !== null;
  }

  get payoutMultiplier(): number {
    return clamp(1 - this.elapsedSeconds * GAME_CONFIG.ambulanceDriver.fareDecayPercentPerSecond, 0, 1);
  }

  get currentRatePerMeter(): number {
    return GAME_CONFIG.ambulanceDriver.ratePerMeter * this.payoutMultiplier;
  }

  get currentPayout(): number {
    return (this.activeOffer?.initialPayout ?? this.offer.initialPayout) * this.payoutMultiplier;
  }

  acceptOffer(id: string, regionId?: string): boolean {
    if (this.isActive) return false;
    const offer = this.offers.acceptOffer(id, regionId);
    if (!offer) return false;
    this.activeOffer = offer;
    this.state = PackageDeliveryState.DrivingToPickup;
    this.elapsedSeconds = 0;
    this.lastResult = null;
    this.lastTrainingReward = null;
    this.resultTimeRemaining = 0;
    this.showMarker(offer.pickupPoint.position, new Color3(1, 0.62, 0.12), "ambulance-pickup-marker");
    return true;
  }

  update(deltaTime: number): void {
    this.resultTimeRemaining = Math.max(0, this.resultTimeRemaining - deltaTime);
    if (!this.activeOffer) return;

    this.elapsedSeconds += deltaTime;
    if (this.state === PackageDeliveryState.DrivingToPickup
      && distanceXZ(this.player.root.position, this.activeOffer.pickupPoint.position) <= GAME_CONFIG.ambulanceDriver.pickupRadius
      && this.player.getSpeedMph() <= GAME_CONFIG.ride.maximumArrivalSpeedMph) {
      this.state = PackageDeliveryState.CarryingPackage;
      this.showMarker(this.activeOffer.destinationPoint.position, new Color3(0.72, 0.35, 1), "ambulance-dropoff-marker");
      return;
    }
    if (this.state === PackageDeliveryState.CarryingPackage
      && distanceXZ(this.player.root.position, this.activeOffer.destinationPoint.position) <= GAME_CONFIG.ambulanceDriver.dropoffRadius
      && this.player.getSpeedMph() <= GAME_CONFIG.ride.maximumArrivalSpeedMph) {
      this.completeDelivery();
    }
  }

  getObjectivePosition(): Vector3 | null {
    if (!this.activeOffer) return null;
    return this.state === PackageDeliveryState.DrivingToPickup
      ? this.activeOffer.pickupPoint.position
      : this.activeOffer.destinationPoint.position;
  }

  isWaitingForArrivalSpeed(): boolean {
    const target = this.getObjectivePosition();
    if (!target) return false;
    const radius = this.state === PackageDeliveryState.DrivingToPickup
      ? GAME_CONFIG.ambulanceDriver.pickupRadius : GAME_CONFIG.ambulanceDriver.dropoffRadius;
    return distanceXZ(this.player.root.position,target) <= radius
      && this.player.getSpeedMph() > GAME_CONFIG.ride.maximumArrivalSpeedMph;
  }

  endForArrest(): boolean {
    if (!this.activeOffer) return false;
    this.finishActivity();
    return true;
  }

  dispose(): void {
    this.marker?.dispose();
    this.markerMaterial?.dispose();
    this.marker = null;
    this.markerMaterial = null;
  }

  private completeDelivery(): void {
    if (!this.activeOffer) return;
    const payout = this.currentPayout;
    this.lastResult = {
      initialPayout: this.activeOffer.initialPayout,
      payout,
      pickupDistance: this.activeOffer.pickupDistance,
      tripDistance: this.activeOffer.tripDistance,
      durationSeconds: this.elapsedSeconds,
    };
    this.lastTrainingReward = this.profile.completeAmbulanceJob(payout, this.activeOffer.training);
    this.resultTimeRemaining = GAME_CONFIG.presentation.resultSeconds;
    this.finishActivity();
  }

  private finishActivity(): void {
    const regionId = this.activeOffer?.training?.regionId;
    this.marker?.setEnabled(false);
    this.activeOffer = null;
    this.state = PackageDeliveryState.Idle;
    this.elapsedSeconds = 0;
    this.offers.refill(regionId);
  }

  private showMarker(position: Vector3, color: Color3, name: string): void {
    if (!this.marker || !this.markerMaterial) {
      this.markerMaterial = new StandardMaterial("ambulance-marker-material", this.scene);
      this.markerMaterial.alpha = 0.62;
      const marker = MeshBuilder.CreateCylinder("ambulance-marker", {
        diameter: GAME_CONFIG.ambulanceDriver.pickupRadius * 2,
        height: 0.18,
        tessellation: 32,
      }, this.scene);
      const beam = MeshBuilder.CreateCylinder("ambulance-marker-beam", {
        diameter: 2.2,
        height: 24,
        tessellation: 16,
      }, this.scene);
      beam.parent = marker;
      beam.position.set(0, 12, 0);
      beam.material = this.markerMaterial;
      marker.material = this.markerMaterial;
      this.marker = marker;
    }
    this.marker.name = name;
    this.marker.position.set(position.x, 0.14, position.z);
    this.markerMaterial.diffuseColor.copyFrom(color);
    this.markerMaterial.emissiveColor.copyFrom(color).scaleInPlace(0.65);
    this.marker.setEnabled(true);
  }
}
