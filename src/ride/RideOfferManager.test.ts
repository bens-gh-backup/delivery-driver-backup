import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { PlayerCar } from "../player/PlayerCar";
import { TownGenerator } from "../world/Town";
import { getMissionLicense } from "../missions/MissionLicenseCatalog";
import * as archetypes from "./PassengerArchetypes";
import { PassengerType } from "../game/types";
import { RideOfferManager } from "./RideOfferManager";

afterEach(()=>vi.restoreAllMocks());

describe("RideOfferManager", () => {
  it("generates random trip tiers without allowing all three to match", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const town = new TownGenerator(scene).generate();
    const player = new PlayerCar(scene, town.roadSpawnPoints);
    const taxi = getMissionLicense("taxi")!;
    const offers = new RideOfferManager(town.deliveryPoints, player, taxi);
    const roadsById = new Map(town.roads.map((road) => [road.id, road]));

    expect(offers.offers).toHaveLength(3);
    expect(new Set(offers.offers.map((offer) => offer.tier)).size).toBeGreaterThan(1);
    for (const offer of offers.offers) {
      const config = offer.tier === "SHORT"
        ? GAME_CONFIG.ride.tripTiers.short
        : offer.tier === "MEDIUM"
          ? GAME_CONFIG.ride.tripTiers.medium
          : GAME_CONFIG.ride.tripTiers.long;
      expect(offer.tripDistance).toBeGreaterThanOrEqual(config.minDistance);
      expect(offer.tripDistance).toBeLessThanOrEqual(config.maxDistance);
      expect(offer.pickupDistance).toBeLessThanOrEqual(GAME_CONFIG.ride.maxPickupDistance);
      expect(offer.missionCategoryId).toBe("taxi");
      expect(roadsById.get(offer.pickupPoint.roadId)?.allowsMissionStops).toBe(true);
      expect(roadsById.get(offer.destinationPoint.roadId)?.allowsMissionStops).toBe(true);
    }

    const oldestId = offers.offers[2].id;
    offers.update(GAME_CONFIG.ride.offerLifetimeSeconds, true);
    expect(offers.offers[0].id).not.toBe(oldestId);
    expect(offers.offers).toHaveLength(3);
    expect(new Set(offers.offers.map((offer) => offer.tier)).size).toBeGreaterThan(1);
    for (let index = 0; index < 25; index++) {
      offers.refillOffers();
      expect(new Set(offers.offers.map((offer) => offer.tier)).size).toBeGreaterThan(1);
    }
    scene.dispose();
    engine.dispose();
  });

  it("applies each category multiplier after the standard fare calculation", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const town = new TownGenerator(scene).generate();
    const player = new PlayerCar(scene, town.roadSpawnPoints);

    const selection = vi.spyOn(archetypes,"pickPassengerType");
    for (const [type,multiplier] of [[PassengerType.Timid,1.25],[PassengerType.Hurried,1.5],
      [PassengerType.Lawful,1.5],[PassengerType.Careful,1.25],[PassengerType.DrivingInstructor,0],
      [PassengerType.Normal,1]] as const) {
      selection.mockReturnValue(type);
      const category = getMissionLicense("taxi")!;
      const manager = new RideOfferManager(town.deliveryPoints, player, category);
      for (const offer of manager.offers) {
        const effectiveDistance = offer.tripDistance
          + offer.pickupDistance * GAME_CONFIG.ride.fare.pickupDistanceWeight;
        const standardFare = (GAME_CONFIG.ride.fare.baseFare
          + effectiveDistance * GAME_CONFIG.ride.fare.ratePerMeter)
          * offer.fareMultiplier;
        expect(offer.baseFare).toBeCloseTo(standardFare * category.fareMultiplier * multiplier);
      }
    }
    scene.dispose();
    engine.dispose();
  });
});
