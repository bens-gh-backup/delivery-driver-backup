import { expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { ProgressionStore } from "../progression/ProgressionStore";
import type { RaceResult } from "../racing/RaceManager";
import type { TrainingRegion } from "../training/Training";
import { defaultProgression, PlayerProfile } from "./PlayerProfile";

function fixture(save = defaultProgression()) {
  let value: string | null = JSON.stringify(save);
  const store = new ProgressionStore({ getItem: () => value, setItem: (_k, v) => { value = v; }, removeItem: () => { value = null; } });
  const profile = new PlayerProfile(store);
  profile.configureTrainingRegions([{id: "block-2-2"} as TrainingRegion]);
  return {profile, store};
}

it.each([[1,10000,10], [2,5000,3], [3,2000,1.5], [4,1000,.5], [5,500,.1], [6,100,.05], [7,0,0]])(
  "awards place %s once, with cash %s and permanent income %s", (finishPlace, cash, income) => {
    const {profile,store} = fixture(), before = profile.money;
    const result: RaceResult = {regionId:"block-2-2", finishPlace};
    expect(profile.completeStreetRace(result)).toBe(true);
    expect(profile.completeStreetRace(result)).toBe(false);
    expect(profile.money).toBe(before + cash);
    expect(result).toMatchObject({cashEarned:cash, passiveIncomeGain:income});
    const loaded = new PlayerProfile(store);
    expect(loaded.passiveIncomePerSecond).toBe(income);
    loaded.accrueTrainingIncome(4);
    expect(loaded.money).toBe(before + cash + 4 * income);
  },
);

it("rewards every new finish, even at the same course and with a worse result", () => {
  const {profile} = fixture(), before = profile.money;
  for (const finishPlace of [1,1,6]) profile.completeStreetRace({regionId:"block-2-2", finishPlace});
  expect(profile.money).toBe(before + 20100);
  expect(profile.passiveIncomePerSecond).toBe(20.05);
  expect(profile.getBestRaceFinish("block-2-2")).toBe(1);
});

it.each([0,8,2.5,NaN,Infinity])("rejects invalid placing %s without a reward", finishPlace => {
  const {profile} = fixture(), before = profile.money;
  expect(profile.completeStreetRace({regionId:"block-2-2",finishPlace})).toBe(false);
  expect(profile.money).toBe(before); expect(profile.passiveIncomePerSecond).toBe(0);
});

it("migrates v12 cash, licenses, all earned income and records without inventing race rewards", () => {
  const save = {...defaultProgression(), version:12, money:1234, taxiPassiveIncomePerSecond:.037,
    ambulancePassiveIncomePerSecond:.15, policeChasePassiveIncomePerSecond:2,
    racingPassiveIncomePerSecond:999, racingLicenseOwned:true, bestRaceFinishes:{"block-2-2":1}};
  const {profile,store} = fixture(save);
  expect(profile.money).toBe(1234); expect(profile.ownsRacingLicense).toBe(true);
  expect(profile.purchaseRacingLicense()).toBe(false); expect(profile.money).toBe(1234);
  expect(profile.getBestRaceFinish("block-2-2")).toBe(1);
  expect(profile.passiveIncomePerSecond).toBeCloseTo(2.187);
  profile.saveNow(); expect(new PlayerProfile(store).passiveIncomePerSecond).toBeCloseTo(2.187);
});

it("charges the license once and preserves it across reload", () => {
  const {profile,store} = fixture({...defaultProgression(),money:9999});
  expect(profile.purchaseRacingLicense()).toBe(false);
  profile.addMoney(1); expect(profile.purchaseRacingLicense()).toBe(true);
  expect(profile.money).toBe(0); expect(profile.purchaseRacingLicense()).toBe(false);
  expect(new PlayerProfile(store).ownsRacingLicense).toBe(true);
});

it("tuning rewards changes future results only, and reset clears saved race income", () => {
  const {profile,store} = fixture(); profile.completeStreetRace({regionId:"block-2-2",finishPlace:1});
  const previous = {...GAME_CONFIG.racing.finishRewards[0]};
  try {
    Object.assign(GAME_CONFIG.racing.finishRewards[0], {cash:30,incomePerSecond:.12});
    expect(new PlayerProfile(store).passiveIncomePerSecond).toBe(10);
    profile.completeStreetRace({regionId:"block-2-2",finishPlace:1});
    expect(profile.passiveIncomePerSecond).toBe(10.12);
    profile.clearSave(); expect(new PlayerProfile(store).passiveIncomePerSecond).toBe(0);
  } finally { Object.assign(GAME_CONFIG.racing.finishRewards[0],previous); }
});
