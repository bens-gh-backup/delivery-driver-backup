import { GAME_CONFIG } from "../game/config";
import type { PlayerProfile } from "../player/PlayerProfile";
import { TRAINING_CATEGORIES, type TrainingContext, type TrainingRegion } from "./Training";

/** Called on phone opening/progression changes, never as part of the driving loop. */
export function suggestTraining(
  regions: readonly TrainingRegion[],
  profile: Pick<PlayerProfile, "getTrainingCount" | "ownsMissionLicense">,
  position: { x: number; z: number },
  lastRegionId?: string,
  distanceRatio: number = GAME_CONFIG.presentation.recommendationDistanceRatio,
): TrainingContext | null {
  const candidates = regions.flatMap(region => {
    if (!region.pickups.length) return [];
    const category = TRAINING_CATEGORIES.find(category => profile.ownsMissionLicense(category.id)
      && profile.getTrainingCount(region.id, category.id) < category.required);
    if (!category) return [];
    const distance = Math.min(...region.pickups.map(pickup =>
      Math.hypot(pickup.position.x - position.x, pickup.position.z - position.z)));
    return [{ regionId: region.id, categoryId: category.id, distance }];
  }).sort((a, b) => a.distance - b.distance || a.regionId.localeCompare(b.regionId));
  const closest = candidates[0];
  if (!closest) return null;
  const previous = candidates.find(candidate => candidate.regionId === lastRegionId);
  const selected = previous && previous.distance <= closest.distance * Math.max(1, distanceRatio)
    ? previous : closest;
  return { regionId: selected.regionId, categoryId: selected.categoryId };
}
