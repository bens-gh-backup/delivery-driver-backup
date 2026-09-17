import type { TrainingReward } from "../training/Training";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GAME_CONFIG } from "../game/config";
import { PassengerType, RideState, type RideOffer, type RideResult } from "../game/types";
import type { PoliceRideEvent } from "../police/PoliceManager";
import { clamp, distanceXZ } from "../utils/math";
import type { PlayerCar } from "../player/PlayerCar";
import type { PlayerProfile } from "../player/PlayerProfile";
import { getMissionLicense, type MissionLicenseId } from "../missions/MissionLicenseCatalog";
import type { RideOfferBoard } from "./RideOfferBoard";

interface PassengerRules {
  collisionPenalty: number;
  speedPenaltyPerSecond: number;
  maxSafeSpeedMph?: number;
  minRequiredSpeedMph?: number;
  gracePeriodSeconds?: number;
}

export class RideManager {
  state = RideState.Idle;
  activeRide: RideOffer | null = null;
  satisfaction: number = GAME_CONFIG.ride.satisfaction.startingScore;
  lastResult: RideResult | null = null;
  lastTrainingReward: TrainingReward | null = null;
  resultTimeRemaining = 0;
  collisionFlashText = "";
  collisionFlashSeconds = 0;
  private passengerElapsed = 0;
  bonusTip = 0;
  traitTipDeduction = 0;
  fareWaived = false;
  private tipForfeited = false;
  private pursuitActive = false;
  private stationRewardEarned = false;
  private observationSeen = false;
  private forbiddenTurnSeen = false;
  private escapeRewardEarned = false;
  private fuelPercent = 1;
  private damagePercent = 0;

  private tipTimeMultiplier = 1;
  private violationBaselinePoints = 0;
  private rideViolationPoints = 0;
  private collisionCooldown = 0;
  private collisionCount = 0;
  private marker: Mesh | null = null;
  private markerMaterial: StandardMaterial | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly offerBoard: RideOfferBoard,
    private readonly profile: PlayerProfile,
  ) {}

  get isActive(): boolean {
    return this.activeRide !== null;
  }

  get completedRides(): number {
    return this.profile.completedRides;
  }

  get totalMoney(): number {
    return this.profile.money;
  }

  acceptRide(categoryId: MissionLicenseId, id: string, regionId?: string): boolean {
    if (this.state !== RideState.Idle) {
      return false;
    }
    const offer = this.offerBoard.acceptOffer(categoryId, id, regionId);
    if (!offer) {
      return false;
    }
    this.activeRide = offer;
    this.state = RideState.DrivingToPickup;
    this.showMarker(offer.pickupPoint.position, new Color3(1, 0.78, 0.1), "ride-pickup-marker");
    return true;
  }

  update(deltaTime: number, player: PlayerCar, active: boolean, totalViolationPoints = 0): void {
    this.resultTimeRemaining = Math.max(0, this.resultTimeRemaining - deltaTime);
    this.collisionFlashSeconds = Math.max(0, this.collisionFlashSeconds - deltaTime);
    if (this.collisionFlashSeconds <= 0) {
      this.collisionFlashText = "";
    }

    if (!active || !this.activeRide) {
      return;
    }

    if (this.state === RideState.DrivingToPickup) {
      if (this.canCompleteArrival(player, this.activeRide.pickupPoint.position, GAME_CONFIG.ride.pickupRadius)) {
        this.pickUpPassenger(totalViolationPoints);
      }
      return;
    }

    if (this.state === RideState.PassengerOnboard) {
      this.rideViolationPoints = Math.max(0, totalViolationPoints - this.violationBaselinePoints);
      this.passengerElapsed += deltaTime;
      this.tipTimeMultiplier = clamp(
        this.tipTimeMultiplier - GAME_CONFIG.ride.fare.tipDecayPercentPerSecond
          * (this.pursuitActive ? GAME_CONFIG.ride.fare.pursuitTipDecayMultiplier : 1)
          * deltaTime,
        0,
        1,
      );
      this.collisionCooldown = Math.max(0, this.collisionCooldown - deltaTime);
      this.applySpeedRule(deltaTime, player.getSpeedMph());
      if (this.canCompleteArrival(player, this.activeRide.destinationPoint.position, GAME_CONFIG.ride.destinationRadius)) {
        this.completeRide();
      }
    }
  }

  registerTrafficCollision(speedMph: number): void {
    if (this.state !== RideState.PassengerOnboard || !this.activeRide || this.collisionCooldown > 0) {
      return;
    }
    if (speedMph < GAME_CONFIG.ride.satisfaction.collisionSpeedThresholdMph) {
      return;
    }
    const penalty = this.rulesFor(this.activeRide.passengerType).collisionPenalty * this.satisfactionPenaltyMultiplier;
    this.satisfaction = clamp(this.satisfaction - penalty, 0, 100);
    this.collisionCount += 1;
    this.collisionCooldown = GAME_CONFIG.ride.satisfaction.collisionCooldownSeconds;
    this.collisionFlashText = `COLLISION -${penalty}`;
    this.collisionFlashSeconds = 1.2;
  }

  getObjectivePosition(): Vector3 | null {
    if (!this.activeRide) {
      return null;
    }
    if (this.state === RideState.DrivingToPickup) {
      return this.activeRide.pickupPoint.position;
    }
    if (this.state === RideState.PassengerOnboard) {
      return this.activeRide.destinationPoint.position;
    }
    return null;
  }

  getCurrentTip(): number {
    if (!this.activeRide) {
      return 0;
    }
    return this.getTipBeforeBonus() + this.bonusTip;
  }

  /** Percentage of the passenger's original tip currently lost to all penalties. */
  get tipReductionPercent(): number {
    const originalTip = this.startingTip;
    if (originalTip <= 0) return 0;
    return clamp((originalTip - this.getTipBeforeBonus()) / originalTip * 100, 0, 100);
  }

  private getTipBeforeBonus(): number {
    if (!this.activeRide || this.fareWaived || this.tipForfeited || this.isInstructor) return 0;
    const ordinaryTip = this.calculateTip(
      this.activeRide.baseFare, this.satisfaction, this.tipTimeMultiplier, this.getViolationTipMultiplier(),
    );
    return Math.max(0, ordinaryTip - this.traitTipDeduction);
  }

  get effectiveBaseFare(): number {
    return this.fareWaived || this.isInstructor ? 0 : this.activeRide?.baseFare ?? 0;
  }

  hasOnboardTrait(type: PassengerType): boolean {
    return this.state === RideState.PassengerOnboard && this.activeRide?.passengerType === type;
  }

  registerDrivingEvent(event: "redLight" | "yellowIntersection" | "opposingLane"): void {
    const rules = GAME_CONFIG.ride.archetypes;
    if (event === "redLight" && this.hasOnboardTrait(PassengerType.Lawful)) {
      this.traitTipDeduction += this.startingTip * rules.redLightDeduction;
      this.flash("RED LIGHT · TIP REDUCED");
    } else if (event === "opposingLane" && this.hasOnboardTrait(PassengerType.Careful)) {
      this.traitTipDeduction += this.startingTip * rules.opposingLaneDeduction;
      this.flash("OPPOSING LANE / U-TURN · TIP REDUCED");
    } else if (event === "yellowIntersection" && this.hasOnboardTrait(PassengerType.ThrillSeeker)) {
      this.bonusTip += rules.yellowBonus;
      this.flash(`YELLOW LIGHT · +$${rules.yellowBonus}`);
    }
  }

  registerPursuit(active: boolean): void {
    this.pursuitActive = active;
    if (active && this.hasOnboardTrait(PassengerType.Shady) && !this.tipForfeited) {
      this.observationSeen = true;
      this.tipForfeited = true;
      this.flash("POLICE PURSUIT · TIP LOST");
    }
  }

  get isInstructor(): boolean { return this.activeRide?.passengerType === PassengerType.DrivingInstructor; }

  registerPoliceEvent(event: PoliceRideEvent): void {
    if (event === "violationObserved" && this.hasOnboardTrait(PassengerType.Shady) && !this.observationSeen) {
      this.observationSeen = true;
      this.flash("POLICE OBSERVATION · $40 BONUS LOST");
    }
    if (event === "pursuitEscaped" && this.hasOnboardTrait(PassengerType.Psychopath) && !this.escapeRewardEarned) {
      this.escapeRewardEarned = true;
      this.bonusTip += GAME_CONFIG.ride.archetypes.escapeBonus;
      this.flash(`PURSUIT ESCAPED · +$${GAME_CONFIG.ride.archetypes.escapeBonus}`);
    }
  }

  registerForbiddenTurn(): void {
    if (this.hasOnboardTrait(PassengerType.Compulsive) && !this.forbiddenTurnSeen) {
      this.forbiddenTurnSeen = true;
      this.flash(`LEFT TURN / U-TURN · $${GAME_CONFIG.ride.archetypes.compulsiveBonus} BONUS LOST`);
    }
  }

  /** Called after fuel consumption/refueling and collision damage/repairs, before arrival. */
  registerVehicleCondition(fuelPercent: number, damagePercent: number): void {
    this.fuelPercent = fuelPercent;
    this.damagePercent = damagePercent;
  }

  get pendingBonus(): { amount: number; eligible: boolean; condition: string } | null {
    const rules = GAME_CONFIG.ride.archetypes;
    if (this.hasOnboardTrait(PassengerType.Shady)) return {
      amount:rules.shadyBonus, eligible:!this.observationSeen, condition:"NO POLICE OBSERVATIONS",
    };
    if (this.hasOnboardTrait(PassengerType.Compulsive)) return {
      amount:rules.compulsiveBonus, eligible:!this.forbiddenTurnSeen, condition:"NO LEFT TURNS / U-TURNS",
    };
    if (this.hasOnboardTrait(PassengerType.RunningOnFumes)) return {
      amount:rules.lowFuelBonus, eligible:this.fuelPercent < rules.lowFuelThreshold, condition:"FUEL BELOW 50%",
    };
    if (this.hasOnboardTrait(PassengerType.DemolitionDerbyFan)) return {
      amount:rules.damageBonus, eligible:this.damagePercent > rules.damageThreshold, condition:"DAMAGE ABOVE 30%",
    };
    return null;
  }

  registerStationStop(stoppedAtStation: boolean): void {
    if (stoppedAtStation && this.hasOnboardTrait(PassengerType.OffGrid) && !this.stationRewardEarned) {
      this.stationRewardEarned = true;
      this.bonusTip += GAME_CONFIG.ride.archetypes.stationBonus;
      this.flash(`GAS STATION STOP · +$${GAME_CONFIG.ride.archetypes.stationBonus}`);
    }
  }

  registerMechanicRepair(repairedAmount: number): void {
    if (repairedAmount > 0 && this.hasOnboardTrait(PassengerType.Mechanic) && !this.fareWaived) {
      this.fareWaived = true;
      this.flash("FREE REPAIR · FARE AND TIP WAIVED");
    }
  }

  private flash(text: string): void {
    this.collisionFlashText = text;
    this.collisionFlashSeconds = 2;
  }

  private get startingTip(): number {
    return (this.isInstructor ? 0 : this.activeRide?.baseFare ?? 0) * this.getMaxTipPercent() * this.baseTipMultiplier;
  }

  private get baseTipMultiplier(): number {
    if (this.activeRide?.passengerType === PassengerType.Millionaire) return GAME_CONFIG.ride.archetypes.millionaireTipMultiplier;
    if (this.activeRide?.passengerType === PassengerType.ServiceWorker) return GAME_CONFIG.ride.archetypes.serviceWorkerTipMultiplier;
    return 1;
  }

  private get satisfactionPenaltyMultiplier(): number {
    if (this.activeRide?.passengerType === PassengerType.Millionaire) return GAME_CONFIG.ride.archetypes.millionairePenaltyMultiplier;
    if (this.activeRide?.passengerType === PassengerType.ServiceWorker) return GAME_CONFIG.ride.archetypes.serviceWorkerPenaltyMultiplier;
    return 1;
  }

  get currentViolationPoints(): number {
    return this.rideViolationPoints;
  }

  get violationTipPenaltyPercent(): number {
    return (1 - this.getViolationTipMultiplier()) * 100;
  }

  getStars(): number {
    return RideManager.satisfactionToStars(this.satisfaction);
  }

  isSpeedWarning(speedMph: number): boolean {
    if (this.state !== RideState.PassengerOnboard || !this.activeRide) {
      return false;
    }
    const rules = this.rulesFor(this.activeRide.passengerType);
    if (rules.maxSafeSpeedMph !== undefined) {
      return speedMph > rules.maxSafeSpeedMph;
    }
    if (rules.minRequiredSpeedMph !== undefined) {
      const grace = rules.gracePeriodSeconds ?? 0;
      return this.passengerElapsed > grace && speedMph < rules.minRequiredSpeedMph;
    }
    return false;
  }

  getSpeedWarningLabel(speedMph: number): string {
    if (!this.isSpeedWarning(speedMph) || !this.activeRide) {
      return `${Math.round(speedMph)} MPH`;
    }
    if ((this.activeRide.passengerType === PassengerType.SpeedDemon || this.activeRide.passengerType === PassengerType.Hurried)) {
      return `${Math.round(speedMph)} MPH - TOO SLOW`;
    }
    return `${Math.round(speedMph)} MPH - TOO FAST`;
  }

  isWaitingForArrivalSpeed(player: PlayerCar): boolean {
    const target = this.getObjectivePosition();
    if (!target || !this.activeRide) {
      return false;
    }
    const radius = this.state === RideState.DrivingToPickup
      ? GAME_CONFIG.ride.pickupRadius
      : GAME_CONFIG.ride.destinationRadius;
    return distanceXZ(player.root.position, target) <= radius
      && player.getSpeedMph() >= GAME_CONFIG.ride.maximumArrivalSpeedMph;
  }

  dispose(): void {
    this.marker?.dispose();
    this.markerMaterial?.dispose();
    this.marker = null;
    this.markerMaterial = null;
  }

  static satisfactionToStars(score: number): number {
    if (score <= 0) {
      return 0;
    }
    return Math.ceil(score / 20);
  }

  private pickUpPassenger(totalViolationPoints: number): void {
    if (!this.activeRide) {
      return;
    }
    this.state = RideState.PassengerOnboard;
    this.satisfaction = GAME_CONFIG.ride.satisfaction.startingScore;
    this.bonusTip = 0;
    this.traitTipDeduction = 0;
    this.fareWaived = false;
    this.tipForfeited = false;
    this.stationRewardEarned = false;
    this.observationSeen = false;
    this.forbiddenTurnSeen = false;
    this.escapeRewardEarned = false;
    this.passengerElapsed = 0;
    this.tipTimeMultiplier = 1;
    this.pursuitActive = false;
    this.violationBaselinePoints = totalViolationPoints;
    this.rideViolationPoints = 0;
    this.collisionCooldown = 0;
    this.collisionCount = 0;
    this.showMarker(this.activeRide.destinationPoint.position, new Color3(0.2, 0.95, 0.4), "ride-destination-marker");
  }

  private canCompleteArrival(player: PlayerCar, target: Vector3, radius: number): boolean {
    return distanceXZ(player.root.position, target) <= radius
      && player.getSpeedMph() < GAME_CONFIG.ride.maximumArrivalSpeedMph;
  }

  private applySpeedRule(deltaTime: number, speedMph: number): void {
    if (!this.activeRide) {
      return;
    }
    const rules = this.rulesFor(this.activeRide.passengerType);
    let penalized = false;
    let penaltySeconds = deltaTime;
    if (rules.maxSafeSpeedMph !== undefined && speedMph > rules.maxSafeSpeedMph) {
      penalized = true;
    }
    if (rules.minRequiredSpeedMph !== undefined) {
      const grace = rules.gracePeriodSeconds ?? 0;
      penalized = this.passengerElapsed > grace && speedMph < rules.minRequiredSpeedMph;
      penaltySeconds = Math.min(deltaTime, Math.max(0, this.passengerElapsed - grace));
    }
    if (penalized) {
      this.satisfaction = clamp(this.satisfaction - rules.speedPenaltyPerSecond * this.satisfactionPenaltyMultiplier * penaltySeconds, 0, 100);
    }
  }

  private completeRide(): void {
    if (!this.activeRide) {
      return;
    }
    const pending = this.pendingBonus;
    if (pending?.eligible) this.bonusTip += pending.amount;
    const baseFare = this.effectiveBaseFare;
    const violationTipPenaltyPercent = this.violationTipPenaltyPercent;
    const tip = this.getCurrentTip();
    const total = baseFare + tip;
    const result: RideResult = {
      passengerName: this.activeRide.passengerName,
      passengerType: this.activeRide.passengerType,
      missionCategoryId: this.activeRide.missionCategoryId,
      rideTier: this.activeRide.tier,
      pickupDistance: this.activeRide.pickupDistance,
      tripDistance: this.activeRide.tripDistance,
      durationSeconds: this.passengerElapsed,
      collisionCount: this.collisionCount,
      stars: this.getStars(),
      baseFare,
      tip,
      bonusTip: this.bonusTip,
      traitTipDeduction: this.traitTipDeduction,
      fareWaived: this.fareWaived,
      cardsEarned: this.hasOnboardTrait(PassengerType.OffDutyCop) && this.getStars() === 5 ? 1 : 0,
      couponsEarned: this.hasOnboardTrait(PassengerType.CarSalesman) ? 1 : 0,
      freeUpgradeCreditsEarned: this.isInstructor && this.getStars() >= GAME_CONFIG.ride.archetypes.instructorMinimumStars ? 1 : 0,
      timeTipPercentRemaining: this.tipTimeMultiplier * 100,
      violationPoints: this.rideViolationPoints,
      violationTipPenaltyPercent,
      total,
    };
    const training = this.activeRide.training;
    this.lastTrainingReward = this.profile.completeRide(result, training);
    this.lastResult = result;
    this.resultTimeRemaining = GAME_CONFIG.presentation.resultSeconds;
    this.marker?.setEnabled(false);
    this.activeRide = null;
    this.state = RideState.Idle;
    this.satisfaction = GAME_CONFIG.ride.satisfaction.startingScore;
    this.bonusTip = 0;
    this.traitTipDeduction = 0;
    this.fareWaived = false;
    this.tipForfeited = false;
    this.stationRewardEarned = false;
    this.observationSeen = false;
    this.forbiddenTurnSeen = false;
    this.escapeRewardEarned = false;
    this.passengerElapsed = 0;
    this.tipTimeMultiplier = 1;
    this.pursuitActive = false;
    this.violationBaselinePoints = 0;
    this.rideViolationPoints = 0;
    this.collisionCooldown = 0;
    this.collisionCount = 0;
    this.offerBoard.refillOffers(result.missionCategoryId, training?.regionId);
  }

  private calculateTip(baseFare: number, satisfaction: number, timeMultiplier: number, violationMultiplier: number): number {
    return baseFare
      * this.getMaxTipPercent()
      * this.baseTipMultiplier
      * (satisfaction / 100)
      * timeMultiplier
      * violationMultiplier;
  }

  private getViolationTipMultiplier(): number {
    const categoryMultiplier = this.activeRide
      ? getMissionLicense(this.activeRide.missionCategoryId)?.violationTipPenaltyMultiplier ?? 1
      : 1;
    return clamp(
      1 - this.rideViolationPoints
        * GAME_CONFIG.ride.fare.violationTipPenaltyPerPoint
        * categoryMultiplier,
      0,
      1,
    );
  }

  private getMaxTipPercent(): number {
    if (!this.activeRide) return GAME_CONFIG.ride.fare.maxTipPercent;
    return getMissionLicense(this.activeRide.missionCategoryId)?.maxTipPercent
      ?? GAME_CONFIG.ride.fare.maxTipPercent;
  }

  private rulesFor(type: PassengerType): PassengerRules {
    const traits = GAME_CONFIG.ride.archetypes;
    if (type === PassengerType.Timid) return {
      collisionPenalty: GAME_CONFIG.ride.satisfaction.normal.collisionPenalty,
      speedPenaltyPerSecond: traits.speedPenaltyPerSecond,
      maxSafeSpeedMph: traits.timidMaxMph,
    };
    if (type === PassengerType.Hurried) return {
      collisionPenalty: GAME_CONFIG.ride.satisfaction.normal.collisionPenalty,
      speedPenaltyPerSecond: traits.speedPenaltyPerSecond,
      minRequiredSpeedMph: traits.hurriedMinMph,
      gracePeriodSeconds: traits.hurriedGraceSeconds,
    };
    if (type === PassengerType.ScaredyCat) {
      return GAME_CONFIG.ride.satisfaction.scaredyCat;
    }
    if (type === PassengerType.SpeedDemon) {
      return GAME_CONFIG.ride.satisfaction.speedDemon;
    }
    return GAME_CONFIG.ride.satisfaction.normal;
  }

  private showMarker(position: Vector3, color: Color3, name: string): void {
    if (!this.marker || !this.markerMaterial) {
      this.markerMaterial = new StandardMaterial("ride-marker-mat", this.scene);
      this.markerMaterial.alpha = 0.55;

      const disc = MeshBuilder.CreateCylinder("ride-marker", {
        diameter: GAME_CONFIG.ride.pickupRadius * 2,
        height: 0.18,
        tessellation: 32,
      }, this.scene);
      disc.material = this.markerMaterial;

      const beam = MeshBuilder.CreateCylinder("ride-marker-beam", {
        diameter: 2.2,
        height: 22,
        tessellation: 16,
      }, this.scene);
      beam.parent = disc;
      beam.position.set(0, 11, 0);
      beam.material = this.markerMaterial;
      this.marker = disc;
    }

    this.marker.name = name;
    this.marker.position.set(position.x, 0.14, position.z);
    this.markerMaterial.diffuseColor.copyFrom(color);
    this.markerMaterial.emissiveColor.copyFrom(color).scaleInPlace(0.65);
    this.marker.setEnabled(true);
  }
}
