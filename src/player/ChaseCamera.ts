import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GAME_CONFIG } from "../game/config";
import { clamp, damping, lerp } from "../utils/math";
import type { PlayerCar } from "./PlayerCar";

export class ChaseCamera {
  readonly camera: UniversalCamera;
  private readonly config = GAME_CONFIG.camera;
  private target = Vector3.Zero();
  private readonly headingForward = Vector3.Zero();
  private readonly travelDirection = Vector3.Zero();
  private readonly forward = Vector3.Zero();
  private readonly desiredPosition = Vector3.Zero();
  private readonly desiredTarget = Vector3.Zero();

  constructor(scene: Scene, private readonly player: PlayerCar) {
    this.camera = new UniversalCamera("chase-camera", new Vector3(0, 35, -35), scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 2200;
    this.camera.fov = 0.82;
    this.target.copyFrom(player.root.position);
    this.update(1 / 60);
  }

  snapToPlayer(): void {
    this.update(100);
  }

  update(deltaTime: number): void {
    this.player.getForwardToRef(this.headingForward);
    this.player.getTravelDirectionToRef(this.travelDirection);
    Vector3.LerpToRef(this.headingForward, this.travelDirection, this.config.velocityInfluence, this.forward);
    this.forward.normalize();
    this.desiredPosition.set(
      this.player.root.position.x - this.forward.x * this.config.distance,
      this.player.root.position.y + this.config.height,
      this.player.root.position.z - this.forward.z * this.config.distance,
    );
    this.desiredTarget.set(
      this.player.root.position.x + this.forward.x * this.config.lookAhead,
      this.player.root.position.y + 2,
      this.player.root.position.z + this.forward.z * this.config.lookAhead,
    );

    Vector3.LerpToRef(this.camera.position, this.desiredPosition, damping(deltaTime, this.config.positionDamping), this.camera.position);
    Vector3.LerpToRef(this.target, this.desiredTarget, damping(deltaTime, this.config.targetDamping), this.target);
    const maxSpeedMph = this.player.getMaxForwardSpeed() * GAME_CONFIG.ride.mphPerWorldUnitPerSecond;
    const speedRatio = clamp(this.player.getSpeedMph() / maxSpeedMph, 0, 1);
    const desiredFov = lerp(this.config.minFov, this.config.maxFov, Math.pow(speedRatio, 1.6));
    this.camera.fov = lerp(this.camera.fov, desiredFov, damping(deltaTime, 4));
    this.camera.setTarget(this.target);
  }
}
