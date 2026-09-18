import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GAME_CONFIG } from "../game/config";
import type { TrafficWaypoint } from "../game/types";
import type { VehicleBody } from "../physics/VehicleBody";
import { NpcRecovery, type RecoveryHandling } from "../physics/NpcRecovery";
import { createTrafficTurnPath, type Direction, type TrafficCar, type TrafficDriver } from "../traffic/TrafficCar";
import type { WorldQuery } from "../world/WorldQuery";
import { clamp } from "../utils/math";

const directions: Direction[] = ["north", "south", "east", "west"];
export const directionOffset = (d: Direction): [number, number] => d === "north" ? [0, -1] : d === "south" ? [0, 1] : d === "east" ? [1, 0] : [-1, 0];
const opposite = (d: Direction): Direction => d === "north" ? "south" : d === "south" ? "north" : d === "east" ? "west" : "east";

/** A physical steering controller, never a waypoint teleport or rotate-in-place recovery. */
export class SuspectDriver implements TrafficDriver {
  enabled = false;
  chasing = false;
  disabled = false;
  damagePercent = 0;
  readonly recovery = new NpcRecovery();
  private ix = 0;
  private iz = 0;
  private direction: Direction = "east";
  private exitDirection: Direction = "east";
  private path: Vector3[] = [];
  private pathIndex = 0;
  private time = 0;
  private stuck = 0;
  private damageCooldown = 0;
  private readonly handling: RecoveryHandling = { ...GAME_CONFIG.policeChase.suspectHandling,
    topSpeed: GAME_CONFIG.policeChase.suspectTopSpeedMph / GAME_CONFIG.ride.mphPerWorldUnitPerSecond };

  constructor(private readonly xs: readonly number[], private readonly zs: readonly number[], private readonly rng: () => number) {}

  spawn(target: TrafficWaypoint, direction: Direction): void {
    this.enabled = true; this.chasing = this.disabled = false; this.damagePercent = 0;
    this.ix = target.ix; this.iz = target.iz; this.direction = this.exitDirection = direction;
    this.path.length = 0; this.pathIndex = this.time = this.stuck = this.damageCooldown = 0; this.recovery.reset();
  }
  beginChase(): void { this.chasing = true; this.damagePercent = 0; this.damageCooldown = 0; }
  finish(won: boolean): void { this.chasing = false; this.disabled = won; }
  damage(amount: number): void {
    if (!this.chasing || this.damageCooldown > 0 || amount <= 0) return;
    this.damagePercent = Math.min(1, this.damagePercent + amount);
    this.damageCooldown = GAME_CONFIG.policeChase.damageCooldownSeconds;
    if (this.damagePercent >= 1) this.disabled = true;
  }
  impact(body: VehicleBody): void { this.recovery.impact(body); }

  update(body: VehicleBody, dt: number, nearby: readonly TrafficCar[], world?: WorldQuery, player?: VehicleBody): void {
    const c = GAME_CONFIG.policeChase, scale = GAME_CONFIG.ride.mphPerWorldUnitPerSecond;
    this.time += dt; this.damageCooldown = Math.max(0, this.damageCooldown - dt);
    const moving = Math.hypot(body.velocityX, body.velocityZ);
    this.stuck = moving < 3 && !this.disabled ? this.stuck + dt : 0;
    let dx = this.xs[this.ix] - body.x, dz = this.zs[this.iz] - body.z;
    let intersectionDistance = Math.hypot(dx, dz);
    if (!this.path.length && intersectionDistance < c.routeChoiceDistance) this.planTurn(player);
    if (this.path.length) {
      // Skip passed curve samples, but keep a short physical look-ahead through the bend.
      while (this.pathIndex < this.path.length - 1
        && Math.hypot(this.path[this.pathIndex].x-body.x,this.path[this.pathIndex].z-body.z) < 12) this.pathIndex++;
      const end = this.path[this.path.length - 1], [fx,fz] = directionOffset(this.exitDirection);
      if (this.pathIndex === this.path.length - 1 && ((body.x-end.x)*fx+(body.z-end.z)*fz > 0
        || Math.hypot(end.x-body.x,end.z-body.z) < 9)) {
        this.direction = this.exitDirection; this.ix += fx; this.iz += fz;
        this.path.length = 0; this.pathIndex = 0;
        dx = this.xs[this.ix]-body.x; dz = this.zs[this.iz]-body.z; intersectionDistance = Math.hypot(dx,dz);
      }
    }
    const [fx,fz] = directionOffset(this.direction), lane = GAME_CONFIG.traffic.laneOffset;
    let x: number, z: number;
    if (this.path.length) {
      x = this.path[this.pathIndex].x; z = this.path[this.pathIndex].z;
      // Follow through the exit instead of braking to chase the last point sideways.
      if (this.pathIndex === this.path.length - 1) {
        const [exitX,exitZ] = directionOffset(this.exitDirection);
        x += exitX*c.navigationLookAhead; z += exitZ*c.navigationLookAhead;
      }
    }
    else {
      const weave = Math.sin(this.time*Math.PI*2/c.weavePeriodSeconds) * c.weaveAmplitude
        * clamp((intersectionDistance-c.routeChoiceDistance)/80,0,1);
      const offset = clamp(lane + weave, -GAME_CONFIG.world.roadWidth/2+10, GAME_CONFIG.world.roadWidth/2-10);
      const ahead = Math.min(c.navigationLookAhead, Math.max(0, dx*fx+dz*fz));
      x = fx ? body.x+fx*ahead : this.xs[this.ix]+fz*offset;
      z = fz ? body.z+fz*ahead : this.zs[this.iz]-fx*offset;
    }
    const top = (this.chasing ? c.suspectTopSpeedMph : c.ambientTopSpeedMph)/scale;
    const corner = c.cornerSpeedMph/scale;
    const speed = this.path.length ? corner : Math.min(top, Math.sqrt(corner*corner
      + 2*this.handling.braking*Math.max(0,intersectionDistance-c.routeChoiceDistance)));
    this.recovery.drive(body, dt, {x,z,speed,handling:this.handling,stop:this.disabled,
      allowPause:false,reactionSeconds:0,steeringRecoverySeconds:0,forceManeuver:this.stuck>2},world,nearby,player);
    body.dynamic = true;
  }

  private planTurn(player?: VehicleBody): void {
    const available = directions.filter(d => { const [x,z]=directionOffset(d);
      return this.ix+x>=0 && this.ix+x<this.xs.length && this.iz+z>=0 && this.iz+z<this.zs.length; });
    const choices = available.filter(d=>d!==opposite(this.direction));
    let best = choices[0] ?? available[0], bestScore = -Infinity;
    for (const d of choices.length ? choices : available) {
      const [fx,fz]=directionOffset(d), x=this.xs[this.ix+fx], z=this.zs[this.iz+fz];
      const score=(this.chasing && player ? Math.hypot(x-player.x,z-player.z) : 0)+this.rng()*220
        +(d===this.direction?40:0);
      if (score>bestScore) {best=d;bestScore=score;}
    }
    this.exitDirection=best;
    const [ax,az]=directionOffset(this.direction),[bx,bz]=directionOffset(best),lane=GAME_CONFIG.traffic.laneOffset;
    const radius=GAME_CONFIG.world.roadWidth/2+8,x=this.xs[this.ix],z=this.zs[this.iz];
    const start=new Vector3(x-ax*radius+az*lane,0,z-az*radius-ax*lane);
    const end=new Vector3(x+bx*radius+bz*lane,0,z+bz*radius-bx*lane);
    this.path=[start,...createTrafficTurnPath(start,end,this.direction,8)];this.pathIndex=0;
  }
}
