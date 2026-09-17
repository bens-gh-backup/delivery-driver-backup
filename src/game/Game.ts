import { isInServiceArea } from "../world/ServiceAreas";
import { createTrainingRegions, TrainingIncomeClock } from "../training/Training";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { hasEnhancedGraphics, resolveGraphicsMode, setSceneGraphicsMode } from "../graphics/GraphicsMode";
import { PassengerTurnTracker } from "../player/PassengerTurnTracker";
import { PassengerDrivingEvents } from "../player/PassengerDrivingEvents";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Loading/loadingScreen";
import { GAME_CONFIG } from "./config";
import { GameState, PassengerType, RideState, type PoliceCitation } from "./types";
import { TownGenerator, type Town } from "../world/Town";
import { CITY_STYLE } from "../world/CityStyle";
import { PlayerCar } from "../player/PlayerCar";
import { ChaseCamera } from "../player/ChaseCamera";
import { Input } from "../player/Input";
import { TrafficManager } from "../traffic/TrafficManager";
import { GameUI, type UiRaceResult } from "../ui/GameUI";
import { RaceManager } from "../racing/RaceManager";
import { RideOfferBoard } from "../ride/RideOfferBoard";
import { RideManager } from "../ride/RideManager";
import { FuelManager } from "../player/FuelManager";
import { DamageManager } from "../player/DamageManager";
import { PerformanceMonitor } from "./PerformanceMonitor";
import { WorldQuery } from "../world/WorldQuery";
import { PlayerProfile } from "../player/PlayerProfile";
import { ActivityManager } from "../activity/ActivityManager";
import { DrivingBehaviorManager } from "../player/DrivingBehaviorManager";
import { lerp, normalizeAngle } from "../utils/math";
import { applyPermanentUpgrades, VEHICLE_STAT_KEYS } from "../progression/UpgradeSystem";
import { AMBULANCE_VEHICLE, STARTER_VEHICLE, getVehicleDefinition } from "../vehicles/VehicleCatalog";
import type { VehicleStatKey } from "../vehicles/VehicleTypes";
import { getMissionLicense, type MissionLicenseId } from "../missions/MissionLicenseCatalog";
import { PoliceManager } from "../police/PoliceManager";
import type { PolicePursuitTarget } from "../police/PoliceManager";
import { policeInputForAmbulance } from "../police/EmergencyPrivileges";
import { AmbulanceDriverManager } from "../delivery/AmbulanceDriverManager";

export class Game {
  private readonly incomeClock = new TrainingIncomeClock();
  private racing: RaceManager | null = null;
  private raceResult: UiRaceResult | null = null;
  private raceReturnPose: { x: number; z: number; heading: number } | null = null;
  private raceStartPose: { x: number; z: number; heading: number } | null = null;
  private scene: Scene;
  private state = GameState.Start;
  private town: Town | null = null;
  private player: PlayerCar | null = null;
  private chaseCamera: ChaseCamera | null = null;
  private input: Input | null = null;
  private rideOffers: RideOfferBoard | null = null;
  private ride: RideManager | null = null;
  private fuel: FuelManager | null = null;
  private damage: DamageManager | null = null;
  private traffic: TrafficManager | null = null;
  private police: PoliceManager | null = null;
  private ambulanceDriver: AmbulanceDriverManager | null = null;
  private profile: PlayerProfile | null = null;
  private activity: ActivityManager | null = null;
  private drivingBehavior: DrivingBehaviorManager | null = null;
  private worldQuery: WorldQuery | null = null;
  private readonly passengerTurnTracker = new PassengerTurnTracker();
  private passengerDrivingEvents: PassengerDrivingEvents | null = null;
  private physicsAccumulator = 0;
  private readonly previousPlayerPosition = Vector3.Zero();
  private readonly currentPlayerPosition = Vector3.Zero();
  private readonly renderPlayerPosition = Vector3.Zero();
  private previousPlayerHeading = 0;
  private currentPlayerHeading = 0;
  private readonly ui: GameUI;
  private readonly performanceMonitor: PerformanceMonitor;

  constructor(
    private readonly engine: Engine,
    private readonly canvas: HTMLCanvasElement,
    uiRoot: HTMLDivElement,
  ) {
    const startupStarted = performance.now();
    this.scene = this.createScene();
    this.ui = new GameUI(uiRoot, {
      start: () => this.startShift(),
      acceptRide: (categoryId, id, regionId) => this.acceptRide(categoryId, id, regionId),
      acceptAmbulanceDriver: (id, regionId) => this.acceptAmbulanceDriver(id, regionId),
      purchaseMissionLicense: (id) => this.purchaseMissionLicense(id),
      purchaseVehicle: (id) => this.purchaseVehicle(id),
      equipVehicle: (id) => this.equipVehicle(id),
      purchaseUpgrade: (stat) => this.purchaseUpgrade(stat),
      acknowledgeCitation: () => this.acknowledgeCitation(),
      debugGiveMoney: () => this.profile?.addTemporaryDebugMoney(25000),
      debugResetMoney: () => this.profile?.resetMoneyToStartingAmount(),
      debugUnlockAllCars: () => this.profile?.unlockAllVehicles(),
      debugResetUpgrades: () => this.debugResetUpgrades(),
      debugSetUpgrade: (stat, level) => this.debugSetUpgrade(stat, level),
      debugEquipVehicle: (id) => this.debugEquipVehicle(id),
      debugTogglePoliceVision: () => this.police?.toggleDebugVision() ?? false,
      resetProgression: () => this.resetProgression(),
      purchaseRacingLicense: () => this.purchaseRacingLicense(),
      startRace: (regionId) => this.startRace(regionId),
      retryRace: () => this.retryRace(),
      continueRace: () => this.endRace(false),
      abortRace: () => this.endRace(true),
      openVehicleShop: () => this.openVehicleShop(),
      canUseVehicleShop: () => this.canUseVehicleShop(),
      debugUnlockRacing: () => this.profile?.debugUnlockRacing(),
      debugResetRaceFinish: (regionId: string) => this.profile?.debugResetRaceFinish(regionId),
    });
    this.performanceMonitor = new PerformanceMonitor(engine, this.scene, uiRoot);
    this.buildSimulation();
    this.ui.showStart();
    document.addEventListener("visibilitychange", () => {
      this.incomeClock.reset();
      if (document.hidden) this.profile?.saveNow();
    });
    this.performanceMonitor.setStartupMilliseconds(performance.now() - startupStarted);
  }

  startRenderLoop(): void {
    this.engine.runRenderLoop(() => {
      const deltaTime = Math.min(0.05, this.engine.getDeltaTime() / 1000);
      this.performanceMonitor.beginUpdate();
      const wasPlaying = this.state === GameState.Playing;
      this.update(deltaTime);
      const seconds = this.incomeClock.tick(performance.now(), wasPlaying && this.state === GameState.Playing && !document.hidden);
      this.profile?.accrueTrainingIncome(seconds);
      this.performanceMonitor.endUpdate();
      this.performanceMonitor.beginRender();
      this.scene.render();
      this.performanceMonitor.endRender();
      this.performanceMonitor.afterRender(
        (this.traffic?.activeCarCount ?? 0) + (this.racing?.isActive ? GAME_CONFIG.racing.aiCount : 0),
        (this.worldQuery?.lastCollisionCandidateCount ?? 0) + (this.traffic?.lastCollisionCandidateCount ?? 0),
        this.drivingBehavior,
      );
    });
  }

  private startShift(): void {
    this.state = GameState.Playing;
    this.physicsAccumulator = 0;
    this.ui.showPlaying();
    this.canvas.focus();
  }

  private restart(): void {
    this.disposeSimulation();
    this.scene.dispose();
    this.scene = this.createScene();
    this.performanceMonitor.attachScene(this.scene);
    this.state = GameState.Playing;
    this.buildSimulation();
    this.ui.showPlaying();
    this.canvas.focus();
  }

  private update(deltaTime: number): void {
    if (!this.player || !this.input || !this.rideOffers || !this.ride || !this.ambulanceDriver || !this.fuel || !this.damage || !this.traffic || !this.police || !this.chaseCamera || !this.town || !this.activity || !this.profile || !this.drivingBehavior) {
      if (this.chaseCamera) {
        this.chaseCamera.update(deltaTime);
      }
      return;
    }

    if (this.input.consumeEscape()) {
      if (this.ui.isVehicleShopOpen) {
        this.ui.closeShop();
        this.input.resetDrivingState();
        this.canvas.focus();
        return;
      }
      if (this.state === GameState.Paused) {
        this.state = GameState.Playing;
        this.physicsAccumulator = 0;
        this.ui.showPlaying();
      } else if (this.state === GameState.Playing) {
        this.state = GameState.Paused;
        this.physicsAccumulator = 0;
        this.input.resetDrivingState();
        this.ui.closePhone();
        this.ui.showPaused(this.profile);
      }
    }

    if (this.state !== GameState.Playing) {
      return;
    }

    if (this.input.consumePhoneToggle() && !this.racing?.isActive && !this.ui.isVehicleShopOpen) {
      this.ui.togglePhone();
    }
    if (this.input.consumeMapToggle() && !this.ui.isVehicleShopOpen && this.racing?.state !== "COUNTDOWN"
      && this.racing?.state !== "FINISHED") {
      this.ui.toggleMap();
    }
    if (this.racing?.isActive) {
      this.updateRace(deltaTime);
      return;
    }
    if (this.ui.isVehicleShopOpen) {
      this.physicsAccumulator = 0;
      this.input.resetDrivingState();
      this.profile.updateAutosave(deltaTime);
      this.updateRaceUi(deltaTime);
      return;
    }

    let citationIssued = false;
    if (this.worldQuery) {
      const fixedStep = GAME_CONFIG.simulation.fixedStepSeconds;
      this.restorePlayerPhysicsPose();
      this.physicsAccumulator = Math.min(
        this.physicsAccumulator + deltaTime,
        fixedStep * GAME_CONFIG.simulation.maxSubSteps,
      );
      let trafficCollisionMph = 0;
      while (this.physicsAccumulator >= fixedStep) {
        this.previousPlayerPosition.copyFrom(this.currentPlayerPosition);
        this.previousPlayerHeading = this.currentPlayerHeading;
        const resetGeneration = this.player.resetGeneration;
        this.player.update(fixedStep, this.input, this.worldQuery, this.fuel.hasFuel, this.damage.damagePercent);
        if (this.player.resetGeneration !== resetGeneration) {
          this.passengerDrivingEvents?.reset(this.player.root.position);
          this.passengerTurnTracker.reset(this.player.root.position, this.player.heading);
        }
        this.drivingBehavior.update(fixedStep, this.player, this.worldQuery);
        const collision = this.traffic.update(fixedStep, this.player);
        // Arrest checks must see damage from this collision in the same physics step.
        if (collision.damagePercent > 0) this.damage.applyDamage(collision.damagePercent);
        if (this.ride.hasOnboardTrait(PassengerType.Lawful)
          || this.ride.hasOnboardTrait(PassengerType.Careful)
          || this.ride.hasOnboardTrait(PassengerType.ThrillSeeker)) {
          const events = this.passengerDrivingEvents?.update(
            this.player.root.position, (direction) => this.traffic!.trafficSignals.aspectFor(direction),
          );
          if(events) for (const event of events) this.ride.registerDrivingEvent(event);
        }
        if (this.ride.hasOnboardTrait(PassengerType.Compulsive)
          && this.passengerTurnTracker.update(this.player.root.position, this.player.heading)) this.ride.registerForbiddenTurn();
        this.ride.registerPursuit(this.police.isPursuitActive);
        const policeTarget = this.policeTargetSnapshot();
        if (collision.policeCollisionOfficerId !== null) {
          this.police.registerPoliceCollision(
            collision.policeCollisionOfficerId,
            policeTarget,
            collision.policeCollisionSeverity,
          );
        }
        const {rates,severity} = policeInputForAmbulance(
          this.drivingBehavior.rates,this.drivingBehavior.current,this.ambulanceDriver.isActive,
        );
        const citation = this.police.update(
          fixedStep,
          policeTarget,
          rates,
          severity,
          this.profile,
        );
        if (!citation && collision.collisionViolationSeverity > 0) {
          this.police.registerTrafficCollision(
            policeTarget,
            collision.collisionViolationSeverity,
          );
        }
        for (const event of this.police.drainRideEvents()) this.ride.registerPoliceEvent(event);
        this.ride.registerPursuit(this.police.isPursuitActive || citation !== null);
        trafficCollisionMph = Math.max(trafficCollisionMph, collision.ridePenaltyMph);
        this.currentPlayerPosition.copyFrom(this.player.root.position);
        this.currentPlayerHeading = this.player.heading;
        this.physicsAccumulator -= fixedStep;
        if (citation) {
          if (this.ambulanceDriver.endForArrest()) this.restorePersonalVehicle();
          this.profile.settlePoliceCitation(citation, this.ride.hasOnboardTrait(PassengerType.Lawyer));
          this.activity.update();
          this.beginCitation(citation);
          citationIssued = true;
          break;
        }
      }
      this.ride.registerTrafficCollision(trafficCollisionMph);
    }
    if (citationIssued) {
      this.physicsAccumulator = 0;
      this.previousPlayerPosition.copyFrom(this.currentPlayerPosition);
      this.previousPlayerHeading = this.currentPlayerHeading;
      this.performanceMonitor.beginUiUpdate();
      this.ui.update(
        this.rideOffers,
        this.ride,
        this.ambulanceDriver,
        this.player,
        this.fuel,
        this.damage,
        this.police,
        this.profile,
        this.town,
        this.activity.getObjectivePosition(),
        0,
      );
      this.performanceMonitor.endUiUpdate();
      return;
    }
    this.rideOffers.update(
      deltaTime,
      !this.activity.hasActiveActivity,
      this.profile.ownedMissionLicenseIds,
    );
    this.fuel.update(deltaTime, this.player, this.town.gasStations, this.profile, this.ui.isRefuelHeld);
    this.damage.update(
      deltaTime, this.player, this.town.autoBodyShops, this.profile, this.ui.isRepairHeld,
      this.ride.hasOnboardTrait(PassengerType.Mechanic),
    );
    this.ride.registerVehicleCondition(this.fuel.fuelPercent, this.damage.damagePercent);
    this.ride.registerMechanicRepair(this.damage.lastRepairAmount);
    this.ride.registerStationStop(this.fuel.canUsePump);
    this.ride.registerPursuit(this.police.isPursuitActive);
    const previousRideState = this.ride.state;
    this.ride.update(deltaTime, this.player, true, this.drivingBehavior.totals.total);
    if (previousRideState !== this.ride.state) {
      this.passengerDrivingEvents?.reset(this.player.root.position);
      this.passengerTurnTracker.reset(this.player.root.position, this.player.heading);
      // A pursuit already active at pickup counts for Shady too.
      if (this.ride.state === RideState.PassengerOnboard) this.ride.registerPursuit(this.police.isPursuitActive);
    }
    const ambulanceWasActive = this.ambulanceDriver.isActive;
    this.ambulanceDriver.update(deltaTime);
    if (ambulanceWasActive && !this.ambulanceDriver.isActive) this.restorePersonalVehicle();
    this.activity.update();
    this.profile.updateAutosave(deltaTime);
    if (this.worldQuery) {
      this.applyInterpolatedPlayerPose(this.physicsAccumulator / GAME_CONFIG.simulation.fixedStepSeconds);
    }
    this.chaseCamera.update(deltaTime);
    this.performanceMonitor.beginUiUpdate();
    this.ui.update(
      this.rideOffers,
      this.ride,
      this.ambulanceDriver,
      this.player,
      this.fuel,
      this.damage,
      this.police,
      this.profile,
      this.town,
      this.activity.getObjectivePosition(),
      deltaTime,
    );
    this.performanceMonitor.endUiUpdate();
  }

  private buildSimulation(): void {
    this.town = new TownGenerator(this.scene).generate();
    this.ui.setTown(this.town);
    this.worldQuery = new WorldQuery(
      this.town.staticColliders,
      this.town.roads,
      GAME_CONFIG.world.roadWidth / 2,
      GAME_CONFIG.world.roadWidth / 2 + GAME_CONFIG.world.sidewalkWidth,
      GAME_CONFIG.world.spatialCellSize,
      this.town.legalDrivingAreas,
    );
    this.input = new Input();
    this.profile = new PlayerProfile();
    const regions = createTrainingRegions(this.town);
    this.profile.configureTrainingRegions(regions);
    this.incomeClock.reset();
    const equippedVehicle = getVehicleDefinition(this.profile.equippedVehicleId) ?? STARTER_VEHICLE;
    this.player = new PlayerCar(
      this.scene,
      this.town.roadSpawnPoints,
      equippedVehicle,
      applyPermanentUpgrades(equippedVehicle.stats, this.profile.upgrades),
    );
    this.capturePlayerPhysicsPose();
    this.chaseCamera = new ChaseCamera(this.scene, this.player);
    this.scene.activeCamera = this.chaseCamera.camera;
    this.rideOffers = new RideOfferBoard(this.town.deliveryPoints, this.player, regions);

    this.damage = new DamageManager();
    this.ride = new RideManager(this.scene, this.rideOffers, this.profile);
    this.ambulanceDriver = new AmbulanceDriverManager(
      this.scene,
      this.town.deliveryPoints,
      this.player,
      this.profile,
      regions,
      this.town.clinics,
    );
    this.activity = new ActivityManager();
    this.racing = new RaceManager(this.scene, this.town);
    this.ui.setRaceCourses(this.racing.courses);
    this.drivingBehavior = new DrivingBehaviorManager();
    this.passengerDrivingEvents = new PassengerDrivingEvents(this.town.roadPositionsX, this.town.roadPositionsZ);
    this.fuel = new FuelManager();
    this.traffic = new TrafficManager(this.scene, this.town.roadSpawnPoints, this.town.roadPositionsX, this.town.roadPositionsZ);
    const debugVision = new URLSearchParams(window.location.search).has("debug");
    this.police = new PoliceManager(this.traffic.policeCars, this.scene, debugVision);
  }

  private disposeSimulation(): void {
    this.racing?.dispose();
    this.racing = null;
    this.raceResult = null;
    this.raceReturnPose = null;
    this.raceStartPose = null;
    this.ui.setRaceState(null, null);
    this.ui.closeShop();
    this.input?.dispose();
    this.ride?.dispose();
    this.ambulanceDriver?.dispose();
    this.police?.dispose();
    this.traffic?.dispose();
    this.profile?.dispose();
    this.input = null;
    this.rideOffers = null;
    this.ride = null;
    this.ambulanceDriver = null;
    this.profile = null;
    this.activity = null;
    this.drivingBehavior = null;
    this.passengerDrivingEvents = null;
    this.fuel = null;
    this.damage = null;
    this.traffic = null;
    this.police = null;
    this.worldQuery = null;
    this.physicsAccumulator = 0;
    this.player = null;
    this.chaseCamera = null;
    this.town = null;
  }

  private acceptRide(categoryId: MissionLicenseId, id: string, regionId?: string): boolean {
    if (
      this.state !== GameState.Playing
      || !this.ride
      || !this.activity
      || !this.profile?.ownsMissionLicense(categoryId)
    ) {
      return false;
    }
    return this.activity.start(this.ride, () => this.ride!.acceptRide(categoryId, id, regionId));
  }

  private acceptAmbulanceDriver(id: string, regionId?: string): boolean {
    if (
      this.state !== GameState.Playing
      || !this.ambulanceDriver
      || !this.activity
      || !this.profile?.ownsMissionLicense("ambulance_driver")
      || this.police?.isPursuitActive
    ) {
      return false;
    }
    const accepted = this.activity.start(this.ambulanceDriver, () => this.ambulanceDriver!.acceptOffer(id, regionId));
    if (accepted) {
      this.player!.equipVehicle(AMBULANCE_VEHICLE, AMBULANCE_VEHICLE.stats, true);
      this.capturePlayerPhysicsPose();
    }
    return accepted;
  }

  private purchaseMissionLicense(id: MissionLicenseId): string {
    if (!this.profile || !this.rideOffers) return "LICENSES UNAVAILABLE";
    const license = getMissionLicense(id);
    if (!license) return "LICENSE NOT FOUND";
    if (this.profile.ownsMissionLicense(id)) return "LICENSE ALREADY OWNED";
    if (this.profile.money < license.unlockCost) return "INSUFFICIENT FUNDS";
    if (!this.profile.purchaseMissionLicense(id)) return "PURCHASE FAILED";

    return `${license.name.toUpperCase()} LICENSE UNLOCKED`;
  }

  private purchaseVehicle(id: string): string {
    if (!this.profile || !this.player) return "GARAGE UNAVAILABLE";
    if (!this.canUseVehicleShop()) return "STOP AT A DEALERSHIP WITHOUT AN ACTIVE JOB";
    if (this.ambulanceDriver?.isActive) return "FINISH AMBULANCE JOB FIRST";
    const vehicle = getVehicleDefinition(id);
    if (!vehicle) return "VEHICLE NOT FOUND";
    if (this.profile.ownsVehicle(id)) return "ALREADY OWNED";
    if (this.profile.money < this.profile.getVehiclePurchaseQuote(id)!.price) return "INSUFFICIENT FUNDS";
    const stopped = this.player.getSpeedMph() <= GAME_CONFIG.progression.equipMaxSpeedMph;
    if (!this.profile.purchaseVehicle(id, stopped)) return "PURCHASE FAILED";
    if (stopped) {
      this.player.equipVehicle(vehicle, applyPermanentUpgrades(vehicle.stats, this.profile.upgrades));
      this.capturePlayerPhysicsPose();
      return `${vehicle.name.toUpperCase()} PURCHASED AND EQUIPPED`;
    }
    return `${vehicle.name.toUpperCase()} PURCHASED - STOP TO EQUIP`;
  }

  private equipVehicle(id: string): string {
    if (!this.profile || !this.player) return "GARAGE UNAVAILABLE";
    if (!this.canUseVehicleShop()) return "STOP AT A DEALERSHIP WITHOUT AN ACTIVE JOB";
    if (this.ambulanceDriver?.isActive) return "FINISH AMBULANCE JOB FIRST";
    const vehicle = getVehicleDefinition(id);
    if (!vehicle || !this.profile.ownsVehicle(id)) return "VEHICLE NOT OWNED";
    if (this.player.getSpeedMph() > GAME_CONFIG.progression.equipMaxSpeedMph) return "STOP TO EQUIP";
    if (!this.profile.equipVehicle(id)) return "EQUIP FAILED";
    this.player.equipVehicle(vehicle, applyPermanentUpgrades(vehicle.stats, this.profile.upgrades));
    this.capturePlayerPhysicsPose();
    return `${vehicle.name.toUpperCase()} EQUIPPED`;
  }

  private purchaseUpgrade(stat: VehicleStatKey): string {
    if (!this.profile || !this.player || !VEHICLE_STAT_KEYS.includes(stat)) return "UPGRADE UNAVAILABLE";
    if (this.racing?.isActive) return "FINISH RACE FIRST";
    const currentLevel = this.profile.upgrades[stat];
    if (currentLevel >= GAME_CONFIG.progression.maxUpgradeLevel) return "MAX LEVEL";
    if (!this.profile.purchaseUpgrade(stat)) return "INSUFFICIENT FUNDS";
    this.applyCurrentEffectiveStats();
    return `${this.upgradeLabel(stat)} UPGRADED TO LEVEL ${this.profile.upgrades[stat]}`;
  }

  private applyCurrentEffectiveStats(): void {
    if (!this.profile || !this.player || this.ambulanceDriver?.isActive) return;
    const vehicle = getVehicleDefinition(this.profile.equippedVehicleId) ?? STARTER_VEHICLE;
    this.player.applyEffectiveStats(applyPermanentUpgrades(vehicle.stats, this.profile.upgrades));
  }

  private restorePersonalVehicle(): void {
    if (!this.profile || !this.player || !this.player.isAmbulance) return;
    const vehicle = getVehicleDefinition(this.profile.equippedVehicleId) ?? STARTER_VEHICLE;
    this.player.equipVehicle(vehicle, applyPermanentUpgrades(vehicle.stats, this.profile.upgrades), true);
    this.capturePlayerPhysicsPose();
  }

  private debugResetUpgrades(): void {
    this.profile?.resetUpgrades();
    this.applyCurrentEffectiveStats();
  }

  private debugSetUpgrade(stat: VehicleStatKey, level: number): void {
    if (!VEHICLE_STAT_KEYS.includes(stat)) return;
    this.profile?.setUpgradeLevel(stat, level);
    this.applyCurrentEffectiveStats();
  }

  private debugEquipVehicle(id: string): void {
    if (!this.profile || !this.player || !this.profile.ownsVehicle(id)) return;
    const vehicle = getVehicleDefinition(id);
    if (!vehicle || !this.profile.equipVehicle(id)) return;
    this.player.equipVehicle(vehicle, applyPermanentUpgrades(vehicle.stats, this.profile.upgrades));
    this.capturePlayerPhysicsPose();
  }

  private canUseVehicleShop(): boolean {
    return this.state === GameState.Playing && !!this.player && !!this.town
      && !this.activity?.hasActiveActivity && !this.police?.isPursuitActive
      && this.player.getSpeedMph() <= GAME_CONFIG.progression.equipMaxSpeedMph
      && this.town.dealerships.some(dealer => isInServiceArea(this.player!.root.position, dealer.serviceArea));
  }

  private openVehicleShop(): boolean {
    if (!this.canUseVehicleShop()) return false;
    this.input?.resetDrivingState();
    this.physicsAccumulator = 0;
    return true;
  }

  private purchaseRacingLicense(): string {
    if (!this.profile) return "LICENSE UNAVAILABLE";
    if (this.profile.ownsRacingLicense) return "LICENSE ALREADY OWNED";
    return this.profile.purchaseRacingLicense() ? "RACING LICENSE UNLOCKED" : "INSUFFICIENT FUNDS";
  }

  private startRace(regionId: string): boolean {
    if (!this.racing || !this.player || !this.activity || !this.profile?.ownsRacingLicense
      || this.state !== GameState.Playing || this.police?.isPursuitActive
      || this.activity.hasActiveActivity || !this.fuel?.hasFuel) return false;
    this.restorePlayerPhysicsPose();
    const returnPose = { x: this.player.root.position.x, z: this.player.root.position.z, heading: this.player.heading };
    if (!this.activity.start(this.racing, () => this.racing!.start(regionId, this.player!))) return false;
    this.raceReturnPose = returnPose;
    this.raceStartPose = { x: this.player.root.position.x, z: this.player.root.position.z, heading: this.player.heading };
    this.raceResult = null;
    this.traffic?.setSuspended(true);
    this.ui.closePhone();
    this.ui.closeShop();
    this.synchronizeRacePose();
    this.updateRaceUi(0);
    return true;
  }

  private retryRace(): void {
    if (this.racing?.state !== "FINISHED" || !this.player || !this.fuel?.hasFuel) return;
    const id = this.racing.snapshot.regionId;
    this.racing.abort();
    this.activity?.update();
    if (!this.activity?.start(this.racing, () => this.racing!.start(id, this.player!))) {
      this.endRace(true);
      return;
    }
    this.raceResult = null;
    this.synchronizeRacePose();
    this.updateRaceUi(0);
  }

  private endRace(aborted: boolean): void {
    if (!this.racing || (!this.racing.isActive && !this.raceReturnPose)) return;
    const pose = aborted ? this.raceReturnPose : this.raceStartPose;
    this.racing.abort();
    this.activity?.update();
    if (pose && this.player) {
      this.player.teleportTo(pose.x, pose.z, pose.heading);
      if (!aborted && this.town) {
        const curb = GAME_CONFIG.world.roadWidth / 2 - this.player.colliderRadius - GAME_CONFIG.player.parkedCurbClearance;
        const eastWest = Math.abs(Math.sin(pose.heading)) > 0.5;
        const roads = eastWest ? this.town.roadPositionsZ : this.town.roadPositionsX;
        const coordinate = eastWest ? pose.z : pose.x;
        const center = roads.reduce((best, value) => Math.abs(value - coordinate) < Math.abs(best - coordinate) ? value : best);
        const side = eastWest ? -Math.sign(Math.sin(pose.heading)) : Math.sign(Math.cos(pose.heading));
        this.player.teleportTo(eastWest ? pose.x : center + side * curb,
          eastWest ? center + side * curb : pose.z, pose.heading);
      }
    }
    this.raceResult = null;
    this.raceReturnPose = null;
    this.raceStartPose = null;
    this.traffic?.setSuspended(false, this.player ?? undefined);
    this.synchronizeRacePose();
    this.drivingBehavior?.update(0, this.player!, this.worldQuery!);
    this.state = GameState.Playing;
    this.ui.setRaceState(null, null);
    this.ui.showPlaying();
    this.updateRaceUi(0);
  }

  private synchronizeRacePose(): void {
    this.physicsAccumulator = 0;
    this.capturePlayerPhysicsPose();
    this.input?.resetDrivingState();
    this.chaseCamera?.snapToPlayer();
    this.canvas.focus();
  }

  private updateRace(deltaTime: number): void {
    const race = this.racing!, player = this.player!, input = this.input!;
    const fixedStep = GAME_CONFIG.simulation.fixedStepSeconds;
    this.restorePlayerPhysicsPose();
    this.physicsAccumulator = Math.min(this.physicsAccumulator + deltaTime,
      fixedStep * GAME_CONFIG.simulation.maxSubSteps);
    while (this.physicsAccumulator >= fixedStep) {
      this.previousPlayerPosition.copyFrom(this.currentPlayerPosition);
      this.previousPlayerHeading = this.currentPlayerHeading;
      if (race.state === "RACING") {
        if (input.consumeReset()) {
          race.resetPlayer(player);
          this.capturePlayerPhysicsPose();
          input.resetDrivingState();
          this.chaseCamera?.snapToPlayer();
        } else {
          player.update(fixedStep, input, this.worldQuery!, this.fuel!.hasFuel, this.damage!.damagePercent);
        }
        this.fuel!.update(fixedStep, player, [], this.profile!, false);
      } else {
        input.consumeReset();
        input.resetDrivingState();
      }
      race.update(fixedStep, player);
      this.currentPlayerPosition.copyFrom(player.root.position);
      this.currentPlayerHeading = player.heading;
      this.physicsAccumulator -= fixedStep;
      const result = race.consumeResult();
      if (result) {
        const profile = this.profile!;
        const previousBest = profile.getBestRaceFinish(result.regionId);
        const incomeBefore = profile.getRegionPassiveIncomePerSecond(result.regionId);
        profile.recordRaceFinish(result.regionId, result.finishPlace);
        this.raceResult = {
          regionId: result.regionId, finishPlace: result.finishPlace, previousBest,
          bestFinish: profile.getBestRaceFinish(result.regionId)!,
          multiplier: profile.getRaceMultiplier(result.regionId), incomeBefore,
          incomeAfter: profile.getRegionPassiveIncomePerSecond(result.regionId),
        };
        this.capturePlayerPhysicsPose();
      }
      if (race.state === "RACING" && !this.fuel!.hasFuel && player.getSpeedMph() < 1) {
        this.endRace(true);
        this.ui.showRaceFeedback("OUT OF FUEL · RACE ENDED");
        return;
      }
    }
    this.profile!.updateAutosave(deltaTime);
    this.applyInterpolatedPlayerPose(this.physicsAccumulator / fixedStep);
    this.chaseCamera!.update(deltaTime);
    this.updateRaceUi(deltaTime);
  }

  private updateRaceUi(deltaTime: number): void {
    this.ui.setRaceState(this.racing?.isActive ? this.racing.snapshot : null, this.raceResult);
    this.performanceMonitor.beginUiUpdate();
    this.ui.update(this.rideOffers!, this.ride!, this.ambulanceDriver!, this.player!, this.fuel!, this.damage!,
      this.police!, this.profile!, this.town!, this.activity!.getObjectivePosition(), deltaTime);
    this.performanceMonitor.endUiUpdate();
  }

  private resetProgression(): void {
    this.profile?.clearSave();
    window.location.reload();
  }

  private beginCitation(citation: PoliceCitation): void {
    this.state = GameState.Citation;
    this.physicsAccumulator = 0;
    this.input?.resetDrivingState();
    this.ui.showCitation(citation);
  }

  private policeTargetSnapshot(): PolicePursuitTarget {
    const player = this.player!;
    return {
      x: player.root.position.x,
      z: player.root.position.z,
      heading: player.heading,
      velocityX: player.getVelocityX(),
      velocityZ: player.getVelocityZ(),
      vehicleLength: player.vehicleLength,
      vehicleWidth: player.vehicleWidth,
      damagePercent: this.damage?.damagePercent ?? 0,
    };
  }

  private acknowledgeCitation(): void {
    if (this.state !== GameState.Citation) return;
    this.state = GameState.Playing;
    this.physicsAccumulator = 0;
    this.ui.showPlaying();
    this.canvas.focus();
  }

  private upgradeLabel(stat: VehicleStatKey): string {
    return stat === "topSpeed" ? "TOP SPEED" : stat.toUpperCase();
  }

  private capturePlayerPhysicsPose(): void {
    if (!this.player) return;
    this.currentPlayerPosition.copyFrom(this.player.root.position);
    this.previousPlayerPosition.copyFrom(this.currentPlayerPosition);
    this.currentPlayerHeading = this.player.heading;
    this.previousPlayerHeading = this.currentPlayerHeading;
  }

  private restorePlayerPhysicsPose(): void {
    if (!this.player) return;
    this.player.root.position.copyFrom(this.currentPlayerPosition);
    this.player.heading = this.currentPlayerHeading;
    this.player.root.rotation.y = this.currentPlayerHeading;
  }

  private applyInterpolatedPlayerPose(alpha: number): void {
    if (!this.player) return;
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    Vector3.LerpToRef(this.previousPlayerPosition, this.currentPlayerPosition, clampedAlpha, this.renderPlayerPosition);
    const headingDelta = normalizeAngle(this.currentPlayerHeading - this.previousPlayerHeading);
    const renderHeading = normalizeAngle(lerp(this.previousPlayerHeading, this.previousPlayerHeading + headingDelta, clampedAlpha));
    this.player.root.position.copyFrom(this.renderPlayerPosition);
    this.player.heading = renderHeading;
    this.player.root.rotation.y = renderHeading;
  }

  private createScene(): Scene {
    const scene = new Scene(this.engine);
    setSceneGraphicsMode(scene, resolveGraphicsMode());
    scene.clearColor.set(0.55, 0.72, 0.86, 1);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = GAME_CONFIG.graphics.fogStart;
    scene.fogEnd = GAME_CONFIG.graphics.fogEnd;
    scene.fogColor = new Color3(0.55, 0.72, 0.86);
    const light = new HemisphericLight("main-light", new Vector3(0.4, 1, 0.3), scene);
    light.intensity = 0.92;
    light.groundColor = new Color3(0.32, 0.34, 0.34);
    if (hasEnhancedGraphics(scene)) {
      const lighting=CITY_STYLE.lighting;
      const sky=Color3.FromHexString(lighting.sky);
      scene.clearColor.set(sky.r,sky.g,sky.b,1);
      scene.fogColor=sky;
      light.diffuse=Color3.FromHexString(lighting.ambient);
      light.groundColor=Color3.FromHexString(lighting.ground);
      light.intensity=lighting.ambientIntensity;
      const sun=new DirectionalLight("sunlight",new Vector3(...lighting.direction),scene);
      sun.diffuse=Color3.FromHexString(lighting.sun);
      sun.intensity=lighting.sunIntensity;
      sun.specular=new Color3(0.5,0.48,0.44);
    }

    const previewCamera = new ArcRotateCamera("preview-camera", Math.PI * 0.25, Math.PI * 0.35, 850, Vector3.Zero(), scene);
    previewCamera.minZ = 0.1;
    previewCamera.maxZ = 2200;
    scene.activeCamera = previewCamera;
    return scene;
  }
}
