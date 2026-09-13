import { GAME_CONFIG } from "../game/config";

export class Input {
  private readonly keys = new Set<string>();
  private steeringValue = 0;
  private throttleValue = 0;
  private brakeValue = 0;
  private readonly onKeyDown = (event: KeyboardEvent) => {
    this.keys.add(event.code);
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyP", "KeyM"].includes(event.code)) {
      event.preventDefault();
    }
  };
  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  get steering(): number {
    return this.steeringValue;
  }

  get throttle(): number {
    return this.throttleValue;
  }

  get brake(): number {
    return this.brakeValue;
  }

  updateDriving(deltaTime: number): void {
    const steeringTarget = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight"))
      - Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    const throttleTarget = Number(this.keys.has("KeyW") || this.keys.has("ArrowUp"));
    const brakeTarget = Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
    const steeringRate = steeringTarget === 0
      ? GAME_CONFIG.input.steeringReturnRate
      : GAME_CONFIG.input.steeringRiseRate;

    this.steeringValue = this.moveTowards(this.steeringValue, steeringTarget, steeringRate * deltaTime);
    this.throttleValue = this.moveTowards(
      this.throttleValue,
      throttleTarget,
      (throttleTarget === 0 ? GAME_CONFIG.input.pedalReturnRate : GAME_CONFIG.input.pedalRiseRate) * deltaTime,
    );
    this.brakeValue = this.moveTowards(
      this.brakeValue,
      brakeTarget,
      (brakeTarget === 0 ? GAME_CONFIG.input.pedalReturnRate : GAME_CONFIG.input.pedalRiseRate) * deltaTime,
    );
  }

  resetDrivingState(): void {
    this.steeringValue = 0;
    this.throttleValue = 0;
    this.brakeValue = 0;
  }

  consumeReset(): boolean {
    if (!this.keys.has("KeyR")) {
      return false;
    }
    this.keys.delete("KeyR");
    return true;
  }

  consumePhoneToggle(): boolean {
    if (!this.keys.has("KeyP")) {
      return false;
    }
    this.keys.delete("KeyP");
    return true;
  }

  consumeMapToggle(): boolean {
    if (!this.keys.has("KeyM")) {
      return false;
    }
    this.keys.delete("KeyM");
    return true;
  }

  consumeEscape(): boolean {
    if (!this.keys.has("Escape")) {
      return false;
    }
    this.keys.delete("Escape");
    return true;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  private moveTowards(current: number, target: number, maxDelta: number): number {
    if (Math.abs(target - current) <= maxDelta) {
      return target;
    }
    return current + Math.sign(target - current) * maxDelta;
  }
}
