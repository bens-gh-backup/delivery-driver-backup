import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Frustum } from "@babylonjs/core/Maths/math.frustum";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { GAME_CONFIG } from "../game/config";
import type { BoxCollider, TrafficWaypoint } from "../game/types";
import type { PlayerCar } from "../player/PlayerCar";
import type { PlayerProfile } from "../player/PlayerProfile";
import type { DamageManager } from "../player/DamageManager";
import type { Town } from "../world/Town";
import type { WorldQuery } from "../world/WorldQuery";
import { isDevelopedBlock } from "../world/CityDistricts";
import type { TrafficManager } from "../traffic/TrafficManager";
import type { TrafficCar, Direction } from "../traffic/TrafficCar";
import { randomSeed, seededRandom } from "../utils/math";
import { createSuspectPrototype, getSuspectMuzzleOffset } from "../vehicles/BlenderChaseMeshes";
import { SuspectDriver, directionOffset } from "./SuspectDriver";
import { ChaseEngagement, segmentBoxFraction, segmentVehicleFraction, shotAtDistance,
  type ChaseOutcome, type ChaseResult, type ChaseHudState } from "./ChaseRules";

interface SpawnSite { waypoint: TrafficWaypoint; direction: Direction; x: number; z: number }

export class PoliceChaseManager {
  readonly suspect: TrafficCar;
  readonly driver: SuspectDriver;
  readonly hud: ChaseHudState = { active:false,licenseRequired:false,suspectHealth:1,distance:0,
    escapeRemaining:null,hit:false,result:null,resultSeconds:0 };
  readonly engagement = new ChaseEngagement();
  state: "absent" | "roaming" | "active" | "retiring" = "absent";
  lastResult: ChaseResult | null = null;
  resultTimeRemaining = 0;
  escapeElapsed = 0;
  lastCoverCandidateCount = 0;
  shotsFired = 0;
  private nextSpawnCheck = 0;
  private shotRemaining = 0;
  private flashRemaining = 0;
  private hitRemaining = 0;
  private readonly rng: () => number;
  private readonly sites: SpawnSite[][] = [];
  private readonly winningSites: SpawnSite[][] = [];
  private readonly colliders: BoxCollider[] = [];
  private readonly nearby: TrafficCar[] = [];
  private readonly prototype: Mesh;
  private readonly material: StandardMaterial;
  private readonly shotMaterial: StandardMaterial;
  private readonly muzzle: Mesh;
  private readonly tracer: Mesh;
  private readonly muzzleOffset = getSuspectMuzzleOffset();

  constructor(private readonly scene: Scene, town: Town, private readonly world: WorldQuery,
    private readonly traffic: TrafficManager, private readonly player: PlayerCar,
    private readonly profile: PlayerProfile, private readonly damage: DamageManager, seed=randomSeed()) {
    this.rng=seededRandom(seed);
    this.material=new StandardMaterial("getaway-colors",scene);this.material.diffuseColor=Color3.White();
    this.material.specularColor.set(.12,.12,.12);this.material.freeze();
    this.prototype=createSuspectPrototype(scene,this.material);
    this.driver=new SuspectDriver(town.roadPositionsX,town.roadPositionsZ,this.rng);
    this.suspect=traffic.addManagedCar(this.prototype,this.driver);this.suspect.mesh.name="getaway-car";
    this.shotMaterial=new StandardMaterial("getaway-shot",scene);this.shotMaterial.disableLighting=true;
    this.shotMaterial.emissiveColor.set(1,.76,.3);this.shotMaterial.freeze();
    this.muzzle=MeshBuilder.CreatePolyhedron("getaway-muzzle",{type:1,size:.32},scene);
    this.tracer=MeshBuilder.CreateBox("getaway-tracer",{width:.07,height:.07,depth:1},scene);
    for(const mesh of [this.muzzle,this.tracer]) {mesh.material=this.shotMaterial;mesh.isPickable=false;mesh.setEnabled(false);}
    const xs=town.roadPositionsX,zs=town.roadPositionsZ;
    for(const {bx,bz} of town.districts) {
      if(!isDevelopedBlock(bx,bz,xs.length-1,zs.length-1))continue;
      const sites: SpawnSite[]=[];
      for(const [axis,index,ix,iz,direction] of [
        ["eastWest",bz,bx,bz,"east"],["eastWest",bz+1,bx+1,bz+1,"west"],
        ["northSouth",bx,bx,bz+1,"north"],["northSouth",bx+1,bx+1,bz,"south"],
      ] as const) {
        if(!town.roads.some(r=>r.axis===axis&&r.index===index&&r.type==="city"))continue;
        const waypoint=town.roadSpawnPoints.find(p=>p.ix===ix&&p.iz===iz);
        if(!waypoint)continue;
        const [fx,fz]=directionOffset(direction),lane=GAME_CONFIG.traffic.laneOffset;
        sites.push({waypoint,direction,x:(xs[ix]+xs[ix+fx])/2+fz*lane,z:(zs[iz]+zs[iz+fz])/2-fx*lane});
      }
      this.sites.push(sites);
    }
  }

  get isActive(): boolean {return this.state==="active";}
  getObjectivePosition(): Vector3 | null {return this.isActive ? this.suspect.mesh.position : null;}
  resetEngagement(): void {this.engagement.reset();this.hud.licenseRequired=false;}

  /** Ambient traffic is suspended during races, including transient shot visuals. */
  prepareForRace(): void {
    this.resetEngagement();
    this.flashRemaining = this.hitRemaining = 0;
    this.muzzle.setEnabled(false);
    this.tracer.setEnabled(false);
  }

  resumeAfterRace(): void {
    this.resetEngagement();
    if (this.isActive || this.state === "absent") return;
    // Managed actors bypass ordinary traffic recycling. Do not re-enable a frozen
    // suspect inside the player's return position or begin an instant new chase.
    if (Math.hypot(this.suspect.mesh.position.x - this.player.root.position.x,
      this.suspect.mesh.position.z - this.player.root.position.z) < GAME_CONFIG.racing.trafficResumeClearance) {
      this.state = "absent";
      this.driver.enabled = false;
      this.suspect.mesh.setEnabled(false);
      this.nextSpawnCheck = GAME_CONFIG.policeChase.spawnCheckSeconds;
    }
  }

  /** Called once per visible, playing frame, after passenger boarding has had priority. */
  update(dt: number, available: boolean, engagementDt = dt): boolean {
    this.resultTimeRemaining=Math.max(0,this.resultTimeRemaining-dt);
    this.flashRemaining=Math.max(0,this.flashRemaining-dt);this.hitRemaining=Math.max(0,this.hitRemaining-dt);
    if(this.flashRemaining<=0) {this.muzzle.setEnabled(false);this.tracer.setEnabled(false);}
    if(this.state==="retiring" && this.distance()>GAME_CONFIG.policeChase.retireDistanceMeters && this.offscreen(this.suspect.mesh.position.x,this.suspect.mesh.position.z)) {
      this.state="absent";this.driver.enabled=false;this.suspect.mesh.setEnabled(false);
      this.nextSpawnCheck=GAME_CONFIG.policeChase.spawnCheckSeconds;
    }
    if(this.state==="absent") {
      this.nextSpawnCheck-=dt;
      if(this.nextSpawnCheck<=0) {this.nextSpawnCheck=GAME_CONFIG.policeChase.spawnCheckSeconds;this.trySpawn();}
    }
    if(this.state==="roaming") {
      this.shotRemaining-=dt;
      if(this.shotRemaining<=0) {this.fire(false);this.scheduleShot();}
    }
    // Render frames can outnumber physics steps on high-refresh displays. Only sample
    // closing distance after motion advances, otherwise unchanged poses reset the gate.
    if (!available || this.state !== "roaming") this.resetEngagement();
    const qualified=available && this.state === "roaming" && engagementDt > 0
      ? this.engagement.update(engagementDt,this.distance(),true)
      : this.hud.licenseRequired;
    this.hud.licenseRequired=qualified&&!this.profile.ownsMissionLicense("police_chase");
    this.refreshHud();
    return qualified&&this.profile.ownsMissionLicense("police_chase");
  }

  begin(): boolean {
    if(this.state!=="roaming"||!this.profile.ownsMissionLicense("police_chase"))return false;
    this.state="active";this.driver.beginChase();this.suspect.collisionBody.reportStaticImpacts=true;
    this.escapeElapsed=0;this.lastResult=null;this.resultTimeRemaining=0;this.resetEngagement();this.scheduleShot();
    this.refreshHud();return true;
  }

  stepCombat(dt: number): void {
    if(!this.isActive)return;
    if(this.damage.damagePercent>=1) {this.finish("destroyed");return;}
    if(this.driver.damagePercent>=1) {this.finish("won");return;}
    const c=GAME_CONFIG.policeChase;
    this.escapeElapsed=this.distance()>c.escapeDistanceMeters ? this.escapeElapsed+dt : 0;
    if(this.escapeElapsed>c.escapeSeconds) {this.finish("escaped");return;}
    this.shotRemaining-=dt;
    if(this.shotRemaining<=0) {this.fire(true);this.scheduleShot();}
    if(this.damage.damagePercent>=1)this.finish("destroyed");
    this.refreshHud();
  }

  finish(outcome: ChaseOutcome): void {
    if(!this.isActive)return;
    this.state="retiring";this.driver.finish(outcome==="won");this.suspect.collisionBody.reportStaticImpacts=false;
    this.lastResult={outcome,passiveIncomeGain:0};this.profile.completePoliceChase(this.lastResult);
    this.resultTimeRemaining=GAME_CONFIG.presentation.resultSeconds;this.resetEngagement();this.refreshHud();
  }

  private distance(): number {return Math.hypot(this.suspect.mesh.position.x-this.player.root.position.x,
    this.suspect.mesh.position.z-this.player.root.position.z)*GAME_CONFIG.ride.metersPerWorldUnit;}
  private scheduleShot(): void {const c=GAME_CONFIG.policeChase;this.shotRemaining=c.shotMinSeconds+this.rng()*(c.shotMaxSeconds-c.shotMinSeconds);}
  private refreshHud(): void {
    Object.assign(this.hud,{active:this.isActive,suspectHealth:Math.max(0,1-this.driver.damagePercent),distance:this.distance(),
      escapeRemaining:this.isActive&&this.escapeElapsed>0 ? Math.max(0,GAME_CONFIG.policeChase.escapeSeconds-this.escapeElapsed):null,
      hit:this.hitRemaining>0,result:this.lastResult,resultSeconds:this.resultTimeRemaining});
  }

  private trySpawn(): void {
    this.winningSites.length=0;
    for(const sites of this.sites) if(this.rng()<GAME_CONFIG.policeChase.spawnChancePerBlock)this.winningSites.push(sites);
    // Shuffle successes, avoiding the bias of always accepting the first block.
    for(let i=this.winningSites.length-1;i>0;i--) {const j=Math.floor(this.rng()*(i+1));
      [this.winningSites[i],this.winningSites[j]]=[this.winningSites[j],this.winningSites[i]];}
    for(const sites of this.winningSites) {
      const start=Math.floor(this.rng()*sites.length);
      for(let i=0;i<sites.length;i++) {
        const site=sites[(i+start)%sites.length];
        if(Math.hypot(site.x-this.player.root.position.x,site.z-this.player.root.position.z)*GAME_CONFIG.ride.metersPerWorldUnit
          <GAME_CONFIG.policeChase.minimumSpawnDistanceMeters || !this.offscreen(site.x,site.z))continue;
        this.world.getNearbyColliders(site.x,site.z,12,this.colliders);
        if(this.colliders.some(b=>Math.abs(b.x-site.x)<b.halfX+8&&Math.abs(b.z-site.z)<b.halfZ+8)
          ||this.traffic.cars.some(car=>car!==this.suspect&&Math.hypot(car.mesh.position.x-site.x,car.mesh.position.z-site.z)<25))continue;
        this.suspect.respawn(site.waypoint,site.direction,.5);
        this.driver.spawn(this.suspect.target,site.direction);this.suspect.mesh.setEnabled(true);
        this.state="roaming";this.resetEngagement();this.scheduleShot();return;
      }
    }
  }

  private offscreen(x: number,z: number): boolean {
    const camera=this.scene.activeCamera;if(!camera)return false;
    camera.getViewMatrix();camera.getProjectionMatrix();
    const planes=Frustum.GetPlanes(camera.getTransformationMatrix());
    const point=new Vector3(x,2,z);
    return planes.some(p=>p.dotCoordinate(point)<-12);
  }

  /** One broad-phase query and segment/box tests per shot; no per-frame line-of-sight work. */
  private fire(damaging: boolean): void {
    const car=this.suspect.mesh.position,heading=this.suspect.mesh.rotation.y,s=Math.sin(heading),c=Math.cos(heading);
    const offset=this.muzzleOffset;
    const x=car.x+offset.x*c+offset.z*s,z=car.z-offset.x*s+offset.z*c,y=car.y+offset.y;
    const player=this.player.root.position,dx=player.x-car.x,dz=player.z-car.z;
    const rear=dx*s+dz*c<=0,distance=this.distance(),odds=shotAtDistance(distance);
    let tx=x-s*30,tz=z-c*30,ty=y;
    if(damaging&&rear&&odds.probability>0) {tx=player.x;tz=player.z;ty=player.y+1.3;}
    const targeted=damaging&&rear&&odds.probability>0;
    let fraction=Infinity;
    this.lastCoverCandidateCount=0;
    if(targeted) {
      this.world.getNearbyColliders((x+tx)/2,(z+tz)/2,Math.hypot(tx-x,tz-z)/2,this.colliders);
      this.traffic.queryVehicles((x+tx)/2,(z+tz)/2,Math.hypot(tx-x,tz-z)/2+15,this.nearby);
      this.lastCoverCandidateCount=this.colliders.length+this.nearby.length;
      for(const box of this.colliders)fraction=Math.min(fraction,segmentBoxFraction(x,z,tx,tz,box));
      for(const other of this.nearby)if(other!==this.suspect)fraction=Math.min(fraction,segmentVehicleFraction(x,z,tx,tz,other.collisionBody));
      if(fraction>=1&&this.rng()<odds.probability) {
        this.damage.applyDamage(odds.damage);this.hitRemaining=GAME_CONFIG.policeChase.hitFlashSeconds;
      } else if(fraction>=1) {tx+=c*5;tz-=s*5;} // Cosmetic miss passes beside the cruiser.
    }
    if(fraction<1) {tx=x+(tx-x)*fraction;tz=z+(tz-z)*fraction;ty=y+(ty-y)*fraction;}
    const length=Math.hypot(tx-x,ty-y,tz-z);
    this.muzzle.position.set(x,y,z);this.tracer.position.set((x+tx)/2,(y+ty)/2,(z+tz)/2);
    this.tracer.scaling.z=length;this.tracer.rotation.set(-Math.atan2(ty-y,Math.hypot(tx-x,tz-z)),Math.atan2(tx-x,tz-z),0);
    this.muzzle.setEnabled(true);this.tracer.setEnabled(true);this.flashRemaining=GAME_CONFIG.policeChase.tracerSeconds;
    this.shotsFired++;
  }

  dispose(): void {
    this.driver.enabled=false;this.muzzle.dispose();this.tracer.dispose();this.prototype.dispose();
    this.shotMaterial.dispose();this.material.dispose();
  }
}
