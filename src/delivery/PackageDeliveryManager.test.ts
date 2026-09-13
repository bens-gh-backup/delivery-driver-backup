import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { PlayerCar } from "../player/PlayerCar";
import { PlayerProfile } from "../player/PlayerProfile";
import { TownGenerator } from "../world/Town";
import { PackageDeliveryManager, PackageDeliveryState } from "./PackageDeliveryManager";

describe("PackageDeliveryManager", () => {
  it("offers three citywide patients more than 400m from the selected clinic", () => {
    const fixture = createFixture();
    const offer = fixture.manager.offer;

    expect(fixture.manager.offers.getOffers(fixture.region.id)).toHaveLength(3);
    expect(offer.tripDistance).toBeGreaterThan(GAME_CONFIG.ambulanceDriver.minDropoffDistance);
    expect(offer.destinationPoint).toBe(fixture.clinic.destinationPoint);
    expect(offer.initialPayout).toBeCloseTo(offer.tripDistance * GAME_CONFIG.ambulanceDriver.ratePerMeter);
    const roadsById = new Map(fixture.town.roads.map((road) => [road.id, road]));
    expect(roadsById.get(offer.pickupPoint.roadId)?.allowsMissionStops).toBe(true);
    expect(roadsById.get(offer.destinationPoint.roadId)?.allowsMissionStops).toBe(true);
    fixture.manager.update(30);
    expect(fixture.manager.offer.id).toBe(offer.id);
    fixture.dispose();
  });

  it("decays payout from acceptance through pickup and pays the remainder at dropoff", () => {
    const fixture = createFixture();
    const offer = fixture.manager.offer;
    const startingMoney = fixture.profile.money;
    expect(fixture.manager.acceptOffer(offer.id, fixture.region.id)).toBe(true);

    fixture.manager.update(20);
    expect(fixture.manager.payoutMultiplier).toBeCloseTo(
      1 - 20 * GAME_CONFIG.ambulanceDriver.fareDecayPercentPerSecond,
    );

    fixture.player.root.position.copyFrom(offer.pickupPoint.position);
    fixture.manager.update(0);
    expect(fixture.manager.state).toBe(PackageDeliveryState.CarryingPackage);
    fixture.player.root.position.copyFrom(offer.destinationPoint.position);
    fixture.manager.update(0);

    const expectedPayout = offer.initialPayout
      * (1 - 20 * GAME_CONFIG.ambulanceDriver.fareDecayPercentPerSecond);
    expect(fixture.manager.state).toBe(PackageDeliveryState.Idle);
    expect(fixture.manager.lastResult?.payout).toBeCloseTo(expectedPayout);
    expect(fixture.profile.money).toBeCloseTo(startingMoney + expectedPayout);
    expect(fixture.manager.offer.id).not.toBe(offer.id);
    fixture.dispose();
  });

  it("requires the ambulance to slow down at both patient and clinic", () => {
    const f=createFixture(), offer=f.manager.offer;
    expect(f.manager.acceptOffer(offer.id,f.region.id)).toBe(true);
    f.player.root.position.copyFrom(offer.pickupPoint.position);
    (f.player as unknown as {velocityX:number}).velocityX=100;
    f.manager.update(0); expect(f.manager.state).toBe(PackageDeliveryState.DrivingToPickup);
    expect(f.manager.isWaitingForArrivalSpeed()).toBe(true);
    (f.player as unknown as {velocityX:number}).velocityX=0;
    f.manager.update(0); expect(f.manager.state).toBe(PackageDeliveryState.CarryingPackage);
    f.player.root.position.copyFrom(offer.destinationPoint.position);
    (f.player as unknown as {velocityX:number}).velocityX=100;
    f.manager.update(0); expect(f.manager.state).toBe(PackageDeliveryState.CarryingPackage);
    (f.player as unknown as {velocityX:number}).velocityX=0;
    f.manager.update(0); expect(f.manager.state).toBe(PackageDeliveryState.Idle);
    f.dispose();
  });

  it("ends an arrested patient job without payout or training credit", () => {
    const fixture = createFixture();
    const money = fixture.profile.money;
    expect(fixture.manager.acceptOffer(fixture.manager.offer.id, fixture.region.id)).toBe(true);
    expect(fixture.manager.endForArrest()).toBe(true);
    expect(fixture.manager.isActive).toBe(false);
    expect(fixture.manager.lastResult).toBeNull();
    expect(fixture.profile.money).toBe(money);
    fixture.dispose();
  });
});

function createFixture() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const town = new TownGenerator(scene).generate();
  const player = new PlayerCar(scene, town.roadSpawnPoints);
  const profile = new PlayerProfile();
  const region = { id: town.clinics[0].regionId, label: "Region 1", bx: 0, bz: 0,
    minX: town.minX, maxX: town.maxX, minZ: town.minZ, maxZ: town.maxZ,
    x: town.clinics[0].position.x, z: town.clinics[0].position.z, pickups: town.deliveryPoints };
  const clinic = town.clinics[0];
  const manager = new PackageDeliveryManager(scene, town.deliveryPoints, player, profile, [region], town.clinics);
  manager.offers.getOffers(region.id);
  return {
    engine,
    scene,
    player,
    profile,
    town,
    manager,
    region,
    clinic,
    dispose: () => {
      manager.dispose();
      profile.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}
