import type { TrainingRegion, TrainingCategoryId } from "../training/Training";
import { createRideOffer } from "./RideFactory";
import { GAME_CONFIG } from "../game/config";
import { type DeliveryPoint, type RideOffer, type RideTier } from "../game/types";
import { distanceXZ, randomSeed, seededRandom } from "../utils/math";
import type { PlayerCar } from "../player/PlayerCar";
import type { MissionLicenseDefinition } from "../missions/MissionLicenseCatalog";

const OFFER_TIERS: RideTier[] = ["SHORT", "MEDIUM", "LONG"];

export class RideOfferManager {
  readonly offers: RideOffer[] = [];
  private readonly rng: () => number;
  private nextId = 1;
  private distanceRefreshElapsed = 0;

  constructor(
    private readonly points: DeliveryPoint[],
    private readonly player: PlayerCar,
    readonly category: MissionLicenseDefinition,
    private readonly region?: TrainingRegion,
  ) {
    // Offer pools are session content: use the catalog seed only as a stable
    // fallback lineage, then randomize the actual stream for each new pool.
    this.rng = seededRandom((category.offerSeed ^ randomSeed()) >>> 0);
    const tiers = this.generateTierSet();
    for (let i = 0; i < GAME_CONFIG.ride.offerCount; i++) {
      const stagger = (GAME_CONFIG.ride.offerCount - i - 1) * -GAME_CONFIG.ride.offerLifetimeSeconds;
      this.offers.push(this.generateOffer(tiers[i], stagger));
    }
  }

  update(deltaTime: number, canUpdate: boolean): void {
    if (!canUpdate || this.offers.length === 0) {
      return;
    }

    this.distanceRefreshElapsed += deltaTime;
    if (this.distanceRefreshElapsed >= GAME_CONFIG.ride.offerDistanceRefreshSeconds) {
      this.distanceRefreshElapsed = 0;
      if (!this.region) this.refreshPickupDistances();
    }

    for (const offer of this.offers) {
      offer.ageSeconds += deltaTime;
    }

    const oldest = this.offers[this.offers.length - 1];
    if (oldest.ageSeconds >= GAME_CONFIG.ride.offerLifetimeSeconds) {
      this.offers.pop();
      const tier = this.pickReplacementTier();
      this.offers.unshift(this.generateOffer(tier, -GAME_CONFIG.ride.offerLifetimeSeconds * (GAME_CONFIG.ride.offerCount - 1)));
    }
  }

  acceptOffer(id: string): RideOffer | null {
    const offer = this.offers.find((candidate) => candidate.id === id) ?? null;
    if (!offer) {
      return null;
    }
    this.offers.length = 0;
    return offer;
  }

  refillOffers(): void {
    this.offers.length = 0;
    this.distanceRefreshElapsed = 0;
    const tiers = this.generateTierSet();
    for (let i = 0; i < GAME_CONFIG.ride.offerCount; i++) {
      const stagger = (GAME_CONFIG.ride.offerCount - i - 1) * -GAME_CONFIG.ride.offerLifetimeSeconds;
      this.offers.push(this.generateOffer(tiers[i], stagger));
    }
  }

  private generateOffer(tier: RideTier, ageSeconds = 0): RideOffer {
    const pickupPoint = this.pickPickupPoint();
    return createRideOffer(this.points, pickupPoint, tier, this.category, this.rng,
      `${this.region?.id ?? "global"}-${this.category.id}-ride-${this.nextId++}`,
      distanceXZ(this.player.root.position, pickupPoint.position) * GAME_CONFIG.ride.metersPerWorldUnit,
      this.region ? { regionId: this.region.id, categoryId: this.category.id as TrainingCategoryId } : undefined, ageSeconds);
  }

  private pickPickupPoint(): DeliveryPoint {
    if (this.region) return this.region.pickups[Math.floor(this.rng() * this.region.pickups.length)];
    const maxDistance = GAME_CONFIG.ride.maxPickupDistance;
    const candidates = this.points.filter((point) => {
      return distanceXZ(this.player.root.position, point.position) * GAME_CONFIG.ride.metersPerWorldUnit <= maxDistance;
    });
    if (candidates.length > 0) {
      return candidates[Math.floor(this.rng() * candidates.length)];
    }
    return this.points.reduce((nearest, point) => {
      const nearestDistance = distanceXZ(this.player.root.position, nearest.position);
      const pointDistance = distanceXZ(this.player.root.position, point.position);
      return pointDistance < nearestDistance ? point : nearest;
    });
  }

  refreshPickupDistances(): void {
    for (const offer of this.offers) {
      offer.pickupDistance = distanceXZ(this.player.root.position, offer.pickupPoint.position) * GAME_CONFIG.ride.metersPerWorldUnit;
    }
  }

  private generateTierSet(): RideTier[] {
    const tiers = Array.from({ length: GAME_CONFIG.ride.offerCount }, () => this.randomTier());
    if (tiers.length >= 2 && tiers.every((tier) => tier === tiers[0])) {
      tiers[tiers.length - 1] = this.randomTier(tiers[0]);
    }
    return tiers;
  }

  private pickReplacementTier(): RideTier {
    if (this.offers.length >= 2 && this.offers.every((offer) => offer.tier === this.offers[0].tier)) {
      return this.randomTier(this.offers[0].tier);
    }
    return this.randomTier();
  }

  private randomTier(excluded?: RideTier): RideTier {
    const candidates = excluded ? OFFER_TIERS.filter((tier) => tier !== excluded) : OFFER_TIERS;
    return candidates[Math.floor(this.rng() * candidates.length)];
  }

}
