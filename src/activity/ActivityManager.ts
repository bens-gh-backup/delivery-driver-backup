import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

export interface Activity {
  readonly isActive: boolean;
  getObjectivePosition(): Vector3 | null;
}

export class ActivityManager {
  private activeActivity: Activity | null = null;

  get hasActiveActivity(): boolean {
    return this.activeActivity !== null;
  }

  start(activity: Activity, begin: () => boolean): boolean {
    if (this.activeActivity || !begin()) {
      return false;
    }
    this.activeActivity = activity;
    return true;
  }

  update(): void {
    if (this.activeActivity && !this.activeActivity.isActive) {
      this.activeActivity = null;
    }
  }

  getObjectivePosition(): Vector3 | null {
    return this.activeActivity?.getObjectivePosition() ?? null;
  }
}
