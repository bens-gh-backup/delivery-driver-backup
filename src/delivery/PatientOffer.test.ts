import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Clinic, DeliveryPoint } from "../game/types";
import { GAME_CONFIG } from "../game/config";
import { createPatientOffer, eligiblePatientClinics } from "./PatientOffer";
import { PackageOfferBoard } from "./PackageOfferBoard";
import type { PlayerCar } from "../player/PlayerCar";

const point = (meters: number): DeliveryPoint => ({roadId:"city", position:new Vector3(meters / GAME_CONFIG.ride.metersPerWorldUnit,0,0)});
const clinic = (meters: number) => ({destinationPoint:point(meters)}) as Clinic;
describe("curbside clinic destinations", () => {
  it("accepts the exact minimum and samples only eligible clinics without moving the pickup", () => {
    const pickup=point(0), clinics=[clinic(999),clinic(1000),clinic(1800)];
    expect(eligiblePatientClinics(pickup,clinics)).toEqual(clinics.slice(1));
    const offer=createPatientOffer(pickup,clinics,()=>0,"patient")!;
    expect(offer.pickupPoint).toBe(pickup);expect(offer.destinationPoint).toBe(clinics[1].destinationPoint);
    expect(offer.tripDistance).toBe(1000);expect(offer.initialPayout).toBe(200);
    expect(offer.curbside).toBe(true);expect(offer.training).toBeUndefined();
    expect(createPatientOffer(pickup,clinics,()=>.99,"patient")!.tripDistance).toBe(1800);
  });
  it("never falls back to a nearby clinic or a nearby legacy pickup", () => {
    expect(createPatientOffer(point(0),[clinic(999)],()=>0,"patient")).toBeNull();
    expect(createPatientOffer(point(0),[],()=>0,"patient")).toBeNull();
    const player={root:{position:Vector3.Zero()}} as PlayerCar;
    expect(new PackageOfferBoard([point(0),point(100)],player,[],[clinic(500)]).getOffers()).toEqual([]);
  });
});
