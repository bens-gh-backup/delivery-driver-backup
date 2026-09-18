import type { RaceEncounterCue } from "../racing/RaceEncounterManager";
import type { ChaseHudState, ChaseResult } from "../chase/ChaseRules";
import { suggestTraining } from "../training/TrainingSuggestion";
import type { TrainingContext, TrainingReward } from "../training/Training";
import { CITY_STYLE } from "../world/CityStyle";
import { TRAINING_CATEGORIES, TRAINING_JOBS_PER_REGION, type TrainingCategoryId } from "../training/Training";
import { RideHud } from "./RideHud";
import { formatIncomeRate } from "./IncomeFormat";
import { setText, setVisible, setClass, setStyle } from "./DomUpdates";
import { passengerArchetype } from "../ride/PassengerArchetypes";
import type { RideOfferBoard } from "../ride/RideOfferBoard";
import type { RideManager } from "../ride/RideManager";
import type { PlayerCar } from "../player/PlayerCar";
import type { FuelManager } from "../player/FuelManager";
import type { DamageManager } from "../player/DamageManager";
import type { PoliceManager } from "../police/PoliceManager";
import type { CurbsideCue } from "../passengers/PassengerManager";
import type { PackageDeliveryResult } from "../delivery/PackageDeliveryManager";
import { AmbulanceDriverState, type AmbulanceDriverManager } from "../delivery/AmbulanceDriverManager";
import { GAME_CONFIG } from "../game/config";
import { PassengerType, RideState, type PoliceCitation, type RideHistoryEntry, type RideResult, type RideOffer } from "../game/types";
import type { Town } from "../world/Town";
import { distanceXZ, normalizeAngle } from "../utils/math";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PlayerProfile } from "../player/PlayerProfile";
import { applyPermanentUpgrades, VEHICLE_STAT_KEYS } from "../progression/UpgradeSystem";
import { ELITE_VEHICLE, VEHICLE_CATALOG, normalizedVehicleStat } from "../vehicles/VehicleCatalog";
import type { VehicleDefinition, VehicleStatKey } from "../vehicles/VehicleTypes";
import {
  MISSION_LICENSES,
  getMissionLicense,
  type MissionLicenseDefinition,
  type MissionLicenseId,
} from "../missions/MissionLicenseCatalog";
import { projectMapHeight, projectMapPoint, projectMapWidth, unprojectMapPoint } from "./MapProjection";

export interface GameUIActions {
  start(): void;
  acceptRide(categoryId: MissionLicenseId, id: string, regionId?: string): boolean;
  acceptAmbulanceDriver(id: string, regionId?: string): boolean;
  purchaseMissionLicense(id: MissionLicenseId): string;
  purchaseVehicle(id: string): string;
  equipVehicle(id: string): string;
  purchaseUpgrade(stat: VehicleStatKey): string;
  acknowledgeCitation(): void;
  debugGiveMoney(): void;
  debugResetMoney(): void;
  debugUnlockAllCars(): void;
  debugResetUpgrades(): void;
  debugSetUpgrade(stat: VehicleStatKey, level: number): void;
  debugEquipVehicle(id: string): void;
  debugTogglePoliceVision(): boolean;
  resetProgression(): void;
  getManualWaypoint(): Vector3 | null;
  canSetManualWaypoint(): boolean;
  setManualWaypoint(position: Vector3 | null): boolean;
  debugUnlockRacing?: () => void;
  debugResetRaceFinish?: (regionId: string) => void;
  purchaseRacingLicense?: () => string;
  startRace?: (regionId: string) => boolean;
  abortRace?: () => void;
  openVehicleShop?: () => boolean;
  canUseVehicleShop?: () => boolean;
}

export interface UiRaceSnapshot {
  state: string;
  regionId: string;
  position: number;
  checkpoint: number;
  checkpointCount: number;
  countdown: number;
  route: readonly { x: number; z: number }[];
}

export interface UiRaceResult {
  regionId: string;
  finishPlace: number;
  cashEarned: number;
  passiveIncomeGain: number;
}

interface MapMarkers {
  player: HTMLDivElement;
  pickup: HTMLDivElement;
  dropoff: HTMLDivElement;
  reward: HTMLDivElement;
  waypoint: HTMLButtonElement | null;
}

export class GameUI {
  private readonly startScreen: HTMLDivElement;
  private readonly pauseScreen: HTMLDivElement;
  private readonly hud: HTMLDivElement;
  private readonly indicator: HTMLDivElement;
  private readonly phone: HTMLDivElement;
  private readonly map: HTMLDivElement;
  private readonly refuelOverlay: HTMLDivElement;
  private readonly refuelButton: HTMLButtonElement;
  private readonly repairOverlay: HTMLDivElement;
  private readonly repairButton: HTMLButtonElement;
  private readonly dealershipOverlay: HTMLDivElement;
  private readonly browseInventoryButton: HTMLButtonElement;
  private readonly rideResult: HTMLDivElement;
  private readonly citationOverlay: HTMLDivElement;
  private readonly policeMeter: HTMLDivElement;
  private readonly policeMeterLabel: HTMLDivElement;
  private readonly policeDistanceLabel: HTMLDivElement;
  private readonly policeFineLabel: HTMLDivElement;
  private readonly policeMeterFill: HTMLDivElement;
  private readonly policeEscapeFill: HTMLDivElement;
  private readonly debugProgression: HTMLDivElement | null;
  private readonly pauseRaceAbort: HTMLButtonElement;
  private readonly startButton: HTMLButtonElement;
  private readonly moneyValue: HTMLDivElement;
  private readonly aiIncomeValue: HTMLDivElement;
  private readonly ridesValue: HTMLDivElement;
  private readonly speedometer: HTMLDivElement;
  private readonly fuelMeter: HTMLDivElement;
  private readonly fuelLabel: HTMLDivElement;
  private readonly fuelFill: HTMLDivElement;
  private readonly damageMeter: HTMLDivElement;
  private readonly damageLabel: HTMLDivElement;
  private readonly damageFill: HTMLDivElement;
  private readonly refuelStatus: HTMLDivElement;
  private readonly rideHud: HTMLDivElement;
  private readonly raceHud: HTMLDivElement;
  private readonly raceCountdown: HTMLDivElement;
  private readonly raceResultOverlay: HTMLDivElement;
  private readonly vehicleShopOverlay: HTMLDivElement;
  private readonly vehicleShopContent: HTMLDivElement;
  private readonly debugRaceTelemetry: HTMLDivElement | null;
  private readonly collisionFlash: HTMLDivElement;
  private readonly indicatorArrow: HTMLSpanElement;
  private readonly indicatorDistance: HTMLSpanElement;
  private phoneOpen = false;
  private phoneRefreshElapsed = 0;
  private mapOpen = false;
  private refuelHeld = false;
  private repairHeld = false;
  private readonly rideHudView: RideHud;
  private lastPoliceMode = "idle";
  private lastPhoneHtml = "";
  private lastRideResultHtml = "";
  private lastRaceResultHtml = "";
  private mapTown: Town | null = null;
  private mapMarkers: MapMarkers | null = null;
  private mapCanvas: HTMLDivElement | null = null;
  private phoneMapMarkers: MapMarkers | null = null;
  private phoneTown: Town | null = null;
  private phoneTab: MissionLicenseId | "training" | "garage" | "upgrades" | "licenses" | "scorecard" = "training";
  private trainingRegionId: string | undefined;
  private trainingCategoryId: TrainingCategoryId | "race" | undefined;
  private trainingSuggestion: TrainingContext | null = null;
  private suggestionKey = "";
  private lastWorkedRegionId: string | undefined;
  private lastSeenReward: TrainingReward | null = null;
  private highlightedRegionId: string | undefined;
  private highlightSeconds = 0;
  private rewardHtmlReceipt: TrainingReward | null = null;
  private rewardHtmlCache = "";
  private suggestedRaceRegionId: string | undefined;
  private readonly phoneSectionHtml = new Map<string, string>();
  private phoneLiveValues: string[] = [];
  private phoneLiveNodes: HTMLElement[] = [];
  private trainingMapCache = "";
  private trainingMapRegions: RideOfferBoard["regions"] | null = null;
  private trainingMapRevision = -1;
  private raceCourses: ReadonlyMap<string, { route: readonly { x: number; z: number }[] }> | null = null;
  private garagePage = 0;
  private scorecardPage = 0;
  private phoneFeedback = "";
  private phoneFeedbackSeconds = 0;
  private ambulancePursuitBlocked = false;
  private raceSnapshot: UiRaceSnapshot | null = null;
  private raceResultData: UiRaceResult | null = null;
  private vehicleShopOpen = false;
  private lastRaceHudHtml = "";
  private raceEncounterCue: RaceEncounterCue | null = null;

  setRaceEncounterCue(cue: RaceEncounterCue | null): void { this.raceEncounterCue = cue; }
  private lastCountdownHtml = "";
  private lastVehicleShopHtml = "";
  private lastVehicleShopState = "";
  private shopFeedback = "";
  private raceFeedback = "";
  private raceFeedbackSeconds = 0;
  private hasFuel = true;
  private curbsideCue: CurbsideCue = null;
  private chaseState: ChaseHudState | null = null;
  private lastIncomeChase: ChaseResult | null = null;

  setChaseState(state: ChaseHudState | null): void { this.chaseState = state; }
  private lastIncomeRide: RideResult | null = null;
  private lastIncomePatient: PackageDeliveryResult | null = null;

  get blocksCurbsidePickup(): boolean {
    return this.phoneOpen || this.mapOpen || this.vehicleShopOpen || this.refuelHeld || this.repairHeld;
  }

  setCurbsidePickupCue(cue: CurbsideCue): void { this.curbsideCue = cue; }

  setTown(town: Town): void {
    this.phoneTown = town;
    this.trainingMapCache = "";
    this.trainingMapRegions = null;
    this.trainingMapRevision = -1;
    this.trainingRegionId = undefined;
    this.trainingCategoryId = undefined;
    this.lastSeenReward = null;
    this.lastIncomeRide = null;
    this.curbsideCue = null;
    this.raceEncounterCue = null;
    this.lastIncomePatient = null;
    this.lastIncomeChase = null;
    this.chaseState = null;
    this.lastWorkedRegionId = undefined;
    this.suggestionKey = "";
    this.highlightedRegionId = undefined;
    this.highlightSeconds = 0;
    this.lastPhoneHtml = "";
  }

  setRaceCourses(courses: ReadonlyMap<string, { route: readonly { x: number; z: number }[] }>): void {
    this.raceCourses = courses;
    this.lastPhoneHtml = "";
  }

  setRaceState(snapshot: UiRaceSnapshot | null, result: UiRaceResult | null = null): void {
    const previousState = this.raceSnapshot?.state ?? "IDLE";
    const active = snapshot?.state === "COUNTDOWN" || snapshot?.state === "RACING";
    this.raceSnapshot = snapshot;
    if (result && result !== this.raceResultData && GAME_CONFIG.presentation.progressionFeedback
      && result.passiveIncomeGain > 0) {
      this.highlightedRegionId = result.regionId;
      this.highlightSeconds = GAME_CONFIG.presentation.regionHighlightSeconds;
    }
    this.raceResultData = result;
    setClass(this.pauseRaceAbort, "hidden", !active && snapshot?.state !== "FINISHED");
    if (active && previousState !== snapshot?.state) {
      this.closePhone();
      this.toggleMapOff();
      this.closeVehicleShop();
      this.rideResult.classList.add("hidden");
      this.raceResultOverlay.classList.add("hidden");
      this.lastRaceResultHtml = "";
      this.lastCountdownHtml = "";
      this.lastPhoneHtml = "";
    }
    if (snapshot?.state === "FINISHED" && previousState !== snapshot.state) {
      this.toggleMapOff();
      this.closeVehicleShop();
    }
    if (snapshot?.state === "FINISHED" && result) {
      this.raceResultOverlay.classList.remove("hidden");
    }
    if (!snapshot || snapshot.state === "IDLE") {
      this.raceResultOverlay.classList.add("hidden");
      this.raceCountdown.classList.add("hidden");
      this.lastRaceHudHtml = "";
      this.lastRaceResultHtml = "";
      this.lastCountdownHtml = "";
      this.raceHud.classList.add("hidden");
      this.rideHud.classList.remove("hidden");
    }
  }

  showRaceFeedback(message: string): void {
    this.raceFeedback = message;
    this.raceFeedbackSeconds = 3;
  }

  get isVehicleShopOpen(): boolean {
    return this.vehicleShopOpen;
  }

  openVehicleShopOverlay(): void {
    this.lastVehicleShopState = "";
    this.vehicleShopOpen = true;
    this.vehicleShopOverlay.classList.remove("hidden");
  }

  closeVehicleShop(): void {
    this.vehicleShopOpen = false;
    this.vehicleShopOverlay.classList.add("hidden");
    this.lastVehicleShopHtml = "";
    this.lastVehicleShopState = "";
  }

  closeShop(): void {
    this.closeVehicleShop();
  }

  private toggleMapOff(): void {
    this.mapOpen = false;
    this.map.classList.add("hidden");
  }

  constructor(
    private readonly root: HTMLDivElement,
    private readonly actions: GameUIActions,
  ) {
    root.innerHTML = "";

    this.startScreen = document.createElement("div");
    this.startScreen.className = "screen";
    this.startScreen.innerHTML = `
      <div class="panel">
        <h1>AI TAXI TRAINING</h1>
        <p>Pick up passengers. Train your AI replacement.</p>
        <p>WASD to drive. P opens your phone. M opens the map. R resets your car.</p>
        <button type="button">START</button>
      </div>
    `;
    this.startButton = this.startScreen.querySelector("button")!;
    this.startButton.addEventListener("click", () => actions.start());

    this.pauseScreen = document.createElement("div");
    this.pauseScreen.className = "screen pause-screen hidden";
    this.pauseScreen.innerHTML = `
      <div class="panel">
        <h1>PAUSED</h1>
        <p>Press Escape to resume.</p>
        <button type="button" class="pause-race-abort hidden" data-race-abort>ABORT RACE</button>
        <button type="button" class="pause-reset" data-reset-progression>RESET PROGRESSION</button>
      </div>
    `;
    this.pauseRaceAbort = this.pauseScreen.querySelector("[data-race-abort]")!;
    this.pauseRaceAbort.addEventListener("click", () => this.actions.abortRace?.());
    this.pauseScreen.querySelector("[data-reset-progression]")!.addEventListener("click", () => {
      if (window.confirm("Reset all progression? This will erase your money, AI training, purchases, upgrades, and ride history.")) {
        actions.resetProgression();
      }
    });

    this.hud = document.createElement("div");
    this.hud.className = "hud hidden";
    this.hud.innerHTML = `
      <div class="hud-stats" data-hud="stats">
        <div class="hud-stat" data-hud="money"></div>
        <div class="hud-stat ai-income" data-hud="ai-income"></div>
        <div class="hud-stat" data-hud="rides"></div>
        <div class="hud-stat speedometer" data-hud="speed"></div>
        <div class="fuel-meter" data-hud="fuel">
          <div class="fuel-label" data-hud="fuel-label"></div>
          <div class="fuel-track"><div class="fuel-fill" data-hud="fuel-fill"></div></div>
        </div>
        <div class="damage-meter" data-hud="damage">
          <div class="damage-label" data-hud="damage-label"></div>
          <div class="damage-track"><div class="damage-fill" data-hud="damage-fill"></div></div>
        </div>
      </div>
      <div class="police-meter hidden" data-hud="police">
        <div class="police-meter-label" data-hud="police-label"></div>
        <div class="police-distance hidden" data-hud="police-distance"></div>
        <div class="police-fine-label hidden" data-hud="police-fine"></div>
        <div class="police-meter-track">
          <div class="police-meter-fill" data-hud="police-fill"></div>
          <div class="police-escape-fill" data-hud="police-escape-fill"></div>
        </div>
      </div>
      <div class="refuel-status hidden" data-hud="refuel">REFUELING</div>
      <div class="mission-row">
        <div class="ride-hud" data-hud="ride"></div>
        <div class="race-hud hidden" data-hud="race"></div>
        <div class="indicator hidden" data-hud="indicator"><span class="arrow">↑</span><span data-indicator="distance"></span></div>
      </div>
      <div class="collision-flash hidden" data-hud="collision"></div>
    `;
    this.aiIncomeValue = this.hud.querySelector('[data-hud="ai-income"]')!;
    this.moneyValue = this.hud.querySelector('[data-hud="money"]')!;
    this.ridesValue = this.hud.querySelector('[data-hud="rides"]')!;
    this.speedometer = this.hud.querySelector('[data-hud="speed"]')!;
    this.fuelMeter = this.hud.querySelector('[data-hud="fuel"]')!;
    this.fuelLabel = this.hud.querySelector('[data-hud="fuel-label"]')!;
    this.fuelFill = this.hud.querySelector('[data-hud="fuel-fill"]')!;
    this.damageMeter = this.hud.querySelector('[data-hud="damage"]')!;
    this.damageLabel = this.hud.querySelector('[data-hud="damage-label"]')!;
    this.damageFill = this.hud.querySelector('[data-hud="damage-fill"]')!;
    this.policeMeter = this.hud.querySelector('[data-hud="police"]')!;
    this.policeMeterLabel = this.hud.querySelector('[data-hud="police-label"]')!;
    this.policeDistanceLabel = this.hud.querySelector('[data-hud="police-distance"]')!;
    this.policeFineLabel = this.hud.querySelector('[data-hud="police-fine"]')!;
    this.policeMeterFill = this.hud.querySelector('[data-hud="police-fill"]')!;
    this.policeEscapeFill = this.hud.querySelector('[data-hud="police-escape-fill"]')!;
    this.refuelStatus = this.hud.querySelector('[data-hud="refuel"]')!;
    this.rideHud = this.hud.querySelector('[data-hud="ride"]')!;
    this.rideHudView = new RideHud(this.rideHud);
    this.raceHud = this.hud.querySelector('[data-hud="race"]')!;
    this.raceHud.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("[data-race-abort]")) this.actions.abortRace?.();
    });
    this.collisionFlash = this.hud.querySelector('[data-hud="collision"]')!;
    this.indicator = this.hud.querySelector('[data-hud="indicator"]')!;
    this.indicatorArrow = this.indicator.querySelector(".arrow")!;
    this.indicatorDistance = this.indicator.querySelector('[data-indicator="distance"]')!;
    this.phone = document.createElement("div");
    this.phone.className = "phone-overlay hidden";
    this.phone.addEventListener("focusin", event => {
      const region = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-training-region]");
      if (!region) return;
      for (const button of this.phone.querySelectorAll<HTMLButtonElement>("[data-training-region]")) button.tabIndex = button === region ? 0 : -1;
    });
    this.phone.addEventListener("keydown", event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-training-region]");
      const region = this.trainingMapRegions?.find(region => region.id === button?.dataset.trainingRegion);
      if (!region) return;
      const movement: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      const delta = movement[event.key];
      if (!delta) return;
      event.preventDefault();
      // Skip park blocks while preserving spatial keyboard navigation.
      const neighbor = this.trainingMapRegions?.filter(candidate =>
        delta[0] ? candidate.bz === region.bz && (candidate.bx - region.bx) * delta[0] > 0
          : candidate.bx === region.bx && (candidate.bz - region.bz) * delta[1] > 0)
        .sort((a, b) => Math.abs(a.bx - region.bx) + Math.abs(a.bz - region.bz)
          - Math.abs(b.bx - region.bx) - Math.abs(b.bz - region.bz))[0];
      if (!neighbor) return;
      const target = this.phone.querySelector<HTMLButtonElement>(`[data-training-region="${neighbor.id}"]`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    this.phone.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-phone-close]")) {
        this.closePhone();
        return;
      }
      const region = target.closest<HTMLButtonElement>("[data-training-region]");
      if (region) {
        this.trainingRegionId = region.dataset.trainingRegion;
        this.trainingCategoryId = "taxi";
        this.lastPhoneHtml = "";
        return;
      }
      const category = target.closest<HTMLButtonElement>("[data-training-category]");
      if (category) {
        this.trainingCategoryId = category.dataset.trainingCategory as TrainingCategoryId | "race";
        this.lastPhoneHtml = "";
        return;
      }
      const chooseRace = target.closest<HTMLButtonElement>("[data-choose-race]");
      if (chooseRace) {
        this.trainingRegionId = this.trainingRegionId ?? chooseRace.dataset.chooseRace;
        this.trainingCategoryId = "race";
        this.lastPhoneHtml = "";
        return;
      }
      const racingLicenseButton = target.closest<HTMLButtonElement>("[data-purchase-racing-license]");
      if (racingLicenseButton && !racingLicenseButton.disabled) {
        this.showPhoneFeedback(this.actions.purchaseRacingLicense?.() ?? "RACING UNAVAILABLE");
        return;
      }
      const raceButton = target.closest<HTMLButtonElement>("[data-start-race]");
      if (raceButton && !raceButton.disabled) {
        if (this.actions.startRace?.(raceButton.dataset.startRace ?? "")) this.closePhone();
        return;
      }
      if (target.closest("[data-training-back]")) {
        if (this.trainingCategoryId) this.trainingCategoryId = undefined;
        else this.trainingRegionId = undefined;
        this.lastPhoneHtml = "";
        return;
      }
      const current = target.closest<HTMLButtonElement>("[data-current-job]");
      if (current) {
        this.trainingRegionId = current.dataset.regionId || undefined;
        this.trainingCategoryId = current.dataset.categoryId as TrainingCategoryId;
        this.phoneTab = this.trainingRegionId ? "training" : current.dataset.categoryId as MissionLicenseId;
        this.lastPhoneHtml = "";
        return;
      }
      const tab = target.closest<HTMLButtonElement>("[data-phone-tab]");
      if (tab) {
        this.phoneTab = (tab.dataset.phoneTab as typeof this.phoneTab) ?? "training";
        this.lastPhoneHtml = "";
        return;
      }
      const pageButton = target.closest<HTMLButtonElement>("[data-phone-page]");
      if (pageButton && !pageButton.disabled) {
        const delta = Number(pageButton.dataset.pageDelta ?? 0);
        if (pageButton.dataset.phonePage === "garage") this.garagePage += delta;
        if (pageButton.dataset.phonePage === "scorecard") this.scorecardPage += delta;
        this.lastPhoneHtml = "";
        return;
      }
      const rideButton = target.closest<HTMLButtonElement>("[data-ride-id]");
      if (rideButton) {
        const categoryId = rideButton.dataset.rideCategory as MissionLicenseId;
        if (this.actions.acceptRide(categoryId, rideButton.dataset.rideId ?? "", rideButton.dataset.regionId || undefined)) this.closePhone();
        return;
      }
      const packageButton = target.closest<HTMLButtonElement>("[data-ambulance-driver-id]");
      if (packageButton) {
        if (this.actions.acceptAmbulanceDriver(packageButton.dataset.ambulanceDriverId ?? "", packageButton.dataset.regionId || undefined)) this.closePhone();
        return;
      }
      const licenseButton = target.closest<HTMLButtonElement>("[data-purchase-license]");
      if (licenseButton && !licenseButton.disabled) {
        this.showPhoneFeedback(this.actions.purchaseMissionLicense(
          licenseButton.dataset.purchaseLicense as MissionLicenseId,
        ));
        return;
      }
      const buyButton = target.closest<HTMLButtonElement>("[data-buy-vehicle]");
      if (buyButton) {
        this.showPhoneFeedback(this.actions.purchaseVehicle(buyButton.dataset.buyVehicle ?? ""));
        return;
      }
      const equipButton = target.closest<HTMLButtonElement>("[data-equip-vehicle]");
      if (equipButton) {
        this.showPhoneFeedback(this.actions.equipVehicle(equipButton.dataset.equipVehicle ?? ""));
        return;
      }
      const upgradeButton = target.closest<HTMLButtonElement>("[data-upgrade-stat]");
      if (upgradeButton) {
        this.showPhoneFeedback(this.actions.purchaseUpgrade(upgradeButton.dataset.upgradeStat as VehicleStatKey));
      }
    });
    this.map = document.createElement("div");
    this.map.className = "map-overlay hidden";
    this.map.addEventListener("click", event => this.handleWaypointClick(event));
    this.refuelOverlay = document.createElement("div");
    this.refuelOverlay.className = "refuel-overlay hidden";
    this.refuelOverlay.innerHTML = `
      <div class="refuel-panel">
        <div class="refuel-title">GAS STATION</div>
        <button type="button" class="refuel-button">FILL TANK</button>
      </div>
    `;
    this.refuelButton = this.refuelOverlay.querySelector("button")!;
    this.refuelButton.addEventListener("pointerdown", (event) => {
      if (this.refuelButton.disabled) return;
      event.preventDefault();
      this.refuelHeld = true;
      this.refuelButton.setPointerCapture(event.pointerId);
    });
    this.refuelButton.addEventListener("pointerup", (event) => {
      this.refuelHeld = false;
      if (this.refuelButton.hasPointerCapture(event.pointerId)) {
        this.refuelButton.releasePointerCapture(event.pointerId);
      }
    });
    this.refuelButton.addEventListener("pointercancel", () => {
      this.refuelHeld = false;
    });
    window.addEventListener("blur", () => {
      this.refuelHeld = false;
      this.repairHeld = false;
    });
    this.repairOverlay = document.createElement("div");
    this.repairOverlay.className = "repair-overlay hidden";
    this.repairOverlay.innerHTML = `
      <div class="repair-panel">
        <div class="repair-title">AUTO BODY</div>
        <div class="repair-actions">
          <button type="button" class="repair-button">REPAIR CAR</button>
        </div>
      </div>
    `;
    this.repairButton = this.repairOverlay.querySelector(".repair-button")!;
    this.dealershipOverlay = document.createElement("div");
    this.dealershipOverlay.className = "dealership-overlay hidden";
    this.dealershipOverlay.innerHTML = `<div class="repair-panel dealership-panel"><div class="repair-title">DEALERSHIP</div>
      <button type="button" class="browse-inventory-button">BROWSE INVENTORY</button></div>`;
    this.browseInventoryButton = this.dealershipOverlay.querySelector(".browse-inventory-button")!;
    this.repairButton.addEventListener("pointerdown", (event) => {
      if (this.repairButton.disabled) return;
      event.preventDefault();
      this.repairHeld = true;
      this.repairButton.setPointerCapture(event.pointerId);
    });
    this.repairButton.addEventListener("pointerup", (event) => {
      this.repairHeld = false;
      if (this.repairButton.hasPointerCapture(event.pointerId)) {
        this.repairButton.releasePointerCapture(event.pointerId);
      }
    });
    this.repairButton.addEventListener("pointercancel", () => {
      this.repairHeld = false;
    });
    this.browseInventoryButton.addEventListener("click", () => {
      if (!this.actions.openVehicleShop?.()) return;
      this.repairHeld = false;
      this.dealershipOverlay.classList.add("hidden");
      this.openVehicleShopOverlay();
    });
    this.rideResult = document.createElement("div");
    this.rideResult.className = "ride-result hidden";
    this.raceCountdown = document.createElement("div");
    this.raceCountdown.className = "race-countdown hidden";
    this.raceResultOverlay = document.createElement("div");
    this.raceResultOverlay.className = "race-result-overlay hidden";
    this.raceResultOverlay.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
    });
    this.vehicleShopOverlay = document.createElement("div");
    this.vehicleShopOverlay.className = "vehicle-shop-overlay hidden";
    this.vehicleShopOverlay.innerHTML = `
      <div class="vehicle-shop-panel">
        <div class="vehicle-shop-heading"><div class="vehicle-shop-title">DEALERSHIP</div><button type="button" class="phone-close" data-shop-close aria-label="Close vehicle shop">&times;</button></div>
        <div class="vehicle-shop-content"></div>
      </div>
    `;
    this.vehicleShopContent = this.vehicleShopOverlay.querySelector(".vehicle-shop-content")!;
    this.vehicleShopOverlay.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-shop-close]")) {
        this.closeVehicleShop();
        return;
      }
      const buyButton = target.closest<HTMLButtonElement>("[data-buy-vehicle]");
      if (buyButton) {
        this.showShopFeedback(this.actions.purchaseVehicle(buyButton.dataset.buyVehicle ?? ""));
        return;
      }
      const equipButton = target.closest<HTMLButtonElement>("[data-equip-vehicle]");
      if (equipButton) this.showShopFeedback(this.actions.equipVehicle(equipButton.dataset.equipVehicle ?? ""));
    });
    this.citationOverlay = document.createElement("div");
    this.citationOverlay.className = "citation-overlay hidden";
    this.citationOverlay.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("[data-citation-continue]")) actions.acknowledgeCitation();
    });

    this.debugProgression = new URLSearchParams(window.location.search).has("debug")
      ? this.createDebugProgressionPanel()
      : null;
    this.debugRaceTelemetry = this.debugProgression?.querySelector("[data-debug-race-telemetry]") ?? null;

    root.append(this.startScreen, this.pauseScreen, this.hud, this.phone, this.map, this.refuelOverlay, this.repairOverlay, this.dealershipOverlay, this.rideResult,
      this.raceCountdown, this.raceResultOverlay, this.vehicleShopOverlay, this.citationOverlay);
    if (this.debugProgression) root.append(this.debugProgression);
  }

  showStart(): void {
    this.startScreen.classList.remove("hidden");
    this.pauseScreen.classList.add("hidden");
    this.hud.classList.add("hidden");
    this.indicator.classList.add("hidden");
    this.phone.classList.add("hidden");
    this.map.classList.add("hidden");
    this.refuelOverlay.classList.add("hidden");
    this.repairOverlay.classList.add("hidden");
    this.dealershipOverlay.classList.add("hidden");
    this.rideResult.classList.add("hidden");
    this.citationOverlay.classList.add("hidden");
    this.closeVehicleShop();
    this.phoneOpen = false;
    this.mapOpen = false;
    this.refuelHeld = false;
    this.repairHeld = false;
    this.phoneFeedback = "";
    this.phoneFeedbackSeconds = 0;
    this.pauseRaceAbort.classList.add("hidden");
  }

  showPlaying(): void {
    this.startScreen.classList.add("hidden");
    this.pauseScreen.classList.add("hidden");
    this.hud.classList.remove("hidden");
    this.rideResult.classList.remove("hidden");
    this.citationOverlay.classList.add("hidden");
    if (!this.raceSnapshot || this.raceSnapshot.state === "IDLE") this.raceResultOverlay.classList.add("hidden");
  }

  showPaused(profile: PlayerProfile): void {
    this.startScreen.classList.add("hidden");
    this.pauseScreen.classList.remove("hidden");
    this.phone.classList.add("hidden");
    this.map.classList.add("hidden");
    this.refuelOverlay.classList.add("hidden");
    this.repairOverlay.classList.add("hidden");
    this.dealershipOverlay.classList.add("hidden");
    this.phoneOpen = false;
    this.mapOpen = false;
    this.refuelHeld = false;
    this.repairHeld = false;
    this.closeVehicleShop();
    this.raceCountdown.classList.add("hidden");
    this.raceResultOverlay.classList.add("hidden");
    this.raceHud.classList.add("hidden");
    this.pauseRaceAbort.classList.toggle("hidden", !this.raceSnapshot || this.raceSnapshot.state === "IDLE");
  }

  showCitation(citation: PoliceCitation): void {
    this.pauseScreen.classList.add("hidden");
    this.phone.classList.add("hidden");
    this.map.classList.add("hidden");
    this.refuelOverlay.classList.add("hidden");
    this.repairOverlay.classList.add("hidden");
    this.dealershipOverlay.classList.add("hidden");
    this.phoneOpen = false;
    this.mapOpen = false;
    this.refuelHeld = false;
    this.repairHeld = false;
    this.closeVehicleShop();
    this.raceCountdown.classList.add("hidden");
    this.raceResultOverlay.classList.add("hidden");
    const basePayment = citation.waiverReason ? "WAIVED" : citation.amountPaid > 0 ? `${this.money(citation.amountPaid)} PAID` : "NO FUNDS COLLECTED";
    const totalAssessed = citation.assessedFine;
    const totalPaid = citation.amountPaid;
    this.citationOverlay.innerHTML = `
      <div class="citation-panel">
        <div class="citation-agency">CITY POLICE</div>
        <div class="citation-title">CITATION</div>
        <div class="citation-offense">${citation.offense}</div>
        <div class="citation-payment">FINE ${this.money(citation.assessedFine)} · ${basePayment}</div>
        <div class="citation-payment">TOTAL ${this.money(totalAssessed)} · ${this.money(totalPaid)} PAID</div>
        ${citation.waiverReason ? `<div class="trait-status">${citation.waiverReason === "lawyer" ? "LAWYER" : "GET OUT OF JAIL FREE CARD USED"} · ${this.money(citation.waivedAmount ?? 0)} WAIVED</div>` : ""}
        <div class="citation-balance">BALANCE ${this.money(citation.remainingBalance)}</div>
        <button type="button" data-citation-continue>CONTINUE</button>
      </div>
    `;
    this.citationOverlay.classList.remove("hidden");
  }

  togglePhone(): void {
    if (this.raceSnapshot?.state === "COUNTDOWN" || this.raceSnapshot?.state === "RACING" || this.vehicleShopOpen) return;
    this.phoneOpen = !this.phoneOpen;
    this.phone.classList.toggle("hidden", !this.phoneOpen);
    if (this.phoneOpen) {
      this.phone.querySelector(".phone-screen")?.scrollTo(0, 0);
      this.phoneTab = GAME_CONFIG.gameplay.regionalTrainingEnabled ? "training" : (this.curbsideCue === "license" || this.chaseState?.licenseRequired || this.raceEncounterCue?.kind === "license") ? "licenses" : "upgrades";
      this.trainingRegionId = undefined;
      this.trainingCategoryId = undefined;
      this.suggestionKey = "";
      this.phoneFeedback = "";
      this.phoneFeedbackSeconds = 0;
      this.lastPhoneHtml = "";
      this.phoneRefreshElapsed = GAME_CONFIG.ride.offerDistanceRefreshSeconds;
    }
  }

  openLicenses(): void {
    if (this.raceSnapshot?.state === "COUNTDOWN" || this.raceSnapshot?.state === "RACING" || this.vehicleShopOpen) return;
    this.toggleMapOff();
    if (!this.phoneOpen) this.togglePhone();
    this.phoneTab = "licenses";
    this.phoneFeedback = ""; this.phoneFeedbackSeconds = 0;
    this.lastPhoneHtml = "";
    this.phoneRefreshElapsed = GAME_CONFIG.ride.offerDistanceRefreshSeconds;
  }

  closePhone(): void {
    this.phoneOpen = false;
    this.phone.classList.add("hidden");
  }

  toggleMap(): void {
    if (this.raceSnapshot?.state === "COUNTDOWN" || this.vehicleShopOpen) return;
    this.mapOpen = !this.mapOpen;
    this.map.classList.toggle("hidden", !this.mapOpen);
  }

  get isRefuelHeld(): boolean {
    return this.refuelHeld;
  }

  get isRepairHeld(): boolean {
    return this.repairHeld;
  }

  update(
    offers: RideOfferBoard,
    ride: RideManager,
    ambulanceDriver: AmbulanceDriverManager,
    player: PlayerCar,
    fuel: FuelManager,
    damage: DamageManager,
    police: PoliceManager,
    profile: PlayerProfile,
    town: Town,
    objectivePosition: Vector3 | null,
    deltaTime: number,
  ): void {
    this.phoneFeedbackSeconds = Math.max(0, this.phoneFeedbackSeconds - deltaTime);
    if (this.phoneFeedbackSeconds <= 0 && this.phoneFeedback) {
      this.phoneFeedback = "";
      this.lastPhoneHtml = "";
    }
    this.raceFeedbackSeconds = Math.max(0, this.raceFeedbackSeconds - deltaTime);
    const speedMph = player.getSpeedMph();
    const raceActive = this.raceSnapshot?.state === "COUNTDOWN" || this.raceSnapshot?.state === "RACING";
    const raceSession = raceActive || this.raceSnapshot?.state === "FINISHED";
    this.hasFuel = fuel.hasFuel;
    this.ambulancePursuitBlocked = police.isPursuitActive;
    const speedWarning = !raceSession && ride.isSpeedWarning(speedMph);
    const speedLabel = raceSession ? `${Math.round(speedMph)} MPH` : ride.getSpeedWarningLabel(speedMph);
    const fuelPercent = Math.round(fuel.fuelPercent * 100);
    const damagePercent = Math.round(damage.damagePercent * 100);
    const walletMoney = ride.totalMoney;
    setText(this.moneyValue, `$${ride.totalMoney.toFixed(2)}`);
    setText(this.aiIncomeValue, `AI INCOME: $${formatIncomeRate(profile.passiveIncomePerSecond)}/sec`);
    setText(this.ridesValue, `RIDES: ${ride.completedRides}`);
    setText(this.speedometer, speedLabel);
    setClass(this.speedometer, "warning", speedWarning);
    setClass(this.fuelMeter, "low", fuel.isLow);
    setText(this.fuelLabel, `GAS ${fuelPercent}%`);
    setStyle(this.fuelFill, "width", `${fuelPercent}%`);
    setClass(this.damageMeter, "damaged", damage.damagePercent > 0);
    setClass(this.damageMeter, "bullet-hit", this.chaseState?.hit ?? false);
    setText(this.damageLabel, `DAMAGE ${damagePercent}/100`);
    setStyle(this.damageFill, "width", `${damagePercent}%`);
    const policePercent = Math.round(police.warning.hudProgress * 100);
    const escapePercent = Math.round(police.warning.escapeProgress * 100);
    setClass(this.policeMeter, "hidden", raceSession || !!this.chaseState?.active || (police.warning.hudMode === "idle" && policePercent <= 0));
    if (this.lastPoliceMode !== police.warning.hudMode) {
      if(this.lastPoliceMode !== "idle") this.policeMeter.classList.remove(this.lastPoliceMode);
      if(police.warning.hudMode !== "idle") this.policeMeter.classList.add(police.warning.hudMode);
      this.lastPoliceMode=police.warning.hudMode;
    }
    const policeLabels: Record<typeof police.warning.hudMode, string> = {
      idle: "POLICE SUSPICION",
      observing: police.warning.activelyObserving
        ? `OBSERVING: ${police.warning.observedOffense ?? "VIOLATION"}`
        : "POLICE SUSPICION",
      pursuit: "POLICE PURSUIT",
      arresting: "ARRESTING",
      fleeing: "FLEEING",
      escaping: "ESCAPING",
    };
    setText(this.policeMeterLabel, policeLabels[police.warning.hudMode]);
    setClass(this.policeFineLabel, "hidden", !police.isPursuitActive);
    setClass(this.policeDistanceLabel, "hidden", !police.isPursuitActive);
    if (police.isPursuitActive) {
      setText(this.policeDistanceLabel, `${Math.max(0, Math.round(police.warning.distanceMeters))}m`);
      setText(this.policeFineLabel, ride.hasOnboardTrait(PassengerType.Lawyer)
        ? "LAWYER · FINES WAIVED IF CAUGHT"
        : profile.jailFreeCards > 0 ? "GET OUT OF JAIL FREE CARD WILL BE USED"
        : `${this.money(police.warning.potentialFine)} FINE IF CAUGHT`);
    }
    setStyle(this.policeMeterFill, "width", `${policePercent}%`);
    setStyle(this.policeEscapeFill,"width",police.warning.hudMode === "escaping" ? `${escapePercent}%` : "0%");
    setClass(this.refuelStatus, "hidden", raceSession || !fuel.isRefueling);
    this.updateRefuelOverlay(fuel, fuelPercent, walletMoney);
    this.updateRepairOverlay(damage, damagePercent, walletMoney);
    setVisible(this.dealershipOverlay, !raceSession && !this.vehicleShopOpen && !this.phoneOpen
      && Boolean(this.actions.canUseVehicleShop?.()));
    if (raceSession) {
      this.policeMeter.classList.add("hidden");
      this.refuelOverlay.classList.add("hidden");
      this.repairOverlay.classList.add("hidden");
      this.dealershipOverlay.classList.add("hidden");
      this.refuelHeld = false;
      this.repairHeld = false;
    }
    this.updateTrainingFeedback(ride, ambulanceDriver, deltaTime);
    this.updateActivityHud(ride, ambulanceDriver, player);
    setText(this.collisionFlash, this.raceFeedbackSeconds > 0 ? this.raceFeedback : ride.collisionFlashText);
    setClass(this.collisionFlash, "hidden", this.raceFeedbackSeconds <= 0 && !ride.collisionFlashText);

    const raceObjective = raceActive ? this.raceSnapshot?.route[this.raceSnapshot.checkpoint] ?? null : null;
    this.updateIndicator(raceSession ? (raceActive ? objectivePosition ?? (raceObjective ? new Vector3(raceObjective.x, 0, raceObjective.z) : null) : null)
      : objectivePosition ?? this.actions.getManualWaypoint(), player);
    if (this.phoneOpen) {
      this.phoneRefreshElapsed += deltaTime;
      if (this.lastPhoneHtml === "" || this.phoneRefreshElapsed >= GAME_CONFIG.ride.offerDistanceRefreshSeconds) {
        this.phoneRefreshElapsed = 0;
        this.renderPhone(offers, ride, ambulanceDriver, player, profile);
      }
    }
    if (this.mapOpen) {
      this.renderMap(ride, ambulanceDriver, player, town);
    }
    this.renderActivityResult(ride, ambulanceDriver);
    this.renderRaceOverlays();
    if (this.vehicleShopOpen) this.renderVehicleShop(profile, player);
    if (this.debugRaceTelemetry) {
      const competitors = this.raceSnapshot?.state === "RACING"
        ? `RACE ${this.regionNumber(this.raceSnapshot.regionId)} · POS ${this.raceSnapshot.position}/${GAME_CONFIG.racing.aiCount + 1} · CP ${this.raceSnapshot.checkpoint}/${this.raceSnapshot.checkpointCount}`
        : "RACE IDLE";
      setText(this.debugRaceTelemetry, competitors);
      setClass(this.debugRaceTelemetry, "hidden", !raceActive && this.raceSnapshot?.state !== "FINISHED");
    }
  }

  dispose(): void {
    this.root.innerHTML = "";
  }

  private updateRefuelOverlay(fuel: FuelManager, fuelPercent: number, walletMoney: number): void {
    const showOverlay = fuel.canUsePump;
    setClass(this.refuelOverlay, "hidden", !showOverlay);
    if (!showOverlay) {
      this.refuelHeld = false;
      return;
    }
    const full = fuel.isFull;
    const outOfMoney = walletMoney <= 0;
    this.refuelButton.disabled = full || outOfMoney;
    setText(this.refuelButton, full ? "TANK FULL" : outOfMoney ? "NO MONEY" : "FILL TANK");
    setClass(this.refuelButton, "held", this.refuelHeld && !full && !outOfMoney);
    setStyle(this.refuelOverlay,"--fuel-percent",`${fuelPercent}%`);
  }

  private updateRepairOverlay(damage: DamageManager, damagePercent: number, walletMoney: number): void {
    const showOverlay = damage.canUseRepair;
    setClass(this.repairOverlay, "hidden", !showOverlay);
    if (!showOverlay) {
      this.repairHeld = false;
      return;
    }
    const repaired = damage.isRepaired;
    const outOfMoney = walletMoney <= 0 && !damage.freeRepair;
    this.repairButton.disabled = repaired || outOfMoney;
    setText(this.repairButton, repaired ? "CAR REPAIRED" : outOfMoney ? "NO MONEY" : damage.freeRepair ? "FREE REPAIR · WAIVE FARE + TIP" : "REPAIR CAR");
    setClass(this.repairButton, "held", this.repairHeld && !repaired && !outOfMoney);
    setStyle(this.repairOverlay,"--damage-percent",`${damagePercent}%`);
  }


  private renderPhone(
    offers: RideOfferBoard,
    ride: RideManager,
    ambulanceDriver: AmbulanceDriverManager,
    player: PlayerCar,
    profile: PlayerProfile,
  ): void {
    this.phoneLiveValues = [];
    if (!GAME_CONFIG.gameplay.regionalTrainingEnabled) {
      this.setHtml(this.phone, "lastPhoneHtml", `
        <div class="phone-panel upgrades-only">
          <div class="phone-topbar"><div class="phone-tabs" role="tablist">
            ${this.phoneTabButton("upgrades", "UPGRADES")}${this.phoneTabButton("licenses", "LICENSES")}
          </div><button type="button" class="phone-close" data-phone-close aria-label="Close phone">&times;</button></div>
          <div class="phone-screen">
            <div class="upgrade-finances"><strong>${this.phoneLive(this.money(profile.money))}</strong><span>AI INCOME $${formatIncomeRate(profile.passiveIncomePerSecond)}/sec</span></div>
            ${this.phoneFeedback ? `<div class="phone-feedback">${this.phoneFeedback}</div>` : ""}
            ${this.phoneTab === "licenses" ? this.renderLicenses(profile) : this.renderUpgrades(profile)}
          </div><div class="phone-home-indicator" aria-hidden="true"></div>
        </div>`);
      for (let i = 0; i < this.phoneLiveNodes.length; i++) setText(this.phoneLiveNodes[i], this.phoneLiveValues[i] ?? "");
      return;
    }
    let content: string;
    const missionCategory = getMissionLicense(this.phoneTab);
    if (this.phoneTab === "training") {
      content = this.renderTraining(offers, ride, ambulanceDriver, player, profile);
    } else if (missionCategory) {
      content = missionCategory.activityType === "ambulanceDriver"
        ? this.renderAmbulanceDriverTab(ambulanceDriver, ride, player, profile, missionCategory)
        : this.renderMissionTab(offers, ride, ambulanceDriver, player, profile, missionCategory);
    } else if (this.phoneTab === "garage") {
      content = this.renderGarage(profile, player);
    } else if (this.phoneTab === "upgrades") {
      content = this.renderUpgrades(profile);
    } else if (this.phoneTab === "scorecard") {
      content = this.renderScorecard(profile);
    } else {
      content = this.renderScorecard(profile);
    }

    this.setHtml(this.phone, "lastPhoneHtml", `
      <div class="phone-panel ${this.phoneTab === "training" ? "training-workspace" : ""}">
        <div class="phone-topbar">${this.phoneTab === "training" ? this.renderTrainingSummary(offers, profile) : ""}<button type="button" class="phone-close" data-phone-close aria-label="Close phone" title="Close phone">&times;</button></div>
        <div class="phone-tabs" role="tablist">
          ${this.phoneTabButton("training", "TRAINING")}
          ${this.phoneTabButton("upgrades", "UPGRADES")}
        </div>
        <div class="phone-screen">
          ${this.phoneTab === "training" ? "" : this.renderPhoneNotices(ride, ambulanceDriver)}
          ${content}
        </div>
        <div class="phone-home-indicator" aria-hidden="true"></div>
      </div>
    `);
    for (let index = 0; index < this.phoneLiveNodes.length; index++) {
      setText(this.phoneLiveNodes[index], this.phoneLiveValues[index] ?? "");
    }
    if (this.phoneTab === "training") {
      for (const button of this.phone.querySelectorAll<HTMLButtonElement>("[data-training-region]")) {
        const selected = button.dataset.trainingRegion === this.trainingRegionId;
        setClass(button, "selected", selected);
        setClass(button, "suggested", !this.trainingRegionId && GAME_CONFIG.presentation.recommendations
          && button.dataset.trainingRegion === this.trainingSuggestion?.regionId);
        if (button.getAttribute("aria-pressed") !== String(selected)) button.setAttribute("aria-pressed", String(selected));
      }
    }
    if (this.phoneMapMarkers && this.phoneTown) this.updateMapMarkers(this.phoneMapMarkers, ride, ambulanceDriver, player, this.phoneTown);
  }

  private renderPhoneNotices(ride: RideManager, ambulanceDriver: AmbulanceDriverManager): string {
    return `<div data-phone-section="feedback">${this.phoneFeedback ? `<div class="phone-feedback">${this.phoneFeedback}</div>` : ""}</div>
          <div data-phone-section="current-job">${ride.isActive || ambulanceDriver.isActive ? `<button type="button" class="current-job-shortcut" data-current-job
            data-region-id="${ride.activeRide?.training?.regionId ?? ambulanceDriver.activeOffer?.training?.regionId ?? ""}"
            data-category-id="${ride.activeRide?.missionCategoryId ?? "ambulance_driver"}">CURRENT JOB</button>` : ""}</div>`;
  }

  private phoneLive(value: string): string {
    const index = this.phoneLiveValues.push(value) - 1;
    return `<span data-phone-live="${index}"></span>`;
  }

  private renderTrainingSummary(offers: RideOfferBoard, profile: PlayerProfile): string {
    const total = offers.regions.reduce((sum, region) => sum + TRAINING_CATEGORIES.reduce((count, category) =>
      count + profile.getTrainingCount(region.id, category.id), 0), 0);
    const capacity = offers.regions.length * TRAINING_JOBS_PER_REGION;
    const percent = capacity ? total / capacity * 100 : 0;
    return `<div class="training-summary" data-phone-section="summary"><span class="training-eyebrow">TRAINING COMPLETION</span>
      <strong class="training-percent">${percent.toFixed(1)}%</strong>
      <div class="training-total-track" role="progressbar" aria-label="City training" aria-valuenow="${total}" aria-valuemin="0" aria-valuemax="${capacity}"><span style="width:${percent}%"></span></div>
    </div>`;
  }

  private renderTraining(offers: RideOfferBoard, ride: RideManager, packages: AmbulanceDriverManager,
    player: PlayerCar, profile: PlayerProfile): string {
    const town = this.phoneTown;
    if (!town) return "";
    const suggestionKey = `${profile.trainingRevision}:${TRAINING_CATEGORIES.map(c => profile.ownsMissionLicense(c.id))}`;
    if (this.suggestionKey !== suggestionKey) {
      this.suggestionKey = suggestionKey;
      this.suggestedRaceRegionId = [...offers.regions].sort((a, b) =>
        Number(profile.getRegionBaseIncomePerSecond(b.id) > 0) - Number(profile.getRegionBaseIncomePerSecond(a.id) > 0)
        || Math.hypot(a.x - player.root.position.x, a.z - player.root.position.z)
          - Math.hypot(b.x - player.root.position.x, b.z - player.root.position.z))[0]?.id;
      this.trainingSuggestion = GAME_CONFIG.presentation.recommendations
        ? suggestTraining(offers.regions, profile, player.root.position, this.lastWorkedRegionId) : null;
    }
    const counts = offers.regions.map(region => TRAINING_CATEGORIES.reduce((sum, category) =>
      sum + profile.getTrainingCount(region.id, category.id), 0));
    if (this.trainingMapRegions !== offers.regions || this.trainingMapRevision !== profile.trainingRevision) {
      this.trainingMapRegions = offers.regions;
      this.trainingMapRevision = profile.trainingRevision;
      const northernRow = Math.max(...offers.regions.map(region => region.bz));
      const missions = offers.regions.map((region, index) => {
        const point = projectMapPoint(region.x, region.z, town);
        const count = counts[index];
        const state = count === TRAINING_JOBS_PER_REGION ? "automated" : count > 0 ? "in-progress" : "untrained";
        const label = `${region.label}, ${count}/${TRAINING_JOBS_PER_REGION} trained. View jobs.`;
        return `<button type="button" class="training-region ${state}" aria-pressed="false"
          tabindex="${region.bx === 0 && region.bz === northernRow ? 0 : -1}" data-training-region="${region.id}"
          style="left:${point.x}%;top:${point.y}%;width:${projectMapWidth((region.maxX - region.minX - GAME_CONFIG.world.roadWidth) * .72, town)}%;height:${projectMapHeight((region.maxZ - region.minZ - GAME_CONFIG.world.roadWidth) * .82, town)}%"
          aria-label="${label}" title="${label}">
          <span class="region-number">${region.label.replace("Region ", "").padStart(2, "0")}${state === "automated" ? '<span class="region-check" aria-hidden="true">✓</span>' : ""}</span>
          <span class="region-count">${count}<span> / ${TRAINING_JOBS_PER_REGION}</span></span>
          ${count > 0 ? `<span class="training-region-progress" data-training-progress="${region.id}" aria-hidden="true"><span style="width:${count / TRAINING_JOBS_PER_REGION * 100}%"></span></span>` : '<span class="region-progress-empty" aria-hidden="true"></span>'}
        </button>`;
      }).join("");
      this.trainingMapCache = `<section class="training-map" aria-label="City training regions">
        <div class="training-map-scroll" tabindex="0" aria-label="City map. Use arrow keys to move between regions.">${this.mapContents(town, missions, "training-")}</div>
      </section>`;
    }
    const region = offers.regions.find(region => region.id === this.trainingRegionId);
    const raceCost = this.racingLicenseCost();
    return `<div class="training-dashboard">
      <div class="training-layout">
        <div class="training-map-column">
          <div data-phone-section="map">${this.trainingMapCache}</div>
          <div class="training-racing-goal" data-phone-section="race-goal">
            <span class="race-goal-icon" aria-hidden="true">⚑</span>
            <div><strong>${profile.ownsRacingLicense ? "Regional racing" : "Racing license"}</strong><span>${profile.ownsRacingLicense ? "Race to multiply AI income" : this.wholeMoney(raceCost)}</span></div>
            ${profile.ownsRacingLicense
              ? `<button type="button" data-choose-race="${region?.id ?? this.suggestedRaceRegionId ?? ""}">Choose a race</button>`
              : `<button type="button" data-purchase-racing-license aria-label="Unlock Racing License (${this.wholeMoney(raceCost)})" ${profile.money < raceCost ? "disabled" : ""}>Unlock</button>`}
          </div>
        </div>
        <div class="training-jobs-column">
          <div class="training-finances" data-phone-section="finances"><strong>${this.phoneLive(this.money(profile.money))}</strong><span>AI INCOME ${this.phoneLive(`$${profile.passiveIncomePerSecond.toFixed(2)}/sec`)}</span></div>
          <div class="training-notices">${this.renderPhoneNotices(ride, packages)}</div>
          <aside class="training-job-panel" data-phone-section="jobs" aria-label="Region jobs">
          ${region ? this.renderRegionJobs(region, offers, ride, packages, player, profile)
            : `<div class="training-selection-empty"><span class="selection-map-icon" aria-hidden="true">↗</span><h3>Select a region</h3><p>Drive jobs. Grow AI income.</p>
              <div class="activity-preview"><span>Taxi</span><span>${profile.ownsMissionLicense("ambulance_driver") ? "Ambulance" : `Ambulance · ${this.wholeMoney(getMissionLicense("ambulance_driver")!.unlockCost)}`}</span><span>${profile.ownsRacingLicense ? "Regional races" : `Racing · ${this.wholeMoney(raceCost)}`}</span></div></div>`}
          </aside>
        </div>
      </div>
    </div>`;
  }

  private renderRegionJobs(region: RideOfferBoard["regions"][number], offers: RideOfferBoard, ride: RideManager,
    packages: AmbulanceDriverManager, player: PlayerCar, profile: PlayerProfile): string {
    const selected = this.trainingCategoryId ?? "taxi";
    const tabs = TRAINING_CATEGORIES.map(category => {
      const owned = profile.ownsMissionLicense(category.id);
      const count = profile.getTrainingCount(region.id, category.id);
      return `<button type="button" role="tab" aria-selected="${selected === category.id}" data-training-category="${category.id}" class="${selected === category.id ? "active" : ""}">
        ${category.id === "taxi" ? "Taxi" : "Ambulance"}<span>${owned ? `${count}/${category.required}${count === category.required ? " ✓" : ""}` : `🔒 ${this.wholeMoney(getMissionLicense(category.id)!.unlockCost)}`}</span></button>`;
    }).join("");
    const header = `<div class="region-panel-heading"><h3>${region.label}</h3><span>${this.phoneLive(`$${profile.getRegionPassiveIncomePerSecond(region.id).toFixed(2)}/sec`)}</span></div>
      <div class="region-activity-tabs" role="tablist" aria-label="Activities">${tabs}<button type="button" role="tab" aria-selected="${selected === "race"}" data-training-category="race" class="${selected === "race" ? "active" : ""}">Race<span>${profile.ownsRacingLicense ? `×${profile.getRaceMultiplier(region.id).toFixed(2)}` : "🔒"}</span></button></div>`;
    if (selected === "race") return header + this.renderRacingCard(region, ride, packages, profile);
    const category = getMissionLicense(selected)!;
    if (!profile.ownsMissionLicense(selected)) return header + `<div class="inline-license"><strong>Ambulance license</strong>
      <button type="button" data-purchase-license="${selected}" ${profile.money < category.unlockCost ? "disabled" : ""}>Unlock License (${this.wholeMoney(category.unlockCost)})</button></div>`;
    return header + (category.activityType === "ambulanceDriver"
      ? this.renderAmbulanceDriverTab(packages, ride, player, profile, category, region.id)
      : this.renderMissionTab(offers, ride, packages, player, profile, category, region.id));
  }

  private renderRacingCard(
    region: RideOfferBoard["regions"][number],
    ride: RideManager,
    packages: AmbulanceDriverManager,
    profile: PlayerProfile,
  ): string {
    const licensed = profile.ownsRacingLicense;
    const best = profile.getBestRaceFinish(region.id);
    const multiplier = profile.getRaceMultiplier(region.id);
    const baseIncome = profile.getRegionBaseIncomePerSecond(region.id);
    const actualIncome = profile.getRegionPassiveIncomePerSecond(region.id);
    const cost = this.racingLicenseCost();
    const raceActive = this.raceSnapshot?.state === "COUNTDOWN" || this.raceSnapshot?.state === "RACING";
    const pursuitBlocked = this.ambulancePursuitBlocked;
    const fuelBlocked = !this.hasFuel;
    const unavailable = raceActive || ride.isActive || packages.isActive || pursuitBlocked || fuelBlocked;
    const unavailableReason = raceActive
      ? "RACE ALREADY IN PROGRESS"
      : pursuitBlocked
        ? "LOSE THE POLICE BEFORE RACING"
        : fuelBlocked
          ? "REFUEL BEFORE RACING"
          : ride.isActive || packages.isActive ? "CURRENT JOB IN PROGRESS" : "";
    const route = this.raceCourses?.get(region.id)?.route
      ?? (this.raceSnapshot?.regionId === region.id ? this.raceSnapshot.route : []);
    const routePreview = route.length > 1 ? this.raceRoutePreview(route) : "";
    if (!licensed) {
      return `<section class="race-selection-card locked">
        <div class="race-card-heading"><div><div class="race-card-eyebrow">REGIONAL RACING</div><h3>RACING LICENSE</h3></div><strong>${this.wholeMoney(cost)}</strong></div>
        <p>Enter every regional race and multiply that region's AI income.</p>
        <button type="button" data-purchase-racing-license ${profile.money < cost ? "disabled" : ""}>Unlock Racing License (${this.wholeMoney(cost)})</button>
      </section>`;
    }
    return `<section class="race-selection-card">
      <div class="race-card-heading"><div><div class="race-card-eyebrow">REGIONAL RACING</div><h3>${region.label.toUpperCase()}</h3></div><span class="race-license-owned">LICENSED</span></div>
      ${routePreview}
      <div class="race-card-stats"><div><span>AUTOMATION INCOME</span><strong>$${baseIncome.toFixed(2)}/sec</strong></div><div><span>BEST RACE RESULT</span><strong>${best === null ? "UNRANKED" : `${this.ordinal(best)} PLACE`}</strong></div><div><span>RACE MULTIPLIER</span><strong>×${multiplier.toFixed(2)}</strong></div><div><span>ACTUAL AI INCOME</span><strong>$${actualIncome.toFixed(2)}/sec</strong></div></div>
      ${unavailableReason ? `<div class="mission-status">${unavailableReason}</div>` : ""}
      <button type="button" data-start-race="${region.id}" ${unavailable ? "disabled" : ""}>${unavailable ? "RACE UNAVAILABLE" : best === null ? "START RACE" : "RETRY RACE"}</button>
    </section>`;
  }

  private renderMissionTab(
    offerBoard: RideOfferBoard,
    ride: RideManager,
    ambulanceDriver: AmbulanceDriverManager,
    player: PlayerCar,
    profile: PlayerProfile,
    category: MissionLicenseDefinition,
    regionId?: string,
  ): string {
    if (!profile.ownsMissionLicense(category.id)) return this.renderLockedMission(category, profile);
    if (ride.state !== RideState.Idle && ride.activeRide?.missionCategoryId === category.id && ride.activeRide?.training?.regionId === regionId) {
      return this.renderCurrentRide(ride, player, category);
    }
    const rideInProgress = ride.state !== RideState.Idle || ambulanceDriver.isActive;
    return `
      <div class="phone-title">${category.name.toUpperCase()} JOBS</div>
      ${rideInProgress ? '<div class="mission-status">CURRENT RIDE IN PROGRESS · NEW JOBS UNAVAILABLE</div>' : ""}
      <div class="offer-list">
        ${offerBoard.getOffers(category.id, regionId).map((offer) => this.offerCard(offer, rideInProgress)).join("")}
      </div>
    `;
  }

  private renderAmbulanceDriverTab(
    ambulanceDriver: AmbulanceDriverManager,
    ride: RideManager,
    player: PlayerCar,
    profile: PlayerProfile,
    category: MissionLicenseDefinition,
    regionId?: string,
  ): string {
    if (!profile.ownsMissionLicense(category.id)) return this.renderLockedMission(category, profile);
    if (ambulanceDriver.activeOffer && ambulanceDriver.activeOffer.training?.regionId === regionId) {
      const target = ambulanceDriver.getObjectivePosition();
      const distance = target
        ? Math.round(distanceXZ(player.root.position, target) * GAME_CONFIG.ride.metersPerWorldUnit)
        : 0;
      const status = ambulanceDriver.state === AmbulanceDriverState.DrivingToPickup
        ? "Driving to patient"
        : "Patient onboard · return to clinic";
      return `
        <div class="phone-title">CURRENT AMBULANCE JOB</div>
        <div class="current-ride-card">
          <div class="ride-name">EMERGENCY PATIENT TRANSPORT</div>
          <div>${status}</div>
          <div>${distance} m away</div>
          <div>Current Rate: ${this.money(ambulanceDriver.currentRatePerMeter)} / m</div>
          <div>Current Payout: ${this.money(ambulanceDriver.currentPayout)}</div>
          <div>Payout Remaining: ${Math.round(ambulanceDriver.payoutMultiplier * 100)}%</div>
        </div>
      `;
    }
    const packageOffers = ambulanceDriver.offers.getOffers(regionId);
    const unavailable = ride.isActive || ambulanceDriver.isActive || this.ambulancePursuitBlocked;
    return `
      <div class="phone-title">AMBULANCE DRIVER</div>
      ${unavailable ? `<div class="mission-status">${this.ambulancePursuitBlocked
        ? "LOSE THE POLICE BEFORE STARTING AN AMBULANCE JOB"
        : "CURRENT RIDE IN PROGRESS · NEW JOBS UNAVAILABLE"}</div>` : ""}
      <div class="offer-list">
        ${packageOffers.map(offer => `<div class="offer-card">
          <div class="offer-heading">
            <div class="ride-name">PATIENT PICKUP</div>
            <div class="ride-type">RETURN TO REGIONAL CLINIC</div>
          </div>
          <button type="button" data-ambulance-driver-id="${offer.id}" data-region-id="${offer.training?.regionId ?? ""}" ${unavailable ? "disabled" : ""}>
            ${unavailable ? "MISSION IN PROGRESS" : "ACCEPT"}
          </button>
          <div class="ride-details">
            ${this.offerMetric("PICKUP", `${Math.round(offer.pickupDistance)} m`)}
            ${this.offerMetric("TO CLINIC", `${Math.round(offer.tripDistance)} m`)}
            ${this.offerMetric("BASE PAY", this.money(offer.initialPayout))}
          </div>
        </div>`).join("")}
      </div>
    `;
  }

  private renderCurrentRide(ride: RideManager, player: PlayerCar, category: MissionLicenseDefinition): string {
    if (ride.activeRide) {
      const target = ride.getObjectivePosition();
      const distance = target
        ? Math.round(distanceXZ(player.root.position, target) * GAME_CONFIG.ride.metersPerWorldUnit)
        : 0;
      const status = ride.state === RideState.DrivingToPickup ? "Driving to pickup" : "Passenger onboard";
      const onboardDetails = ride.state === RideState.PassengerOnboard
        ? `<div class="phone-current-score">${this.stars(ride.getStars())} · Tip now ${this.money(ride.getCurrentTip())}</div>`
        : "";
      return `
        <div class="phone-title">CURRENT ${category.name.toUpperCase()} RIDE</div>
        <div class="current-ride-card">
          <div class="ride-name">${ride.activeRide.passengerName}</div>
          ${this.passengerTypeBadge(ride.activeRide.passengerType)}
          ${this.traitExplanation(ride.activeRide.passengerType)}
          <div>${status}</div>
          <div>${distance} m away</div>
          <div>Base Fare: ${this.money(ride.effectiveBaseFare)}</div>
          ${onboardDetails}
          ${this.currentTraitStatus(ride)}
        </div>
      `;
    }
    return "";
  }

  private renderLockedMission(category: MissionLicenseDefinition, profile: PlayerProfile): string {
    const affordable = profile.money >= category.unlockCost;
    const unlockAction = `<button type="button" data-purchase-license="${category.id}" ${affordable ? "" : "disabled"}>
          ${affordable ? `PURCHASE FOR ${this.wholeMoney(category.unlockCost)}` : `NEED ${this.wholeMoney(category.unlockCost)}`}
        </button>`;
    return `
      <div class="license-lock">
        <div class="license-lock-label">MISSION LICENSE</div>
        <div class="license-lock-title">${category.name.toUpperCase()}</div>
        <div class="license-lock-description">${category.description}</div>
        <div class="license-lock-rate">${category.activityType === "ambulanceDriver"
          ? `${this.money(GAME_CONFIG.ambulanceDriver.ratePerMeter)} / M STARTING RATE`
          : `BASE FARES ×${category.fareMultiplier}`}</div>
        ${unlockAction}
      </div>
    `;
  }

  private renderGarage(profile: PlayerProfile, player: PlayerCar): string {
    const stopped = player.getSpeedMph() <= GAME_CONFIG.progression.equipMaxSpeedMph;
    const pageSize = 2;
    const pageCount = Math.max(1, Math.ceil(VEHICLE_CATALOG.length / pageSize));
    this.garagePage = Math.max(0, Math.min(this.garagePage, pageCount - 1));
    const vehicles = VEHICLE_CATALOG.slice(this.garagePage * pageSize, (this.garagePage + 1) * pageSize);
    return `
      <div class="phone-title-row">
        <div class="phone-title">VEHICLE GARAGE</div>
        ${this.phonePagination("garage", this.garagePage, pageCount)}
      </div>
      ${this.rewardInventory(profile)}
      <div class="garage-list">
        ${vehicles.map((vehicle) => this.vehicleCard(vehicle, profile, stopped)).join("")}
      </div>
    `;
  }

  private vehicleCard(vehicle: VehicleDefinition, profile: PlayerProfile, stopped: boolean): string {
    const owned = profile.ownsVehicle(vehicle.id);
    const equipped = profile.equippedVehicleId === vehicle.id;
    const quote = profile.getVehiclePurchaseQuote(vehicle.id)!;
    const affordable = profile.money >= quote.price;
    const effective = applyPermanentUpgrades(vehicle.stats, profile.upgrades);
    let action: string;
    if (equipped) {
      action = '<button type="button" disabled>EQUIPPED</button>';
    } else if (owned) {
      action = `<button type="button" data-equip-vehicle="${vehicle.id}" ${stopped ? "" : "disabled"}>${stopped ? "EQUIP" : "STOP TO EQUIP"}</button>`;
    } else {
      action = `<button type="button" data-buy-vehicle="${vehicle.id}" ${affordable ? "" : "disabled"}>${affordable ? "BUY" : "INSUFFICIENT FUNDS"}</button>`;
    }
    return `
      <div class="garage-card ${equipped ? "equipped" : ""}">
        <div class="garage-card-heading">
          <div>
            <div class="vehicle-name">${vehicle.name}</div>
            <div class="vehicle-status">${equipped ? "EQUIPPED" : owned ? "OWNED" : this.wholeMoney(quote.price)}</div>
          </div>
          <span class="vehicle-swatch" style="background:${vehicle.appearance.bodyColor}"></span>
        </div>
        ${quote.discount > 0 ? `<div class="trait-status">${this.wholeMoney(quote.discount)} coupon discount · ${quote.couponsUsed} used on purchase</div>` : ""}
        <div class="vehicle-stats">
          ${VEHICLE_STAT_KEYS.map((stat) => this.vehicleStatRow(vehicle, stat, effective[stat], profile.upgrades[stat])).join("")}
        </div>
        ${action}
      </div>
    `;
  }

  private vehicleStatRow(vehicle: VehicleDefinition, stat: VehicleStatKey, effectiveValue: number, level: number): string {
    const basePercent = normalizedVehicleStat(vehicle, stat) * 100;
    const effectivePercent = Math.min(100, effectiveValue / ELITE_VEHICLE.stats[stat] * 100);
    const baseDisplay = stat === "topSpeed"
      ? `${Math.round(vehicle.stats.topSpeed * GAME_CONFIG.ride.mphPerWorldUnitPerSecond)} MPH`
      : `${Math.round(basePercent)}`;
    const effectiveDisplay = stat === "topSpeed"
      ? `${Math.round(effectiveValue * GAME_CONFIG.ride.mphPerWorldUnitPerSecond)} MPH`
      : `${Math.round(effectiveValue / ELITE_VEHICLE.stats[stat] * 100)}`;
    return `
      <div class="vehicle-stat">
        <div class="vehicle-stat-label"><span>${this.statLabel(stat)}</span><span>${baseDisplay}${level > 0 ? ` → ${effectiveDisplay} (+${level}%)` : ""}</span></div>
        <div class="vehicle-stat-track">
          <div class="vehicle-stat-effective" style="width:${effectivePercent}%"></div>
          <div class="vehicle-stat-base" style="width:${basePercent}%"></div>
        </div>
      </div>
    `;
  }

  private renderLicenses(profile: PlayerProfile): string {
    return `<div class="license-list">${MISSION_LICENSES.filter(license => license.id === "taxi"
      || (license.id === "ambulance_driver" && GAME_CONFIG.gameplay.ambulanceJobsEnabled)
      || (license.id === "police_chase" && GAME_CONFIG.gameplay.policeChasesEnabled)).map(license => {
      const owned = profile.ownsMissionLicense(license.id), affordable = profile.money >= license.unlockCost;
      return `<div class="license-card"><div class="license-card-heading"><strong>${license.name}</strong>
        ${license.id !== "taxi" ? `<span>+$${formatIncomeRate(license.id === "police_chase" ? GAME_CONFIG.policeChase.passiveIncomePerWin : GAME_CONFIG.ambulanceDriver.passiveIncomePerDelivery)}/sec</span>` : ""}</div>
        <p>${license.description}</p><button type="button" data-purchase-license="${license.id}" ${owned || !affordable ? "disabled" : ""}>
          ${owned ? "UNLOCKED" : `Unlock License (${this.wholeMoney(license.unlockCost)})`}</button></div>`;
    }).join("")}${GAME_CONFIG.gameplay.racesEnabled ? `<div class="license-card"><div class="license-card-heading"><strong>Racing</strong><span>Up to +$${formatIncomeRate(Math.max(0, ...GAME_CONFIG.racing.finishRewards.map(reward => reward.incomePerSecond)))}/sec</span></div>
      <p>Join street races. Better finishes earn more.</p>
      <button type="button" data-purchase-racing-license ${profile.ownsRacingLicense || profile.money < GAME_CONFIG.racing.licenseCost ? "disabled" : ""}>
        ${profile.ownsRacingLicense ? "UNLOCKED" : `Unlock License (${this.wholeMoney(GAME_CONFIG.racing.licenseCost)})`}</button></div>` : ""}</div>`;
  }

  private renderUpgrades(profile: PlayerProfile): string {
    return `
      ${GAME_CONFIG.gameplay.regionalTrainingEnabled ? '<div class="phone-title">PERMANENT UPGRADES</div>' : ""}
      ${profile.freeUpgradeCredits > 0 ? `<div class="trait-status">FREE UPGRADE CREDITS: ${profile.freeUpgradeCredits}</div>` : ""}
      <div class="upgrade-list">
        ${VEHICLE_STAT_KEYS.map((stat) => this.upgradeCard(stat, profile)).join("")}
      </div>
    `;
  }

  private renderScorecard(profile: PlayerProfile): string {
    const history = profile.rideHistory;
    const pageSize = 1;
    const pageCount = Math.max(1, Math.ceil(history.length / pageSize));
    this.scorecardPage = Math.max(0, Math.min(this.scorecardPage, pageCount - 1));
    const visibleHistory = history.slice(this.scorecardPage * pageSize, (this.scorecardPage + 1) * pageSize);
    const recordedEarnings = history.reduce((sum, ride) => sum + ride.total, 0);
    const recordedTips = history.reduce((sum, ride) => sum + ride.tip, 0);
    const averageStars = history.length > 0
      ? history.reduce((sum, ride) => sum + ride.stars, 0) / history.length
      : 0;
    const limitNote = history.length > 0 && profile.completedRides > history.length
      ? `<div class="scorecard-note">Showing the latest ${history.length} recorded rides</div>`
      : "";
    const emptyMessage = profile.completedRides > 0
      ? "Detailed scorecards will be recorded for new rides."
      : "Completed rides will appear here.";
    return `
      <div class="phone-title-row">
        <div class="phone-title">RIDE SCORECARD</div>
        ${history.length > 0 ? this.phonePagination("scorecard", this.scorecardPage, pageCount) : ""}
      </div>
      ${this.rewardInventory(profile)}
      <div class="scorecard-summary">
        ${this.scorecardSummaryStat(profile.completedRides.toLocaleString("en-US"), "LIFETIME RIDES")}
        ${this.scorecardSummaryStat(history.length > 0 ? averageStars.toFixed(1) : "-", "AVERAGE STARS")}
        ${this.scorecardSummaryStat(this.money(recordedTips), "RECORDED TIPS")}
        ${this.scorecardSummaryStat(this.money(recordedEarnings), "RECORDED EARNINGS")}
      </div>
      ${limitNote}
      ${history.length > 0
        ? `<div class="scorecard-list">${visibleHistory.map((ride) => this.rideScorecard(ride)).join("")}</div>`
        : `<div class="scorecard-empty"><strong>NO RECORDED RIDES</strong><span>${emptyMessage}</span></div>`}
    `;
  }

  private rideScorecard(ride: RideHistoryEntry): string {
    const totalDistance = ride.pickupDistance + ride.tripDistance;
    const passengerType = ride.passengerType === PassengerType.Normal ? "" : ` · ${ride.passengerType}`;
    return `
      <div class="ride-scorecard">
        <div class="scorecard-heading">
          <div>
            <div class="vehicle-name">${ride.passengerName}</div>
            <div class="ride-type">${getMissionLicense(ride.missionCategoryId)?.name.toUpperCase() ?? "TAXI"}${passengerType} · ${ride.rideTier}</div>
          </div>
          <div class="scorecard-date">${this.completedDate(ride.completedAt)}</div>
        </div>
        <div class="scorecard-stars">${this.stars(ride.stars)}</div>
        <div class="scorecard-details">
          ${this.scorecardDetail("TOTAL DISTANCE", `${Math.round(totalDistance)} m`)}
          ${this.scorecardDetail("PICKUP DISTANCE", `${Math.round(ride.pickupDistance)} m`)}
          ${this.scorecardDetail("RIDE DISTANCE", `${Math.round(ride.tripDistance)} m`)}
          ${this.scorecardDetail("RIDE TIME", this.duration(ride.durationSeconds))}
          ${this.scorecardDetail("COLLISIONS", ride.collisionCount.toString())}
          ${this.scorecardDetail("ILLEGAL POINTS", ride.violationPoints.toFixed(1))}
          ${this.scorecardDetail("TIP PENALTY", `-${Math.round(ride.violationTipPenaltyPercent)}%`)}
          ${this.scorecardDetail("TIME TIP", `${Math.round(ride.timeTipPercentRemaining)}%`)}
        </div>
        ${this.traitResultDetails(ride)}
        <div class="scorecard-money">
          <span>FARE ${this.money(ride.baseFare)}</span>
          <span>TIP ${this.money(ride.tip)}</span>
          <strong>TOTAL ${this.money(ride.total)}</strong>
        </div>
      </div>
    `;
  }

  private scorecardSummaryStat(value: string, label: string): string {
    return `<div><strong>${value}</strong><span>${label}</span></div>`;
  }

  private scorecardDetail(label: string, value: string): string {
    return `<div><span>${label}</span><strong>${this.phoneLive(value)}</strong></div>`;
  }

  private completedDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  private duration(seconds: number): string {
    const wholeSeconds = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(wholeSeconds / 60);
    const remainder = wholeSeconds % 60;
    return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
  }

  private upgradeCard(stat: VehicleStatKey, profile: PlayerProfile): string {
    const level = profile.upgrades[stat];
    const maxed = level >= GAME_CONFIG.progression.maxUpgradeLevel;
    const nextLevel = Math.min(GAME_CONFIG.progression.maxUpgradeLevel, level + 1);
    const quote = profile.getUpgradePurchaseQuote(stat);
    const cost = quote?.price ?? 0;
    const affordable = quote !== null && profile.money >= cost;
    const priceLabel = quote?.creditsUsed ? "Free! (one upgrade only)" : this.wholeMoney(cost);
    return `
      <div class="upgrade-card">
        <div>
          <div class="upgrade-name">${this.statLabel(stat)}</div>
          <div class="upgrade-level">LEVEL ${level} / ${GAME_CONFIG.progression.maxUpgradeLevel}</div>
        </div>
        <div class="upgrade-comparison">
          ${maxed ? '<strong>+50% · MAX LEVEL</strong>' : `<span>+${level}% → +${nextLevel}%</span><strong>${priceLabel}</strong>`}
        </div>
        <button type="button" data-upgrade-stat="${stat}" ${maxed || !affordable ? "disabled" : ""}>
          ${maxed ? "MAX LEVEL" : affordable ? "UPGRADE" : "INSUFFICIENT FUNDS"}
        </button>
      </div>
    `;
  }

  private phoneTabButton(tab: typeof this.phoneTab, label: string): string {
    return `<button type="button" class="phone-tab ${this.phoneTab === tab ? "active" : ""}" data-phone-tab="${tab}" role="tab" aria-selected="${this.phoneTab === tab}">${label}</button>`;
  }

  private phonePagination(section: "garage" | "scorecard", page: number, pageCount: number): string {
    return `
      <div class="phone-pagination" aria-label="${section} pages">
        <button type="button" data-phone-page="${section}" data-page-delta="-1" aria-label="Previous page" ${page <= 0 ? "disabled" : ""}>&lsaquo;</button>
        <span>${page + 1} / ${pageCount}</span>
        <button type="button" data-phone-page="${section}" data-page-delta="1" aria-label="Next page" ${page >= pageCount - 1 ? "disabled" : ""}>&rsaquo;</button>
      </div>
    `;
  }

  private showPhoneFeedback(message: string): void {
    this.phoneFeedback = message;
    this.phoneFeedbackSeconds = 2.5;
    this.lastPhoneHtml = "";
  }

  private renderMap(
    ride: RideManager,
    ambulanceDriver: AmbulanceDriverManager,
    player: PlayerCar,
    town: Town,
  ): void {
    if (this.mapTown !== town || !this.mapMarkers) this.buildMap(town);
    setClass(this.mapCanvas!, "waypoint-enabled", this.actions.canSetManualWaypoint());
    this.updateMapMarkers(this.mapMarkers!, ride, ambulanceDriver, player, town);
  }

  private handleWaypointClick(event: MouseEvent): void {
    if (!this.mapOpen || event.button !== 0 || !this.actions.canSetManualWaypoint()) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-map="waypoint"]')) {
      this.actions.setManualWaypoint(null);
      event.preventDefault();
      return;
    }
    const canvas = this.mapCanvas;
    if (!canvas || !this.mapTown || !canvas.contains(target)) return;
    // Measure only on a click. Percent-positioned markers use the inside of the
    // border, so using the outer rectangle would shift pins at different sizes.
    const rect = canvas.getBoundingClientRect(), style = getComputedStyle(canvas);
    const left = parseFloat(style.borderLeftWidth), top = parseFloat(style.borderTopWidth);
    const width = rect.width - left - parseFloat(style.borderRightWidth);
    const height = rect.height - top - parseFloat(style.borderBottomWidth);
    if (width <= 0 || height <= 0) return;
    const x = (event.clientX - rect.left - left) / width * 100;
    const y = (event.clientY - rect.top - top) / height * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    const point = unprojectMapPoint(x, y, this.mapTown);
    this.actions.setManualWaypoint(new Vector3(point.x, 0, point.z));
  }

  private updateMapMarkers(markers: MapMarkers, ride: RideManager, ambulanceDriver: AmbulanceDriverManager,
    player: PlayerCar, town: Town): void {
    const rewardRegion = this.highlightSeconds > 0
      ? this.trainingMapRegions?.find(region => region.id === this.highlightedRegionId) : undefined;
    // The world map may be used before the phone has been opened.
    const rewardId = this.highlightSeconds > 0 ? this.highlightedRegionId : undefined;
    setVisible(markers.reward, Boolean(rewardId));
    if (rewardId) {
      const [, bx, bz] = rewardId.split("-").map(Number);
      const x = rewardRegion?.x ?? (town.roadPositionsX[bx] + town.roadPositionsX[bx + 1]) / 2;
      const z = rewardRegion?.z ?? (town.roadPositionsZ[bz] + town.roadPositionsZ[bz + 1]) / 2;
      const point = projectMapPoint(x, z, town);
      setStyle(markers.reward, "left", `${point.x}%`);
      setStyle(markers.reward, "top", `${point.y}%`);
      setStyle(markers.reward, "width", `${projectMapWidth(town.roadPositionsX[bx + 1] - town.roadPositionsX[bx] - GAME_CONFIG.world.roadWidth, town)}%`);
      setStyle(markers.reward, "height", `${projectMapHeight(town.roadPositionsZ[bz + 1] - town.roadPositionsZ[bz] - GAME_CONFIG.world.roadWidth, town)}%`);
    }
    const playerPoint = projectMapPoint(player.root.position.x, player.root.position.z, town);
    setStyle(markers.player, "left", `${playerPoint.x}%`);
    setStyle(markers.player, "top", `${playerPoint.y}%`);
    setStyle(markers.player, "transform", `translate(-50%, -50%) rotate(${player.heading}rad)`);

    const activeRide = ride.activeRide;
    const activePackage = ambulanceDriver.activeOffer;
    const pickup = activeRide?.pickupPoint ?? activePackage?.pickupPoint ?? null;
    const destination = activeRide?.destinationPoint ?? activePackage?.destinationPoint ?? null;
    const showingPickup = (activeRide !== null && ride.state === RideState.DrivingToPickup)
      || (activePackage !== null && ambulanceDriver.state === AmbulanceDriverState.DrivingToPickup);
    const showingDropoff = (activeRide !== null && ride.state === RideState.PassengerOnboard)
      || (activePackage !== null && ambulanceDriver.state === AmbulanceDriverState.CarryingPackage);

    this.updateObjectiveMapMarker(markers.pickup, pickup?.position.x, pickup?.position.z, town, showingPickup);
    this.updateObjectiveMapMarker(markers.dropoff, destination?.position.x, destination?.position.z, town, showingDropoff);
    if (markers.waypoint) {
      const waypoint = this.actions.getManualWaypoint();
      this.updateObjectiveMapMarker(markers.waypoint, waypoint?.x, waypoint?.z, town, waypoint !== null);
    }
  }

  private readMapMarkers(root: HTMLElement, prefix = ""): MapMarkers | null {
    const player = root.querySelector<HTMLDivElement>(`[data-map="${prefix}player"]`);
    if (!player) return null;
    return { player,
      pickup: root.querySelector(`[data-map="${prefix}pickup"]`)!,
      dropoff: root.querySelector(`[data-map="${prefix}dropoff"]`)!,
      reward: root.querySelector(`[data-map="${prefix}reward"]`)!,
      waypoint: root.querySelector(`[data-map="${prefix}waypoint"]`),
    };
  }

  private buildMap(town: Town): void {
    this.map.innerHTML = `<div class="map-panel"><div class="map-title">MAP</div>
      ${this.mapContents(town)}<div class="phone-close-hint">M TO CLOSE · ESC TO PAUSE</div></div>`;
    this.mapTown = town;
    this.mapCanvas = this.map.querySelector(".map-canvas");
    this.mapMarkers = this.readMapMarkers(this.map);
  }

  private mapContents(town: Town, missions = "", prefix = ""): string {
    const roadWidth = projectMapWidth(GAME_CONFIG.world.roadWidth, town);
    const roadHeight = projectMapHeight(GAME_CONFIG.world.roadWidth, town);
    const parks = town.districts.filter(block => block.district === "park").map(({ bx, bz }) => {
      const x0 = town.roadPositionsX[bx], x1 = town.roadPositionsX[bx + 1];
      const z0 = town.roadPositionsZ[bz], z1 = town.roadPositionsZ[bz + 1];
      const point = projectMapPoint((x0 + x1) / 2, (z0 + z1) / 2, town);
      return `<div class="map-park" data-map-park="block-${bx}-${bz}" role="img" aria-label="Park"
        style="left:${point.x}%;top:${point.y}%;width:${projectMapWidth(x1 - x0 - GAME_CONFIG.world.roadWidth, town)}%;height:${projectMapHeight(z1 - z0 - GAME_CONFIG.world.roadWidth, town)}%"></div>`;
    }).join("");
    const roads = town.roads.map((road) => {
      const point = road.axis === "northSouth"
        ? projectMapPoint(road.center, 0, town)
        : projectMapPoint(0, road.center, town);
      const style = road.axis === "northSouth"
        ? `left:${point.x}%;width:${roadWidth}%`
        : `top:${point.y}%;height:${roadHeight}%`;
      return `<div class="map-road ${road.axis} ${road.type}" style="${style}"></div>`;
    }).join("");
    const gasMarkers = town.gasStations.map((station) => {
      const point = projectMapPoint(station.position.x, station.position.z, town);
      return `<div class="map-marker gas" style="left:${point.x}%;top:${point.y}%" role="img" aria-label="Gas station" title="Gas station"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4h10v17M3 21h14M7 7h6v5H7zM15 10h2l3 3v5a1 1 0 0 0 2 0V9l-4-4"/></svg></div>`;
    }).join("");
    const repairMarkers = town.autoBodyShops.map((shop) => {
      const point = projectMapPoint(shop.position.x, shop.position.z, town);
      return `<div class="map-marker repair" style="left:${point.x}%;top:${point.y}%" role="img" aria-label="Repair shop" title="Repair shop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4a6 6 0 0 0-7 8L3 17a3 3 0 0 0 4 4l5-5a6 6 0 0 0 8-7l-4 3-4-4z"/></svg></div>`;
    }).join("");
    const dealerMarkers = town.dealerships.map(dealer => {
      const point = projectMapPoint(dealer.position.x, dealer.position.z, town);
      return `<div class="map-marker dealership" style="left:${point.x}%;top:${point.y}%" role="img" aria-label="Car dealership" title="Car dealership"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13l3-7h12l3 7v7H3zM3 13h18M6 20v2m12-2v2M6 16h2m8 0h2"/></svg></div>`;
    }).join("");
    // Scale with the road so marker edges stay on the actual curb side even in a narrow map.
    const objectiveMarkerWidth = projectMapWidth(GAME_CONFIG.world.roadWidth * 0.5, town);
    const objectiveMarkerHeight = projectMapHeight(GAME_CONFIG.world.roadWidth * 0.5, town);

    return `<div class="map-canvas" style="--map-road-color:${CITY_STYLE.palette.road};aspect-ratio:${town.maxX - town.minX}/${town.maxZ - town.minZ};--objective-marker-width:${objectiveMarkerWidth}%;--objective-marker-height:${objectiveMarkerHeight}%;--mission-marker-width:${projectMapWidth(130, town)}%;--mission-marker-height:${projectMapHeight(130, town)}%;--service-marker-width:${projectMapWidth(140, town)}%;--service-marker-height:${projectMapHeight(140, town)}%">
          ${parks}${roads}${gasMarkers}${repairMarkers}${dealerMarkers}${missions}
          <div class="map-marker pickup hidden" data-map="${prefix}pickup" role="img" aria-label="Pickup" title="Pickup"></div>
          <div class="map-marker dropoff hidden" data-map="${prefix}dropoff" role="img" aria-label="Dropoff" title="Dropoff"></div>
          <div class="map-training-reward hidden" data-map="${prefix}reward" aria-hidden="true"></div>
          <div class="map-player" data-map="${prefix}player">▲</div>
          ${prefix === "" ? '<button type="button" class="map-waypoint hidden" data-map="waypoint" aria-label="Remove waypoint" title="Remove waypoint"></button>' : ""}
        </div>`;
  }

  private updateObjectiveMapMarker(
    marker: HTMLElement,
    x: number | undefined,
    z: number | undefined,
    town: Town,
    visible: boolean,
  ): void {
    const hasPosition = x !== undefined && z !== undefined;
    const shouldShow = visible && hasPosition;
    setClass(marker, "hidden", !shouldShow);
    if (!shouldShow) return;
    const point = projectMapPoint(x, z, town);
    setStyle(marker, "left", `${point.x}%`);
    setStyle(marker, "top", `${point.y}%`);
  }

  private offerCard(offer: RideOffer, disabled = false): string {
    return `
      <div class="offer-card">
        <div class="offer-heading">
          <div class="ride-name">${offer.passengerName}</div>
          ${this.passengerTypeBadge(offer.passengerType)}
        </div>
        <button type="button" data-ride-id="${offer.id}" data-ride-category="${offer.missionCategoryId}" data-region-id="${offer.training?.regionId ?? ""}" ${disabled ? "disabled" : ""}>
          ${disabled ? "RIDE IN PROGRESS" : "ACCEPT"}
        </button>
        ${this.traitExplanation(offer.passengerType)}
        <div class="ride-details">
          ${this.offerMetric("PICKUP", `${Math.round(offer.pickupDistance)} m`)}
          ${this.offerMetric("TRIP", `${Math.round(offer.tripDistance)} m`)}
          ${this.offerMetric("FARE", this.money(offer.baseFare))}
        </div>
      </div>
    `;
  }

  private offerMetric(label: string, value: string): string {
    return `<div><span>${label}</span><strong>${this.phoneLive(value)}</strong></div>`;
  }

  private passengerTypeBadge(passengerType: PassengerType): string {
    return passengerType === PassengerType.Normal ? "" : `<div class="ride-type">${passengerArchetype(passengerType).name}</div>`;
  }

  private updateActivityHud(ride: RideManager, ambulanceDriver: AmbulanceDriverManager, player: PlayerCar): void {
    const raceActive = this.raceSnapshot?.state === "COUNTDOWN" || this.raceSnapshot?.state === "RACING";
    const raceSession = raceActive || this.raceSnapshot?.state === "FINISHED";
    setVisible(this.raceHud, raceActive);
    setVisible(this.rideHud, !raceSession);
    if (raceActive && this.raceSnapshot) {
      const snapshot = this.raceSnapshot;
      const stateLabel = snapshot.state === "COUNTDOWN" ? "GRID" : "RACING";
      const html = `<div class="race-hud-line"><strong>STREET RACE</strong><span>${stateLabel}</span></div>
        <div class="race-hud-line"><strong>POSITION ${Math.max(1, snapshot.position)} / ${GAME_CONFIG.racing.aiCount + 1}</strong><span>CHECKPOINT ${Math.min(snapshot.checkpoint + 1, snapshot.checkpointCount)} / ${snapshot.checkpointCount}</span></div>`;
      if (html !== this.lastRaceHudHtml) {
        this.lastRaceHudHtml = html;
        this.raceHud.innerHTML = html;
      }
      return;
    }
    if (this.chaseState?.active) {
      this.rideHudView.update({ objective: `POLICE · ${Math.round(this.chaseState.distance)}m`,
        targetHealth: this.chaseState.suspectHealth,
        arrival: this.chaseState.escapeRemaining !== null ? `LOSING SUSPECT · ${Math.ceil(this.chaseState.escapeRemaining)}s` : undefined });
      return;
    }
    if (ambulanceDriver.activeOffer) {
      const objective = ambulanceDriver.state === AmbulanceDriverState.DrivingToPickup ? "COLLECT PATIENT" : "DRIVE TO CLINIC";
      this.rideHudView.update({objective:`AMBULANCE · ${objective}`,
        packagePayout:`PAYOUT: ${this.money(ambulanceDriver.currentPayout)}`,

        arrival:ambulanceDriver.isWaitingForArrivalSpeed()
          ? `SLOW BELOW ${GAME_CONFIG.ride.maximumArrivalSpeedMph} MPH` : undefined});
      return;
    }
    if (!ride.activeRide && this.raceEncounterCue) {
      const cue = this.raceEncounterCue, seconds = Math.ceil(cue.seconds);
      const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,"0")}`;
      const label = cue.kind === "license" ? "E · RACING LICENSE" : cue.kind === "fuel" ? "REFUEL TO RACE" : "E · ENTER RACE";
      this.rideHudView.update({objective: `${label} · ${time}`});
      return;
    }
    if (!ride.activeRide) {
      this.rideHudView.update({objective: GAME_CONFIG.gameplay.curbsidePassengersEnabled
        ? this.chaseState?.licenseRequired ? "POLICE LICENSE REQUIRED · P"
          : this.curbsideCue === "license" ? "AMBULANCE LICENSE REQUIRED · P"
          : this.curbsideCue === "pursuit" ? "LOSE POLICE FIRST"
          : this.curbsideCue === "patient" ? "STOP TO COLLECT PATIENT"
          : this.curbsideCue === "taxi" ? "STOP TO PICK UP" : "LOOK FOR SOMEONE HAILING A TAXI"
        : "PRESS P FOR RIDES"});
      return;
    }
    const onboard = ride.state === RideState.PassengerOnboard;
    const category = getMissionLicense(ride.activeRide.missionCategoryId)?.name.toUpperCase() ?? "RIDE";
    this.rideHudView.update({
      objective:`${category} · ${onboard ? "" : "PICK UP: "}${this.passengerNameWithTrait(ride.activeRide.passengerName,ride.activeRide.passengerType)}`,
      trait:passengerArchetype(ride.activeRide.passengerType).text,
      stars:onboard ? ride.getStars() : undefined,
      tip:onboard ? this.money(ride.getCurrentTip()) : undefined,
      statusHtml:onboard ? this.currentTraitStatus(ride) : undefined,
      arrival:ride.isWaitingForArrivalSpeed(player) ? `SLOW BELOW ${GAME_CONFIG.ride.maximumArrivalSpeedMph} MPH` : undefined,
    });
  }

  private traitExplanation(type: PassengerType): string {
    const text = passengerArchetype(type).text;
    return text ? `<div class="trait-explanation">${text}</div>` : "";
  }

  private currentTraitStatus(ride: RideManager): string {
    if (ride.isInstructor) return `<div class="trait-status">NO FARE OR TIP · ${ride.getStars() >= GAME_CONFIG.ride.archetypes.instructorMinimumStars
      ? "FREE UPGRADE ELIGIBLE AT DROP-OFF" : "4+ STARS NEEDED FOR FREE UPGRADE"}</div>`;
    if (ride.fareWaived) return '<div class="trait-status">FREE REPAIR · FARE AND TIP WAIVED</div>';
    const pending = ride.pendingBonus;
    const permanent = ride.hasOnboardTrait(PassengerType.Shady) || ride.hasOnboardTrait(PassengerType.Compulsive);
    const pendingText = pending ? `<div class="trait-status">${pending.eligible
      ? `${this.money(pending.amount)} BONUS ELIGIBLE AT DROP-OFF`
      : `${this.money(pending.amount)} BONUS ${permanent ? "LOST" : "NOT YET ELIGIBLE"}`} · ${pending.condition}</div>` : "";
    return `${pendingText}${ride.bonusTip > 0 ? `<div class="trait-status">BONUS EARNED ${this.money(ride.bonusTip)}</div>` : ""}
      ${ride.traitTipDeduction > 0 ? `<div class="trait-status">TRAIT TIP DEDUCTIONS ${this.money(ride.traitTipDeduction)}</div>` : ""}`;
  }

  private rewardInventory(profile: PlayerProfile): string {
    return `<div class="reward-inventory">Get Out of Jail Free cards: ${profile.jailFreeCards}<br>Vehicle coupons: ${profile.vehicleCoupons} × ${this.wholeMoney(GAME_CONFIG.ride.archetypes.vehicleCouponValue)}<br>Free upgrade credits: ${profile.freeUpgradeCredits}</div>`;
  }

  private traitResultDetails(result: RideResult): string {
    return `${result.passengerType === PassengerType.DrivingInstructor ? '<div class="trait-status">DRIVING INSTRUCTOR · NO FARE OR TIP</div>' : ""}
      ${(result.freeUpgradeCreditsEarned ?? 0) > 0 ? '<div class="trait-status">+1 FREE UPGRADE CREDIT</div>' : ""}
      ${result.fareWaived ? '<div class="trait-status">FARE AND TIP WAIVED FOR REPAIRS</div>' : ""}
      ${(result.bonusTip ?? 0) > 0 ? `<div class="trait-status">Bonus included in tip: ${this.money(result.bonusTip!)}</div>` : ""}
      ${(result.traitTipDeduction ?? 0) > 0 ? `<div class="trait-status">Trait tip deductions: ${this.money(result.traitTipDeduction!)}</div>` : ""}
      ${(result.cardsEarned ?? 0) > 0 ? '<div class="trait-status">+1 GET OUT OF JAIL FREE CARD</div>' : ""}
      ${(result.couponsEarned ?? 0) > 0 ? `<div class="trait-status">+1 ${this.wholeMoney(GAME_CONFIG.ride.archetypes.vehicleCouponValue)} VEHICLE COUPON</div>` : ""}`;
  }

  private passengerNameWithTrait(name: string, passengerType: PassengerType): string {
    return passengerType === PassengerType.Normal ? name : `${name} (${passengerArchetype(passengerType).name})`;
  }

  private updateIndicator(target: Vector3 | null, player: PlayerCar): void {
    if (!target) {
      setVisible(this.indicator,false);
      return;
    }
    setVisible(this.indicator,true);
    const dx = target.x - player.root.position.x;
    const dz = target.z - player.root.position.z;
    const worldAngle = Math.atan2(dx, dz);
    const relativeAngle = normalizeAngle(worldAngle - player.heading);
    const distance = Math.round(distanceXZ(player.root.position, target) * GAME_CONFIG.ride.metersPerWorldUnit);
    setStyle(this.indicatorArrow,"transform",`rotate(${relativeAngle}rad)`);
    setText(this.indicatorDistance,`${distance}m`);
  }

  private updateTrainingFeedback(ride: RideManager, ambulance: AmbulanceDriverManager, deltaTime: number): void {
    this.highlightSeconds = Math.max(0, this.highlightSeconds - deltaTime);
    if (ride.lastResult && ride.lastResult !== this.lastIncomeRide) {
      this.lastIncomeRide = ride.lastResult;
      if ((ride.lastResult.passiveIncomeGain ?? 0) > 0 && GAME_CONFIG.presentation.progressionFeedback)
        this.highlightSeconds = GAME_CONFIG.presentation.regionHighlightSeconds;
    }
    if (ambulance.lastResult && ambulance.lastResult !== this.lastIncomePatient) {
      this.lastIncomePatient = ambulance.lastResult;
      if ((ambulance.lastResult.passiveIncomeGain ?? 0) > 0 && GAME_CONFIG.presentation.progressionFeedback)
        this.highlightSeconds = GAME_CONFIG.presentation.regionHighlightSeconds;
    }
    if (this.chaseState?.result && this.chaseState.result !== this.lastIncomeChase) {
      this.lastIncomeChase = this.chaseState.result;
      if (this.chaseState.result.passiveIncomeGain > 0 && GAME_CONFIG.presentation.progressionFeedback)
        this.highlightSeconds = GAME_CONFIG.presentation.regionHighlightSeconds;
    }
    const reward = ambulance.resultTimeRemaining > 0 ? ambulance.lastTrainingReward
      : ride.resultTimeRemaining > 0 ? ride.lastTrainingReward : null;
    if (reward && reward !== this.lastSeenReward) {
      this.lastSeenReward = reward;
      this.lastWorkedRegionId = reward.regionId;
      this.suggestionKey = "";
      if (GAME_CONFIG.presentation.progressionFeedback) {
        this.highlightedRegionId = reward.regionId;
        this.highlightSeconds = GAME_CONFIG.presentation.regionHighlightSeconds;
        this.lastPhoneHtml = "";
      }
    }
    setClass(this.aiIncomeValue, "income-reward", this.highlightSeconds > 0 && GAME_CONFIG.presentation.progressionFeedback);
  }

  private trainingRewardHtml(reward: TrainingReward | null): string {
    if (!reward || !GAME_CONFIG.presentation.progressionFeedback) return "";
    if (this.rewardHtmlReceipt === reward) return this.rewardHtmlCache;
    this.rewardHtmlReceipt = reward;
    const gain = Math.round((reward.incomeAfter - reward.incomeBefore) * 1_000_000) / 1_000_000;
    const label = reward.categoryId === "taxi" ? "Taxi" : "Ambulance";
    const complete = reward.after === reward.required;
    const amount = gain.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    this.rewardHtmlCache = `<div class="training-reward" role="status" style="--progress-from:${reward.before / reward.required};--progress-to:${reward.after / reward.required};--progress-duration:${GAME_CONFIG.presentation.progressAnimationMs}ms">
      <div class="training-reward-label">${label} · Region ${this.regionNumber(reward.regionId)} <span>${reward.before}/${reward.required} → ${reward.after}/${reward.required}</span></div>
      <div class="training-reward-track"><span></span></div>
      <div class="training-reward-income">${gain > 0 ? `<strong>AI income +$${amount}/sec</strong>` : ""}${complete ? '<span class="automated-badge">Automated ✓</span>' : ""}</div>
    </div>`;
    return this.rewardHtmlCache;
  }

  private renderActivityResult(ride: RideManager, ambulanceDriver: AmbulanceDriverManager): void {
    if (this.raceSnapshot && this.raceSnapshot.state !== "IDLE") {
      setVisible(this.rideResult, false);
      this.lastRideResultHtml = "";
      return;
    }
    if (this.chaseState?.result && this.chaseState.resultSeconds > 0) {
      const result = this.chaseState.result;
      setClass(this.rideResult, "passenger-result", false);
      setVisible(this.rideResult, true);
      const labels = {won: "SUSPECT DISABLED", destroyed: "POLICE CAR DISABLED", escaped: "SUSPECT ESCAPED", reset: "PURSUIT ENDED"};
      this.setHtml(this.rideResult, "lastRideResultHtml", `<div class="ride-result-title">${labels[result.outcome]}</div>
        ${result.passiveIncomeGain > 0 ? `<div class="training-reward-income"><strong>+$${formatIncomeRate(result.passiveIncomeGain)}/sec AI income</strong></div>` : ""}`);
      return;
    }
    if (ambulanceDriver.lastResult && ambulanceDriver.resultTimeRemaining > 0) {
      const result = ambulanceDriver.lastResult;
      setClass(this.rideResult,"passenger-result",false);
      setVisible(this.rideResult,true);
      this.setHtml(this.rideResult, "lastRideResultHtml", `
        <div class="ride-result-title">PATIENT DELIVERED</div>
        <div class="patient-payout">${this.money(result.payout)}</div>
        ${result.curbside && GAME_CONFIG.presentation.progressionFeedback
          ? `<div class="training-reward-income"><strong>+$${formatIncomeRate(result.passiveIncomeGain ?? 0)}/sec AI income</strong></div>`
          : this.trainingRewardHtml(ambulanceDriver.lastTrainingReward)}
      `);
      return;
    }
    if (!ride.lastResult || ride.resultTimeRemaining <= 0) {
      setClass(this.rideResult,"passenger-result",false);
      setVisible(this.rideResult,false);
      this.lastRideResultHtml = "";
      return;
    }
    const result = ride.lastResult;
    setClass(this.rideResult,"passenger-result",true);
    setVisible(this.rideResult,true);
    this.setHtml(this.rideResult, "lastRideResultHtml", `
      <div class="ride-result-stars">${this.stars(result.stars)}</div>
      <div class="ride-result-earnings">
        <span>BASE FARE</span><strong>${this.money(result.baseFare)}</strong>
        <span>TIP</span><strong>${this.money(result.tip)}</strong>
      </div>
      ${ride.lastResult.curbside
        ? (ride.lastResult.passiveIncomeGain ?? 0) > 0 && GAME_CONFIG.presentation.progressionFeedback
          ? `<div class="training-reward-income" role="status"><strong>AI income +$${formatIncomeRate(ride.lastResult.passiveIncomeGain!)}/sec</strong></div>` : ""
        : this.trainingRewardHtml(ride.lastTrainingReward)}
    `);
  }

  private renderRaceOverlays(): void {
    const snapshot = this.raceSnapshot;
    if (snapshot?.state === "COUNTDOWN") {
      setClass(this.raceCountdown, "hidden", false);
      const html = `<div class="race-countdown-label">STREET RACE</div><strong>${snapshot.countdown > 0 ? Math.max(1, Math.ceil(snapshot.countdown)) : "GO!"}</strong>`;
      if (html !== this.lastCountdownHtml) {
        this.lastCountdownHtml = html;
        this.raceCountdown.innerHTML = html;
      }
    } else {
      setClass(this.raceCountdown, "hidden", true);
    }
    const result = this.raceResultData;
    if (snapshot?.state !== "FINISHED" || !result) {
      if (snapshot?.state !== "FINISHED") setClass(this.raceResultOverlay, "hidden", true);
      return;
    }
    const html = `<div class="street-race-result" role="status">
      <div class="race-result-eyebrow">RACE COMPLETE</div>
      <div class="street-race-place">${this.ordinal(result.finishPlace)} <span>/ ${GAME_CONFIG.racing.aiCount + 1}</span></div>
      <div class="street-race-cash">${this.wholeMoney(result.cashEarned)}</div>
      <div class="training-reward-income"><strong>+$${formatIncomeRate(result.passiveIncomeGain)}/sec AI income</strong></div>
    </div>`;
    if (html !== this.lastRaceResultHtml) {
      this.lastRaceResultHtml = html;
      this.raceResultOverlay.innerHTML = html;
    }
    setClass(this.raceResultOverlay, "hidden", false);
  }

  private renderVehicleShop(profile: PlayerProfile, player: PlayerCar): void {
    const stopped = player.getSpeedMph() <= GAME_CONFIG.progression.equipMaxSpeedMph;
    // Compare displayed state before formatting all cards. Fractional income only matters
    // when it crosses a quoted price; never use the changing bank balance as the key.
    const state = JSON.stringify([
      stopped, this.shopFeedback, profile.equippedVehicleId,
      profile.jailFreeCards, profile.vehicleCoupons, profile.freeUpgradeCredits,
      GAME_CONFIG.ride.archetypes.vehicleCouponValue, GAME_CONFIG.ride.mphPerWorldUnitPerSecond,
      VEHICLE_STAT_KEYS.map(stat => profile.upgrades[stat]),
      VEHICLE_CATALOG.map(vehicle => {
        const owned = profile.ownsVehicle(vehicle.id);
        const quote = profile.getVehiclePurchaseQuote(vehicle.id)!;
        return [vehicle.id, owned, quote.price, quote.discount, quote.couponsUsed,
          !owned && profile.money >= quote.price];
      }),
    ]);
    if (state === this.lastVehicleShopState) return;
    this.lastVehicleShopState = state;
    const html = `${this.shopFeedback ? `<div class="phone-feedback shop-feedback">${this.shopFeedback}</div>` : ""}<div class="vehicle-shop-subtitle">UPGRADES APPLY TO EVERY CAR</div>${this.rewardInventory(profile)}<div class="garage-list">${VEHICLE_CATALOG.map(vehicle => this.vehicleCard(vehicle, profile, stopped)).join("")}</div>`;
    if (html === this.lastVehicleShopHtml) return;
    this.lastVehicleShopHtml = html;
    this.vehicleShopContent.innerHTML = html;
  }

  private showShopFeedback(message: string): void {
    this.shopFeedback = message;
    this.lastVehicleShopHtml = "";
    window.setTimeout(() => {
      if (this.shopFeedback !== message) return;
      this.shopFeedback = "";
      this.lastVehicleShopHtml = "";
    }, 2500);
  }

  private raceRoutePreview(route: readonly { x: number; z: number }[]): string {
    if (!this.phoneTown) return "";
    const points = route.map(point => {
      const projected = projectMapPoint(point.x, point.z, this.phoneTown!);
      return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
    }).join(" ");
    return `<div class="race-route-preview" aria-label="Race route preview"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${points}" /></svg></div>`;
  }

  private racingLicenseCost(): number {
    return GAME_CONFIG.racing.licenseCost;
  }

  private regionNumber(regionId: string): string {
    const region = this.phoneTown && this.trainingMapRegions?.find(candidate => candidate.id === regionId);
    const match = region?.label.match(/(\d+)$/);
    if (match) return match[1];
    const block = regionId.match(/^block-(\d+)-(\d+)$/);
    if (block) return String(Number(block[1]) + Number(block[2]) * GAME_CONFIG.world.blocksX + 1);
    return "?";
  }

  private ordinal(value: number): string {
    const suffix = value % 100 >= 11 && value % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[value % 10] ?? "th";
    return `${value}${suffix}`;
  }

  private stars(count: number): string {
    const clamped = Math.max(0, Math.min(5, count));
    return `<span aria-label="${clamped} out of 5 stars">${"★".repeat(clamped)}${"☆".repeat(5 - clamped)}</span>`;
  }

  private statLabel(stat: VehicleStatKey): string {
    if (stat === "topSpeed") return "TOP SPEED";
    return stat.toUpperCase();
  }

  private wholeMoney(value: number): string {
    return `$${Math.round(value).toLocaleString("en-US")}`;
  }

  private money(value: number): string {
    return `$${value.toFixed(2)}`;
  }

  private createDebugProgressionPanel(): HTMLDivElement {
    const panel = document.createElement("div");
    panel.className = "progression-debug";
    panel.innerHTML = `
      <div class="progression-debug-title">PROGRESSION DEBUG</div>
      <div class="progression-debug-row">
        <button type="button" data-debug-action="money">TEMP +$25K</button>
        <button type="button" data-debug-action="reset-money">RESET CASH</button>
      </div>
      <div class="progression-debug-row">
        <button type="button" data-debug-action="unlock">UNLOCK CARS</button>
        <button type="button" data-debug-action="reset-upgrades">RESET UPGRADES</button>
      </div>
      ${GAME_CONFIG.gameplay.racesEnabled ? `<div class="progression-debug-row">
        <button type="button" data-debug-action="unlock-racing">UNLOCK RACING</button>
        <select data-debug="race-region">${Array.from({ length: 36 }, (_, index) => {
          const bx = index % 6, bz = Math.floor(index / 6);
          return `<option value="block-${bx}-${bz}">REGION ${index + 1}</option>`;
        }).join("")}</select>
      </div>
      <div class="progression-debug-row">
        <button type="button" data-debug-action="start-race">START RACE</button>
        <button type="button" data-debug-action="reset-race">RESET BEST</button>
      </div>
      <div class="progression-debug-race hidden" data-debug-race-telemetry></div>` : ""}
      <div class="progression-debug-row">
        <button type="button" data-debug-action="police-vision">POLICE VISION: ON</button>
      </div>
      <div class="progression-debug-row">
        <select data-debug="stat">${VEHICLE_STAT_KEYS.map((stat) => `<option value="${stat}">${this.statLabel(stat)}</option>`).join("")}</select>
        <input data-debug="level" type="number" min="0" max="50" value="10" aria-label="Upgrade level">
        <button type="button" data-debug-action="set-upgrade">SET LEVEL</button>
      </div>
      <div class="progression-debug-row">
        <select data-debug="vehicle">${VEHICLE_CATALOG.map((vehicle) => `<option value="${vehicle.id}">${vehicle.name}</option>`).join("")}</select>
        <button type="button" data-debug-action="equip">EQUIP</button>
        <button type="button" class="danger" data-debug-action="reset">RESET SAVE</button>
      </div>
    `;
    panel.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-debug-action]");
      if (!button) return;
      const action = button.dataset.debugAction;
      if (action === "money") this.actions.debugGiveMoney();
      if (action === "reset-money") this.actions.debugResetMoney();
      if (action === "unlock") this.actions.debugUnlockAllCars();
      if (action === "reset-upgrades") this.actions.debugResetUpgrades();
      if (action === "unlock-racing") this.actions.debugUnlockRacing?.();
      if (action === "start-race") {
        const regionId = panel.querySelector<HTMLSelectElement>('[data-debug="race-region"]')!.value;
        this.actions.startRace?.(regionId);
      }
      if (action === "reset-race") {
        const regionId = panel.querySelector<HTMLSelectElement>('[data-debug="race-region"]')!.value;
        this.actions.debugResetRaceFinish?.(regionId);
        this.lastPhoneHtml = "";
      }
      if (action === "police-vision") {
        const visible = this.actions.debugTogglePoliceVision();
        button.textContent = `POLICE VISION: ${visible ? "ON" : "OFF"}`;
      }
      if (action === "set-upgrade") {
        const stat = panel.querySelector<HTMLSelectElement>('[data-debug="stat"]')!.value as VehicleStatKey;
        const level = Number(panel.querySelector<HTMLInputElement>('[data-debug="level"]')!.value);
        this.actions.debugSetUpgrade(stat, level);
      }
      if (action === "equip") {
        const id = panel.querySelector<HTMLSelectElement>('[data-debug="vehicle"]')!.value;
        this.actions.debugEquipVehicle(id);
      }
      if (action === "reset" && window.confirm("Clear all saved progression and reload?")) {
        this.actions.resetProgression();
      }
      this.lastPhoneHtml = "";
    });
    return panel;
  }

  private setHtml(element: HTMLElement, cacheKey: "lastPhoneHtml" | "lastRideResultHtml", html: string): void {
    if (this[cacheKey] === html) {
      return;
    }
    this[cacheKey] = html;
    if (cacheKey === "lastPhoneHtml") {
      const template = document.createElement("template");
      template.innerHTML = html;
      const sameWorkspace = element.querySelector(".training-workspace") && template.content.querySelector(".training-workspace");
      const focused = document.activeElement as HTMLElement | null;
      const focusCategory = focused?.dataset.trainingCategory ?? focused?.dataset.purchaseLicense;
      const focusRegion = focused?.dataset.trainingRegion;
      if (sameWorkspace) {
        for (const section of template.content.querySelectorAll<HTMLElement>("[data-phone-section]")) {
          const key = section.dataset.phoneSection!;
          const target = element.querySelector<HTMLElement>(`[data-phone-section="${key}"]`);
          if (target && this.phoneSectionHtml.get(key) !== section.innerHTML) target.innerHTML = section.innerHTML;
          this.phoneSectionHtml.set(key, section.innerHTML);
        }
      } else {
        element.replaceChildren(template.content);
        this.phoneSectionHtml.clear();
        for (const section of element.querySelectorAll<HTMLElement>("[data-phone-section]")) {
          this.phoneSectionHtml.set(section.dataset.phoneSection!, section.innerHTML);
        }
      }
      if (focused && !focused.isConnected && (focusCategory || focusRegion)) {
        element.querySelector<HTMLElement>(focusCategory
          ? `[data-training-category="${focusCategory}"]` : `[data-training-region="${focusRegion}"]`)?.focus({ preventScroll: true });
      }
    } else element.innerHTML = html;
    if (cacheKey === "lastPhoneHtml") this.phoneMapMarkers = this.readMapMarkers(element, "training-");
    if (cacheKey === "lastPhoneHtml") this.phoneLiveNodes = [...element.querySelectorAll<HTMLElement>("[data-phone-live]")].sort((a, b) => Number(a.dataset.phoneLive) - Number(b.dataset.phoneLive));
  }
}
