import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { PoliceChaseManager } from "./PoliceChaseManager";
import { TrafficManager } from "../traffic/TrafficManager";
import { PlayerCar } from "../player/PlayerCar";
import { PlayerProfile } from "../player/PlayerProfile";
import { ProgressionStore } from "../progression/ProgressionStore";
import { DamageManager } from "../player/DamageManager";
import { WorldQuery } from "../world/WorldQuery";
import { GAME_CONFIG } from "../game/config";
import type { Town } from "../world/Town";
import type { BoxCollider, RoadDefinition } from "../game/types";
const dispose:(()=>void)[]=[];
afterEach(()=>{dispose.splice(0).forEach(fn=>fn());vi.restoreAllMocks();});
function fixture(colliders:BoxCollider[]=[]) {
  const engine=new NullEngine(),scene=new Scene(engine),grid=[-1275,-850,-425,0,425,850,1275];
  const waypoints=grid.flatMap((x,ix)=>grid.map((z,iz)=>({ix,iz,position:new Vector3(x,0,z)})));
  const roads=(["northSouth","eastWest"] as const).flatMap(axis=>grid.map((center,index)=>({axis,index,center,type:index===0||index===6?"highway":"city",speedLimitMph:50}))) as RoadDefinition[];
  const town={roadPositionsX:grid,roadPositionsZ:grid,roadSpawnPoints:waypoints,roads,
    districts:Array.from({length:36},(_,i)=>({bx:i%6,bz:Math.floor(i/6)}))} as unknown as Town;
  const world=new WorldQuery(colliders,roads,32.5,35.5,64),player=new PlayerCar(scene,waypoints),damage=new DamageManager();
  const profile=new PlayerProfile(new ProgressionStore({getItem:()=>null,setItem:()=>{},removeItem:()=>{}}));
  profile.addMoney(1000);profile.purchaseMissionLicense("police_chase");
  const traffic=new TrafficManager(scene,waypoints,grid,grid);
  const chase=new PoliceChaseManager(scene,town,world,traffic,player,profile,damage,123);
  const camera=new FreeCamera("test-camera",new Vector3(0,15,-20),scene);camera.setTarget(Vector3.Zero());scene.activeCamera=camera;
  // Keep ordinary cars out of the controlled shot/collision corridor.
  for(const car of traffic.cars)if(car!==chase.suspect){car.mesh.position.set(1000,1,1000);car.syncCollisionBody(0);}
  const start=()=>{
    chase.suspect.respawn(waypoints.find(p=>p.ix===3&&p.iz===3)!,"south",.5);
    chase.driver.spawn(chase.suspect.target,"south");chase.suspect.mesh.position.set(0,1,0);
    chase.suspect.mesh.rotation.y=0;chase.suspect.syncCollisionBody(0);chase.suspect.mesh.setEnabled(true);
    player.teleportTo(0,-20,0);chase.state="roaming";expect(chase.begin()).toBe(true);
    (traffic as any).rebuildSpatialHash();
  };
  dispose.push(()=>{chase.dispose();traffic.dispose();profile.dispose();scene.dispose();engine.dispose();});
  return {chase,traffic,player,profile,damage,world,start};
}
describe("police encounter lifecycle",()=>{
  it("spawns offscreen on a clear city street, with at most one reserved actor",()=>{
    const {chase,traffic,player}=fixture();const count=traffic.cars.length;
    vi.spyOn(chase as any,"offscreen").mockReturnValue(true);vi.spyOn(chase as any,"rng").mockReturnValue(0);
    chase.update(.05,false);expect(chase.state).toBe("roaming");
    const p=chase.suspect.mesh.position;expect(Number.isFinite(p.x+p.z)).toBe(true);
    expect(Vector3.Distance(p,player.root.position)).toBeGreaterThanOrEqual(GAME_CONFIG.policeChase.minimumSpawnDistanceMeters);
    const heading=chase.suspect.mesh.rotation.y;
    expect(Math.abs(Math.sin(heading))>.5 ? Math.abs(p.z) : Math.abs(p.x)).toBeLessThan(1275-30);
    chase.update(60,false);expect(traffic.cars).toHaveLength(count);expect(chase.state).toBe("roaming");
  });
  it("waits a full interval before the first shot and clips shots against building cover",()=>{
    const {chase,start,damage}=fixture([{x:0,z:-10,halfX:4,halfZ:2}]);start();
    const initial=chase.shotsFired;chase.stepCombat(3.79);expect(chase.shotsFired).toBe(initial);
    (chase as any).fire(true);expect(damage.damagePercent).toBe(0);expect(chase.lastCoverCandidateCount).toBeGreaterThan(0);
  });
  it("hits behind at 30m, but never in front, beyond 120m, or through traffic",()=>{
    const {chase,start,damage,player,traffic}=fixture();start();
    (chase as any).fire(true);expect(damage.damagePercent).toBe(.08);
    player.teleportTo(0,20,0);(chase as any).fire(true);expect(damage.damagePercent).toBe(.08);
    player.teleportTo(0,-121,0);(chase as any).fire(true);expect(damage.damagePercent).toBe(.08);
    player.teleportTo(0,-30,0);const blocker=traffic.cars[0];blocker.mesh.position.set(0,1,-15);blocker.mesh.rotation.y=Math.PI/2;
    blocker.mesh.setEnabled(true);blocker.syncCollisionBody(0);(traffic as any).rebuildSpatialHash();(chase as any).fire(true);expect(damage.damagePercent).toBe(.08);
  });
  it("resets the 15-second escape clock on returning within 300m",()=>{
    const {chase,start,player}=fixture();start();player.teleportTo(0,-301,0);chase.stepCombat(14);
    expect(chase.isActive).toBe(true);player.teleportTo(0,-300,0);chase.stepCombat(1);expect(chase.escapeElapsed).toBe(0);
    player.teleportTo(0,-301,0);chase.stepCombat(15);expect(chase.isActive).toBe(true);
    chase.stepCombat(.01);expect(chase.lastResult?.outcome).toBe("escaped");
  });
  it("prioritizes player destruction on a simultaneous knockout, and settles a win only once",()=>{
    const {chase,start,damage,profile}=fixture();start();chase.driver.damagePercent=1;damage.damagePercent=1;chase.stepCombat(.01);
    expect(chase.lastResult?.outcome).toBe("destroyed");expect(profile.passiveIncomePerSecond).toBe(0);
    damage.damagePercent=0;start();chase.driver.damagePercent=1;chase.stepCombat(.01);chase.finish("won");
    expect(chase.lastResult?.outcome).toBe("won");expect(chase.driver.disabled).toBe(true);expect(profile.passiveIncomePerSecond).toBe(1);
    const shots=chase.shotsFired;chase.update(60,true);expect(chase.shotsFired).toBe(shots);expect(chase.isActive).toBe(false);
  });
  it("applies armored and target damage through the existing one-pass contact solver",()=>{
    const {chase,start,player,traffic}=fixture();start();traffic.chaseActive=true;
    const suspect=chase.suspect;player.teleportTo(0,-(player.vehicleLength+GAME_CONFIG.traffic.hitboxLength)/2+.3,0);Object.assign(player,{velocityX:0,velocityZ:100});
    suspect.mesh.position.set(0,1,0);suspect.syncCollisionBody(0);
    (traffic as any).prepareUpdates(0,player);(traffic as any).fullSimulationByCar[suspect.id]=true;
    (traffic as any).rebuildSpatialHash();const result=(traffic as any).resolveVehicleCollisions(0,player);
    expect(result.damagePercent).toBeCloseTo(.03);expect(chase.driver.damagePercent).toBeCloseTo(.33);
    expect(suspect.collisionBody.velocityZ).toBeGreaterThan(0);expect(result.policeCollisionOfficerId).toBeNull();
    expect(result.collisionViolationSeverity).toBe(0);
  });
});

it("charges a suspect wall impact once, and gives the cruiser its static-impact armor",()=>{
  const {chase,start,player,traffic,world}=fixture([{x:5,z:0,halfX:1,halfZ:35}]);start();traffic.chaseActive=true;
  const car=chase.suspect;car.mesh.position.set(2,1,0);car.mesh.rotation.y=Math.PI/2;
  Object.assign(car,{collisionMotion:true,velocityX:100,velocityZ:0});car.syncCollisionBody(0);
  player.teleportTo(-40,0,0);(traffic as any).prepareUpdates(0,player);(traffic as any).rebuildSpatialHash();
  (traffic as any).resolveVehicleCollisions(0,player,world);expect(chase.driver.damagePercent).toBeCloseTo(.33);
  expect(car.collisionBody.velocityX).toBeLessThan(10);
  (traffic as any).resolveVehicleCollisions(0,player,world);expect(chase.driver.damagePercent).toBeCloseTo(.33);
  car.mesh.position.set(-50,1,0);car.syncCollisionBody(0);player.teleportTo(2,0,Math.PI/2);
  Object.assign(player,{velocityX:100,velocityZ:0});(traffic as any).rebuildSpatialHash();
  const result=(traffic as any).resolveVehicleCollisions(0,player,world);expect(result.damagePercent).toBeCloseTo(.03);
});
it("keeps closing engagement continuous across render frames without physics motion",()=>{
  const {chase,player}=fixture();chase.state="roaming";chase.suspect.mesh.position.set(0,1,0);
  for(let i=0;i<125;i++) {
    player.teleportTo(0,-(240-i*.5),0);
    chase.update(1/144,true,1/60);chase.update(1/144,true,0);
  }
  expect(chase.engagement.closingSeconds).toBeGreaterThan(2);
  expect(chase.update(1/144,true,1/60)).toBe(false); // No further closing motion.
  chase.update(.1,false,0);expect(chase.engagement.closingSeconds).toBe(0);
});

it("clears shot effects during a race and protects the player's return from a nearby frozen suspect", () => {
  const {chase,start,player}=fixture(); start(); chase.state="roaming";
  (chase as any).fire(false);
  expect((chase as any).tracer.isEnabled()).toBe(true);
  chase.prepareForRace();
  expect((chase as any).tracer.isEnabled()).toBe(false);
  expect((chase as any).muzzle.isEnabled()).toBe(false);
  player.teleportTo(0,-200,0); chase.resumeAfterRace();
  expect(chase.state).toBe("roaming");
  player.teleportTo(0,-20,0); chase.resumeAfterRace();
  expect(chase.state).toBe("absent"); expect(chase.driver.enabled).toBe(false);
  expect(chase.suspect.mesh.isEnabled()).toBe(false);
  expect((chase as any).nextSpawnCheck).toBe(GAME_CONFIG.policeChase.spawnCheckSeconds);
});
