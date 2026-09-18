import { expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SuspectDriver } from "./SuspectDriver";
import { beginBodyStep, createVehicleBody, setBodySize } from "../physics/VehicleBody";
import { GAME_CONFIG } from "../game/config";
import { seededRandom, normalizeAngle } from "../utils/math";
function fixture() {
  const grid=[-850,-425,0,425,850],driver=new SuspectDriver(grid,grid,seededRandom(42)),body=createVehicleBody(0);
  setBodySize(body,5.8,10.8);Object.assign(body,{x:210,z:-GAME_CONFIG.traffic.laneOffset,heading:Math.PI/2});
  driver.spawn({ix:3,iz:2,position:new Vector3(425,0,0)},"east");return {driver,body,grid};
}
it.each([false,true])("negotiates repeated intersections without leaving the grid or stalling (chasing=%s)",chasing=>{
  const {driver,body,grid}=fixture();if(chasing)driver.beginChase();let travelled=0,maxOffRoad=0,minSpeed=Infinity;
  for(let i=0;i<120*60;i++) {
    const x=body.x,z=body.z;beginBodyStep(body,x,z,body.heading);driver.update(body,1/60,[]);
    travelled+=Math.hypot(body.x-x,body.z-z);
    maxOffRoad=Math.max(maxOffRoad,Math.min(...grid.map(g=>Math.min(Math.abs(body.x-g),Math.abs(body.z-g)))));
    if(i>600)minSpeed=Math.min(minSpeed,Math.hypot(body.velocityX,body.velocityZ));
    expect(Number.isFinite(body.x+body.z+body.heading)).toBe(true);
  }
  expect(travelled).toBeGreaterThan(5000);expect(maxOffRoad).toBeLessThan(GAME_CONFIG.world.roadWidth/2);
  expect(minSpeed).toBeGreaterThan(3);
});
it("immediately tries to steer out of a spin with real movement and no stationary 180-degree turn",()=>{
  const {driver,body}=fixture();driver.beginChase();body.heading=-Math.PI/2;body.startHeading=Math.PI/2;
  driver.impact(body);const start={x:body.x,z:body.z,heading:body.heading};
  for(let i=0;i<12;i++)driver.update(body,1/60,[]);
  expect(driver.recovery.pauseRemaining).toBe(0);expect(Math.hypot(body.velocityX,body.velocityZ)).toBeGreaterThan(0);
  expect(Math.abs(normalizeAngle(body.heading-start.heading))).toBeLessThan(.2);
  for(let i=0;i<8*60;i++)driver.update(body,1/60,[]);
  expect(Math.hypot(body.x-start.x,body.z-start.z)).toBeGreaterThan(15);
  expect(driver.recovery.pauseRemaining).toBe(0);
});
it("only damages an active suspect, starts fresh, and debounces grinding contact",()=>{
  const {driver,body}=fixture();driver.damage(.33);expect(driver.damagePercent).toBe(0);
  driver.beginChase();driver.damage(.33);driver.damage(.33);expect(driver.damagePercent).toBe(.33);
  driver.update(body,1.1,[]);driver.damage(.33);expect(driver.damagePercent).toBe(.66);
  driver.finish(false);driver.damage(.33);expect(driver.damagePercent).toBe(.66);
  driver.beginChase();expect(driver.damagePercent).toBe(0);
});
