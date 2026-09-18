import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GAME_CONFIG } from "../game/config";
import type { BoxCollider, DeliveryPoint, RoadDefinition } from "../game/types";
import type { Town } from "../world/Town";
import { isDevelopedBlock } from "../world/CityDistricts";
import { entranceApproach } from "../world/StreetDetails";
import { roadSurfaceHalfWidth, WORLD_SURFACES } from "../world/SurfaceLayout";
import { CITY_STYLE } from "../world/CityStyle";
import patient from "./assets/patient.json";
import type { WorldQuery } from "../world/WorldQuery";

export interface PassengerLocation {
  blockId: string;
  position: Vector3;
  pickupPoint: DeliveryPoint;
  heading: number;
  road: RoadDefinition;
  side: -1 | 1;
  minAlong: number;
  maxAlong: number;
}

/** Build street-side samples once; never search every building during gameplay. */
export function passengerLocations(town: Town, world: WorldQuery, rng: () => number, kind: "taxi" | "patient" = "taxi"): PassengerLocation[] {
  const locations: PassengerLocation[] = [], nearby: BoxCollider[] = [];
  const approaches = town.buildings.map(entranceApproach);
  const scale = GAME_CONFIG.ride.metersPerWorldUnit;
  const patientHalfWidth = (patient.maximum[0]-patient.minimum[0]) * GAME_CONFIG.passengers.modelWorldScale/2;
  const patientHalfLength = (patient.maximum[2]-patient.minimum[2]) * GAME_CONFIG.passengers.modelWorldScale/2;
  const halfRoad = GAME_CONFIG.world.roadWidth / 2;
  const clearance = GAME_CONFIG.passengers.intersectionClearanceMeters / scale;
  const xs = town.roadPositionsX, zs = town.roadPositionsZ;
  for (const { bx, bz } of town.districts) {
    if (!isDevelopedBlock(bx, bz, xs.length - 1, zs.length - 1)) continue;
    for (const [axis, index, side] of [
      ["northSouth", bx, 1], ["northSouth", bx + 1, -1],
      ["eastWest", bz, 1], ["eastWest", bz + 1, -1],
    ] as const) {
      const road = town.roads.find(r => r.axis === axis && r.index === index);
      if (!road || road.type !== "city" || !road.allowsMissionStops) continue;
      const ns = axis === "northSouth";
      const minAlong = (ns ? zs[bz] : xs[bx]) + halfRoad + clearance;
      const maxAlong = (ns ? zs[bz + 1] : xs[bx + 1]) - halfRoad - clearance;
      const inset = kind === "patient" ? CITY_STYLE.streetDetails.curbWidth + patientHalfWidth + .1
        : GAME_CONFIG.passengers.sidewalkInset;
      const across = road.center + side * (roadSurfaceHalfWidth() + inset);
      const halfX = kind === "patient" ? (ns ? patientHalfWidth : patientHalfLength) + .1 : 1.2;
      const halfZ = kind === "patient" ? (ns ? patientHalfLength : patientHalfWidth) + .1 : 1.2;
      // Jittered eight-unit spacing leaves many more choices than waiting people.
      for (let along = minAlong + rng() * 8; along < maxAlong; along += 8) {
        const x = ns ? across : along, z = ns ? along : across;
        world.getNearbyColliders(x, z, Math.max(halfX,halfZ), nearby);
        const overlapsFootprint = (a: BoxCollider, padding = 0) => Math.abs(x-a.x) < halfX+a.halfX+padding
          && Math.abs(z-a.z) < halfZ+a.halfZ+padding;
        // These developed-block edge samples are on the visible sidewalk, including the
        // forgiving strip inside WorldQuery's logical road bounds. Keep service gaps clear.
        if (nearby.some(a => overlapsFootprint(a))
          || town.legalDrivingAreas.some(a => overlapsFootprint(a,.8))
          || approaches.some(a => overlapsFootprint(a))) continue;
        const stopAcross = road.center + side * (halfRoad - 5);
        locations.push({ blockId: `block-${bx}-${bz}`, position: new Vector3(x, WORLD_SURFACES.sidewalk + .015, z),
          pickupPoint: { roadId: road.id, position: new Vector3(ns ? stopAcross : along, .1, ns ? along : stopAcross) },
          heading: kind === "patient" ? (ns ? 0 : Math.PI/2) : ns ? -side * Math.PI/2 : side === 1 ? Math.PI : 0,
          road, side, minAlong, maxAlong });
      }
    }
  }
  return locations;
}

export function isBesidePassenger(location: PassengerLocation, position: { x: number; z: number }): boolean {
  const ns = location.road.axis === "northSouth";
  const lateral = (ns ? position.x : position.z) - location.road.center;
  const along = ns ? position.z : position.x;
  return Math.sign(lateral) === location.side && Math.abs(lateral) <= roadSurfaceHalfWidth()
    && along >= location.minAlong && along <= location.maxAlong;
}
