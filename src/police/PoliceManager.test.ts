import { describe, expect, it, vi } from "vitest";
import { GAME_CONFIG } from "../game/config";
import type { DrivingViolationRates, DrivingViolationSeverity } from "../game/types";
import { PlayerProfile } from "../player/PlayerProfile";
import type { TrafficCar } from "../traffic/TrafficCar";
import {
  PoliceManager,
  calculatePoliceFine,
  isPlayerInPoliceView,
} from "./PoliceManager";

const legalRates: DrivingViolationRates = { speeding: 0, wrongSide: 0, sidewalk: 0, total: 0 };
const legalSeverity: DrivingViolationSeverity = { speeding: 0, wrongSide: 0, sidewalk: 0, combined: 0 };

describe("PoliceManager", () => {
  it("resets arrest progress during recovery and permits contact arrest afterward", () => {
    const car = officer(1);
    const manager = new PoliceManager([car]);
    const profile = new PlayerProfile();
    manager.registerPoliceCollision(1, { x: 0, z: 5 }, 0.5);
    const near = { x: 0, z: 5, velocityZ: 10 };
    for (let i = 0; i < 20; i++) manager.update(0.1, near, legalRates, legalSeverity, profile);
    expect(manager.warning.progress).toBeGreaterThan(0);
    Object.defineProperty(car, "accidentState", { value: "pursuitRecovery", configurable: true });
    Object.defineProperty(car, "isInPlayerContact", { value: true });
    for (let i = 0; i < 40; i++) {
      expect(manager.update(0.1, near, legalRates, legalSeverity, profile)).toBeNull();
      expect(manager.warning.progress).toBe(0);
      expect(manager.warning.hudMode).toBe("pursuit");
    }
    Object.defineProperty(car, "accidentState", { value: "driving" });
    let citation = null;
    for (let i = 0; i < 40; i++) citation = manager.update(0.1, near, legalRates, legalSeverity, profile);
    expect(citation).not.toBeNull();
    profile.dispose();
  });

  it("allows arrest of a fully damaged player at speed but never by a disabled officer", () => {
    for (const disabled of [false, true]) {
      const car = officer(1);
      const manager = new PoliceManager([car]);
      const profile = new PlayerProfile();
      manager.registerPoliceCollision(1, { x: 0, z: 5 }, 0.5);
      Object.defineProperty(car, "isPursuitDisabled", { value: disabled });
      const target = { x: 0, z: 5, velocityZ: 100, damagePercent: 1 };
      let citation = null;
      for (let i = 0; i < 40; i++) citation = manager.update(0.1, target, legalRates, legalSeverity, profile);
      expect(citation === null).toBe(disabled);
      if (disabled) {
        manager.drainRideEvents();
        for (let i = 0; i < 80; i++) manager.update(0.1, { ...target, z: 650 }, legalRates, legalSeverity, profile);
        expect(manager.isPursuitActive).toBe(false);
        expect(manager.drainRideEvents()).toEqual(["pursuitEscaped"]);
        expect(manager.registerPoliceCollision(1, { x: 0, z: 5 }, 0.5)).toBe(false);
      }
      profile.dispose();
    }
  });

  it("combines close circular vision with configurable front, rear, and side sightlines", () => {
    const officer = { x: 0, z: 0 };
    const police = GAME_CONFIG.police;
    const halfWidth = police.visionCrossWidth / 2;

    expect(isPlayerInPoliceView(officer, 0, { x: police.visionRadius * 0.6, z: police.visionRadius * 0.6 })).toBe(true);
    expect(isPlayerInPoliceView(officer, 0, { x: halfWidth, z: police.visionForwardLength })).toBe(true);
    expect(isPlayerInPoliceView(officer, 0, { x: 0, z: -police.visionRearLength })).toBe(true);
    expect(isPlayerInPoliceView(officer, 0, { x: police.visionSideLength, z: halfWidth })).toBe(true);
    expect(isPlayerInPoliceView(officer, 0, { x: -police.visionSideLength, z: 0 })).toBe(true);
    expect(isPlayerInPoliceView(officer, 0, { x: halfWidth + 0.1, z: police.visionForwardLength })).toBe(false);
    expect(isPlayerInPoliceView(officer, 0, { x: 0, z: -police.visionRearLength - 0.1 })).toBe(false);
    expect(isPlayerInPoliceView(officer, 0, { x: police.visionSideLength + 0.1, z: 0 })).toBe(false);
    expect(isPlayerInPoliceView(officer, Math.PI / 2, { x: police.visionForwardLength, z: 0 })).toBe(true);
  });

  it("scales and rounds fines between the configured bounds", () => {
    expect(calculatePoliceFine(0)).toBe(40);
    expect(calculatePoliceFine(0.5)).toBe(95);
    expect(calculatePoliceFine(1)).toBe(150);
    expect(calculatePoliceFine(4)).toBe(150);
  });

  it("reports pursuit, arresting, fleeing, and escaping HUD progress", () => {
    const manager = new PoliceManager([officer(15)]);
    const profile = new PlayerProfile();
    expect(manager.registerTrafficCollision({ x: 0, z: 40 }, 0.5)).toBe(true);
    expect(manager.warning.hudMode).toBe("pursuit");
    expect(manager.warning.hudProgress).toBe(0);
    expect(manager.warning.potentialFine).toBe(95);

    manager.update(0.1, { x: 0, z: 300 }, legalRates, legalSeverity, profile);
    expect(manager.warning.hudMode).toBe("pursuit");

    manager.update(0.1, { x: 0, z: 450 }, legalRates, legalSeverity, profile);
    expect(manager.warning.hudMode).toBe("fleeing");
    expect(manager.warning.hudProgress).toBeCloseTo(0.5);

    manager.update(0.1, { x: 0, z: 600 }, legalRates, legalSeverity, profile);
    expect(manager.warning.hudMode).toBe("escaping");
    expect(manager.warning.hudProgress).toBe(1);
    expect(manager.warning.escapeProgress).toBeCloseTo(0.1 / GAME_CONFIG.police.escapeDurationSeconds);

    for (let step = 0; step < 10; step++) {
      manager.update(0.1, { x: 0, z: 5 }, legalRates, legalSeverity, profile);
    }
    manager.update(0.1, { x: 0, z: 20 }, legalRates, legalSeverity, profile);
    expect(manager.warning.hudMode).toBe("pursuit");
    expect(manager.warning.progress).toBeGreaterThan(0);
    expect(manager.warning.escapeProgress).toBe(0);
  });

  it("keeps the pursuit fine fixed while the chase continues", () => {
    const manager = new PoliceManager([officer(16)]);
    const profile = new PlayerProfile();
    expect(manager.registerTrafficCollision({ x: 0, z: 40 }, 0.5)).toBe(true);

    manager.update(45, { x: 0, z: 20 }, legalRates, legalSeverity, profile);

    expect(manager.warning.potentialFine).toBe(95);
    expect(manager.warning.hudMode).toBe("pursuit");
  });

  it("does not build bust progress at high speed when the officer stays close", () => {
    const manager = new PoliceManager([officer(13)]);
    const profile = new PlayerProfile();
    profile.money = 500;
    expect(manager.registerTrafficCollision({ x: 0, z: 40 }, 0.5)).toBe(true);

    let citation = null;
    for (let step = 0; step < 50 && !citation; step++) {
      citation = manager.update(
        0.1,
        { x: 0, z: 5, velocityZ: 100 },
        legalRates,
        legalSeverity,
        profile,
      );
    }
    expect(citation).toBeNull();
    expect(manager.warning.progress).toBe(0);
    expect(manager.warning.hudMode).toBe("pursuit");
  });

  it("allows capture tolerance outside the exact follow target so the meter cannot stall", () => {
    const manager = new PoliceManager([officer(14)]);
    const profile = new PlayerProfile();
    profile.money = 500;
    expect(manager.registerTrafficCollision({ x: 0, z: 40 }, 0.5)).toBe(true);
    const settledDistance = GAME_CONFIG.traffic.vehicleLength / 2
      + GAME_CONFIG.player.length / 2
      + GAME_CONFIG.police.pursuitDesiredGapMeters
      + GAME_CONFIG.police.pursuitCaptureGapMeters / 2;

    let citation = null;
    for (let step = 0; step < 50 && !citation; step++) {
      citation = manager.update(
        0.1,
        { x: 0, z: settledDistance },
        legalRates,
        legalSeverity,
        profile,
      );
    }
    expect(citation).not.toBeNull();
  });

  it("starts pursuit at the evidence threshold and cites after four seconds in bust range", () => {
    const policeCar = officer(1);
    const manager = new PoliceManager([policeCar]);
    const profile = new PlayerProfile();
    profile.money = 50.25;
    const rates: DrivingViolationRates = { speeding: 0, wrongSide: 5, sidewalk: 0, total: 5 };
    const severity: DrivingViolationSeverity = { speeding: 0, wrongSide: 1, sidewalk: 0, combined: 1 };
    let citation = null;

    for (let step = 0; step < 10 && !manager.isPursuitActive; step++) {
      citation = manager.update(0.1, { x: 0, z: 40 }, rates, severity, profile);
    }

    expect(citation).toBeNull();
    expect(manager.isPursuitActive).toBe(true);
    expect(manager.activePursuerId).toBe(1);
    expect(profile.money).toBe(50.25);
    expect(manager.warning.phase).toBe("pursuit");

    for (let step = 0; step < 50 && !citation; step++) {
      citation = manager.update(0.1, { x: 0, z: 5 }, legalRates, legalSeverity, profile);
    }

    if (citation) profile.settlePoliceCitation(citation);
    expect(citation).toMatchObject({
      officerId: 1,
      offense: "WRONG WAY",
      assessedFine: 150,
      amountPaid: 50.25,
      remainingBalance: 0,
    });
    expect(profile.money).toBe(0);
    expect(manager.warning.progress).toBe(0);
    expect(manager.warning.phase).toBe("idle");
  });

  it("decays suspicion and clears it when an officer is recycled", () => {
    const policeCar = officer(2);
    const manager = new PoliceManager([policeCar]);
    const profile = new PlayerProfile();
    const rates: DrivingViolationRates = { speeding: 2, wrongSide: 0, sidewalk: 0, total: 2 };
    const severity: DrivingViolationSeverity = { speeding: 1, wrongSide: 0, sidewalk: 0, combined: 1 };

    manager.update(0.1, { x: 0, z: 40 }, rates, severity, profile);
    expect(manager.warning.progress).toBeCloseTo(0.1);
    expect(manager.warning.activelyObserving).toBe(true);
    expect(manager.warning.observedOffense).toBe("SPEEDING");

    manager.update(0.2, { x: 0, z: 40 }, legalRates, legalSeverity, profile);
    expect(manager.warning.progress).toBe(0);
    expect(manager.warning.observedOffense).toBeNull();

    manager.update(0.2, { x: 0, z: 40 }, rates, severity, profile);
    expect(manager.warning.progress).toBeGreaterThan(0);
    policeCar.respawnGeneration += 1;
    manager.update(0.1, { x: 0, z: 40 }, legalRates, legalSeverity, profile);
    expect(manager.warning.progress).toBe(0);
  });

  it("uses only the confirming officer and applies a global cooldown after the bust", () => {
    const firstOfficer = officer(3);
    const secondOfficer = officer(4, 5);
    const manager = new PoliceManager([firstOfficer, secondOfficer]);
    const profile = new PlayerProfile();
    profile.money = 500;
    const rates: DrivingViolationRates = { speeding: 0, wrongSide: 5, sidewalk: 0, total: 5 };
    const severity: DrivingViolationSeverity = { speeding: 0, wrongSide: 1, sidewalk: 0, combined: 1 };
    let firstCitation = null;
    for (let step = 0; step < 10 && !manager.isPursuitActive; step++) {
      manager.update(0.1, { x: 0, z: 40 }, rates, severity, profile);
    }
    expect(manager.activePursuerId).toBe(3);
    expect(firstOfficer.setPursuitTarget).toHaveBeenCalled();
    expect(secondOfficer.setPursuitTarget).not.toHaveBeenCalled();

    for (let step = 0; step < 50 && !firstCitation; step++) {
      firstCitation = manager.update(0.1, { x: 0, z: 5 }, legalRates, legalSeverity, profile);
    }
    expect(firstCitation).not.toBeNull();
    expect(profile.money).toBe(500); // Assessment does not charge before all fines are collected.
    profile.settlePoliceCitation(firstCitation!);

    let repeatedCitation = null;
    for (let step = 0; step < 50; step++) {
      repeatedCitation = manager.update(0.1, { x: 0, z: 40 }, rates, severity, profile);
    }
    expect(repeatedCitation).toBeNull();
    expect(profile.money).toBe(350);
  });

  it("starts pursuit rather than immediately citing a witnessed traffic collision", () => {
    const policeCar = officer(5);
    const manager = new PoliceManager([policeCar]);
    const profile = new PlayerProfile();
    profile.money = 500;

    const started = manager.registerTrafficCollision({ x: 0, z: 40 }, 0.5);

    expect(started).toBe(true);
    expect(manager.isPursuitActive).toBe(true);
    expect(manager.activePursuerId).toBe(5);
    expect(profile.money).toBe(500);
    expect(manager.warning.progress).toBe(0);
  });

  it("does not cite a collision outside every officer's view", () => {
    const manager = new PoliceManager([officer(6)]);
    const profile = new PlayerProfile();
    profile.money = 500;

    const started = manager.registerTrafficCollision(
      { x: GAME_CONFIG.police.visionSideLength + 1, z: 0 },
      1,
    );

    expect(started).toBe(false);
    expect(profile.money).toBe(500);
    expect(manager.warning.progress).toBe(0);
  });

  it("starts pursuit instead of immediately citing a direct police collision", () => {
    const policeCar = officer(7);
    const manager = new PoliceManager([policeCar]);
    const profile = new PlayerProfile();
    profile.money = 100;

    const started = manager.registerPoliceCollision(7, { x: 12, z: 20 }, 0);

    expect(started).toBe(true);
    expect(manager.isPursuitActive).toBe(true);
    expect(manager.activePursuerId).toBe(7);
    expect(policeCar.setPursuitTarget).toHaveBeenCalledWith({ x: 12, z: 20 });
    expect(profile.money).toBe(100);
  });

  it("ignores direct and witnessed collision citations during an active pursuit", () => {
    const pursuingOfficer = officer(10);
    const otherOfficer = officer(11);
    const manager = new PoliceManager([pursuingOfficer, otherOfficer]);
    const profile = new PlayerProfile();
    profile.money = 500;
    expect(manager.registerPoliceCollision(10, { x: 0, z: 40 }, 0.5)).toBe(true);

    expect(manager.registerPoliceCollision(11, { x: 5, z: 5 }, 1)).toBe(false);
    expect(manager.registerTrafficCollision({ x: 0, z: 40 }, 1)).toBe(false);
    expect(manager.activePursuerId).toBe(10);
    expect(otherOfficer.setPursuitTarget).not.toHaveBeenCalled();
    expect(profile.money).toBe(500);

    let citation = null;
    for (let step = 0; step < 50 && !citation; step++) {
      citation = manager.update(0.1, { x: 0, z: 5 }, legalRates, legalSeverity, profile);
    }
    if (citation) profile.settlePoliceCitation(citation);
    expect(citation).toMatchObject({
      officerId: 10,
      offense: "COLLISION WITH POLICE",
    });
  });

  it("decays bust progress at one-times speed outside the bust radius", () => {
    const manager = new PoliceManager([officer(8)]);
    const profile = new PlayerProfile();
    profile.money = 500;
    expect(manager.registerTrafficCollision({ x: 0, z: 40 }, 0.5)).toBe(true);

    for (let step = 0; step < 20; step++) {
      manager.update(0.1, { x: 0, z: 5 }, legalRates, legalSeverity, profile);
    }
    expect(manager.warning.phase).toBe("busting");
    expect(manager.warning.progress).toBeCloseTo(0.5);

    for (let step = 0; step < 10; step++) {
      manager.update(0.1, { x: 0, z: 20 }, legalRates, legalSeverity, profile);
    }
    expect(manager.warning.phase).toBe("pursuit");
    expect(manager.warning.progress).toBeCloseTo(0.25);
    expect(manager.isPursuitActive).toBe(true);
  });

  it("ends pursuit after eight continuous seconds beyond the escape distance", () => {
    const policeCar = officer(9);
    const manager = new PoliceManager([policeCar]);
    const profile = new PlayerProfile();
    const escapedPlayer = {
      x: GAME_CONFIG.police.escapeDistanceMeters / GAME_CONFIG.ride.metersPerWorldUnit + 1,
      z: 0,
    };
    expect(manager.registerTrafficCollision({ x: 0, z: 40 }, 0.5)).toBe(true);

    for (let step = 0; step < 40; step++) {
      manager.update(0.1, escapedPlayer, legalRates, legalSeverity, profile);
    }
    manager.update(0.1, { x: 0, z: 20 }, legalRates, legalSeverity, profile);
    for (let step = 0; step < 79; step++) {
      manager.update(0.1, escapedPlayer, legalRates, legalSeverity, profile);
    }
    expect(manager.isPursuitActive).toBe(true);

    manager.update(0.1, escapedPlayer, legalRates, legalSeverity, profile);
    expect(manager.isPursuitActive).toBe(false);
    expect(manager.warning.phase).toBe("idle");
    expect(manager.warning.distanceMeters).toBe(0);
    expect(policeCar.clearPursuit).toHaveBeenCalled();
  });
  it("emits observation evidence once per drain, without replaying lingering HUD suspicion", () => {
    const manager = new PoliceManager([officer(1),officer(2)]), profile = new PlayerProfile();
    manager.update(.1,{x:0,z:40},{...legalRates,speeding:.1,total:.1},
      {...legalSeverity,speeding:.1,combined:.1},profile);
    expect(manager.drainRideEvents()).toEqual(["violationObserved"]);
    expect(manager.drainRideEvents()).toEqual([]);
    manager.update(.1,{x:0,z:40},legalRates,legalSeverity,profile);
    expect(manager.drainRideEvents()).toEqual([]);
    profile.dispose();
  });

  it("emits a successful escape exactly once and excludes arrest and missing-officer cleanup", () => {
    const officers=[officer(1)], manager=new PoliceManager(officers), profile=new PlayerProfile();
    manager.registerPoliceCollision(1,{x:0,z:5},.5);
    expect(manager.drainRideEvents()).toEqual(["violationObserved"]);
    const far={x:GAME_CONFIG.police.escapeDistanceMeters/GAME_CONFIG.ride.metersPerWorldUnit+1,z:0};
    for(let i=0;i<81;i++) manager.update(.1,far,legalRates,legalSeverity,profile);
    expect(manager.drainRideEvents()).toEqual(["pursuitEscaped"]);
    expect(manager.drainRideEvents()).toEqual([]);
    manager.registerPoliceCollision(1,{x:0,z:5},.5);
    manager.drainRideEvents();
    let citation=null;
    for(let i=0;i<50&&!citation;i++) citation=manager.update(.1,{x:0,z:5},legalRates,legalSeverity,profile);
    expect(citation).not.toBeNull();
    expect(manager.drainRideEvents()).toEqual([]);
    const cleanup=new PoliceManager(officers);
    cleanup.registerPoliceCollision(1,{x:0,z:5},.5); cleanup.drainRideEvents();
    officers.pop(); cleanup.update(.1,far,legalRates,legalSeverity,profile);
    expect(cleanup.isPursuitActive).toBe(false);
    expect(cleanup.drainRideEvents()).toEqual([]);
    profile.dispose();
  });

});

function officer(id: number, x = 0): TrafficCar {
  return {
    id,
    role: "police",
    respawnGeneration: 1,
    mesh: {
      position: { x, z: 0 },
      rotation: { y: 0 },
      isEnabled: () => true,
    },
    setPursuitTarget: vi.fn(),
    clearPursuit: vi.fn(),
  } as unknown as TrafficCar;
}
