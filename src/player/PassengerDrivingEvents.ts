import { GAME_CONFIG } from "../game/config";
import type { TrafficSignalAspect } from "../traffic/TrafficSignalController";
import type { Direction } from "../traffic/TrafficCar";

export type PassengerDrivingEvent = "redLight" | "yellowIntersection" | "opposingLane";
export interface DrivingPosition { x: number; z: number }
interface Visit {
  x: number;
  z: number;
  approach: Direction;
  entrySide: Direction;
  yellowAwarded: boolean;
  maneuverPenalized: boolean;
  entryLaneSide: number;
  crossedEntryCenter: boolean;
}

/** Player-only detector. It does not change general driving points or police offenses. */
export class PassengerDrivingEvents {
  private previous: DrivingPosition | null = null;
  private visit: Visit | null = null;
  private lane: { axis: "x" | "z"; center: number; side: number; legal: boolean } | null = null;
  private opposingEpisode = false;
  private reverseDistanceMeters = 0;
  private readonly crossedStopLines = new Set<string>();

  constructor(private readonly roadX: readonly number[], private readonly roadZ: readonly number[]) {}

  reset(position?: DrivingPosition): void {
    // Babylon Vector3 exposes x/z through getters; spreading it copies _x/_z
    // instead, leaving the detector's first segment with invalid coordinates.
    this.previous = position ? { x: position.x, z: position.z } : null;
    this.visit = null;
    this.lane = null;
    this.opposingEpisode = false;
    this.reverseDistanceMeters = 0;
    this.crossedStopLines.clear();
  }

  update(position: DrivingPosition, aspectFor: (direction: Direction) => TrafficSignalAspect): PassengerDrivingEvent[] {
    const events: PassengerDrivingEvent[] = [];
    if (!this.previous) {
      this.previous = { x: position.x, z: position.z };
      return events;
    }
    const start = this.previous;
    const dx = position.x - start.x;
    const dz = position.z - start.z;
    // Sweep the segment with samples no farther apart than the center-line dead band.
    // This also catches complete intersection traversals within one physics step.
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / GAME_CONFIG.ride.archetypes.centerLineTolerance));
    for (let i = 1; i <= steps; i++) {
      const next = { x: start.x + dx * i / steps, z: start.z + dz * i / steps };
      this.sample(this.previous!, next, aspectFor, events);
      this.previous = next;
    }
    return events;
  }

  private sample(
    from: DrivingPosition, to: DrivingPosition,
    aspectFor: (direction: Direction) => TrafficSignalAspect, events: PassengerDrivingEvent[],
  ): void {
    const half = GAME_CONFIG.world.roadWidth / 2;
    const stop = half + GAME_CONFIG.trafficSignals.stopLineSetback;
    const x = nearest(to.x, this.roadX);
    const z = nearest(to.z, this.roadZ);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const moving = Math.hypot(dx, dz) > 1e-8;
    if (moving) {
      const reversing = !this.visit && this.isReversingInLane(dx, dz);
      this.reverseDistanceMeters = reversing
        ? this.reverseDistanceMeters + Math.hypot(dx, dz) * GAME_CONFIG.ride.metersPerWorldUnit
        : 0;
    } else {
      this.reverseDistanceMeters = 0;
    }


    // Each approach is armed again only after retreating beyond its stop line or leaving the area.
    for (const cx of this.roadX) {
      if (Math.abs(to.x - cx) > stop + 1) continue;
      for (const cz of this.roadZ) {
        if (Math.abs(to.z - cz) > stop + 1) continue;
        for (const approach of ["north", "south", "east", "west"] as const) {
          const ns = approach === "north" || approach === "south";
          const sign = approach === "south" || approach === "east" ? 1 : -1;
          const center = ns ? cz : cx;
          const a = ((ns ? from.z : from.x) - center) * sign;
          const b = ((ns ? to.z : to.x) - center) * sign;
          const lateral = ns ? Math.abs(to.x - cx) : Math.abs(to.z - cz);
          const key = `${cx}:${cz}:${approach}`;
          if (b < -stop - GAME_CONFIG.ride.archetypes.centerLineTolerance || b > stop) this.crossedStopLines.delete(key);
          if (lateral <= half && a < -stop && b >= -stop && !this.crossedStopLines.has(key)) {
            this.crossedStopLines.add(key);
            if (aspectFor(approach) === "red") events.push("redLight");
          }
        }
      }
    }
    // Bound bookkeeping to the nearby intersection rather than retaining a trip's entire route.
    for (const key of this.crossedStopLines) {
      const [cx, cz] = key.split(":").map(Number);
      if (Math.abs(to.x - cx) > stop + 1 || Math.abs(to.z - cz) > stop + 1) this.crossedStopLines.delete(key);
    }

    const inside = Math.abs(to.x - x) <= half && Math.abs(to.z - z) <= half;
    if (this.visit && (!inside || this.visit.x !== x || this.visit.z !== z)) {
      const visit = this.visit;
      const exitSide = boundarySide(to, visit.x, visit.z);
      const wrongExit = exitSide === "north" ? to.x > visit.x
        : exitSide === "south" ? to.x < visit.x
        : exitSide === "east" ? to.z > visit.z : to.z < visit.z;
      const sameSide = exitSide === visit.entrySide;
      if (!visit.maneuverPenalized && (sameSide ? visit.crossedEntryCenter : wrongExit)
        && this.canReportOpposingLane()) events.push("opposingLane");
      this.opposingEpisode = wrongExit;
      this.visit = null;
      this.lane = null;
    }
    if (inside) {
      if (!this.visit && moving) {
        const entrySide = boundarySide(from, x, z);
        const approach = entrySide === "north" ? "south" : entrySide === "south" ? "north" : entrySide === "east" ? "west" : "east";
        this.visit = {
          x, z, approach, entrySide,
          yellowAwarded: false, maneuverPenalized: false,
          entryLaneSide: Math.sign(approach === "north" || approach === "south" ? from.x - x : from.z - z),
          crossedEntryCenter: false,
        };
      }
      const visit = this.visit;
      if (visit) {
        const offset = visit.approach === "north" || visit.approach === "south" ? to.x - visit.x : to.z - visit.z;
        if (Math.abs(offset) > GAME_CONFIG.ride.archetypes.centerLineTolerance && Math.sign(offset) !== visit.entryLaneSide) {
          visit.crossedEntryCenter = true;
        }
        if (!visit.yellowAwarded && aspectFor(visit.approach) === "yellow") {
          visit.yellowAwarded = true;
          events.push("yellowIntersection");
        }
        // A reversal back toward the approach is a U-turn, unlike a perpendicular legal turn.
        const reverse = visit.approach === "south" ? dz < -Math.abs(dx) * 2
          : visit.approach === "north" ? dz > Math.abs(dx) * 2
          : visit.approach === "east" ? dx < -Math.abs(dz) * 2 : dx > Math.abs(dz) * 2;
        if (moving && reverse && visit.crossedEntryCenter && !visit.maneuverPenalized) {
          visit.maneuverPenalized = true;
          if (this.canReportOpposingLane()) events.push("opposingLane");
        }
      }
      return;
    }
    if (!moving) return;
    const ns = Math.abs(to.x - x) <= half;
    const ew = Math.abs(to.z - z) <= half;
    if (!ns && !ew) { this.lane = null; this.opposingEpisode = false; return; }
    const axis = ns ? "x" : "z";
    const center = ns ? x : z;
    const offset = (ns ? to.x : to.z) - center;
    if (Math.abs(offset) <= GAME_CONFIG.ride.archetypes.centerLineTolerance) return;
    const side = Math.sign(offset);
    const longitudinal = ns ? dz : dx;
    if (Math.abs(longitudinal) < 1e-8 && !this.lane) return;
    const legal = Math.abs(longitudinal) < 1e-8 ? this.lane?.legal ?? false
      : side === (ns ? Math.sign(longitudinal) : -Math.sign(longitudinal));
    if (this.lane?.axis === axis && this.lane.center === center && this.lane.side !== side) {
      // Crossing the center line marks a deliberate lane reversal/U-turn, rather than simple backing.
      this.reverseDistanceMeters = 0;
      if (!this.opposingEpisode) {
        if (this.canReportOpposingLane()) events.push("opposingLane");
        this.opposingEpisode = true;
      }
    } else if (this.lane?.axis !== axis || this.lane.center !== center) {
      this.opposingEpisode = !legal;
    } else if (legal) {
      this.opposingEpisode = false;
    }
    this.lane = { axis, center, side, legal };
  }

  private canReportOpposingLane(): boolean {
    return this.reverseDistanceMeters === 0
      || this.reverseDistanceMeters >= GAME_CONFIG.drivingRules.reverseWrongWayGraceDistanceMeters;
  }

  private isReversingInLane(dx: number, dz: number): boolean {
    if (!this.lane) return false;
    const longitudinal = this.lane.axis === "x" ? dz : dx;
    if (Math.abs(longitudinal) < 1e-8) return false;
    const expectedSign = this.lane.axis === "x" ? this.lane.side : -this.lane.side;
    return Math.sign(longitudinal) !== expectedSign;
  }
}

function nearest(value: number, centers: readonly number[]): number {
  return centers.reduce((best, center) => Math.abs(value - center) < Math.abs(value - best) ? center : best, centers[0] ?? Infinity);
}

function boundarySide(position: DrivingPosition, x: number, z: number): Direction {
  if (Math.abs(position.x - x) > Math.abs(position.z - z)) return position.x > x ? "east" : "west";
  return position.z > z ? "south" : "north";
}
