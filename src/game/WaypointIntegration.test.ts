import { GAME_CONFIG } from "./config";
import { beforeAll, afterAll } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it, vi } from "vitest";
import { ActivityManager } from "../activity/ActivityManager";
import { Game } from "./Game";
import { GameState } from "./types";

// Exercise Game's actual entry points and activity arbitration without a renderer.
function fixture() {
  const game = Object.assign(Object.create(Game.prototype), {
    state: GameState.Playing,
    manualWaypoint: null,
    town: { minX: -100, maxX: 200, minZ: -300, maxZ: 400 },
    activity: new ActivityManager(),
    racing: null,
    profile: { ownsMissionLicense: () => true, dispose: vi.fn() },
    police: { isPursuitActive: false, dispose: vi.fn() },
    player: { equipVehicle: vi.fn() },
    capturePlayerPhysicsPose: vi.fn(),
    ui: { setChaseState: vi.fn(), setRaceState: vi.fn(), setRaceEncounterCue: vi.fn(), closeShop: vi.fn() },
  });
  const ride = { isActive: false, getObjectivePosition: () => new Vector3(20, 0, 30),
    acceptRide: vi.fn(() => { ride.isActive = true; return true; }), dispose: vi.fn() };
  const ambulance = { isActive: false, getObjectivePosition: () => new Vector3(30, 0, 40),
    acceptOffer: vi.fn(() => { ambulance.isActive = true; return true; }), dispose: vi.fn() };
  game.ride = ride;
  game.ambulanceDriver = ambulance;
  return game;
}

describe("manual waypoint integration", () => {
  it("places, moves and clears a session waypoint without taking the activity slot", () => {
    const game = fixture(), original = new Vector3(25, 10, 80);
    expect(game.setManualWaypoint(original)).toBe(true);
    original.x = 90;
    expect(game.manualWaypoint).toEqual(new Vector3(25, 0, 80));
    expect(game.activity.hasActiveActivity).toBe(false);
    expect(game.activity.getObjectivePosition()).toBeNull();
    expect(game.setManualWaypoint(new Vector3(-100, 0, 400))).toBe(true);
    expect(game.manualWaypoint).toEqual(new Vector3(-100, 0, 400));
    expect(game.setManualWaypoint(null)).toBe(true);
    expect(game.manualWaypoint).toBeNull();
  });

  it.each([GameState.Start, GameState.Paused, GameState.Citation])("preserves the waypoint and rejects edits in %s", state => {
    const game = fixture();
    game.setManualWaypoint(new Vector3(10, 0, 20));
    game.state = state;
    expect(game.setManualWaypoint(new Vector3(50, 0, 50))).toBe(false);
    expect(game.setManualWaypoint(null)).toBe(false);
    expect(game.manualWaypoint).toEqual(new Vector3(10, 0, 20));
  });

  it.each([new Vector3(-101, 0, 0), new Vector3(0, 0, 401), new Vector3(NaN, 0, 0), new Vector3(0, 0, Infinity)])(
    "ignores an invalid or out-of-bounds target %s", position => {
      const game = fixture();
      game.setManualWaypoint(Vector3.Zero());
      expect(game.setManualWaypoint(position)).toBe(false);
      expect(game.manualWaypoint).toEqual(Vector3.Zero());
    },
  );

  it.each(["taxi", "ambulance"])("clears a waypoint only after %s acceptance succeeds, without restoring it afterward", kind => {
    const game = fixture();
    game.setManualWaypoint(new Vector3(10, 0, 20));
    const activity = kind === "taxi" ? game.ride : game.ambulanceDriver;
    const begin = kind === "taxi" ? activity.acceptRide : activity.acceptOffer;
    const accept = () => kind === "taxi" ? game.acceptRide("taxi", "offer", "block-0-0")
      : game.acceptAmbulanceDriver("offer", "block-0-0");
    begin.mockReturnValueOnce(false);
    expect(accept()).toBe(false);
    expect(game.manualWaypoint).toEqual(new Vector3(10, 0, 20));
    expect(accept()).toBe(true);
    expect(game.manualWaypoint).toBeNull();
    expect(game.setManualWaypoint(Vector3.Zero())).toBe(false);
    expect(game.activity.getObjectivePosition()).toEqual(activity.getObjectivePosition());
    activity.isActive = false;
    game.activity.update();
    expect(game.manualWaypoint).toBeNull();
    expect(game.setManualWaypoint(Vector3.Zero())).toBe(true);
  });

  it.each(["COUNTDOWN", "RACING", "FINISHED"])("blocks waypoint placement during race state %s", state => {
    const game = fixture();
    game.racing = { state, isActive: true };
    expect(game.canSetManualWaypoint()).toBe(false);
    expect(game.setManualWaypoint(Vector3.Zero())).toBe(false);
  });

  it("clears the waypoint when the simulation is disposed for a restart", () => {
    const game = fixture();
    game.setManualWaypoint(Vector3.Zero());
    game.disposeSimulation();
    expect(game.manualWaypoint).toBeNull();
    expect(game.canSetManualWaypoint()).toBe(false);
  });
});

// These tests exercise the preserved legacy systems with their feature gates enabled.
const savedGameplay = { ...GAME_CONFIG.gameplay };
beforeAll(() => Object.assign(GAME_CONFIG.gameplay, {"regionalTrainingEnabled": true, "racesEnabled": true, "ambulanceJobsEnabled": true, "curbsidePassengersEnabled": false}));
afterAll(() => Object.assign(GAME_CONFIG.gameplay, savedGameplay));
