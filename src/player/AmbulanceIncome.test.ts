import { describe, expect, it } from "vitest";
import { PlayerProfile, defaultProgression } from "./PlayerProfile";
import { ProgressionStore, type KeyValueStorage } from "../progression/ProgressionStore";
import type { PackageDeliveryResult } from "../delivery/PackageDeliveryManager";
import { GAME_CONFIG } from "../game/config";

function fixture(save = defaultProgression()) {
  let value: string | null = JSON.stringify(save);
  const storage: KeyValueStorage = { getItem:()=>value, setItem:(_k,v)=>{value=v;}, removeItem:()=>{value=null;} };
  const store = new ProgressionStore(storage);
  return {store, profile:new PlayerProfile(store)};
}
const receipt = (payout: number): PackageDeliveryResult => ({curbside:true,initialPayout:200,payout,
  pickupDistance:0,tripDistance:1000,durationSeconds:20});
describe("ambulance permanent income", () => {
  it.each([0,75,200])("credits five cents per second exactly once even for a $%s payout", payout => {
    const {profile,store}=fixture(), result=receipt(payout), money=profile.money;
    profile.completeCurbsideAmbulanceJob(result);profile.completeCurbsideAmbulanceJob(result);
    expect(profile.money).toBe(money+payout);expect(profile.passiveIncomePerSecond).toBe(.05);
    expect(result.passiveIncomeGain).toBe(.05);expect(new PlayerProfile(store).passiveIncomePerSecond).toBe(.05);
    profile.accrueTrainingIncome(10);expect(profile.money).toBeCloseTo(money+payout+.5);
  });
  it("migrates v10 taxi income and owned licenses without crediting prior hospital jobs", () => {
    const {profile,store}=fixture({...defaultProgression(),version:10,taxiPassiveIncomePerSecond:.042842,
      ambulancePassiveIncomePerSecond:999,money:750,ownedMissionLicenseIds:["taxi","ambulance_driver"]});
    expect(profile.passiveIncomePerSecond).toBe(.042842);expect(profile.money).toBe(750);
    expect(profile.ownsMissionLicense("ambulance_driver")).toBe(true);
    profile.completeCurbsideAmbulanceJob(receipt(0));
    const loaded=new PlayerProfile(store);expect(loaded.passiveIncomePerSecond).toBeCloseTo(.092842,6);
    loaded.clearSave();expect(new PlayerProfile(store).passiveIncomePerSecond).toBe(0);
  });
  it("preserves earned ambulance income when future rewards are tuned and excludes legacy receipts", () => {
    const {profile,store}=fixture();profile.completeCurbsideAmbulanceJob(receipt(0));
    const original=GAME_CONFIG.ambulanceDriver.passiveIncomePerDelivery;
    try {
      Object.assign(GAME_CONFIG.ambulanceDriver,{passiveIncomePerDelivery:.08});
      const loaded=new PlayerProfile(store);expect(loaded.passiveIncomePerSecond).toBe(.05);
      loaded.completeCurbsideAmbulanceJob({...receipt(50),curbside:undefined});
      expect(loaded.passiveIncomePerSecond).toBe(.05);
      loaded.completeCurbsideAmbulanceJob(receipt(0));expect(loaded.passiveIncomePerSecond).toBe(.13);
    } finally { Object.assign(GAME_CONFIG.ambulanceDriver,{passiveIncomePerDelivery:original}); }
  });
});
