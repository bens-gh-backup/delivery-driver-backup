import { GAME_CONFIG } from "../game/config";
import type { TrafficDriver } from "../traffic/TrafficCar";
import type { VehicleBody } from "../physics/VehicleBody";
import { normalizeAngle } from "../utils/math";

/** No engine or navigation while waiting; a collision can still shove or spin the car. */
export class ParkedRacer implements TrafficDriver {
  enabled = false;
  readonly width = GAME_CONFIG.player.width;
  readonly length = GAME_CONFIG.player.length;
  readonly damagePercent = 0;
  impact(): void {}
  damage(): void {} // Race entrants always start in their original condition.
  update(body: VehicleBody, dt: number): void {
    const drag = Math.exp(-3 * dt);
    body.velocityX *= drag; body.velocityZ *= drag;
    body.angularVelocity *= Math.exp(-GAME_CONFIG.vehicleCollisions.angularDamping * dt);
    body.dynamic = Math.hypot(body.velocityX, body.velocityZ) > .02 || Math.abs(body.angularVelocity) > .02;
    if (!body.dynamic) { body.velocityX = body.velocityZ = body.angularVelocity = 0; return; }
    body.x += body.velocityX * dt; body.z += body.velocityZ * dt;
    body.heading = normalizeAngle(body.heading + body.angularVelocity * dt);
  }
}
