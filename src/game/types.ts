import type { TrainingContext } from "../training/Training";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { MissionLicenseId } from "../missions/MissionLicenseCatalog";

export enum GameState {
  Start = "START",
  Playing = "PLAYING",
  Paused = "PAUSED",
  Citation = "CITATION",
}

export interface DeliveryPoint {
  position: Vector3;
  roadId: string;
}

export interface GasStation {
  position: Vector3;
  pumpPositions: Vector3[];
  radius: number;
  roadAxis: RoadAxis;
  roadSide: -1 | 1;
}

export interface AutoBodyShop {
  position: Vector3;
  serviceArea: BoxCollider;
  bayDirection: -1 | 1;
}

export interface Dealership {
  position: Vector3;
  serviceArea: BoxCollider;
  roadAxis: RoadAxis;
  roadSide: -1 | 1;
}

export interface Clinic {
  id: string;
  regionId: string;
  position: Vector3;
  destinationPoint: DeliveryPoint;
}

export interface TrafficCollisionInfo {
  ridePenaltyMph: number;
  damagePercent: number;
  collisionViolationSeverity: number;
  policeCollisionOfficerId: number | null;
  policeCollisionSeverity: number;
}

export interface CircleCollider {
  x: number;
  z: number;
  radius: number;
}

export interface BoxCollider {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

export type RoadAxis = "northSouth" | "eastWest";
export type RoadTypeId = "city" | "highway";

export interface RoadDefinition {
  id: string;
  axis: RoadAxis;
  index: number;
  center: number;
  type: RoadTypeId;
  speedLimitMph: number;
  allowsMissionStops: boolean;
}

export interface RoadContext {
  road: RoadDefinition;
  axis: RoadAxis;
  roadCenter: number;
  lateralOffset: number;
  distanceToIntersection: number;
  inIntersection: boolean;
  inTurningGap: boolean;
  inLegalDrivingArea: boolean;
}

export interface DrivingViolationSeverity {
  speeding: number;
  wrongSide: number;
  sidewalk: number;
  combined: number;
}

export interface DrivingViolationTotals {
  speeding: number;
  wrongSide: number;
  sidewalk: number;
  total: number;
}

export type DrivingViolationRates = DrivingViolationTotals;

export type TrafficVehicleRole = "civilian" | "police" | "suspect" | "race_waiting";

export type PoliceOffense =
  | "SPEEDING"
  | "WRONG WAY"
  | "SIDEWALK DRIVING"
  | "RECKLESS DRIVING"
  | "COLLISION WITH POLICE";

export interface PoliceCitation {
  officerId: number;
  offense: PoliceOffense;
  assessedFine: number;
  amountPaid: number;
  remainingBalance: number;
  waiverReason?: "lawyer" | "card";
  waivedAmount?: number;
}

export interface RoadNode {
  position: Vector3;
  ix: number;
  iz: number;
}

export interface TrafficWaypoint {
  position: Vector3;
  ix: number;
  iz: number;
}

export interface RoadSurfaceInfo {
  roadPositionsX: number[];
  roadPositionsZ: number[];
  roadHalfWidth: number;
  sidewalkOuterHalfWidth: number;
}

export enum PassengerType {
  Normal = "NORMAL",
  Timid = "TIMID",
  Hurried = "HURRIED",
  Lawful = "LAWFUL",
  Careful = "CAREFUL",
  Shady = "SHADY",
  ThrillSeeker = "THRILL-SEEKER",
  Mechanic = "MECHANIC",
  Lawyer = "LAWYER",
  OffDutyCop = "OFF-DUTY COP",
  CarSalesman = "CAR SALESMAN",
  Millionaire = "MILLIONAIRE",
  ServiceWorker = "FELLOW SERVICE WORKER",
  OffGrid = "OFF-GRID",
  Compulsive = "COMPULSIVE",
  DrivingInstructor = "DRIVING INSTRUCTOR",
  Psychopath = "PSYCHOPATH",
  RunningOnFumes = "RUNNING ON FUMES",
  DemolitionDerbyFan = "DEMOLITION DERBY FAN",
  // Retained only for historical saves and compatibility.

  ScaredyCat = "SCAREDY-CAT",
  SpeedDemon = "SPEED DEMON",
}

export enum RideState {
  Idle = "IDLE",
  DrivingToPickup = "DRIVING_TO_PICKUP",
  PassengerOnboard = "PASSENGER_ONBOARD",
}

export type RideTier = "SHORT" | "MEDIUM" | "LONG";

export interface RideOffer {
  readonly curbside?: boolean;
  readonly training?: TrainingContext;
  id: string;
  missionCategoryId: MissionLicenseId;
  categoryFareMultiplier: number;
  tier: RideTier;
  passengerName: string;
  passengerType: PassengerType;
  pickupPoint: DeliveryPoint;
  destinationPoint: DeliveryPoint;
  pickupDistance: number;
  tripDistance: number;
  fareMultiplier: number;
  baseFare: number;
  ageSeconds: number;
}

export interface RideResult {
  /** Only physical curbside rides grow the new global taxi income balance. */
  curbside?: boolean;
  passiveIncomeGain?: number;
  passengerName: string;
  passengerType: PassengerType;
  missionCategoryId: MissionLicenseId;
  rideTier: RideTier;
  pickupDistance: number;
  tripDistance: number;
  durationSeconds: number;
  collisionCount: number;
  stars: number;
  baseFare: number;
  tip: number;
  bonusTip?: number;
  traitTipDeduction?: number;
  fareWaived?: boolean;
  cardsEarned?: number;
  couponsEarned?: number;
  freeUpgradeCreditsEarned?: number;
  timeTipPercentRemaining: number;
  violationPoints: number;
  violationTipPenaltyPercent: number;
  total: number;
}

export interface RideHistoryEntry extends RideResult {
  id: string;
  completedAt: number;
}
