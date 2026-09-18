import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Frustum } from "@babylonjs/core/Maths/math.frustum";
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { GAME_CONFIG } from "../game/config";
import type { BoxCollider } from "../game/types";
import type { Town } from "../world/Town";
import type { WorldQuery } from "../world/WorldQuery";
import type { PlayerCar } from "../player/PlayerCar";
import type { TrafficManager } from "../traffic/TrafficManager";
import type { TrafficCar } from "../traffic/TrafficCar";
import { VEHICLE_CATALOG } from "../vehicles/VehicleCatalog";
import { randomSeed, seededRandom } from "../utils/math";
import { createRaceCarVisual } from "./RaceCar";
import { createRaceGrid, type RaceGrid } from "./RaceGrid";
import type { RaceCourse, RacePoint } from "./RaceCourse";
import { ParkedRacer } from "./ParkedRacer";

export interface WaitingRace { readonly course: RaceCourse; readonly grid: RaceGrid; remainingSeconds: number }
export interface RaceEncounterCue { kind: "enter" | "license" | "fuel"; seconds: number }

export class RaceEncounterManager {
  waiting: WaitingRace | null = null;
  readonly cars: TrafficCar[] = [];
  private readonly drivers: ParkedRacer[] = [];
  private readonly sources: {mesh: Mesh; material: StandardMaterial}[] = [];
  private readonly candidates: {course: RaceCourse; grid: RaceGrid}[];
  private readonly successes: {course: RaceCourse; grid: RaceGrid}[] = [];
  private readonly colliders: BoxCollider[] = [];
  private readonly rng: () => number;
  private nextCheck = 0;
  private racing = false;
  private lastRegionId: string | null = null;

  constructor(private readonly scene: Scene, private readonly town: Town,
    courses: ReadonlyMap<string,RaceCourse>, private readonly traffic: TrafficManager,
    private readonly world: WorldQuery, private readonly player: PlayerCar, seed = randomSeed()) {
    this.rng = seededRandom(seed);
    // Reserve adequate spacing even if the player changes vehicles before entering.
    const length = Math.max(GAME_CONFIG.player.length, ...VEHICLE_CATALOG.map(v=>v.appearance.bodyLength));
    this.candidates = [...courses.values()].map(course=>({course,grid:createRaceGrid(course,length)}));
    for (let i=0;i<GAME_CONFIG.racing.aiCount;i++) {
      const source=createRaceCarVisual(scene,`waiting-racer-source-${i}`,
        GAME_CONFIG.racing.racers[i % GAME_CONFIG.racing.racers.length].color);
      source.mesh.setEnabled(false); this.sources.push(source);
      const driver=new ParkedRacer(),car=traffic.addManagedCar(source.mesh,driver,"race_waiting");
      car.mesh.name=`waiting-racer-${i}`; this.drivers.push(driver); this.cars.push(car);
    }
  }

  update(dt: number): void {
    if (this.racing || !Number.isFinite(dt) || dt <= 0) return;
    if (this.waiting) {
      this.waiting.remainingSeconds = Math.max(0,this.waiting.remainingSeconds-dt);
      if (this.waiting.remainingSeconds === 0) this.retire();
      return;
    }
    this.nextCheck -= dt;
    if (this.nextCheck > 0) return;
    this.nextCheck = GAME_CONFIG.racing.encounters.spawnCheckSeconds;
    this.trySpawn();
  }

  getNearby(): WaitingRace | null {
    const race=this.waiting;
    if (!race || race.remainingSeconds <= 0) return null;
    const distance=Math.hypot(this.player.root.position.x-race.grid.player.x,
      this.player.root.position.z-race.grid.player.z)*GAME_CONFIG.ride.metersPerWorldUnit;
    return distance <= GAME_CONFIG.racing.encounters.entryRadiusMeters ? race : null;
  }

  canEnter(regionId: string): boolean { return this.getNearby()?.course.regionId === regionId; }

  consume(): void {
    if (!this.waiting) return;
    this.lastRegionId=this.waiting.course.regionId;
    this.hide(); this.racing=true;
  }

  finishRace(): void { this.racing=false; this.retire(); }

  private retire(): void {
    if (this.waiting) this.lastRegionId=this.waiting.course.regionId;
    this.hide(); this.nextCheck=GAME_CONFIG.racing.encounters.spawnCheckSeconds;
  }

  private hide(): void {
    this.waiting=null;
    for(let i=0;i<this.cars.length;i++) {this.drivers[i].enabled=false;this.cars[i].mesh.setEnabled(false);}
  }

  private trySpawn(): void {
    const camera=this.scene.activeCamera;
    if(!camera)return;
    camera.getViewMatrix();camera.getProjectionMatrix();
    const planes=Frustum.GetPlanes(camera.getTransformationMatrix()),point=new Vector3();
    this.successes.length=0;
    // Roll once for every developed block, including ones that later fail placement.
    for(const candidate of this.candidates) if(this.rng()<GAME_CONFIG.racing.encounters.spawnChancePerBlock)
      this.successes.push(candidate);
    for(let i=this.successes.length-1;i>0;i--) {const j=Math.floor(this.rng()*(i+1));
      [this.successes[i],this.successes[j]]=[this.successes[j],this.successes[i]];}
    for(const candidate of this.successes) {
      const {course,grid}=candidate;
      if(course.regionId===this.lastRegionId)continue;
      const eastWest=Math.abs(Math.sin(course.heading))>.5;
      const roads=this.town.roads.filter(r=>r.axis===(eastWest?"eastWest":"northSouth"));
      const coordinate=eastWest?course.start.z:course.start.x;
      const road=roads.reduce((a,b)=>Math.abs(a.center-coordinate)<Math.abs(b.center-coordinate)?a:b);
      if(road.type!=="city")continue;
      const positions=[grid.player,...grid.opponents];
      const safe=positions.every(p=>{
        point.set(p.x,2,p.z);
        return Math.hypot(p.x-this.player.root.position.x,p.z-this.player.root.position.z)
          *GAME_CONFIG.ride.metersPerWorldUnit >= GAME_CONFIG.racing.encounters.minimumSpawnDistanceMeters
          && planes.some(plane=>plane.dotCoordinate(point)<-8)
          && this.isClear(p,course.heading,road.center);
      });
      if(!safe)continue;
      const waypoint=this.town.roadSpawnPoints[0];
      for(let i=0;i<this.cars.length;i++) {
        const car=this.cars[i],p=grid.opponents[i];
        car.respawn(waypoint,"east",0); // Reset collision/contact state without creating new resources.
        car.mesh.position.set(p.x,.9,p.z);car.mesh.rotation.y=course.heading;car.syncCollisionBody(0);
        this.drivers[i].enabled=true;car.mesh.setEnabled(true);
      }
      this.waiting={course,grid,remainingSeconds:GAME_CONFIG.racing.encounters.waitingSeconds};
      return;
    }
  }

  private isClear(p: RacePoint, heading: number, roadCenter: number): boolean {
    const eastWest=Math.abs(Math.sin(heading))>.5;
    const halfX=(eastWest?GAME_CONFIG.player.length:GAME_CONFIG.player.width)/2+2;
    const halfZ=(eastWest?GAME_CONFIG.player.width:GAME_CONFIG.player.length)/2+2;
    const lateral=eastWest?p.z:p.x;
    if(Math.abs(lateral-roadCenter)+GAME_CONFIG.player.width/2+2>GAME_CONFIG.world.roadWidth/2)return false;
    const intersections=eastWest?this.town.roadPositionsX:this.town.roadPositionsZ;
    if(intersections.some(c=>Math.abs(c-(eastWest?p.x:p.z))<GAME_CONFIG.world.roadWidth/2+GAME_CONFIG.player.length/2+3))return false;
    this.world.getNearbyColliders(p.x,p.z,Math.hypot(halfX,halfZ),this.colliders);
    if(this.colliders.some(b=>Math.abs(b.x-p.x)<b.halfX+halfX&&Math.abs(b.z-p.z)<b.halfZ+halfZ))return false;
    // Protect service entrances, including their street-facing approaches.
    if(this.town.legalDrivingAreas.some(b=>Math.abs(b.x-p.x)<b.halfX+halfX&&Math.abs(b.z-p.z)<b.halfZ+halfZ))return false;
    return !this.traffic.cars.some(car=>car.mesh.isEnabled() && car.role!=="race_waiting"
      && Math.hypot(car.mesh.position.x-p.x,car.mesh.position.z-p.z)<Math.hypot(halfX,halfZ)+12);
  }

  dispose(): void {
    this.hide();
    for(const source of this.sources) {source.mesh.dispose();source.material.dispose();}
    // TrafficManager owns and disposes the reserved car clones.
  }
}
