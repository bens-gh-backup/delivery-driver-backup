import type { TrainingContext } from "../training/Training";
import { passengerFareMultiplier, pickPassengerType } from "./PassengerArchetypes";
import { GAME_CONFIG } from "../game/config";
import type { DeliveryPoint, RideOffer, RideTier } from "../game/types";
import { distanceXZ, randomBetween } from "../utils/math";
import type { MissionLicenseDefinition } from "../missions/MissionLicenseCatalog";

const FIRST_NAMES = [
  "Amanda",
  "Marcus",
  "Daniel",
  "Sarah",
  "Chris",
  "Nina",
  "Sophie",
  "Jordan",
  "Priya",
  "Leo",
  "Maya",
  "Ethan",
  "Riley",
  "Taylor",
  "Dante",
  "Mina",
];

const LAST_INITIALS = ["A.", "B.", "C.", "D.", "G.", "K.", "L.", "M.", "R.", "S.", "T.", "V.", "W."];
export function createRideOffer(points: readonly DeliveryPoint[], pickupPoint: DeliveryPoint, tier: RideTier,
  category: MissionLicenseDefinition, rng: () => number, id: string, pickupDistanceMeters = 0,
  training?: TrainingContext, ageSeconds = 0): RideOffer {
    const destinationPoint = pickRideDestination(points, pickupPoint, tier, rng);
    const pickupDistance = pickupDistanceMeters;
    const tripDistance = distanceXZ(pickupPoint.position, destinationPoint.position) * GAME_CONFIG.ride.metersPerWorldUnit;
    const fareMultiplier = randomBetween(
      rng,
      GAME_CONFIG.ride.fare.randomMultiplierMin,
      GAME_CONFIG.ride.fare.randomMultiplierMax,
    );
    const effectiveDistance = tripDistance + pickupDistance * GAME_CONFIG.ride.fare.pickupDistanceWeight;
    const standardBaseFare = (GAME_CONFIG.ride.fare.baseFare + effectiveDistance * GAME_CONFIG.ride.fare.ratePerMeter)
      * fareMultiplier;
    const passengerType = pickPassengerType(rng);
    const baseFare = standardBaseFare * category.fareMultiplier * passengerFareMultiplier(passengerType);

    return {
      id: id,
      training: training,
      missionCategoryId: category.id,
      categoryFareMultiplier: category.fareMultiplier,
      tier,
      passengerName: generateName(rng),
      passengerType,
      pickupPoint,
      destinationPoint,
      pickupDistance,
      tripDistance,
      fareMultiplier,
      baseFare,
      ageSeconds,
    };
}

function pickRideDestination(points: readonly DeliveryPoint[], pickup: DeliveryPoint, tier: RideTier, rng: () => number): DeliveryPoint {
    const band = tier === "SHORT" ? GAME_CONFIG.ride.tripTiers.short : tier === "MEDIUM" ? GAME_CONFIG.ride.tripTiers.medium : GAME_CONFIG.ride.tripTiers.long;
    const candidates = points.filter((point) => {
      const distance = distanceXZ(point.position, pickup.position) * GAME_CONFIG.ride.metersPerWorldUnit;
      return point !== pickup && distance >= band.minDistance && distance <= band.maxDistance;
    });
    if (candidates.length > 0) {
      return candidates[Math.floor(rng() * candidates.length)];
    }

    const targetDistance = (band.minDistance + band.maxDistance) / 2;
    return points
      .filter((point) => point !== pickup)
      .reduce((best, point) => {
        const bestDistance = Math.abs(distanceXZ(best.position, pickup.position) * GAME_CONFIG.ride.metersPerWorldUnit - targetDistance);
        const pointDistance = Math.abs(distanceXZ(point.position, pickup.position) * GAME_CONFIG.ride.metersPerWorldUnit - targetDistance);
        return pointDistance < bestDistance ? point : best;
      });
}

function generateName(rng: () => number): string {
  return `${FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]} ${LAST_INITIALS[Math.floor(rng() * LAST_INITIALS.length)]}`;
}
