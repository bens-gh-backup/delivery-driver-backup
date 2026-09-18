import { GAME_CONFIG } from "../game/config";
import type { Clinic, DeliveryPoint } from "../game/types";
import { distanceXZ } from "../utils/math";
import type { PackageDeliveryOffer } from "./PackageDeliveryManager";

export function eligiblePatientClinics(pickup: DeliveryPoint, clinics: readonly Clinic[]): Clinic[] {
  return clinics.filter(clinic => distanceXZ(pickup.position, clinic.destinationPoint.position)
    * GAME_CONFIG.ride.metersPerWorldUnit >= GAME_CONFIG.ambulanceDriver.minDropoffDistance);
}

export function createPatientOffer(pickup: DeliveryPoint, clinics: readonly Clinic[], rng: () => number,
  id: string): PackageDeliveryOffer | null {
  const eligible = eligiblePatientClinics(pickup, clinics);
  if (!eligible.length) return null;
  const destinationPoint = eligible[Math.floor(rng() * eligible.length)].destinationPoint;
  const tripDistance = distanceXZ(pickup.position, destinationPoint.position) * GAME_CONFIG.ride.metersPerWorldUnit;
  return { id, curbside: true, pickupPoint: pickup, destinationPoint, pickupDistance: 0, tripDistance,
    initialPayout: tripDistance * GAME_CONFIG.ambulanceDriver.ratePerMeter };
}
