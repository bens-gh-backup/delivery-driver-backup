import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import type { RoadDefinition, TrafficWaypoint } from "../game/types";
import type { PlayerCar } from "../player/PlayerCar";
import { TrafficManager } from "../traffic/TrafficManager";
import type { Town } from "../world/Town";
import { WorldQuery } from "../world/WorldQuery";
import { createRaceCourses } from "./RaceCourse";
import { RaceEncounterManager } from "./RaceEncounterManager";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
function fixture() {
  const engine = new NullEngine(), scene = new Scene(engine);
  const camera = new FreeCamera("camera", new Vector3(-200,100,-200), scene);
  camera.setTarget(new Vector3(-200,0,-1000));
  const coordinates = Array.from({length:7},(_,i)=>i*425);
  const roads: RoadDefinition[] = ["eastWest","northSouth"].flatMap(axis => coordinates.map((center,index) => ({
    id:`${axis}-${index}`,axis:axis as RoadDefinition["axis"],index,center,
    type:index===0||index===6?"highway":"city",speedLimitMph:35,allowsMissionStops:index>0&&index<6,
  })));
  const waypoints: TrafficWaypoint[] = coordinates.flatMap((x,ix)=>coordinates.map((z,iz)=>({ix,iz,position:new Vector3(x,0,z)})));
  const town = {roads,roadPositionsX:coordinates,roadPositionsZ:coordinates,roadSpawnPoints:waypoints,legalDrivingAreas:[]} as unknown as Town;
  const traffic = new TrafficManager(scene, waypoints,coordinates,coordinates);
  for (const car of traffic.cars) car.mesh.setEnabled(false);
  const player = {root:{position:new Vector3(-200,.9,-200)}} as PlayerCar;
  const world = new WorldQuery([],roads,32.5,42.5,120);
  const courses = createRaceCourses(town);
  const manager = new RaceEncounterManager(scene,town,courses,traffic,world,player,17);
  Object.assign(manager,{rng:()=>0}); // Every block succeeds; all placement checks remain real.
  cleanup.push(()=>{manager.dispose();traffic.dispose();scene.dispose();engine.dispose();});
  return {manager,traffic,player,town,world,scene,camera};
}

describe("discoverable street-race gatherings", () => {
  it("spawns six collidable stationary opponents on a city street, leaving fourth place empty", () => {
    const {manager,player,town} = fixture(); manager.update(.05);
    const race = manager.waiting!; expect(race).not.toBeNull();
    expect(manager.cars).toHaveLength(6);
    expect(manager.cars.every(c=>c.mesh.isEnabled()&&c.driver?.enabled&&c.role==="race_waiting")).toBe(true);
    const eastWest = Math.abs(Math.sin(race.course.heading))>.5;
    const lateral = eastWest?race.course.start.z:race.course.start.x;
    const closest = town.roads.filter(r=>r.axis===(eastWest?"eastWest":"northSouth"))
      .sort((a,b)=>Math.abs(a.center-lateral)-Math.abs(b.center-lateral))[0];
    expect(closest.type).toBe("city");
    for (const car of manager.cars) {
      const before = car.mesh.position.clone(); car.update(1,[]);
      expect(car.mesh.position).toEqual(before); expect(car.collisionBody.dynamic).toBe(false);
      expect(car.collisionBody.halfWidth*2).toBe(GAME_CONFIG.player.width);
      expect(Math.hypot(before.x-player.root.position.x,before.z-player.root.position.z)).toBeGreaterThan(300);
      expect(Math.hypot(before.x-race.grid.player.x,before.z-race.grid.player.z)).toBeGreaterThan(6);
    }
  });

  it("checks entry against the empty player slot and rejects expired or different gatherings", () => {
    const {manager,player} = fixture(); manager.update(.05); const race = manager.waiting!;
    expect(manager.getNearby()).toBeNull();
    player.root.position.set(race.grid.player.x+50,0,race.grid.player.z);
    expect(manager.canEnter(race.course.regionId)).toBe(true); expect(manager.canEnter("missing")).toBe(false);
    player.root.position.x+=.01; expect(manager.getNearby()).toBeNull();
    player.root.position.x-=.01; manager.update(180);
    expect(manager.getNearby()).toBeNull(); expect(manager.cars.every(c=>!c.mesh.isEnabled()&&!c.driver?.enabled)).toBe(true);
  });

  it("waits a minute after expiry, never runs an unattended race, and reuses the same resources", () => {
    const {manager,scene} = fixture(); manager.update(.05);
    const first = manager.waiting!.course.regionId, meshes=scene.meshes.length, materials=scene.materials.length;
    manager.update(179); expect(manager.waiting!.course.regionId).toBe(first);
    manager.update(1); expect(manager.waiting).toBeNull();
    manager.update(59); expect(manager.waiting).toBeNull();
    manager.update(1); expect(manager.waiting).not.toBeNull();
    expect(manager.waiting!.course.regionId).not.toBe(first);
    expect(scene.meshes.length).toBe(meshes); expect(scene.materials.length).toBe(materials);
  });

  it("consumes the gathering until the race ends, then applies the normal cooldown", () => {
    const {manager} = fixture(); manager.update(.05); manager.consume();
    expect(manager.cars.every(c=>!c.mesh.isEnabled())).toBe(true);
    manager.update(600); expect(manager.waiting).toBeNull();
    manager.finishRace(); manager.update(59); expect(manager.waiting).toBeNull();
    manager.update(1); expect(manager.waiting).not.toBeNull();
  });

  it("skips obstructed service approaches instead of forcing an unsafe fallback", () => {
    const {manager,town} = fixture();
    town.legalDrivingAreas.push({x:1200,z:1200,halfX:5000,halfZ:5000});
    manager.update(.05); expect(manager.waiting).toBeNull();
    expect(manager.cars.every(c=>!c.mesh.isEnabled())).toBe(true);
  });

  it("does not spawn within the distance exclusion", () => {
    const {manager,player} = fixture();
    const candidates = (manager as any).candidates;
    (manager as any).candidates = [candidates.find((c:any)=>c.course.regionId==="block-2-2")];
    const p = (manager as any).candidates[0].grid.player; player.root.position.set(p.x,0,p.z);
    manager.update(.05); expect(manager.waiting).toBeNull();
  });

  it("carries a shove and spin, then settles without steering back onto its original grid", () => {
    const {manager} = fixture(); manager.update(.05); const car=manager.cars[0];
    const before=car.mesh.position.clone(),heading=car.mesh.rotation.y;
    Object.assign(car.collisionBody,{velocityX:20,velocityZ:10,angularVelocity:1,changed:true,dynamic:true,impulse:5});
    car.applyCollisionBody();
    for(let frame=0;frame<600;frame++) car.update(1/60,[]);
    expect(car.mesh.position.x).toBeGreaterThan(before.x+5);
    expect(Math.abs(car.mesh.rotation.y-heading)).toBeGreaterThan(.1);
    expect(car.collisionBody.dynamic).toBe(false);
    const stopped=car.mesh.position.clone();car.update(1,[]);expect(car.mesh.position).toEqual(stopped);
  });
});
