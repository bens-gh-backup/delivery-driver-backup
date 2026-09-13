import { GAME_CONFIG } from "../game/config";
import { normalizeAngle } from "../utils/math";
import type { DrivingPosition } from "./PassengerDrivingEvents";

/** One player-only maneuver tracker; no road search and no effect on police/Careful rules. */
export class PassengerTurnTracker {
  private previous: DrivingPosition | null = null;
  private previousHeading = 0;
  private rotation = 0;
  private rightmostRotation = 0;
  private straightAnchor = 0;
  private straightDistance = 0;
  private reported = false;

  reset(position?: DrivingPosition, heading = 0): void {
    this.previous = position ? {x:position.x,z:position.z} : null;
    this.previousHeading = heading;
    this.resetManeuver();
  }

  /** True once when a moving maneuver turns left >=60° or reverses heading >=150°. */
  update(position: DrivingPosition, heading: number): boolean {
    if (!this.previous) { this.reset(position,heading); return false; }
    const distance = Math.hypot(position.x-this.previous.x,position.z-this.previous.z)
      * GAME_CONFIG.ride.metersPerWorldUnit;
    const delta = normalizeAngle(heading-this.previousHeading) * 180/Math.PI;
    this.previous = {x:position.x,z:position.z};
    this.previousHeading = heading;
    if (distance < 1e-6) return false;
    const rules = GAME_CONFIG.ride.archetypes;
    this.rotation += delta;
    this.rightmostRotation = Math.max(this.rightmostRotation,this.rotation);
    const forbidden = !this.reported && (this.rightmostRotation-this.rotation >= rules.turnLeftDegrees-1e-6
      || Math.abs(this.rotation) >= rules.turnUTurnDegrees-1e-6);
    if (forbidden) this.reported = true;
    // Only rearm after a meaningful maneuver, never erase a gradual turn's initial rotation.
    if (this.rightmostRotation >= rules.turnLeftDegrees || this.reported) {
      if (Math.abs(delta)/distance > rules.turnStraightMaxDegreesPerMeter
        || Math.abs(this.rotation-this.straightAnchor) > rules.turnStraightDegrees) {
        this.straightAnchor = this.rotation;
        this.straightDistance = 0;
      } else {
        this.straightDistance += distance;
        if (this.straightDistance >= rules.turnRearmDistanceMeters) this.resetManeuver();
      }
    }
    return forbidden;
  }

  private resetManeuver(): void {
    this.rotation = 0;
    this.rightmostRotation = 0;
    this.straightAnchor = 0;
    this.straightDistance = 0;
    this.reported = false;
  }
}
