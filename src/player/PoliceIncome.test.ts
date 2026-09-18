import { expect, it } from "vitest";
import { PlayerProfile, defaultProgression } from "./PlayerProfile";
import { ProgressionStore } from "../progression/ProgressionStore";
import type { ChaseResult } from "../chase/ChaseRules";
import { GAME_CONFIG } from "../game/config";
function fixture(save=defaultProgression()) {
  let value:string|null=JSON.stringify(save);
  const store=new ProgressionStore({getItem:()=>value,setItem:(_k,v)=>{value=v;},removeItem:()=>{value=null;}});
  return {store,profile:new PlayerProfile(store)};
}
it("settles a win once as saved permanent income with no immediate bounty",()=>{
  const {profile,store}=fixture(),money=profile.money,result:ChaseResult={outcome:"won",passiveIncomeGain:0};
  profile.completePoliceChase(result);profile.completePoliceChase(result);
  expect(profile.money).toBe(money);expect(result.passiveIncomeGain).toBe(1);
  expect(new PlayerProfile(store).passiveIncomePerSecond).toBe(1);
  profile.accrueTrainingIncome(5);expect(profile.money).toBe(money+5);
});
it.each(["destroyed","escaped","reset"] as const)("does not reward %s",outcome=>{
  const {profile}=fixture();profile.completePoliceChase({outcome,passiveIncomeGain:0});expect(profile.passiveIncomePerSecond).toBe(0);
});
it.each([10,11])("migrates version %s without fabricating police rewards or losing existing income",version=>{
  const {profile,store}=fixture({...defaultProgression(),version,taxiPassiveIncomePerSecond:.037,
    ambulancePassiveIncomePerSecond:.15,policeChasePassiveIncomePerSecond:999,ownedMissionLicenseIds:["taxi","ambulance_driver"]});
  expect(profile.passiveIncomePerSecond).toBeCloseTo(version===10?.037:.187);
  profile.completePoliceChase({outcome:"won",passiveIncomeGain:0});
  expect(new PlayerProfile(store).passiveIncomePerSecond).toBeCloseTo(version===10?1.037:1.187);
});
it("tuning rewards only changes future wins, and reset clears them",()=>{
  const {profile,store}=fixture();profile.completePoliceChase({outcome:"won",passiveIncomeGain:0});
  const old=GAME_CONFIG.policeChase.passiveIncomePerWin;
  try {
    Object.assign(GAME_CONFIG.policeChase,{passiveIncomePerWin:.75});
    const loaded=new PlayerProfile(store);expect(loaded.passiveIncomePerSecond).toBe(1);
    loaded.completePoliceChase({outcome:"won",passiveIncomeGain:0});expect(loaded.passiveIncomePerSecond).toBe(1.75);
    loaded.clearSave();expect(new PlayerProfile(store).passiveIncomePerSecond).toBe(0);
  } finally {Object.assign(GAME_CONFIG.policeChase,{passiveIncomePerWin:old});}
});
