import type { DeliveryPoint, RideOffer } from "../game/types";
import { getMissionLicense, type MissionLicenseId } from "../missions/MissionLicenseCatalog";
import type { PlayerCar } from "../player/PlayerCar";
import type { TrainingRegion } from "../training/Training";
import { RideOfferManager } from "./RideOfferManager";

export class RideOfferBoard {
  private readonly pools = new Map<string, RideOfferManager>();
  constructor(private readonly points: DeliveryPoint[], private readonly player: PlayerCar,
    readonly regions: readonly TrainingRegion[] = []) {}

  ensurePool(categoryId: MissionLicenseId, regionId?: string): RideOfferManager | null {
    const key = `${regionId ?? "global"}:${categoryId}`;
    const existing = this.pools.get(key);
    if (existing) return existing;
    const category = getMissionLicense(categoryId);
    const region = regionId ? this.regions.find(region => region.id === regionId) : undefined;
    if (!category || category.activityType !== "passengerRide"
      || (regionId && !region?.pickups.length)) return null;
    const pool = new RideOfferManager(this.points, this.player, category, region);
    this.pools.set(key, pool);
    return pool;
  }

  getOffers(categoryId: MissionLicenseId, regionId?: string): readonly RideOffer[] {
    const pool = this.ensurePool(categoryId, regionId);
    pool?.refreshPickupDistances();
    return pool?.offers ?? [];
  }

  update(deltaTime: number, canUpdate: boolean, ownedCategoryIds: readonly MissionLicenseId[]): void {
    for (const pool of this.pools.values()) {
      if (ownedCategoryIds.includes(pool.category.id)) pool.update(deltaTime, canUpdate);
    }
  }

  acceptOffer(categoryId: MissionLicenseId, offerId: string, regionId?: string): RideOffer | null {
    return this.pools.get(`${regionId ?? "global"}:${categoryId}`)?.acceptOffer(offerId) ?? null;
  }

  refillOffers(categoryId: MissionLicenseId, regionId?: string): void {
    this.pools.get(`${regionId ?? "global"}:${categoryId}`)?.refillOffers();
  }
}
