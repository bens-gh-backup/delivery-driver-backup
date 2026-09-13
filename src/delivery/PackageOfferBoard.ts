import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GAME_CONFIG } from "../game/config";
import type { Clinic, DeliveryPoint } from "../game/types";
import type { PlayerCar } from "../player/PlayerCar";
import type { TrainingRegion } from "../training/Training";
import { distanceXZ, randomSeed, seededRandom } from "../utils/math";
import type { PackageDeliveryOffer } from "./PackageDeliveryManager";

class PackageOfferPool {
  readonly offers: PackageDeliveryOffer[] = [];
  private readonly rng = seededRandom(GAME_CONFIG.ambulanceDriver.offerSeed ^ randomSeed());
  private nextId = 1;
  constructor(private readonly points: readonly DeliveryPoint[], private readonly player: PlayerCar,
    private readonly clinic: Clinic, private readonly region?: TrainingRegion) { this.refill(); }
  refill(): void {
    this.offers.length = 0;
    for (let i = 0; i < 3; i++) this.offers.push(this.generateOffer());
  }
  generateOffer(): PackageDeliveryOffer {
    const pickupPoint = this.pickPickupPoint();
    const destinationPoint = this.clinic.destinationPoint;
    const pickupDistance = this.distanceInMeters(this.player.root.position, pickupPoint.position);
    const tripDistance = this.distanceInMeters(pickupPoint.position, destinationPoint.position);
    return {
      id: `${this.region?.id ?? "global"}-ambulance-${this.nextId++}`,
      training: this.region ? Object.freeze({ regionId: this.region.id, categoryId: "ambulance_driver" as const }) : undefined,
      pickupPoint,
      destinationPoint,
      pickupDistance,
      tripDistance,
      initialPayout: tripDistance * GAME_CONFIG.ambulanceDriver.ratePerMeter,
    };
  }

  private pickPickupPoint(): DeliveryPoint {
    const candidates = this.points.filter(point => this.distanceInMeters(point.position, this.clinic.destinationPoint.position)
      > GAME_CONFIG.ambulanceDriver.minDropoffDistance);
    if (candidates.length > 0) return candidates[Math.floor(this.rng() * candidates.length)];
    return this.points.reduce((nearest, point) => {
      return distanceXZ(this.player.root.position, point.position) < distanceXZ(this.player.root.position, nearest.position)
        ? point
        : nearest;
    });
  }

  private distanceInMeters(a: Vector3, b: Vector3): number {
    return distanceXZ(a, b) * GAME_CONFIG.ride.metersPerWorldUnit;
  }
}

export class PackageOfferBoard {
  private readonly pools = new Map<string, PackageOfferPool>();
  constructor(private readonly points: readonly DeliveryPoint[], private readonly player: PlayerCar,
    readonly regions: readonly TrainingRegion[] = [], private readonly clinics: readonly Clinic[] = []) {}
  private ensurePool(regionId?: string): PackageOfferPool | null {
    const key = regionId ?? "global";
    let pool = this.pools.get(key);
    if (pool) return pool;
    const region = regionId ? this.regions.find(region => region.id === regionId) : undefined;
    if (regionId && !region?.pickups.length) return null;
    const clinic = this.clinics.find(clinic => clinic.regionId === regionId) ?? this.clinics[0];
    if (!clinic) return null;
    pool = new PackageOfferPool(this.points, this.player, clinic, region);
    this.pools.set(key, pool);
    return pool;
  }
  getOffers(regionId?: string): readonly PackageDeliveryOffer[] {
    const offers = this.ensurePool(regionId)?.offers ?? [];
    for (const offer of offers) offer.pickupDistance = distanceXZ(this.player.root.position, offer.pickupPoint.position)
      * GAME_CONFIG.ride.metersPerWorldUnit;
    return offers;
  }
  acceptOffer(id: string, regionId?: string): PackageDeliveryOffer | null {
    const pool = this.pools.get(regionId ?? "global");
    const offer = pool?.offers.find(offer => offer.id === id);
    if (!pool || !offer) return null;
    pool.offers.length = 0;
    return offer;
  }
  refill(regionId?: string): void { this.pools.get(regionId ?? "global")?.refill(); }
}
