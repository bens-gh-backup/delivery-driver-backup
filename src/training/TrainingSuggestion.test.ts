import { describe, expect, it } from "vitest";
import { suggestTraining } from "./TrainingSuggestion";
import { TRAINING_CATEGORIES, type TrainingCategoryId, type TrainingRegion } from "./Training";

const region = (id: string, pickupX: number, centerX = pickupX): TrainingRegion => ({
  id, label: id, bx: 0, bz: 0, x: centerX, z: 0, minX: 0, maxX: 100, minZ: 0, maxZ: 100,
  pickups: [{ position: { x: pickupX, z: 0 } }] as TrainingRegion["pickups"],
});
function profile(completed: Record<string, number> = {}, ambulance = false) {
  return { ownsMissionLicense: (id: string) => id === "taxi" || ambulance,
    getTrainingCount: (id: string, category: TrainingCategoryId) => completed[`${id}:${category}`] ?? 0 };
}
describe("training suggestions", () => {
  it("uses pickup distance rather than block center", () => {
    expect(suggestTraining([region("far", 100, 1), region("near", 10, 500)], profile(), { x: 0, z: 0 })?.regionId).toBe("near");
  });
  it("continues the previous region only within the configured travel ratio", () => {
    const regions = [region("near", 10), region("previous", 14)];
    expect(suggestTraining(regions, profile(), { x: 0, z: 0 }, "previous", 1.5)?.regionId).toBe("previous");
    expect(suggestTraining(regions, profile(), { x: 0, z: 0 }, "previous", 1.2)?.regionId).toBe("near");
  });
  it("excludes locked and completed work and discovers newly licensed work", () => {
    const regions = [region("a", 10)];
    const counts: Record<string, number> = { "a:taxi": TRAINING_CATEGORIES[0].required };
    expect(suggestTraining(regions, profile(counts), { x: 0, z: 0 })).toBeNull();
    expect(suggestTraining(regions, profile(counts, true), { x: 0, z: 0 })).toEqual({ regionId: "a", categoryId: "ambulance_driver" });
    counts["a:taxi"] = 0;
    expect(suggestTraining(regions, profile(counts), { x: 0, z: 0 })?.categoryId).toBe("taxi");
  });
  it("ignores regions without legal pickups", () => {
    expect(suggestTraining([{ ...region("a", 0), pickups: [] }], profile(), { x: 0, z: 0 })).toBeNull();
  });
});
