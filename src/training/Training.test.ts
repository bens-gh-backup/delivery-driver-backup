import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TRAINING_CATEGORIES, categoryIncome, createTrainingRegions, sanitizeTrainingProgress, TrainingIncomeClock } from "./Training";
import { PlayerProfile, defaultProgression } from "../player/PlayerProfile";
import { ProgressionStore } from "../progression/ProgressionStore";
import { RideOfferBoard } from "../ride/RideOfferBoard";
import { RideManager } from "../ride/RideManager";
import { PackageDeliveryManager } from "../delivery/PackageDeliveryManager";
import { GAME_CONFIG } from "../game/config";
import { PassengerType, type DeliveryPoint, type RoadDefinition } from "../game/types";
import type { PlayerCar } from "../player/PlayerCar";

function grid(nx = 7, nz = 7) {
  const xs = Array.from({ length: nx + 1 }, (_, i) => i * 425);
  const zs = Array.from({ length: nz + 1 }, (_, i) => i * 425);
  const roads: RoadDefinition[] = [];
  const deliveryPoints: DeliveryPoint[] = [];
  for (const [axis, coordinates, across] of [["northSouth", xs, zs], ["eastWest", zs, xs]] as const) {
    coordinates.forEach((center, index) => {
      const highway = index === 0 || index === coordinates.length - 1;
      const id = `${axis}-${index}`;
      roads.push({ id, axis, index, center, type: highway ? "highway" : "city", speedLimitMph: 60, allowsMissionStops: !highway });
      for (let i = 0; i < across.length - 1; i++) for (const side of [-1, 1]) {
        const mid = (across[i] + across[i + 1]) / 2;
        deliveryPoints.push({ roadId: id, position: axis === "northSouth"
          ? new Vector3(center + side * 20, .1, mid) : new Vector3(mid, .1, center + side * 20) });
      }
    });
  }
  return { roadPositionsX: xs, roadPositionsZ: zs, roads, deliveryPoints };
}
function fixture() {
  const town = grid(), regions = createTrainingRegions(town);
  const eligible = new Set(town.roads.filter(r => r.allowsMissionStops).map(r => r.id));
  const points = town.deliveryPoints.filter(p => eligible.has(p.roadId));
  const player = { root: { position: Vector3.Zero() }, getSpeedMph: () => 0 } as unknown as PlayerCar;
  let saved: string | null = null, writes = 0;
  const store = new ProgressionStore({ getItem: () => saved, setItem: (_, value) => { saved = value; writes++; }, removeItem: () => { saved = null; } });
  const profile = new PlayerProfile(store);
  profile.configureTrainingRegions(regions);
  return { town, regions, points, player, profile, store, writes: () => writes };
}

describe("regional AI training", () => {
  it.each([[6, 6], [7, 7], [4, 9], [9, 4]])("assigns legal road sides uniquely across a %i by %i map", (nx, nz) => {
    const town = grid(nx, nz), regions = createTrainingRegions(town);
    expect(regions).toHaveLength(nx * nz);
    expect(regions.every(r => r.pickups.length > 0)).toBe(true);
    const assigned = regions.flatMap(r => r.pickups);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect(assigned).toHaveLength(town.deliveryPoints.filter(p => town.roads.find(r => r.id === p.roadId)!.allowsMissionStops).length);
    expect(regions.find(r => r.id === "block-2-2")?.bx).toBe(2);
    for (const region of regions) for (const p of region.pickups) {
      expect(p.position.x >= region.minX && p.position.x < region.maxX && p.position.z >= region.minZ && p.position.z < region.maxZ).toBe(true);
    }
  });

  it("matches every documented income step and clamps malformed counts", () => {
    for (const category of TRAINING_CATEGORIES) {
      expect(categoryIncome(category.id,0)).toBe(0);
      const completesCategory = Number(category.required) === 1;
      expect(categoryIncome(category.id,1)).toBe(
        category.passiveIncomePerMission * (completesCategory ? category.completionMultiplier : 1),
      );
      expect(categoryIncome(category.id,category.required)).toBeCloseTo(
        category.required * category.passiveIncomePerMission * category.completionMultiplier,
      );
      expect(categoryIncome(category.id,category.required+10)).toBe(categoryIncome(category.id,category.required));
    }
    const taxi = TRAINING_CATEGORIES.find(category=>category.id==="taxi")!;
    expect(sanitizeTrainingProgress({ "block-0-0": { rideshare: 99, ambulance_driver: -4, rideshare_silver: 1.8 }, bad: { taxi: 5 } }))
      .toEqual({ "block-0-0": { taxi: taxi.required, ambulance_driver: 0 } });
  });

  it("returns exact transient income receipts including completion bonuses and race multipliers", () => {
    const f = fixture(), region = f.regions[0];
    f.profile.debugUnlockRacing();
    f.profile.recordRaceFinish(region.id, 2);
    const multiplier = f.profile.getRaceMultiplier(region.id);
    const category = TRAINING_CATEGORIES.find(c => c.id === "ambulance_driver")!;
    for (let before = 0; before < category.required; before++) {
      const reward = f.profile.completeAmbulanceJob(0, { regionId: region.id, categoryId: category.id });
      expect(reward).toMatchObject({ regionId: region.id, categoryId: category.id,
        before, after: before + 1, required: category.required });
      expect(reward!.incomeBefore).toBeCloseTo(categoryIncome(category.id, before) * multiplier);
      expect(reward!.incomeAfter).toBeCloseTo(categoryIncome(category.id, before + 1) * multiplier);
    }
    expect(f.profile.completeAmbulanceJob(5, { regionId: region.id, categoryId: category.id })).toBeNull();
    expect(f.profile.completeAmbulanceJob(0)).toBeNull();
    expect(f.profile.completeAmbulanceJob(0, { regionId: "missing", categoryId: category.id })).toBeNull();
    const saved = f.store.load()!;
    expect(saved).not.toHaveProperty("lastTrainingReward");
    const restored = new PlayerProfile(f.store); restored.configureTrainingRegions(f.regions);
    expect(restored.passiveIncomePerSecond).toBeCloseTo(f.profile.passiveIncomePerSecond);
  });

  it("pays fractional active income without frame saves and persists progress with payment", () => {
    const f = fixture(), region = f.regions[0];
    const unitIncome = categoryIncome("ambulance_driver", 1);
    f.profile.completePackage(7, { regionId: region.id, categoryId: "ambulance_driver" });
    expect(f.profile.passiveIncomePerSecond).toBe(unitIncome);
    const writes = f.writes(), money = f.profile.money;
    for (let i = 0; i < 60; i++) f.profile.accrueTrainingIncome(1 / 60);
    expect(f.writes()).toBe(writes);
    expect(f.profile.money).toBeCloseTo(money + unitIncome, 8);
    f.profile.updateAutosave(GAME_CONFIG.progression.autosaveSeconds);
    const reload = new PlayerProfile(f.store); reload.configureTrainingRegions(f.regions);
    expect(reload.money).toBeCloseTo(f.profile.money, 8);
    expect(reload.passiveIncomePerSecond).toBe(unitIncome);
    expect(reload.getTrainingCount(region.id, "ambulance_driver")).toBe(1);
    const before = reload.money;
    reload.accrueTrainingIncome(2);
    expect(reload.money).toBeCloseTo(before + unitIncome*2, 8);
  });

  it("migrates v5, derives full-city income, excludes absent regions and resets training", () => {
    const f = fixture(), source = defaultProgression();
    f.store.save({ ...source, version: 5, money: 123,
      ownedMissionLicenseIds: ["rideshare", "taxi", "rideshare_silver"] as never, trainingProgress: undefined! });
    let profile = new PlayerProfile(f.store); profile.configureTrainingRegions(f.regions);
    expect(profile.money).toBe(123); expect(profile.ownsMissionLicense("taxi")).toBe(true);
    expect(profile.passiveIncomePerSecond).toBe(0);
    const progress = Object.fromEntries(f.regions.map(region => [region.id, Object.fromEntries(TRAINING_CATEGORIES.map(c => [c.id,c.required]))]));
    const fullRegionIncome = TRAINING_CATEGORIES.reduce((sum,category)=>sum
      + category.required*category.passiveIncomePerMission*category.completionMultiplier,0);
    f.store.save({ ...source, trainingProgress: progress });
    profile = new PlayerProfile(f.store); profile.configureTrainingRegions(f.regions);
    expect(profile.passiveIncomePerSecond).toBeCloseTo(f.regions.length*fullRegionIncome);
    profile.configureTrainingRegions(createTrainingRegions(grid(6, 6)));
    expect(profile.passiveIncomePerSecond).toBeCloseTo(36*fullRegionIncome);
    expect(profile.getTrainingCount("block-5-5", "taxi")).toBe(GAME_CONFIG.progression.training.taxi.requiredMissionsPerRegion);
    profile.configureTrainingRegions(f.regions.slice(0,1));
    expect(profile.passiveIncomePerSecond).toBeCloseTo(fullRegionIncome);
    profile.completePackage(1, { regionId: f.regions[0].id, categoryId: "ambulance_driver" });
    expect(profile.getTrainingCount(f.regions[0].id, "ambulance_driver"))
      .toBe(GAME_CONFIG.progression.training.ambulance_driver.requiredMissionsPerRegion);
    expect(profile.passiveIncomePerSecond).toBeCloseTo(fullRegionIncome);
    profile.clearSave();
    profile = new PlayerProfile(f.store); profile.configureTrainingRegions(f.regions);
    expect(profile.passiveIncomePerSecond).toBe(0);
  });

  it("discards paused and hidden clock intervals without capping visible elapsed time", () => {
    const clock = new TrainingIncomeClock();
    expect(clock.tick(1000, true)).toBe(0);
    expect(clock.tick(3000, true)).toBe(2);
    expect(clock.tick(4000, false)).toBe(0);
    expect(clock.tick(9000, true)).toBe(0);
    expect(clock.tick(9500, true)).toBe(.5);
    clock.reset();
    expect(clock.tick(99000, true)).toBe(0);
  });

  it("keeps regional choices across navigation and movement, with independent timed passenger replacement", () => {
    const f = fixture(), a = f.regions[0], b = f.regions.at(-1)!;
    const board = new RideOfferBoard(f.points, f.player, f.regions);
    const first = [...board.getOffers("taxi", a.id)];
    const second = [...board.getOffers("taxi", b.id)];
    expect(first).toHaveLength(3); expect(second).toHaveLength(3);
    expect(first.every(offer => a.pickups.includes(offer.pickupPoint))).toBe(true);
    expect(second.every(offer => b.pickups.includes(offer.pickupPoint))).toBe(true);
    expect(new Set([...first,...second].map(o => o.id)).size).toBe(6);
    f.player.root.position.set(9000,0,9000);
    expect(board.getOffers("taxi", a.id)).toEqual(first);
    board.update(999, false, ["taxi"]);
    expect(board.getOffers("taxi", a.id)).toEqual(first);
    board.ensurePool("taxi", a.id)!.update(GAME_CONFIG.ride.offerLifetimeSeconds, true);
    expect(board.getOffers("taxi", a.id).map(o => o.id)).not.toEqual(first.map(o => o.id));
    expect(board.getOffers("taxi", b.id)).toEqual(second);
    expect(board.ensurePool("taxi", "missing")).toBeNull();
  });

  it("credits Taxi training once and keeps automated jobs paid", () => {
    const categoryId = "taxi" as const;
    const f = fixture(), region = f.regions[0], engine = new NullEngine(), scene = new Scene(engine);
    const board = new RideOfferBoard(f.points, f.player, f.regions);
    const rides = new RideManager(scene, board, f.profile);
    try {
      const training = GAME_CONFIG.progression.training.taxi;
      const required = training.requiredMissionsPerRegion;
      const rate = required*training.passiveIncomePerMission*training.completionMultiplier;
      for (let i = 0; i <= required; i++) {
        const offer = board.getOffers(categoryId, region.id)[0];
        offer.passengerType = PassengerType.Normal;
        expect(rides.acceptRide(categoryId, offer.id, region.id)).toBe(true);
        board.getOffers("taxi", f.regions.at(-1)!.id);
        f.player.root.position.copyFrom(offer.pickupPoint.position); rides.update(0,f.player,true);
        f.player.root.position.copyFrom(offer.destinationPoint.position); rides.update(0,f.player,true);
        rides.update(0,f.player,true);
        expect(f.profile.getTrainingCount(region.id,categoryId)).toBe(Math.min(required,i+1));
        if (i < required) {
          expect(rides.lastTrainingReward).toMatchObject({ regionId: region.id, categoryId, before: i, after: i + 1 });
          expect(rides.lastTrainingReward!.incomeAfter - rides.lastTrainingReward!.incomeBefore)
            .toBeCloseTo(categoryIncome(categoryId, i + 1) - categoryIncome(categoryId, i));
        } else expect(rides.lastTrainingReward).toBeNull();
      }
      expect(f.profile.completedRides).toBe(required+1);
      expect(f.profile.passiveIncomePerSecond).toBeCloseTo(rate);
    } finally { scene.dispose(); engine.dispose(); }
  });

  it("keeps three package choices, credits zero-payout deliveries, and excludes confiscations", () => {
    const f = fixture(), region = f.regions[0], engine = new NullEngine(), scene = new Scene(engine);
    const clinics = f.regions.map(region => ({ id:`clinic-${region.id}`, regionId:region.id,
      position:new Vector3(region.x,0,region.z), destinationPoint:region.pickups[0] }));
    const manager = new PackageDeliveryManager(scene,f.points,f.player,f.profile,f.regions,clinics);
    try {
      const offers = [...manager.offers.getOffers(region.id)];
      expect(offers).toHaveLength(3);
      expect(offers.every(o => o.destinationPoint === clinics[0].destinationPoint)).toBe(true);
      manager.offers.getOffers(f.regions[1].id);
      expect(manager.offers.getOffers(region.id)).toEqual(offers);
      expect(manager.acceptOffer(offers[1].id,region.id)).toBe(true);
      manager.elapsedSeconds = 100000;
      f.player.root.position.copyFrom(offers[1].pickupPoint.position); manager.update(0);
      f.player.root.position.copyFrom(offers[1].destinationPoint.position); manager.update(0); manager.update(0);
      expect(manager.lastResult?.payout).toBe(0);
      expect(f.profile.getTrainingCount(region.id,"ambulance_driver")).toBe(1);
      const next = manager.offers.getOffers(region.id)[0];
      expect(manager.offers.getOffers(region.id)).toHaveLength(3);
      manager.acceptOffer(next.id,region.id);
      manager.endForArrest();
      expect(f.profile.getTrainingCount(region.id,"ambulance_driver")).toBe(1);
    } finally { scene.dispose(); engine.dispose(); }
  });
});
