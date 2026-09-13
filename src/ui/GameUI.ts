import { CITY_STYLE } from "../world/CityStyle";
import { TRAINING_CATEGORIES, TRAINING_JOBS_PER_REGION, categoryIncome, type TrainingCategoryId } from "../training/Training";
import { RideHud } from "./RideHud";
import { setText, setVisible, setClass, setStyle } from "./DomUpdates";
import { passengerArchetype } from "../ride/PassengerArchetypes";
import type { RideOfferBoard } from "../ride/RideOfferBoard";
import type { RideManager } from "../ride/RideManager";
import type { PlayerCar } from "../player/PlayerCar";
import type { FuelManager } from "../player/FuelManager";
import type { DamageManager } from "../player/DamageManager";
import type { PoliceManager } from "../police/PoliceManager";
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
  getMissionLicense,
  type MissionLicenseDefinition,
  type MissionLicenseId,
} from "../missions/MissionLicenseCatalog";
import { projectMapHeight, projectMapPoint, projectMapWidth } from "./MapProjection";

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
  debugUnlockRacing?: () => void;
  debugResetRaceFinish?: (regionId: string) => void;
  purchaseRacingLicense?: () => string;
  startRace?: (regionId: string) => boolean;
  retryRace?: () => void;
  continueRace?: () => void;
  abortRace?: () => void;
  openVehicleShop?: () => boolean;
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
  previousBest: number | null;
  bestFinish: number;
  multiplier: number;
  incomeBefore: number;
  incomeAfter: number;
}

interface MapMarkers {
  player: HTMLDivElement;
  pickup: HTMLDivElement;
  dropoff: HTMLDivElement;
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
  private phoneMapMarkers: MapMarkers | null = null;
  private phoneTown: Town | null = null;
  private phoneTab: MissionLicenseId | "training" | "garage" | "upgrades" | "scorecard" = "training";
  private trainingRegionId: string | undefined;
  private trainingCategoryId: TrainingCategoryId | undefined;
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
  private raceCanRetry = true;
  private lastCountdownHtml = "";
  private lastVehicleShopHtml = "";
  private shopFeedback = "";
  private raceFeedback = "";
  private raceFeedbackSeconds = 0;
  private hasFuel = true;

  setTown(town: Town): void {
    this.phoneTown = town;
    this.trainingMapCache = "";
    this.trainingMapRegions = null;
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
    this.raceResultData = result;
    this.pauseRaceAbort.classList.toggle("hidden", !active && snapshot?.state !== "FINISHED");
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
    this.vehicleShopOpen = true;
    this.vehicleShopOverlay.classList.remove("hidden");
  }

  closeVehicleShop(): void {
    this.vehicleShopOpen = false;
    this.vehicleShopOverlay.classList.add("hidden");
    this.lastVehicleShopHtml = "";
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
        <h1>RIDE-SHARE DRIVER</h1>
        <p>Complete jobs. Train your AI replacement. Earn AI income.</p>
        <p>WASD to drive. P opens the app. M opens the map. R resets your car.</p>
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
      const neighbor = this.trainingMapRegions?.find(candidate => candidate.bx === region.bx + delta[0] && candidate.bz === region.bz + delta[1]);
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
      const region = target.closest<HTMLButtonElement>("[data-training-region], [data-training-suggestion]");
      if (region) {
        this.trainingRegionId = region.dataset.trainingRegion ?? region.dataset.trainingSuggestion;
        this.trainingCategoryId = undefined;
        this.lastPhoneHtml = "";
        return;
      }
      const category = target.closest<HTMLButtonElement>("[data-training-category]");
      if (category) {
        this.trainingCategoryId = category.dataset.trainingCategory as TrainingCategoryId;
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
          <button type="button" class="browse-inventory-button">BROWSE INVENTORY</button>
        </div>
      </div>
    `;
    this.repairButton = this.repairOverlay.querySelector(".repair-button")!;
    this.browseInventoryButton = this.repairOverlay.querySelector(".browse-inventory-button")!;
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
      if (target.closest("[data-race-retry]")) this.actions.retryRace?.();
      if (target.closest("[data-race-continue]")) this.actions.continueRace?.();
    });
    this.vehicleShopOverlay = document.createElement("div");
    this.vehicleShopOverlay.className = "vehicle-shop-overlay hidden";
    this.vehicleShopOverlay.innerHTML = `
      <div class="vehicle-shop-panel">
        <div class="vehicle-shop-heading"><div class="vehicle-shop-title">VEHICLE SHOP</div><button type="button" class="phone-close" data-shop-close aria-label="Close vehicle shop">&times;</button></div>
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

    root.append(this.startScreen, this.pauseScreen, this.hud, this.phone, this.map, this.refuelOverlay, this.repairOverlay, this.rideResult,
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
      this.phoneTab = "training";
      this.trainingRegionId = undefined;
      this.trainingCategoryId = undefined;
      this.phoneFeedback = "";
      this.phoneFeedbackSeconds = 0;
      this.lastPhoneHtml = "";
      this.phoneRefreshElapsed = GAME_CONFIG.ride.offerDistanceRefreshSeconds;
    }
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
    this.raceCanRetry = this.hasFuel;
    this.ambulancePursuitBlocked = police.isPursuitActive;
    const speedWarning = !raceSession && ride.isSpeedWarning(speedMph);
    const speedLabel = raceSession ? `${Math.round(speedMph)} MPH` : ride.getSpeedWarningLabel(speedMph);
    const fuelPercent = Math.round(fuel.fuelPercent * 100);
    const damagePercent = Math.round(damage.damagePercent * 100);
    const walletMoney = ride.totalMoney;
    setText(this.moneyValue, `$${ride.totalMoney.toFixed(2)}`);
    setText(this.aiIncomeValue, `AI INCOME: $${profile.passiveIncomePerSecond.toFixed(2)}/sec`);
    setText(this.ridesValue, `RIDES: ${ride.completedRides}`);
    setText(this.speedometer, speedLabel);
    setClass(this.speedometer, "warning", speedWarning);
    setClass(this.fuelMeter, "low", fuel.isLow);
    setText(this.fuelLabel, `GAS ${fuelPercent}%`);
    setStyle(this.fuelFill, "width", `${fuelPercent}%`);
    setClass(this.damageMeter, "damaged", damage.damagePercent > 0);
    setText(this.damageLabel, `DAMAGE ${damagePercent}/100`);
    setStyle(this.damageFill, "width", `${damagePercent}%`);
    const policePercent = Math.round(police.warning.hudProgress * 100);
    const escapePercent = Math.round(police.warning.escapeProgress * 100);
    setClass(this.policeMeter, "hidden", raceSession || (police.warning.hudMode === "idle" && policePercent <= 0));
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
    if (raceSession) {
      this.policeMeter.classList.add("hidden");
      this.refuelOverlay.classList.add("hidden");
      this.repairOverlay.classList.add("hidden");
      this.refuelHeld = false;
      this.repairHeld = false;
    }
    this.updateActivityHud(ride, ambulanceDriver, player);
    setText(this.collisionFlash, this.raceFeedbackSeconds > 0 ? this.raceFeedback : ride.collisionFlashText);
    setClass(this.collisionFlash, "hidden", this.raceFeedbackSeconds <= 0 && !ride.collisionFlashText);

    const raceObjective = raceActive ? this.raceSnapshot?.route[this.raceSnapshot.checkpoint] ?? null : null;
    this.updateIndicator(raceSession ? (raceActive ? objectivePosition ?? (raceObjective ? new Vector3(raceObjective.x, 0, raceObjective.z) : null) : null) : objectivePosition, player);
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
      this.debugRaceTelemetry.textContent = competitors;
      this.debugRaceTelemetry.classList.toggle("hidden", !raceActive && this.raceSnapshot?.state !== "FINISHED");
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
      <div class="phone-panel ${this.phoneTab === "training" && !this.trainingRegionId ? "training-workspace" : ""}">
        <div class="phone-topbar"><button type="button" class="phone-close" data-phone-close aria-label="Close phone" title="Close phone">&times;</button></div>
        <div class="phone-tabs" role="tablist">
          ${this.phoneTabButton("training", "TRAINING")}
          ${this.phoneTabButton("upgrades", "UPGRADES")}
        </div>
        <div class="phone-screen">
          ${this.phoneFeedback ? `<div class="phone-feedback">${this.phoneFeedback}</div>` : ""}
          ${ride.isActive || ambulanceDriver.isActive ? `<button type="button" class="current-job-shortcut" data-current-job
            data-region-id="${ride.activeRide?.training?.regionId ?? ambulanceDriver.activeOffer?.training?.regionId ?? ""}"
            data-category-id="${ride.activeRide?.missionCategoryId ?? "ambulance_driver"}">CURRENT JOB</button>` : ""}
          ${content}
        </div>
        <div class="phone-home-indicator" aria-hidden="true"></div>
      </div>
    `);
    for (let index = 0; index < this.phoneLiveNodes.length; index++) {
      setText(this.phoneLiveNodes[index], this.phoneLiveValues[index] ?? "");
    }
    if (this.phoneMapMarkers && this.phoneTown) this.updateMapMarkers(this.phoneMapMarkers, ride, ambulanceDriver, player, this.phoneTown);
  }

  private phoneLive(value: string): string {
    const index = this.phoneLiveValues.push(value) - 1;
    return `<span data-phone-live="${index}"></span>`;
  }

  private renderTraining(offers: RideOfferBoard, ride: RideManager, packages: AmbulanceDriverManager,
    player: PlayerCar, profile: PlayerProfile): string {
    const region = offers.regions.find(region => region.id === this.trainingRegionId);
    if (!region) {
      const trainingMoney = this.phoneLive(this.money(profile.money));
      const trainingIncome = this.phoneLive(`$${profile.passiveIncomePerSecond.toFixed(2)}/sec`);
      if (this.trainingMapRegions === offers.regions && this.trainingMapRevision === profile.trainingRevision) return this.trainingMapCache;
      this.trainingMapRegions = offers.regions;
      this.trainingMapRevision = profile.trainingRevision;
      const town = this.phoneTown;
      if (!town) return "";
      const counts = new Map(offers.regions.map(region => [region.id,
        TRAINING_CATEGORIES.reduce((sum, category) => sum + profile.getTrainingCount(region.id, category.id), 0)]));
      const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
      const capacity = offers.regions.length * TRAINING_JOBS_PER_REGION;
      const percent = capacity ? Math.round(total / capacity * 1000) / 10 : 0;
      const started = [...counts.values()].filter(count => count > 0).length;
      const automated = [...counts.values()].filter(count => count === TRAINING_JOBS_PER_REGION).length;
      const unfinished = offers.regions.filter(region => counts.get(region.id)! < TRAINING_JOBS_PER_REGION);
      // Prefer work already underway, then a nearby untouched region. This is a
      // cached suggestion, not a per-frame distance search or automatic selection.
      const suggested = [...unfinished].sort((a, b) => counts.get(b.id)! - counts.get(a.id)!
        || Math.hypot(a.x - player.root.position.x, a.z - player.root.position.z)
          - Math.hypot(b.x - player.root.position.x, b.z - player.root.position.z))[0];
      const northernRow = Math.max(...offers.regions.map(region => region.bz));
      const missions = offers.regions.map(region => {
        const point = projectMapPoint(region.x, region.z, town);
        const count = counts.get(region.id)!;
        const blockWidth = region.maxX - region.minX - GAME_CONFIG.world.roadWidth;
        const blockDepth = region.maxZ - region.minZ - GAME_CONFIG.world.roadWidth;
        const state = count === TRAINING_JOBS_PER_REGION ? "automated" : count > 0 ? "in-progress" : "untrained";
        const label = `${region.label}, ${count}/${TRAINING_JOBS_PER_REGION} trained${state === "automated" ? ", automated" : ""}. View jobs.`;
        return `<button type="button" class="training-region ${state}"
          tabindex="${region.bx === 0 && region.bz === northernRow ? 0 : -1}" data-training-region="${region.id}" style="left:${point.x}%;top:${point.y}%;width:${projectMapWidth(blockWidth * .72, town)}%;height:${projectMapHeight(blockDepth * .82, town)}%"
          aria-label="${label}" title="${label}">
          <span class="region-number">${region.label.replace("Region ", "").padStart(2, "0")}${state === "automated" ? '<span class="region-check" aria-hidden="true">✓</span>' : ""}</span>
          <span class="region-count">${count}<span> / ${TRAINING_JOBS_PER_REGION}</span></span>
          ${count > 0 ? `<span class="training-region-progress" data-training-progress="${region.id}" aria-hidden="true"><span style="width:${count / TRAINING_JOBS_PER_REGION * 100}%"></span></span>` : '<span class="region-progress-empty" aria-hidden="true"></span>'}
        </button>`;
      }).join("");
      this.trainingMapCache = `<div class="training-layout">
          <section class="training-map" aria-label="City training regions">
            <div class="training-map-scroll" tabindex="0" aria-label="City map. Scroll horizontally on smaller screens.">${this.mapContents(town, missions, "training-")}</div>
            <p class="training-pan-hint">Swipe or scroll to explore the map</p>
          </section>
          <aside class="training-overview" aria-label="City training progress">
            <div class="training-summary"><div class="training-eyebrow">CITY PROGRESS</div>
              <div class="training-total-row"><div class="training-total">${percent.toFixed(1)}<span>%</span></div>
                ${total === 0 ? '<span class="training-zero-hint">(select a region to view its jobs)</span>' : ""}</div>
              <div class="training-total-track" role="progressbar" aria-label="City training" aria-valuenow="${total}" aria-valuemin="0" aria-valuemax="${capacity}"><span style="width:${capacity ? total / capacity * 100 : 0}%"></span></div>
              <p>${total} of ${capacity} missions trained</p>
              <dl><div><dt>Regions started</dt><dd>${started}<span> / ${offers.regions.length}</span></dd></div>
                <div><dt>Fully automated</dt><dd>${automated}<span> / ${offers.regions.length}</span></dd></div></dl>
            </div>
            <div class="training-next"><div class="training-eyebrow">${suggested ? total ? "PICK UP WHERE YOU LEFT OFF" : "YOUR FIRST STEP" : "NETWORK COMPLETE"}</div>
              <h3>${suggested ? suggested.label : "You're fully trained."}</h3>
              <p>${suggested ? `${counts.get(suggested.id)} of ${TRAINING_JOBS_PER_REGION} missions trained` : "Every region is automated. You can still take paid jobs."}</p>
              ${suggested ? `<button type="button" data-training-suggestion="${suggested.id}">${total ? "Continue training" : "Start training"}<span aria-hidden="true">→</span></button>` : ""}
              <div class="training-finances"><strong>${trainingMoney}</strong><span>AI INCOME ${trainingIncome}</span></div>
            </div>
          </aside>
        </div>`;
      return this.trainingMapCache;
    }
    const back = `<button type="button" class="training-back" data-training-back>← ${this.trainingCategoryId ? region.label : "TRAINING MAP"}</button>`;
    if (this.trainingCategoryId) {
      const category = getMissionLicense(this.trainingCategoryId)!;
      const definition = TRAINING_CATEGORIES.find(item => item.id === this.trainingCategoryId)!;
      const count = profile.getTrainingCount(region.id, definition.id);
      const status = `<div class="training-caption">${region.label.toUpperCase()} · ${count}/${definition.required} TRAINED${count === definition.required ? " · AUTOMATED" : ""}</div>`;
      if (!region.pickups.length) return `${back}${status}<p>No legal pickups available in this region.</p>`;
      return back + status + (category.activityType === "ambulanceDriver"
        ? this.renderAmbulanceDriverTab(packages, ride, player, profile, category, region.id)
        : this.renderMissionTab(offers, ride, packages, player, profile, category, region.id));
    }
    return `${back}<div class="phone-title">${region.label.toUpperCase()}</div><div class="training-categories">
      ${TRAINING_CATEGORIES.map(category => {
        const count = profile.getTrainingCount(region.id, category.id);
        const income = categoryIncome(category.id, count);
        const owned = profile.ownsMissionLicense(category.id);
        const cost = getMissionLicense(category.id)!.unlockCost;
        const action = owned
          ? `<button type="button" data-training-category="${category.id}">VIEW JOBS</button>`
          : `<button type="button" data-purchase-license="${category.id}" ${profile.money < cost ? "disabled" : ""}>Unlock License (${this.wholeMoney(cost)})</button>`;
        return `<div class="training-category"><h3>${category.name}</h3>
          <div class="training-category-progress">${count}/${category.required} TRAINED ${count === category.required ? "· AUTOMATED" : ""}</div>
          <div class="training-rate">+$${income.toFixed(2)}/sec</div>
          ${action}</div>`;
      }).join("")}</div>${this.renderRacingCard(region, ride, packages, profile)}`;
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

  private renderUpgrades(profile: PlayerProfile): string {
    return `
      <div class="phone-title">PERMANENT UPGRADES</div>
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
    this.updateMapMarkers(this.mapMarkers!, ride, ambulanceDriver, player, town);
  }

  private updateMapMarkers(markers: MapMarkers, ride: RideManager, ambulanceDriver: AmbulanceDriverManager,
    player: PlayerCar, town: Town): void {
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
  }

  private readMapMarkers(root: HTMLElement, prefix = ""): MapMarkers | null {
    const player = root.querySelector<HTMLDivElement>(`[data-map="${prefix}player"]`);
    if (!player) return null;
    return { player,
      pickup: root.querySelector(`[data-map="${prefix}pickup"]`)!,
      dropoff: root.querySelector(`[data-map="${prefix}dropoff"]`)!,
    };
  }

  private buildMap(town: Town): void {
    this.map.innerHTML = `<div class="map-panel"><div class="map-title">MAP</div>
      ${this.mapContents(town)}<div class="phone-close-hint">M TO CLOSE · ESC TO PAUSE</div></div>`;
    this.mapTown = town;
    this.mapMarkers = this.readMapMarkers(this.map);
  }

  private mapContents(town: Town, missions = "", prefix = ""): string {
    const roadWidth = projectMapWidth(GAME_CONFIG.world.roadWidth, town);
    const roadHeight = projectMapHeight(GAME_CONFIG.world.roadWidth, town);
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
      return `<div class="map-marker gas" style="left:${point.x}%;top:${point.y}%" role="img" aria-label="Gas station" title="Gas station">G</div>`;
    }).join("");
    const repairMarkers = town.autoBodyShops.map((shop) => {
      const point = projectMapPoint(shop.position.x, shop.position.z, town);
      return `<div class="map-marker repair" style="left:${point.x}%;top:${point.y}%" role="img" aria-label="Auto repair" title="Auto repair">A</div>`;
    }).join("");
    // Scale with the road so marker edges stay on the actual curb side even in a narrow map.
    const objectiveMarkerWidth = projectMapWidth(GAME_CONFIG.world.roadWidth * 0.5, town);
    const objectiveMarkerHeight = projectMapHeight(GAME_CONFIG.world.roadWidth * 0.5, town);

    return `<div class="map-canvas" style="--map-road-color:${CITY_STYLE.palette.road};aspect-ratio:${town.maxX - town.minX}/${town.maxZ - town.minZ};--objective-marker-width:${objectiveMarkerWidth}%;--objective-marker-height:${objectiveMarkerHeight}%;--mission-marker-width:${projectMapWidth(130, town)}%;--mission-marker-height:${projectMapHeight(130, town)}%;--service-marker-width:${projectMapWidth(140, town)}%;--service-marker-height:${projectMapHeight(140, town)}%">
          ${roads}${gasMarkers}${repairMarkers}${missions}
          <div class="map-marker pickup hidden" data-map="${prefix}pickup" role="img" aria-label="Pickup" title="Pickup"></div>
          <div class="map-marker dropoff hidden" data-map="${prefix}dropoff" role="img" aria-label="Dropoff" title="Dropoff"></div>
          <div class="map-player" data-map="${prefix}player">▲</div>
        </div>`;
  }

  private updateObjectiveMapMarker(
    marker: HTMLDivElement,
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
          ${this.offerMetric("BASE FARE", this.money(offer.baseFare))}
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
      const html = `<div class="race-hud-line"><strong>REGION ${this.regionNumber(snapshot.regionId)}</strong><span>${stateLabel}</span></div>
        <div class="race-hud-line"><strong>POSITION ${Math.max(1, snapshot.position)} / ${GAME_CONFIG.racing.aiCount + 1}</strong><span>CHECKPOINT ${Math.min(snapshot.checkpoint + 1, snapshot.checkpointCount)} / ${snapshot.checkpointCount}</span></div>`;
      if (html !== this.lastRaceHudHtml) {
        this.lastRaceHudHtml = html;
        this.raceHud.innerHTML = html;
      }
      return;
    }
    if (ambulanceDriver.activeOffer) {
      const objective = ambulanceDriver.state === AmbulanceDriverState.DrivingToPickup ? "COLLECT PATIENT" : "RETURN TO CLINIC";
      this.rideHudView.update({objective:`AMBULANCE · ${objective}`,
        packagePayout:`PAYOUT: ${this.money(ambulanceDriver.currentPayout)}`,
        packageRate:`RATE: ${this.money(ambulanceDriver.currentRatePerMeter)} / M`,
        arrival:ambulanceDriver.isWaitingForArrivalSpeed()
          ? `SLOW BELOW ${GAME_CONFIG.ride.maximumArrivalSpeedMph} MPH` : undefined});
      return;
    }
    if (!ride.activeRide) {
      this.rideHudView.update({objective:"PRESS P FOR RIDES"});
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

  private renderActivityResult(ride: RideManager, ambulanceDriver: AmbulanceDriverManager): void {
    if (this.raceSnapshot && this.raceSnapshot.state !== "IDLE") {
      setVisible(this.rideResult, false);
      this.lastRideResultHtml = "";
      return;
    }
    if (ambulanceDriver.lastResult && ambulanceDriver.resultTimeRemaining > 0) {
      const result = ambulanceDriver.lastResult;
      setClass(this.rideResult,"passenger-result",false);
      setVisible(this.rideResult,true);
      this.setHtml(this.rideResult, "lastRideResultHtml", `
        <div class="ride-result-title">PATIENT DELIVERED</div>
        <div>${Math.round(result.tripDistance)} m to clinic in ${this.duration(result.durationSeconds)}</div>
        <div>Starting Payout ${this.money(result.initialPayout)}</div>
        <div>Total ${this.money(result.payout)}</div>
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
    `);
  }

  private renderRaceOverlays(): void {
    const snapshot = this.raceSnapshot;
    if (snapshot?.state === "COUNTDOWN") {
      this.raceCountdown.classList.remove("hidden");
      const html = `<div class="race-countdown-label">REGION ${this.regionNumber(snapshot.regionId)} RACE</div><strong>${snapshot.countdown > 0 ? Math.max(1, Math.ceil(snapshot.countdown)) : "GO!"}</strong>`;
      if (html !== this.lastCountdownHtml) {
        this.lastCountdownHtml = html;
        this.raceCountdown.innerHTML = html;
      }
    } else {
      this.raceCountdown.classList.add("hidden");
    }
    const result = this.raceResultData;
    if (snapshot?.state !== "FINISHED" || !result) {
      if (snapshot?.state !== "FINISHED") this.raceResultOverlay.classList.add("hidden");
      return;
    }
    const improved = result.previousBest === null || result.bestFinish < result.previousBest;
    const previous = result.previousBest === null ? "UNRANKED" : `${this.ordinal(result.previousBest)} PLACE`;
    const html = `<div class="race-result-panel">
      <div class="race-result-eyebrow">RACE COMPLETE</div><h2>REGION ${this.regionNumber(result.regionId)}</h2>
      <div class="race-finish-label">FINISH</div><div class="race-finish">${this.ordinal(result.finishPlace)} / ${GAME_CONFIG.racing.aiCount + 1}</div>
      <div class="race-result-grid"><div><span>PREVIOUS BEST</span><strong>${previous}</strong></div><div><span>${improved ? "NEW REGIONAL MULTIPLIER" : "BEST RESULT REMAINS"}</span><strong>×${result.multiplier.toFixed(2)}</strong></div><div><span>REGIONAL AI INCOME</span><strong>$${result.incomeBefore.toFixed(2)} → $${result.incomeAfter.toFixed(2)}/sec</strong></div></div>
      <div class="race-result-actions"><button type="button" data-race-retry ${this.raceCanRetry ? "" : "disabled"}>${this.raceCanRetry ? "RETRY" : "REFUEL TO RETRY"}</button><button type="button" data-race-continue>CONTINUE</button></div>
    </div>`;
    if (html !== this.lastRaceResultHtml) {
      this.lastRaceResultHtml = html;
      this.raceResultOverlay.innerHTML = html;
    }
    this.raceResultOverlay.classList.remove("hidden");
  }

  private renderVehicleShop(profile: PlayerProfile, player: PlayerCar): void {
    const stopped = player.getSpeedMph() <= GAME_CONFIG.progression.equipMaxSpeedMph;
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
      <div class="progression-debug-row">
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
      <div class="progression-debug-race hidden" data-debug-race-telemetry></div>
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
    element.innerHTML = html;
    if (cacheKey === "lastPhoneHtml") this.phoneMapMarkers = this.readMapMarkers(element, "training-");
    if (cacheKey === "lastPhoneHtml") this.phoneLiveNodes = [...element.querySelectorAll<HTMLElement>("[data-phone-live]")].sort((a, b) => Number(a.dataset.phoneLive) - Number(b.dataset.phoneLive));
  }
}
