import { describe, expect, it } from "vitest";
import { PassengerTurnTracker } from "./PassengerTurnTracker";
import { GAME_CONFIG } from "../game/config";
import { normalizeAngle } from "../utils/math";

function fixture(startDegrees = 0) {
  const tracker = new PassengerTurnTracker();
  let x = 0, z = 0, degrees = startDegrees;
  tracker.reset({x,z},degrees*Math.PI/180);
  const move = (rotation: number, meters = .2) => {
    degrees += rotation;
    const heading = normalizeAngle(degrees*Math.PI/180);
    x += Math.sin(heading)*meters/GAME_CONFIG.ride.metersPerWorldUnit;
    z += Math.cos(heading)*meters/GAME_CONFIG.ride.metersPerWorldUnit;
    return tracker.update({x,z},heading);
  };
  return {tracker,move,reset:()=>tracker.reset({x,z},normalizeAngle(degrees*Math.PI/180))};
}

describe("Compulsive turn tracker",()=>{
  it.each([0,90,180,270])("detects left turns from heading %s without relying on road position", start=>{
    const f=fixture(start),events=[];
    for(let i=0;i<90;i++) events.push(f.move(-1));
    expect(events.filter(Boolean)).toHaveLength(1);
  });
  it.each([-1,1])("detects a curved U-turn in direction %s", sign=>{
    const f=fixture(),events=[];
    for(let i=0;i<180;i++) events.push(f.move(sign));
    expect(events.filter(Boolean)).toHaveLength(1);
  });
  it("does not mistake a broad continuing right curve for straight travel",()=>{
    const f=fixture(),events=[];
    for(let i=0;i<180;i++) events.push(f.move(1,1));
    expect(events.filter(Boolean)).toHaveLength(1);
  });
  it("allows repeated right turns separated by straight travel",()=>{
    const f=fixture(),events=[];
    for(let turn=0;turn<4;turn++) {
      for(let i=0;i<90;i++) events.push(f.move(1));
      for(let i=0;i<6;i++) events.push(f.move(0,1));
    }
    expect(events.some(Boolean)).toBe(false);
  });
  it("detects a left turn immediately following a right turn",()=>{
    const f=fixture();
    for(let i=0;i<90;i++) expect(f.move(1)).toBe(false);
    const events=Array.from({length:90},()=>f.move(-1));
    expect(events.some(Boolean)).toBe(true);
  });
  it("allows corrections, straight reversing, stationary changes and heading wraparound",()=>{
    const f=fixture(179);
    for(let i=0;i<20;i++) {
      expect(f.move(5)).toBe(false); expect(f.move(-5)).toBe(false);
      expect(f.move(0,-1)).toBe(false);
    }
    expect(f.move(-90,0)).toBe(false);
    expect(f.move(0)).toBe(false);
  });
  it("reanchors on position resets without manufacturing turns",()=>{
    const f=fixture();
    f.move(-40); f.reset();
    expect(f.move(-30)).toBe(false);
    f.tracker.reset({x:500,z:1000},Math.PI);
    expect(f.tracker.update({x:500,z:1001},Math.PI)).toBe(false);
  });
});
