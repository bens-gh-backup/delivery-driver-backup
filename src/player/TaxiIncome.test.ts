import { describe, expect, it } from "vitest";
import { PlayerProfile, defaultProgression } from "./PlayerProfile";
import { ProgressionStore, type KeyValueStorage } from "../progression/ProgressionStore";
import { GAME_CONFIG } from "../game/config";
import { PassengerType, type RideResult } from "../game/types";
import { formatIncomeRate } from "../ui/IncomeFormat";

function fixture(save = defaultProgression()) {
  let value: string | null = JSON.stringify(save);
  const storage: KeyValueStorage = { getItem:()=>value, setItem:(_k,v)=>{value=v;}, removeItem:()=>{value=null;} };
  const store = new ProgressionStore(storage);
  return {store, profile:new PlayerProfile(store)};
}
function result(total: number, stars = 5): RideResult {
  return {curbside:true,total,baseFare:total*.75,tip:total*.25,bonusTip:2,cardsEarned:1,couponsEarned:1,
    passengerType:PassengerType.Normal,passengerName:"Test rider",missionCategoryId:"taxi",rideTier:"SHORT",
    pickupDistance:0,tripDistance:500,durationSeconds:30,collisionCount:0,stars,timeTipPercentRemaining:100,
    violationPoints:0,violationTipPenaltyPercent:0};
}

describe("curbside taxi income", () => {
  it("credits the rating reward exactly once independently of fare, bonus and noncash rewards", () => {
    const {profile,store}=fixture();const ride=result(100);
    profile.completeRide(ride);profile.completeRide(ride);
    expect(profile.money).toBe(200);expect(profile.completedRides).toBe(1);
    expect(profile.passiveIncomePerSecond).toBe(.03);expect(ride.passiveIncomeGain).toBe(.03);
    profile.accrueTrainingIncome(10);expect(profile.money).toBeCloseTo(200.3);
    profile.saveNow();const loaded=new PlayerProfile(store);
    expect(loaded.passiveIncomePerSecond).toBe(.03);expect(loaded.rideHistory[0].passiveIncomeGain).toBe(.03);
  });
  it.each([[1,.001],[2,.003],[3,.01],[4,.02],[5,.03]])("pays the %s-star income tier independent of cash payout", (stars, income) => {
    for (const payout of [0,10,1000]) {
      const {profile}=fixture(); const ride=result(payout,stars); profile.completeRide(ride);
      expect(profile.passiveIncomePerSecond).toBe(income);
      expect(ride.passiveIncomeGain).toBe(income);
    }
  });
  it("preserves old fare-based income and changes only future rewards when tuning", () => {
    const {profile,store}=fixture({...defaultProgression(),taxiPassiveIncomePerSecond:.002842});
    expect(profile.passiveIncomePerSecond).toBe(.002842);
    expect(formatIncomeRate(.003)).toBe("0.003");expect(formatIncomeRate(.001)).toBe("0.001");
    expect(formatIncomeRate(1.2)).toBe("1.20");expect(formatIncomeRate(0)).toBe("0.00");
    const original=GAME_CONFIG.progression.taxiIncomePerSecondByStars[5];
    try {
      Object.assign(GAME_CONFIG.progression.taxiIncomePerSecondByStars,{5:.05});
      const loaded=new PlayerProfile(store);expect(loaded.passiveIncomePerSecond).toBe(.002842);
      loaded.completeRide(result(100));expect(loaded.passiveIncomePerSecond).toBe(.052842);
    } finally { Object.assign(GAME_CONFIG.progression.taxiIncomePerSecondByStars,{5:original}); }
  });
  it("keeps the minimum tier for old zero-star results, and excludes legacy offer-board rides", () => {
    const {profile}=fixture();profile.completeRide({...result(100),curbside:undefined});
    expect(profile.passiveIncomePerSecond).toBe(0);
    profile.completeRide(result(0,0));expect(profile.passiveIncomePerSecond).toBe(.001);
  });
  it("preserves old saves but suspends regional income and does not backfill ride history", () => {
    const save={...defaultProgression(),version:9,money:1234,trainingProgress:{'block-0-0':{taxi:3}},
      racingLicenseOwned:true,bestRaceFinishes:{'block-0-0':1},taxiPassiveIncomePerSecond:999};
    const {profile,store}=fixture(save);
    profile.configureTrainingRegions([{id:'block-0-0',label:'Region 1',bx:0,bz:0,minX:0,maxX:425,minZ:0,maxZ:425,x:200,z:200,pickups:[]}]);
    expect(profile.getTrainingCount('block-0-0','taxi')).toBe(3);expect(profile.getBestRaceFinish('block-0-0')).toBe(1);
    expect(profile.passiveIncomePerSecond).toBe(0);expect(profile.money).toBe(1234);
    profile.completeRide(result(100));const loaded=new PlayerProfile(store);
    expect(loaded.passiveIncomePerSecond).toBe(.03);expect(loaded.getTrainingCount('block-0-0','taxi')).toBe(3);
    loaded.clearSave();expect(new PlayerProfile(store).passiveIncomePerSecond).toBe(0);
  });
  it("persists accumulated income independently of the capped history", () => {
    const {profile,store}=fixture();
    for(let i=0;i<GAME_CONFIG.progression.rideHistoryLimit+5;i++)profile.completeRide(result(1));
    const loaded=new PlayerProfile(store);expect(loaded.rideHistory).toHaveLength(GAME_CONFIG.progression.rideHistoryLimit);
    expect(loaded.passiveIncomePerSecond).toBeCloseTo((GAME_CONFIG.progression.rideHistoryLimit+5)*.03,6);
  });
});
