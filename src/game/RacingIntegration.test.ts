import { beforeAll, afterAll } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it, vi } from "vitest";
import { GAME_CONFIG } from "./config";
import { Game } from "./Game";
import { GameState } from "./types";

type GameStub = Record<string, any>;

function call<T>(method: string, game: GameStub, ...args: unknown[]): T {
  return (Game.prototype as any)[method].call(game, ...args) as T;
}

function createGameStub(): GameStub {
  const player = {
    root: { position: new Vector3(100, 0.9, 200), rotation: { y: 0 } },
    heading: 0.25,
    getSpeedMph: vi.fn(() => 0),
    teleportTo: vi.fn(),
    reset: vi.fn(),
    equipVehicle: vi.fn(),
  };
  const activity: GameStub = {
    hasActiveActivity: false,
    start: vi.fn((_activity: unknown, begin: () => boolean) => {
      const started = begin();
      if (started) activity.hasActiveActivity = true;
      return started;
    }),
    update: vi.fn(() => { activity.hasActiveActivity = false; }),
  };
  const racing = {
    isActive: false,
    state: "IDLE",
    start: vi.fn(() => true),
    abort: vi.fn(),
  };
  const profile = {
    ownsRacingLicense: true,
    money: 100_000,
    upgrades: { acceleration: 0, topSpeed: 0, turning: 0, braking: 0 },
    ownsVehicle: vi.fn(() => false),
    getVehiclePurchaseQuote: vi.fn(() => ({ price: 1 })),
    purchaseVehicle: vi.fn(() => true),
    completeStreetRace: vi.fn(result => { result.cashEarned = 5000; result.passiveIncomeGain = 3; return true; }),
    getBestRaceFinish: vi.fn(() => null),
    getRegionPassiveIncomePerSecond: vi.fn(() => 0.16),
    getRaceMultiplier: vi.fn(() => 1),
    updateAutosave: vi.fn(),
  };
  return {
    state: GameState.Playing,
    player,
    activity,
    racing,
    profile,
    fuel: { hasFuel: true, update: vi.fn() },
    police: { isPursuitActive: false, resetDutyObservations: vi.fn() },
    raceEncounters: { waiting: { grid: {player:{x:0,z:0},opponents:[]} }, canEnter: vi.fn(() => true), consume: vi.fn(), finishRace: vi.fn() },
    traffic: { setSuspended: vi.fn() },
    town: {
      autoBodyShops: [{ position: new Vector3(100, 0, 200) }],
      dealerships: [{ serviceArea: { x: 100, z: 200, halfX: 27, halfZ: 22 } }],
    },
    ui: {
      closePhone: vi.fn(),
      closeShop: vi.fn(),
      setRaceState: vi.fn(),
      setRaceEncounterCue: vi.fn(),
      blocksCurbsidePickup: false,
      showPlaying: vi.fn(),
      showRaceFeedback: vi.fn(),
    },
    input: { consumeReset: vi.fn(() => false), resetDrivingState: vi.fn() },
    canvas: { focus: vi.fn() },
    worldQuery: {},
    damage: { damagePercent: 0 },
    chaseCamera: { update: vi.fn(), snapToPlayer: vi.fn() },
    drivingBehavior: { update: vi.fn() },
    currentPlayerPosition: new Vector3(100, 0.9, 200),
    previousPlayerPosition: new Vector3(100, 0.9, 200),
    currentPlayerHeading: 0.25,
    previousPlayerHeading: 0.25,
    physicsAccumulator: 0,
    raceResult: null,
    raceResultSeconds: GAME_CONFIG.racing.encounters.resultSeconds,
    raceReturnPose: null,
    raceStartPose: null,
    restorePlayerPhysicsPose: vi.fn(),
    synchronizeRacePose: vi.fn(),
    capturePlayerPhysicsPose: vi.fn(),
    applyInterpolatedPlayerPose: vi.fn(),
    updateRaceUi: vi.fn(),
    performanceMonitor: { beginUiUpdate: vi.fn(), endUiUpdate: vi.fn() },
    canApproachRace: function(this: GameStub): boolean { return call<boolean>("canApproachRace", this); },
    canUseVehicleShop: function(this: GameStub): boolean {
      return (Game.prototype as any).canUseVehicleShop.call(this);
    },
  };
}

describe("Game racing integration", () => {
  it("returns automatically after the result duration without paying again", () => {
    const game = createGameStub(); game.racing.state = "FINISHED"; game.endRace = vi.fn();
    call<void>("updateRace", game, 2.9);
    expect(game.endRace).not.toHaveBeenCalled();
    call<void>("updateRace", game, .11);
    expect(game.endRace).toHaveBeenCalledWith(false);
    expect(game.profile.completeStreetRace).not.toHaveBeenCalled();
  });
  it.each([
    ["without the racing license", (game: GameStub) => { game.profile.ownsRacingLicense = false; }],
    ["during an active job", (game: GameStub) => { game.activity.hasActiveActivity = true; }],
    ["during a police pursuit", (game: GameStub) => { game.police.isPursuitActive = true; }],
    ["with a blocking menu", (game: GameStub) => { game.ui.blocksCurbsidePickup = true; }],
    ["without a nearby live gathering", (game: GameStub) => { game.raceEncounters.canEnter.mockReturnValue(false); }],
    ["without fuel", (game: GameStub) => { game.fuel.hasFuel = false; }],
    ["outside the playing state", (game: GameStub) => { game.state = GameState.Paused; }],
  ])("does not start a race %s", (_label, mutate) => {
    const game = createGameStub();
    game.manualWaypoint = new Vector3(20, 0, 30);
    mutate(game);

    expect(call<boolean>("startRace", game, "block-0-0")).toBe(false);
    expect(game.racing.start).not.toHaveBeenCalled();
    expect(game.activity.start).not.toHaveBeenCalled();
    expect(game.traffic.setSuspended).not.toHaveBeenCalled();
    expect(game.manualWaypoint).toEqual(new Vector3(20, 0, 30));
  });

  it("starts an allowed race through ActivityManager and suspends traffic", () => {
    const game = createGameStub();
    game.manualWaypoint = new Vector3(20, 0, 30);

    expect(call<boolean>("startRace", game, "block-2-3")).toBe(true);
    expect(game.racing.start).toHaveBeenCalledWith("block-2-3", game.player, game.raceEncounters.waiting.grid);
    expect(game.activity.start).toHaveBeenCalledTimes(1);
    expect(game.traffic.setSuspended).toHaveBeenCalledWith(true);
    expect(game.ui.closePhone).toHaveBeenCalledTimes(1);
    expect(game.ui.closeShop).toHaveBeenCalledTimes(1);
    expect(game.raceReturnPose).toEqual({ x: 100, z: 200, heading: 0.25 });
    expect(game.manualWaypoint).toBeNull();
  });

  it("preserves a waypoint if the race manager rejects the start", () => {
    const game = createGameStub();
    game.manualWaypoint = new Vector3(20, 0, 30);
    game.racing.start.mockReturnValue(false);
    expect(call<boolean>("startRace", game, "block-0-0")).toBe(false);
    expect(game.manualWaypoint).toEqual(new Vector3(20, 0, 30));
  });

  it("aborting a race restores the player pose and traffic without recording a result", () => {
    const game = createGameStub();
    expect(call<boolean>("startRace", game, "block-0-0")).toBe(true);
    game.racing.isActive = true;

    call<void>("endRace", game, true);

    expect(game.racing.abort).toHaveBeenCalledTimes(1);
    expect(game.activity.update).toHaveBeenCalledTimes(1);
    expect(game.player.teleportTo).toHaveBeenCalledWith(100, 200, 0.25);
    expect(game.player.reset).not.toHaveBeenCalled();
    expect(game.traffic.setSuspended).toHaveBeenLastCalledWith(false, game.player);
    expect(game.raceReturnPose).toBeNull();
    expect(game.raceStartPose).toBeNull();
    expect(game.profile.completeStreetRace).not.toHaveBeenCalled();
  });

  it("records one consumed finish result and does not duplicate it on later updates", () => {
    const game = createGameStub();
    const result = { regionId: "block-0-0", finishPlace: 2 };
    game.racing.state = "RACING";
    game.racing.isActive = true;
    game.racing.update = vi.fn(() => { game.racing.state = "FINISHED"; });
    game.racing.consumeResult = vi.fn()
      .mockReturnValueOnce(result)
      .mockReturnValue(null);
    game.player.update = vi.fn();
    game.physicsAccumulator = GAME_CONFIG.simulation.fixedStepSeconds;
    game.profile.getBestRaceFinish
      .mockReturnValueOnce(null)
      .mockReturnValue(2);
    game.profile.getRegionPassiveIncomePerSecond
      .mockReturnValueOnce(0.16)
      .mockReturnValue(0.32);
    game.profile.getRaceMultiplier.mockReturnValue(2);

    call<void>("updateRace", game, 0);
    game.physicsAccumulator = GAME_CONFIG.simulation.fixedStepSeconds;
    call<void>("updateRace", game, 0);

    expect(game.profile.completeStreetRace).toHaveBeenCalledTimes(1);
    expect(game.profile.completeStreetRace).toHaveBeenCalledWith(result);
    expect(game.racing.consumeResult).toHaveBeenCalledTimes(1);
    expect(game.raceResult).toMatchObject({ regionId: "block-0-0", finishPlace: 2, cashEarned: 5000, passiveIncomeGain: 3 });
  });

  it.each(["COUNTDOWN", "RACING", "FINISHED"])("consumes fuel and applies existing damage only while driving in %s", state => {
    const game = createGameStub();
    game.racing.state = state;
    game.racing.isActive = true;
    game.racing.update = vi.fn();
    game.racing.consumeResult = vi.fn(() => null);
    game.player.update = vi.fn();
    game.damage.damagePercent = 0.6;
    call<void>("updateRace", game, GAME_CONFIG.simulation.fixedStepSeconds);
    if (state === "RACING") {
      expect(game.player.update).toHaveBeenCalledWith(GAME_CONFIG.simulation.fixedStepSeconds,
        game.input, game.worldQuery, true, 0.6, true);
      expect(game.fuel.update).toHaveBeenCalledWith(GAME_CONFIG.simulation.fixedStepSeconds,
        game.player, [], game.profile, false);
    } else {
      expect(game.player.update).not.toHaveBeenCalled();
      expect(game.fuel.update).not.toHaveBeenCalled();
    }
    expect(game.damage.damagePercent).toBe(0.6);
  });

  it("ends an empty-fuel stopped attempt without a race reward", () => {
    const game = createGameStub();
    game.racing.state = "RACING";
    game.racing.isActive = true;
    game.racing.update = vi.fn();
    game.racing.consumeResult = vi.fn(() => null);
    game.player.update = vi.fn();
    game.fuel.hasFuel = false;
    game.endRace = vi.fn();
    call<void>("updateRace", game, GAME_CONFIG.simulation.fixedStepSeconds);
    expect(game.endRace).toHaveBeenCalledWith(true);
    expect(game.profile.completeStreetRace).not.toHaveBeenCalled();
    expect(game.ui.showRaceFeedback).toHaveBeenCalledWith("OUT OF FUEL · RACE ENDED");
  });

  it.each([
    ["at a repair shop away from a dealership", (game: GameStub) => { game.town.dealerships[0].serviceArea.x = 0; }],
    ["during pursuit", (game: GameStub) => { game.police.isPursuitActive = true; }],
    ["during an active job", (game: GameStub) => { game.activity.hasActiveActivity = true; }],
    ["while moving", (game: GameStub) => { game.player.getSpeedMph.mockReturnValue(GAME_CONFIG.progression.equipMaxSpeedMph + 1); }],
  ])("blocks vehicle purchases %s", (_label, mutate) => {
    const game = createGameStub();
    mutate(game);

    expect(call<string>("purchaseVehicle", game, "used-compact")).toBe("STOP AT A DEALERSHIP WITHOUT AN ACTIVE JOB");
    expect(game.profile.purchaseVehicle).not.toHaveBeenCalled();
  });

  it("allows a vehicle purchase only while stopped in a dealership lot", () => {
    const game = createGameStub();

    expect(call<string>("purchaseVehicle", game, "used-compact")).toBe("USED COMPACT PURCHASED AND EQUIPPED");
    expect(game.profile.purchaseVehicle).toHaveBeenCalledWith("used-compact", true);
    expect(game.player.equipVehicle).toHaveBeenCalledTimes(1);
  });
});

// These tests exercise the preserved legacy systems with their feature gates enabled.
const savedGameplay = { ...GAME_CONFIG.gameplay };
beforeAll(() => { Object.assign(GAME_CONFIG.gameplay, {"racesEnabled": true}); vi.stubGlobal("document", {hidden:false}); });
afterAll(() => { Object.assign(GAME_CONFIG.gameplay, savedGameplay); vi.unstubAllGlobals(); });
