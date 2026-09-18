import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { GAME_CONFIG } from "../game/config";
import { TownGenerator, type Town } from "../world/Town";
import { WorldQuery } from "../world/WorldQuery";
import type { PlayerCar } from "../player/PlayerCar";
import { PassengerManager } from "./PassengerManager";
import { isBesidePassenger } from "./PassengerLocations";
import asset from "./assets/passenger.json";
import patientAsset from "./assets/patient.json";
import { roadSurfaceHalfWidth, WORLD_SURFACES } from "../world/SurfaceLayout";
import { CITY_STYLE } from "../world/CityStyle";

const configuredPatients = GAME_CONFIG.ambulanceDriver.averagePatientsPerBlock;
let engine: NullEngine, scene: Scene, town: Town, world: WorldQuery;
beforeAll(() => {
  // Fixed population fixture; leave player-tuned density in config untouched.
  Object.assign(GAME_CONFIG.ambulanceDriver, {averagePatientsPerBlock: 3 / 34});
  engine = new NullEngine(); scene = new Scene(engine); town = new TownGenerator(scene).generate();
  world = new WorldQuery(town.staticColliders,town.roads,32.5,35.5,64,town.legalDrivingAreas);
});
afterAll(() => { Object.assign(GAME_CONFIG.ambulanceDriver, {averagePatientsPerBlock: configuredPatients}); scene.dispose(); engine.dispose(); });
function fixture(firstRide = true) {
  let speed = 0;
  const player = { root: { position: new Vector3(-212.5,.9,-27) }, heading: Math.PI/2, getSpeedMph: () => speed } as PlayerCar;
  const manager = new PassengerManager(scene,town,world,player,firstRide,9182);
  return { manager, player, speed: (value: number) => { speed = value; } };
}

describe("curbside population and pickup", () => {
  it("spreads eighteen taxis and three patients over separate developed blocks and starts one ahead", () => {
    const {manager,player} = fixture();
    expect(manager.targetCount).toBe(21); expect(manager.waiting).toHaveLength(21);
    expect(new Set(manager.waiting.map(p=>p.location.blockId)).size).toBe(21);
    const first = manager.waiting[0];
    expect(first.location.position.x-player.root.position.x).toBeGreaterThan(40);
    expect(first.location.position.x-player.root.position.x).toBeLessThan(85);
    expect(isBesidePassenger(first.location,player.root.position)).toBe(true);
    expect(manager.waiting.filter(p=>p.kind === "taxi")).toHaveLength(18);
    expect(manager.waiting.filter(p=>p.kind === "patient")).toHaveLength(3);
    for (const passenger of manager.waiting) {
      const {location}=passenger;
      const lateral=Math.abs((location.road.axis==="northSouth" ? location.position.x : location.position.z)-location.road.center);
      if (passenger.kind === "taxi") expect(lateral-roadSurfaceHalfWidth()).toBeCloseTo(GAME_CONFIG.passengers.sidewalkInset);
      expect(lateral).toBeLessThan(GAME_CONFIG.world.roadWidth/2); // Visible slab extends inside logical road.
      expect(lateral-roadSurfaceHalfWidth()-.42).toBeGreaterThan(CITY_STYLE.streetDetails.curbWidth); // Shoes clear raised curb.
      expect(location.position.y).toBeCloseTo(WORLD_SURFACES.sidewalk+.015);
      expect(passenger.location.road.type).toBe("city");
      expect(passenger.offer.curbside).toBe(true); expect(passenger.offer.pickupDistance).toBe(0);
      expect(passenger.offer.training).toBeUndefined();
      expect(passenger.offer.tripDistance).toBeGreaterThanOrEqual(passenger.kind === "taxi" ? 300 : 1000);
    }
    const rides = manager.waiting.map(p=>p.offer);
    manager.update(1000,player,false,()=>false);
    expect(manager.waiting.map(p=>p.offer)).toEqual(rides);
    manager.dispose();
  });

  it("requires a continuous slow stop on the road, keeps rejected pickups, and boards once", () => {
    const {manager,player,speed} = fixture();
    const target = manager.waiting[0]; const board = vi.fn(()=>true);
    player.root.position.copyFrom(target.location.pickupPoint.position);
    speed(3); manager.update(.6,player,true,board); expect(board).not.toHaveBeenCalled();
    speed(0); manager.update(.3,player,true,board);
    manager.update(.1,player,false,board); // Phone/menus break the dwell.
    manager.update(.3,player,true,board); expect(board).not.toHaveBeenCalled();
    player.root.position.copyFrom(target.location.position); // Standing on the sidewalk is not roadside pickup.
    manager.update(.6,player,true,board); expect(board).not.toHaveBeenCalled();
    player.root.position.copyFrom(target.location.pickupPoint.position);
    const reject = vi.fn(()=>false); manager.update(.6,player,true,reject);
    expect(reject).toHaveBeenCalledOnce(); expect(manager.waiting).toContain(target);
    manager.update(.6,player,true,board); manager.update(.6,player,false,board);
    expect(board).toHaveBeenCalledOnce(); expect(manager.waiting).not.toContain(target);
    expect(target.mesh.isDisposed()).toBe(true);
    expect(manager.waiting).toHaveLength(20); manager.dispose();
  });

  it("rejects opposite-side and out-of-radius stops and replenishes away from the camera", () => {
    const {manager,player} = fixture(); const target=manager.waiting[0], board=vi.fn(()=>true);
    const ns=target.location.road.axis==="northSouth";
    player.root.position.copyFrom(target.location.pickupPoint.position);
    if(ns)player.root.position.x=target.location.road.center-target.location.side*27;
    else player.root.position.z=target.location.road.center-target.location.side*27;
    manager.update(.6,player,true,board); expect(board).not.toHaveBeenCalled();
    player.root.position.copyFrom(target.location.pickupPoint.position);
    if(ns)player.root.position.z+=15;else player.root.position.x+=15;
    manager.update(.6,player,true,board);expect(board).not.toHaveBeenCalled();
    player.root.position.copyFrom(target.location.pickupPoint.position);manager.update(.6,player,true,board);
    manager.update(29,player,false,board);expect(manager.waiting).toHaveLength(20);
    const camera=new FreeCamera("passenger-test-camera",player.root.position.add(new Vector3(0,5,-20)),scene);
    camera.setTarget(player.root.position);scene.activeCamera=camera;
    manager.update(2,player,false,board);expect(manager.waiting).toHaveLength(21);
    const replacement=manager.waiting.at(-1)!;
    expect(Vector3.Distance(replacement.location.position,player.root.position)).toBeGreaterThan(150);
    expect(camera.isInFrustum(replacement.mesh)).toBe(false);
    manager.dispose();camera.dispose();scene.activeCamera=null;
  });

  it("supports zero and higher densities without changing the world's collision geometry", () => {
    const original = GAME_CONFIG.passengers.averagePedestriansPerBlock, colliders=town.staticColliders.length;
    try {
      Object.assign(GAME_CONFIG.passengers,{averagePedestriansPerBlock:0});
      const empty=fixture();expect(empty.manager.waiting.filter(p=>p.kind === "taxi")).toHaveLength(0);empty.manager.dispose();
      Object.assign(GAME_CONFIG.passengers,{averagePedestriansPerBlock:1.1});
      const dense=fixture(false);expect(dense.manager.waiting.filter(p=>p.kind === "taxi")).toHaveLength(37);
      expect(town.staticColliders.length).toBe(colliders);dense.manager.dispose();
    } finally { Object.assign(GAME_CONFIG.passengers,{averagePedestriansPerBlock:original}); }
  });

  it("shows locked patients, blocks pursuit pickup and replenishes the patient kind", () => {
    const {manager,player}=fixture();const patient=manager.waiting.find(p=>p.kind === "patient")!,board=vi.fn(()=>true);
    player.root.position.copyFrom(patient.location.pickupPoint.position);
    manager.update(1,player,true,board,false);expect(manager.nearbyCue).toBe("license");
    manager.update(1,player,true,board,true,true);expect(manager.nearbyCue).toBe("pursuit");
    expect(board).not.toHaveBeenCalled();expect(manager.waiting).toContain(patient);
    manager.update(.3,player,true,board,true);expect(board).not.toHaveBeenCalled();
    manager.update(.3,player,true,board,true);expect(board).toHaveBeenCalledWith(patient);
    expect(manager.waiting.filter(p=>p.kind === "patient")).toHaveLength(2);
    const camera=new FreeCamera("patient-camera",player.root.position.add(new Vector3(0,5,-20)),scene);
    camera.setTarget(player.root.position);scene.activeCamera=camera;
    manager.update(31,player,false,board);
    const replacement=manager.waiting.at(-1)!;
    expect(replacement.kind).toBe("patient");expect(replacement.offer.tripDistance).toBeGreaterThanOrEqual(1000);
    expect(Vector3.Distance(replacement.location.position,player.root.position)).toBeGreaterThan(150);
    expect(camera.isInFrustum(replacement.mesh)).toBe(false);
    manager.dispose();camera.dispose();scene.activeCamera=null;
  });

  it("allows disabling only patients and skips patients when no clinic is far enough", () => {
    const original=GAME_CONFIG.ambulanceDriver.averagePatientsPerBlock;
    try {
      Object.assign(GAME_CONFIG.ambulanceDriver,{averagePatientsPerBlock:0});
      const f=fixture();expect(f.manager.waiting).toHaveLength(18);f.manager.dispose();
    } finally {Object.assign(GAME_CONFIG.ambulanceDriver,{averagePatientsPerBlock:original});}
    const f=fixture();f.manager.dispose();
    const manager=new PassengerManager(scene,{...town,clinics:[]},world,f.player,false,42);
    expect(manager.patientTargetCount).toBe(0);expect(manager.waiting).toHaveLength(18);manager.dispose();
  });

  it("keeps lying bodies on the sidewalk and away from service approaches", () => {
    const {manager}=fixture();
    for(const patient of manager.waiting.filter(p=>p.kind === "patient")) {
      patient.mesh.computeWorldMatrix(true);
      const box=patient.mesh.getBoundingInfo().boundingBox,ns=patient.location.road.axis === "northSouth";
      const near=patient.location.side>0 ? (ns?box.minimumWorld.x:box.minimumWorld.z) : (ns?box.maximumWorld.x:box.maximumWorld.z);
      expect(Math.abs(near-patient.location.road.center)).toBeGreaterThan(roadSurfaceHalfWidth()+CITY_STYLE.streetDetails.curbWidth);
      for(const a of [...town.staticColliders,...town.legalDrivingAreas]) {
        expect(box.minimumWorld.x < a.x+a.halfX && box.maximumWorld.x > a.x-a.halfX
          && box.minimumWorld.z < a.z+a.halfZ && box.maximumWorld.z > a.z-a.halfZ).toBe(false);
      }
    }
    expect(patientAsset.indices.length/3).toBeLessThanOrEqual(GAME_CONFIG.ambulanceDriver.patientTriangleBudget);
    expect(patientAsset.themes).toHaveLength(4);manager.dispose();
  });

  it("keeps the exported art within its budget with four role-based palettes", () => {
    expect(asset.indices.length/3).toBeLessThanOrEqual(GAME_CONFIG.passengers.triangleBudget);
    expect(asset.themes).toHaveLength(4); expect(asset.colorRoles.length*3).toBe(asset.positions.length);
    expect(asset.normals.length).toBe(asset.positions.length);
  });
});
