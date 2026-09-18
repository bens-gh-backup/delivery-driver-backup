import { GAME_CONFIG } from "../game/config";
import type { VehicleAppearance, VehicleDefinition, VehicleStatKey, VehicleStats } from "./VehicleTypes";

interface VehicleRatings {
  acceleration: number;
  topSpeed: number;
  turning: number;
  braking: number;
}

const STARTER_RATINGS: VehicleRatings = {
  acceleration: 45,
  topSpeed: 45,
  turning: 55,
  braking: 45,
};

const STARTER_STATS: VehicleStats = {
  acceleration: GAME_CONFIG.player.acceleration,
  topSpeed: GAME_CONFIG.player.maxForwardSpeed,
  turning: 1,
  braking: GAME_CONFIG.player.braking,
};

const ELITE_STATS: VehicleStats = GAME_CONFIG.progression.eliteVehicleStats;
type ConfiguredVehicleId = keyof typeof GAME_CONFIG.progression.vehiclePrices;

const profiles: Array<{
  id: ConfiguredVehicleId;
  name: string;
  ratings: VehicleRatings;
  color: string;
  size: [number, number, number];
}> = [
  { id: "starter", name: "Starter Beater", ratings: { topSpeed: 45, acceleration: 45, turning: 55, braking: 45 }, color: "#e6b91f", size: [10.2, 5.8, 1.6] },
  { id: "used-compact", name: "Used Compact", ratings: { topSpeed: 50, acceleration: 52, turning: 62, braking: 55 }, color: "#4ca66a", size: [9.1, 5.4, 1.65] },
  { id: "old-sedan", name: "Old Sedan", ratings: { topSpeed: 56, acceleration: 52, turning: 52, braking: 58 }, color: "#a59075", size: [11.1, 5.8, 1.65] },
  { id: "hatchback", name: "Hatchback", ratings: { topSpeed: 58, acceleration: 60, turning: 68, braking: 62 }, color: "#3e8fc9", size: [9.5, 5.6, 1.65] },
  { id: "modern-sedan", name: "Modern Sedan", ratings: { topSpeed: 63, acceleration: 61, turning: 60, braking: 68 }, color: "#d8dde0", size: [11.3, 5.9, 1.55] },
  { id: "sport-compact", name: "Sport Compact", ratings: { topSpeed: 67, acceleration: 70, turning: 76, braking: 70 }, color: "#ef6b38", size: [9.7, 5.8, 1.45] },
  { id: "touring-sedan", name: "Touring Sedan", ratings: { topSpeed: 70, acceleration: 68, turning: 68, braking: 76 }, color: "#4267a8", size: [11.7, 6, 1.55] },
  { id: "hot-hatch", name: "Hot Hatch", ratings: { topSpeed: 73, acceleration: 78, turning: 82, braking: 74 }, color: "#d83c3c", size: [9.4, 5.8, 1.5] },
  { id: "coupe", name: "Coupe", ratings: { topSpeed: 78, acceleration: 80, turning: 77, braking: 77 }, color: "#5d4cc2", size: [10.5, 6, 1.35] },
  { id: "muscle-car", name: "Muscle Car", ratings: { topSpeed: 85, acceleration: 88, turning: 67, braking: 70 }, color: "#26282b", size: [11.2, 6.5, 1.45] },
  { id: "sport-sedan", name: "Sport Sedan", ratings: { topSpeed: 84, acceleration: 83, turning: 82, braking: 84 }, color: "#2c8b80", size: [11.2, 6.1, 1.45] },
  { id: "performance-coupe", name: "Performance Coupe", ratings: { topSpeed: 90, acceleration: 88, turning: 86, braking: 85 }, color: "#f0a62e", size: [10.6, 6.2, 1.3] },
  { id: "grand-tourer", name: "Grand Tourer", ratings: { topSpeed: 93, acceleration: 87, turning: 82, braking: 88 }, color: "#6d7882", size: [11.5, 6.3, 1.35] },
  { id: "exotic-coupe", name: "Exotic Coupe", ratings: { topSpeed: 96, acceleration: 94, turning: 91, braking: 91 }, color: "#e14932", size: [10.2, 6.4, 1.15] },
  { id: "supercar", name: "Supercar", ratings: { topSpeed: 98, acceleration: 97, turning: 95, braking: 95 }, color: "#17a5a1", size: [10.1, 6.5, 1.1] },
  { id: "elite-sports-car", name: "Elite Sports Car", ratings: { topSpeed: 100, acceleration: 100, turning: 100, braking: 100 }, color: "#f2f4f5", size: [10, 6.6, 1.05] },
];

export const VEHICLE_CATALOG: readonly VehicleDefinition[] = profiles.map((profile) => {
  const [bodyLength, bodyWidth, bodyHeight] = profile.size;
  return {
    id: profile.id,
    name: profile.name,
    price: GAME_CONFIG.progression.vehiclePrices[profile.id],
    stats: ratingsToStats(profile.ratings),
    appearance: {
      bodyColor: profile.color,
      bodyLength,
      bodyWidth,
      bodyHeight,
      cabinLength: bodyLength * (bodyHeight < 1.25 ? 0.38 : 0.42),
      cabinWidth: bodyWidth * 0.7,
      cabinHeight: Math.max(0.7, bodyHeight * 0.7),
    },
  };
});

export const STARTER_VEHICLE = VEHICLE_CATALOG[0];
export const ELITE_VEHICLE = VEHICLE_CATALOG[VEHICLE_CATALOG.length - 1];
export const AMBULANCE_VEHICLE: VehicleDefinition = {
  id: "mission-ambulance", name: "Clinic Ambulance", price: 0,
  stats: { ...GAME_CONFIG.ambulanceDriver.ambulanceStats },
  appearance: {
    bodyColor: "#e9eeee", bodyLength: 12.2, bodyWidth: 6.25, bodyHeight: 1.8,
    cabinLength: 7.2, cabinWidth: 5.65, cabinHeight: 2.75, role: "ambulance",
  },
};

export const POLICE_VEHICLE: VehicleDefinition = {
  id: "mission-police", name: "Pursuit Cruiser", price: 0,
  stats: { ...GAME_CONFIG.policeChase.policeHandling,
    topSpeed: GAME_CONFIG.policeChase.policeTopSpeedMph / GAME_CONFIG.ride.mphPerWorldUnitPerSecond },
  appearance: { bodyColor: "#edf0ef", bodyLength: 10.8, bodyWidth: 5.8, bodyHeight: 1.7,
    cabinLength: 4.5, cabinWidth: 4.7, cabinHeight: 1.5, role: "police" },
};

const VEHICLES_BY_ID = new Map(VEHICLE_CATALOG.map((vehicle) => [vehicle.id, vehicle]));

export function getVehicleDefinition(id: string): VehicleDefinition | null {
  return VEHICLES_BY_ID.get(id) ?? null;
}

export function normalizedVehicleStat(vehicle: VehicleDefinition, stat: VehicleStatKey): number {
  return Math.min(1, vehicle.stats[stat] / ELITE_VEHICLE.stats[stat]);
}

function ratingsToStats(ratings: VehicleRatings): VehicleStats {
  return {
    acceleration: mapRating("acceleration", ratings.acceleration),
    topSpeed: mapRating("topSpeed", ratings.topSpeed),
    turning: mapRating("turning", ratings.turning),
    braking: mapRating("braking", ratings.braking),
  };
}

function mapRating(stat: VehicleStatKey, rating: number): number {
  const starterRating = STARTER_RATINGS[stat];
  const amount = (rating - starterRating) / (100 - starterRating);
  return STARTER_STATS[stat] + (ELITE_STATS[stat] - STARTER_STATS[stat]) * amount;
}
