import type { DeliveryPoint } from "../game/types";
import type { Town } from "../world/Town";
import { GAME_CONFIG } from "../game/config";

export const TRAINING_CATEGORIES = [
  {
    id: "taxi", name: "Taxi",
    required: GAME_CONFIG.progression.training.taxi.requiredMissionsPerRegion,
    passiveIncomePerMission: GAME_CONFIG.progression.training.taxi.passiveIncomePerMission,
    completionMultiplier: GAME_CONFIG.progression.training.taxi.completionMultiplier,
  },
  {
    id: "ambulance_driver", name: "Ambulance Driver",
    required: GAME_CONFIG.progression.training.ambulance_driver.requiredMissionsPerRegion,
    passiveIncomePerMission: GAME_CONFIG.progression.training.ambulance_driver.passiveIncomePerMission,
    completionMultiplier: GAME_CONFIG.progression.training.ambulance_driver.completionMultiplier,
  },
] as const;
export const TRAINING_JOBS_PER_REGION = TRAINING_CATEGORIES.reduce((sum, category) => sum + category.required, 0);
export type TrainingCategoryId = typeof TRAINING_CATEGORIES[number]["id"];
export interface TrainingContext { readonly regionId: string; readonly categoryId: TrainingCategoryId; }
/** Transient receipt, derived at the moment a job is credited; never persisted. */
export interface TrainingReward extends TrainingContext {
  readonly before: number;
  readonly after: number;
  readonly required: number;
  readonly incomeBefore: number;
  readonly incomeAfter: number;
}

export type RegionProgress = Partial<Record<TrainingCategoryId, number>>;
export type TrainingProgress = Record<string, RegionProgress>;
export interface TrainingRegion {
  id: string; label: string; bx: number; bz: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
  x: number; z: number; pickups: DeliveryPoint[];
}

export function createTrainingRegions(town: Pick<Town, "roadPositionsX" | "roadPositionsZ" | "deliveryPoints" | "roads">): TrainingRegion[] {
  const regions: TrainingRegion[] = [];
  const eligible = new Set(town.roads.filter(road => road.type === "city" && road.allowsMissionStops).map(road => road.id));
  const xs = town.roadPositionsX, zs = town.roadPositionsZ;
  for (let bz = 0; bz < zs.length - 1; bz++) for (let bx = 0; bx < xs.length - 1; bx++) {
    const minX = xs[bx], maxX = xs[bx + 1], minZ = zs[bz], maxZ = zs[bz + 1];
    regions.push({ id: `block-${bx}-${bz}`, label: `Region ${regions.length + 1}`, bx, bz,
      minX, maxX, minZ, maxZ, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2,
      pickups: town.deliveryPoints.filter(point => eligible.has(point.roadId)
        && point.position.x >= minX && point.position.x < maxX
        && point.position.z >= minZ && point.position.z < maxZ),
    });
  }
  return regions;
}

export function categoryIncome(categoryId: TrainingCategoryId, completed: number): number {
  const category = TRAINING_CATEGORIES.find(category => category.id === categoryId)!;
  const count = Math.min(category.required, Math.max(0, Math.floor(Number.isFinite(completed) ? completed : 0)));
  return count * category.passiveIncomePerMission
    * (count === category.required ? category.completionMultiplier : 1);
}

export function sanitizeTrainingProgress(value: unknown): TrainingProgress {
  const result: TrainingProgress = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [id, progress] of Object.entries(value)) {
    if (!/^block-\d+-\d+$/.test(id) || !progress || typeof progress !== "object") continue;
    const counts: RegionProgress = {};
    for (const category of TRAINING_CATEGORIES) {
      const current = progress[category.id];
      const record = progress as Record<string, unknown>;
      const legacy = category.id === "ambulance_driver" ? record.package_delivery
        : category.id === "taxi" ? record.rideshare : undefined;
      const value = Math.max(
        typeof current === "number" && Number.isFinite(current) ? current : 0,
        typeof legacy === "number" && Number.isFinite(legacy) ? legacy : 0,
      );
      counts[category.id] = Math.min(category.required, Math.max(0, Math.floor(value)));
    }
    result[id] = counts;
  }
  return result;
}

/** Visible gameplay time; reset on visibility transitions to discard hidden intervals. */
export class TrainingIncomeClock {
  private previous: number | null = null;
  reset(): void { this.previous = null; }
  tick(now: number, active: boolean): number {
    const previous = this.previous;
    this.previous = active ? now : null;
    return active && previous !== null ? Math.max(0, (now - previous) / 1000) : 0;
  }
}
