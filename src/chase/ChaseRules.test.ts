import { describe, expect, it } from "vitest";
import { ChaseEngagement, chaseImpactDamage, segmentBoxFraction, segmentVehicleFraction, shotAtDistance } from "./ChaseRules";
import { createVehicleBody } from "../physics/VehicleBody";

describe("pursuit engagement", () => {
  it("requires more than two continuous seconds nearby and resets on leaving or losing availability", () => {
    const gate=new ChaseEngagement();
    expect(gate.update(2,50,true)).toBe(false);expect(gate.update(.01,50,true)).toBe(true);
    expect(gate.update(.1,51,true)).toBe(false);
    gate.update(1,20,true);expect(gate.update(1,20,false)).toBe(false);
    expect(gate.update(1.5,20,true)).toBe(false);expect(gate.update(.6,20,true)).toBe(true);
  });
  it("requires continuously closing within 250m, with independent nearby and closing clocks", () => {
    const gate=new ChaseEngagement();
    gate.update(.1,260,true);gate.update(1,249,true);expect(gate.update(1,220,true)).toBe(false);
    expect(gate.update(.1,200,true)).toBe(true);expect(gate.update(.1,201,true)).toBe(false);
    gate.update(1.5,190,true);expect(gate.update(.6,251,true)).toBe(false);
    gate.update(1,40,true);gate.update(1,60,true);expect(gate.update(1.1,40,true)).toBe(false);
  });
});
describe("shot and impact balance", () => {
  it.each([[0,1,.08],[30,1,.08],[75,.5,.05],[120,0,.02],[150,0,.02]])("distance %s", (d,p,damage) => {
    expect(shotAtDistance(d).probability).toBeCloseTo(p);expect(shotAtDistance(d).damage).toBeCloseTo(damage);
  });
  it("caps a full-speed ram at 33% suspect and 3% cruiser, with lighter glancing impacts", () => {
    expect(chaseImpactDamage(60,1,false)).toBe(.33);expect(chaseImpactDamage(120,1,true)).toBe(.03);
    expect(chaseImpactDamage(30,.5,false)).toBeLessThan(chaseImpactDamage(30,1,false));
    expect(chaseImpactDamage(0,1,false)).toBe(0);expect(chaseImpactDamage(60,0,false)).toBe(0);
  });
  it("tests cover along the finite segment, including rotated traffic", () => {
    const box={x:0,z:10,halfX:2,halfZ:2};
    expect(segmentBoxFraction(0,0,0,20,box)).toBeCloseTo(.4);
    expect(segmentBoxFraction(3,0,3,20,box)).toBe(Infinity);
    expect(segmentBoxFraction(0,0,0,5,box)).toBe(Infinity);
    const body=createVehicleBody(0);Object.assign(body,{x:0,z:10,heading:Math.PI/2,halfWidth:2,halfLength:6});
    expect(segmentVehicleFraction(4,0,4,20,body)).toBeCloseTo(.4);
    body.heading=0;expect(segmentVehicleFraction(4,0,4,20,body)).toBe(Infinity);
  });
});
