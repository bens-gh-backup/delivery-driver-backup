import { TRAINING_CATEGORIES, categoryIncome, sanitizeTrainingProgress, type TrainingContext, type TrainingProgress, type TrainingRegion, type TrainingCategoryId } from "../training/Training";
import { GAME_CONFIG } from "../game/config";
import { PassengerType, type PoliceCitation, type RideHistoryEntry, type RideResult, type RideTier } from "../game/types";
import {
  MISSION_LICENSES,
  getMissionLicense,
  type MissionLicenseId,
} from "../missions/MissionLicenseCatalog";
import { ProgressionStore } from "../progression/ProgressionStore";
import { getUpgradeCost } from "../progression/UpgradeSystem";
import { VEHICLE_CATALOG, getVehicleDefinition } from "../vehicles/VehicleCatalog";
import type { PlayerProgression, PlayerUpgradeLevels, VehicleStatKey } from "../vehicles/VehicleTypes";

export class PlayerProfile {
  private moneyValue: number;
  private trainingProgress: TrainingProgress;
  private trainingRegionIds = new Set<string>();
  private racingLicenseOwnedValue: boolean;
  private bestRaceFinishesValue: Record<string, number>;
  private incomeRate = 0;
  trainingRevision = 0;

  configureTrainingRegions(regions: readonly TrainingRegion[]): void {
    this.trainingRegionIds = new Set(regions.map(region => region.id));
    this.recalculateTrainingIncome();
  }

  get passiveIncomePerSecond(): number { return this.incomeRate; }

  getTrainingCount(regionId: string, categoryId: TrainingCategoryId): number {
    return this.trainingProgress[regionId]?.[categoryId] ?? 0;
  }

  get ownsRacingLicense(): boolean { return this.racingLicenseOwnedValue; }

  getBestRaceFinish(regionId: string): number | null {
    const finish = this.bestRaceFinishesValue[regionId];
    return typeof finish === "number" ? finish : null;
  }

  getRaceMultiplier(regionId: string): number {
    const finish = this.getBestRaceFinish(regionId);
    if (finish === null) return 1;
    return raceMultiplierForFinish(finish);
  }

  getRegionBaseIncomePerSecond(regionId: string): number {
    return TRAINING_CATEGORIES.reduce((sum, category) =>
      sum + categoryIncome(category.id, this.getTrainingCount(regionId, category.id)), 0);
  }

  getRegionPassiveIncomePerSecond(regionId: string): number {
    return this.getRegionBaseIncomePerSecond(regionId) * this.getRaceMultiplier(regionId);
  }

  private creditTraining(context?: TrainingContext): void {
    if (!context || !this.trainingRegionIds.has(context.regionId)) return;
    const category = TRAINING_CATEGORIES.find(category => category.id === context.categoryId);
    if (!category) return;
    const count = this.getTrainingCount(context.regionId, context.categoryId);
    if (count >= category.required) return;
    const progress = this.trainingProgress[context.regionId] ??= {};
    progress[context.categoryId] = count + 1;
    this.trainingRevision++;
    this.recalculateTrainingIncome();
    this.dirty = true;
  }

  private recalculateTrainingIncome(): void {
    let income = 0;
    for (const id of this.trainingRegionIds) income += this.getRegionPassiveIncomePerSecond(id);
    // Stabilize floating-point accumulation without restricting config tuning to whole cents.
    this.incomeRate = Math.round(income * 1_000_000) / 1_000_000;
  }

  accrueTrainingIncome(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0 || this.incomeRate <= 0) return;
    this.moneyValue += this.incomeRate * seconds;
    this.dirty = true;
  }

  completeAmbulanceJob(payout: number, training?: TrainingContext): void {
    this.moneyValue += finiteNonnegative(payout, 0);
    this.creditTraining(training);
    this.saveNow();
  }

  /** Keeps pre-v7 callers and old development utilities compatible during save migration. */
  completePackage(payout: number, training?: TrainingContext): void {
    this.completeAmbulanceJob(payout, training);
  }

  private jailFreeCardsValue: number;
  private vehicleCouponsValue: number;
  private freeUpgradeCreditsValue: number;
  private readonly settledCitations = new WeakSet<PoliceCitation>();
  private temporaryDebugMoneyValue = 0;
  private completedRidesValue: number;
  private ownedVehicleIdsValue: string[];
  private equippedVehicleIdValue: string;
  private ownedMissionLicenseIdsValue: MissionLicenseId[];
  private rideHistoryValue: RideHistoryEntry[];
  readonly upgrades: PlayerUpgradeLevels;
  private dirty = false;
  private autosaveElapsed = 0;
  private persistenceDisabled = false;
  private readonly onPageHide = () => this.saveNow();

  constructor(private readonly store = new ProgressionStore()) {
    const progression = sanitizeProgression(store.load());
    this.moneyValue = progression.money;
    this.trainingProgress = progression.trainingProgress;
    this.racingLicenseOwnedValue = progression.racingLicenseOwned;
    this.bestRaceFinishesValue = progression.bestRaceFinishes;
    this.jailFreeCardsValue = progression.jailFreeCards;
    this.vehicleCouponsValue = progression.vehicleCoupons;
    this.freeUpgradeCreditsValue = progression.freeUpgradeCredits;
    this.completedRidesValue = progression.completedRides;
    this.ownedVehicleIdsValue = progression.ownedVehicleIds;
    this.equippedVehicleIdValue = progression.equippedVehicleId;
    this.ownedMissionLicenseIdsValue = progression.ownedMissionLicenseIds;
    this.rideHistoryValue = progression.rideHistory;
    this.upgrades = progression.upgrades;
    if (typeof window !== "undefined") window.addEventListener("pagehide", this.onPageHide);
  }

  get money(): number {
    return this.moneyValue;
  }

  set money(value: number) {
    this.moneyValue = Math.max(0, Number.isFinite(value) ? value : 0);
    this.temporaryDebugMoneyValue = 0;
    this.dirty = true;
  }

  get completedRides(): number {
    return this.completedRidesValue;
  }

  get ownedVehicleIds(): readonly string[] {
    return this.ownedVehicleIdsValue;
  }

  get equippedVehicleId(): string {
    return this.equippedVehicleIdValue;
  }

  get rideHistory(): readonly RideHistoryEntry[] {
    return this.rideHistoryValue;
  }

  get ownedMissionLicenseIds(): readonly MissionLicenseId[] {
    return this.ownedMissionLicenseIdsValue;
  }

  get jailFreeCards(): number { return this.jailFreeCardsValue; }
  get vehicleCoupons(): number { return this.vehicleCouponsValue; }
  get freeUpgradeCredits(): number { return this.freeUpgradeCreditsValue; }

  getVehiclePurchaseQuote(id: string): { price: number; couponsUsed: number; discount: number } | null {
    const vehicle = getVehicleDefinition(id);
    if (!vehicle) return null;
    const couponsUsed = this.ownsVehicle(id) ? 0 : Math.min(
      this.vehicleCouponsValue, Math.ceil(vehicle.price / GAME_CONFIG.ride.archetypes.vehicleCouponValue),
    );
    const discount = Math.min(vehicle.price, couponsUsed * GAME_CONFIG.ride.archetypes.vehicleCouponValue);
    return { price: vehicle.price - discount, couponsUsed, discount };
  }

  settlePoliceCitation(citation: PoliceCitation, lawyerOnboard = false): void {
    if (this.settledCitations.has(citation)) return;
    this.settledCitations.add(citation);
    const waiverReason = lawyerOnboard ? "lawyer" : this.jailFreeCardsValue > 0 ? "card" : undefined;
    if (waiverReason === "card") this.jailFreeCardsValue -= 1;
    citation.waiverReason = waiverReason;
    citation.waivedAmount = waiverReason ? citation.assessedFine : 0;
    citation.amountPaid = waiverReason ? 0 : this.spend(citation.assessedFine);
    citation.remainingBalance = this.money;
    this.saveNow();
  }

  completeRide(result: RideResult, training?: TrainingContext): void {
    this.creditTraining(training);
    this.jailFreeCardsValue += Math.floor(finiteNonnegative(result.cardsEarned, 0));
    this.vehicleCouponsValue += Math.floor(finiteNonnegative(result.couponsEarned, 0));
    const freeUpgradeCreditsEarned = Math.floor(finiteNonnegative(result.freeUpgradeCreditsEarned, 0));
    this.freeUpgradeCreditsValue += freeUpgradeCreditsEarned;
    this.moneyValue += Math.max(0, result.total);
    this.completedRidesValue += 1;
    const completedAt = Date.now();
    const historyEntry: RideHistoryEntry = {
      ...result,
      freeUpgradeCreditsEarned,
      id: `ride-${completedAt}-${this.completedRidesValue}`,
      completedAt,
    };
    this.rideHistoryValue = [historyEntry, ...this.rideHistoryValue]
      .slice(0, GAME_CONFIG.progression.rideHistoryLimit);
    this.saveNow();
  }

  spend(requestedAmount: number): number {
    const spent = Math.min(Math.max(0, requestedAmount), this.moneyValue);
    if (spent > 0) this.deductMoney(spent);
    return spent;
  }

  ownsVehicle(id: string): boolean {
    return this.ownedVehicleIdsValue.includes(id);
  }

  ownsMissionLicense(id: string): boolean {
    return this.ownedMissionLicenseIdsValue.includes(id as MissionLicenseId);
  }

  purchaseMissionLicense(id: string): boolean {
    const license = getMissionLicense(id);
    if (!license || this.ownsMissionLicense(id) || this.moneyValue < license.unlockCost) return false;
    this.deductMoney(license.unlockCost);
    this.ownedMissionLicenseIdsValue = [...this.ownedMissionLicenseIdsValue, license.id];
    this.saveNow();
    return true;
  }

  purchaseRacingLicense(): boolean {
    const cost = GAME_CONFIG.racing.licenseCost;
    if (this.racingLicenseOwnedValue || !Number.isFinite(cost) || cost < 0 || this.moneyValue < cost) return false;
    this.deductMoney(cost);
    this.racingLicenseOwnedValue = true;
    this.saveNow();
    return true;
  }

  recordRaceFinish(regionId: string, finish: number): boolean {
    if (!this.trainingRegionIds.has(regionId) || !isRaceRegionId(regionId) || !isRaceFinish(finish)) return false;
    const previous = this.bestRaceFinishesValue[regionId];
    if (previous !== undefined && previous <= finish) return false;
    this.bestRaceFinishesValue[regionId] = Math.floor(finish);
    this.trainingRevision++;
    this.recalculateTrainingIncome();
    this.saveNow();
    return true;
  }

  debugResetRaceFinish(regionId: string): void {
    if (!isRaceRegionId(regionId) || this.bestRaceFinishesValue[regionId] === undefined) return;
    delete this.bestRaceFinishesValue[regionId];
    this.trainingRevision++;
    this.recalculateTrainingIncome();
    this.saveNow();
  }

  debugUnlockRacing(): void {
    if (this.racingLicenseOwnedValue) return;
    this.racingLicenseOwnedValue = true;
    this.saveNow();
  }

  purchaseVehicle(id: string, equipImmediately: boolean): boolean {
    const vehicle = getVehicleDefinition(id);
    const quote = this.getVehiclePurchaseQuote(id);
    if (!vehicle || !quote || this.ownsVehicle(id) || this.moneyValue < quote.price) return false;
    this.deductMoney(quote.price);
    this.vehicleCouponsValue -= quote.couponsUsed;
    this.ownedVehicleIdsValue = [...this.ownedVehicleIdsValue, id];
    if (equipImmediately) this.equippedVehicleIdValue = id;
    this.saveNow();
    return true;
  }

  equipVehicle(id: string): boolean {
    if (!this.ownsVehicle(id) || !getVehicleDefinition(id)) return false;
    this.equippedVehicleIdValue = id;
    this.saveNow();
    return true;
  }

  getUpgradePurchaseQuote(stat: VehicleStatKey): { price: number; creditsUsed: number; nextLevel: number } | null {
    if (!isVehicleStatKey(stat)) return null;
    const nextLevel = this.upgrades[stat] + 1;
    const normalPrice = getUpgradeCost(nextLevel);
    if (normalPrice <= 0) return null;
    return this.freeUpgradeCreditsValue > 0
      ? { price: 0, creditsUsed: 1, nextLevel }
      : { price: normalPrice, creditsUsed: 0, nextLevel };
  }

  purchaseUpgrade(stat: VehicleStatKey): boolean {
    const quote = this.getUpgradePurchaseQuote(stat);
    if (!quote || this.moneyValue < quote.price) return false;
    if (quote.price > 0) this.deductMoney(quote.price);
    if (quote.creditsUsed > 0) this.freeUpgradeCreditsValue -= quote.creditsUsed;
    this.upgrades[stat] = quote.nextLevel;
    this.saveNow();
    return true;
  }

  addMoney(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.moneyValue += amount;
    this.saveNow();
  }

  addTemporaryDebugMoney(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.moneyValue += amount;
    this.temporaryDebugMoneyValue += amount;
  }

  resetMoneyToStartingAmount(): void {
    this.moneyValue = GAME_CONFIG.progression.startingMoney;
    this.temporaryDebugMoneyValue = 0;
    this.saveNow();
  }

  unlockAllVehicles(): void {
    this.ownedVehicleIdsValue = VEHICLE_CATALOG.map((vehicle) => vehicle.id);
    this.saveNow();
  }

  setUpgradeLevel(stat: VehicleStatKey, level: number): void {
    this.upgrades[stat] = clampLevel(level);
    this.saveNow();
  }

  resetUpgrades(): void {
    for (const stat of Object.keys(this.upgrades) as VehicleStatKey[]) this.upgrades[stat] = 0;
    this.saveNow();
  }

  updateAutosave(deltaTime: number): void {
    if (!this.dirty) return;
    this.autosaveElapsed += deltaTime;
    if (this.autosaveElapsed >= GAME_CONFIG.progression.autosaveSeconds) this.saveNow();
  }

  saveNow(): void {
    if (this.persistenceDisabled) return;
    this.store.save(this.toProgression());
    this.dirty = false;
    this.autosaveElapsed = 0;
  }

  clearSave(): void {
    this.persistenceDisabled = true;
    this.dirty = false;
    this.store.clear();
    if (typeof window !== "undefined") window.removeEventListener("pagehide", this.onPageHide);
  }

  dispose(): void {
    this.saveNow();
    if (typeof window !== "undefined") window.removeEventListener("pagehide", this.onPageHide);
  }

  private toProgression(): PlayerProgression {
    return {
      version: GAME_CONFIG.progression.saveVersion,
      trainingProgress: sanitizeTrainingProgress(this.trainingProgress),
      jailFreeCards: this.jailFreeCardsValue,
      vehicleCoupons: this.vehicleCouponsValue,
      freeUpgradeCredits: this.freeUpgradeCreditsValue,
      money: Math.max(0, this.moneyValue - this.temporaryDebugMoneyValue),
      completedRides: this.completedRidesValue,
      ownedVehicleIds: [...this.ownedVehicleIdsValue],
      equippedVehicleId: this.equippedVehicleIdValue,
      upgrades: { ...this.upgrades },
      ownedMissionLicenseIds: [...this.ownedMissionLicenseIdsValue],
      rideHistory: this.rideHistoryValue.map((entry) => ({ ...entry })),
      racingLicenseOwned: this.racingLicenseOwnedValue,
      bestRaceFinishes: { ...this.bestRaceFinishesValue },
    };
  }

  private deductMoney(amount: number): void {
    this.moneyValue -= amount;
    this.temporaryDebugMoneyValue = Math.max(0, this.temporaryDebugMoneyValue - amount);
    this.dirty = true;
  }
}

export function defaultProgression(): PlayerProgression {
  return {
    version: GAME_CONFIG.progression.saveVersion,
    trainingProgress: {},
    jailFreeCards: 0,
    vehicleCoupons: 0,
    freeUpgradeCredits: 0,
    money: GAME_CONFIG.progression.startingMoney,
    completedRides: 0,
    ownedVehicleIds: ["starter"],
    equippedVehicleId: "starter",
    upgrades: { acceleration: 0, topSpeed: 0, turning: 0, braking: 0 },
    ownedMissionLicenseIds: ["taxi"],
    rideHistory: [],
    racingLicenseOwned: false,
    bestRaceFinishes: {},
  };
}

function sanitizeProgression(value: unknown): PlayerProgression {
  const defaults = defaultProgression();
  if (!value || typeof value !== "object") return defaults;
  const source = value as Partial<PlayerProgression>;
  if (![1, 2, 3, 4, 5, 6, 7, 8, GAME_CONFIG.progression.saveVersion].includes(source.version ?? -1)) return defaults;
  const knownIds = new Set(VEHICLE_CATALOG.map((vehicle) => vehicle.id));
  const owned = Array.isArray(source.ownedVehicleIds)
    ? [...new Set(source.ownedVehicleIds.filter((id): id is string => typeof id === "string" && knownIds.has(id)))]
    : [];
  if (!owned.includes("starter")) owned.unshift("starter");
  const equipped = typeof source.equippedVehicleId === "string" && owned.includes(source.equippedVehicleId)
    ? source.equippedVehicleId
    : "starter";
  const upgrades = source.upgrades && typeof source.upgrades === "object" ? source.upgrades : defaults.upgrades;
  const knownLicenseIds = new Set<MissionLicenseId>(MISSION_LICENSES.map((license) => license.id));
  const migratedLicenseIds = Array.isArray(source.ownedMissionLicenseIds)
    ? (source.ownedMissionLicenseIds as unknown[]).map(migrateMissionLicenseId)
    : [];
  const ownedMissionLicenseIds = Array.isArray(migratedLicenseIds)
    ? [...new Set(migratedLicenseIds.filter(
      (id): id is MissionLicenseId => typeof id === "string" && knownLicenseIds.has(id as MissionLicenseId),
    ))]
    : [];
  if (!ownedMissionLicenseIds.includes("taxi")) ownedMissionLicenseIds.unshift("taxi");
  const bestRaceFinishes = sanitizeRaceFinishes(source.bestRaceFinishes);
  return {
    version: GAME_CONFIG.progression.saveVersion,
    trainingProgress: sanitizeTrainingProgress(source.trainingProgress),
    jailFreeCards: Math.floor(finiteNonnegative(source.jailFreeCards, 0)),
    vehicleCoupons: Math.floor(finiteNonnegative(source.vehicleCoupons, 0)),
    freeUpgradeCredits: Math.floor(finiteNonnegative(source.freeUpgradeCredits, 0)),
    money: finiteNonnegative(source.money, defaults.money),
    completedRides: Math.floor(finiteNonnegative(source.completedRides, 0)),
    ownedVehicleIds: owned,
    equippedVehicleId: equipped,
    upgrades: {
      acceleration: clampLevel(upgrades.acceleration),
      topSpeed: clampLevel(upgrades.topSpeed),
      turning: clampLevel(upgrades.turning),
      braking: clampLevel(upgrades.braking),
    },
    ownedMissionLicenseIds,
    rideHistory: sanitizeRideHistory(source.rideHistory),
    racingLicenseOwned: source.racingLicenseOwned === true,
    bestRaceFinishes,
  };
}

function sanitizeRideHistory(value: unknown): RideHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const passengerTypes = new Set<string>(Object.values(PassengerType));
  const rideTiers = new Set<RideTier>(["SHORT", "MEDIUM", "LONG"]);
  const entries: RideHistoryEntry[] = [];
  for (const candidate of value.slice(0, GAME_CONFIG.progression.rideHistoryLimit)) {
    if (!candidate || typeof candidate !== "object") continue;
    const entry = candidate as Partial<RideHistoryEntry>;
    if (
      typeof entry.id !== "string"
      || typeof entry.passengerName !== "string"
      || typeof entry.passengerType !== "string"
      || !passengerTypes.has(entry.passengerType)
      || typeof entry.rideTier !== "string"
      || !rideTiers.has(entry.rideTier as RideTier)
      || typeof entry.completedAt !== "number"
      || !Number.isFinite(entry.completedAt)
      || entry.completedAt < 0
    ) continue;
    entries.push({
      id: entry.id,
      completedAt: finiteNonnegative(entry.completedAt, 0),
      passengerName: entry.passengerName,
      passengerType: entry.passengerType as PassengerType,
      missionCategoryId: getMissionLicense(String(migrateMissionLicenseId(
        (entry as { missionCategoryId?: unknown }).missionCategoryId,
      )))?.id ?? "taxi",
      rideTier: entry.rideTier as RideTier,
      pickupDistance: finiteNonnegative(entry.pickupDistance, 0),
      tripDistance: finiteNonnegative(entry.tripDistance, 0),
      durationSeconds: finiteNonnegative(entry.durationSeconds, 0),
      collisionCount: Math.floor(finiteNonnegative(entry.collisionCount, 0)),
      stars: Math.floor(clampNumber(entry.stars, 0, 5)),
      baseFare: finiteNonnegative(entry.baseFare, 0),
      tip: finiteNonnegative(entry.tip, 0),
      bonusTip: finiteNonnegative(entry.bonusTip, 0),
      traitTipDeduction: finiteNonnegative(entry.traitTipDeduction, 0),
      fareWaived: entry.fareWaived === true,
      cardsEarned: Math.floor(finiteNonnegative(entry.cardsEarned, 0)),
      couponsEarned: Math.floor(finiteNonnegative(entry.couponsEarned, 0)),
      freeUpgradeCreditsEarned: Math.floor(finiteNonnegative(entry.freeUpgradeCreditsEarned, 0)),
      timeTipPercentRemaining: clampNumber(entry.timeTipPercentRemaining, 0, 100),
      violationPoints: finiteNonnegative(entry.violationPoints, 0),
      violationTipPenaltyPercent: clampNumber(entry.violationTipPenaltyPercent, 0, 100),
      total: finiteNonnegative(entry.total, 0),
    });
  }
  return entries;
}

function migrateMissionLicenseId(id: unknown): unknown {
  if (id === "package_delivery") return "ambulance_driver";
  if (id === "rideshare" || id === "rideshare_silver") return "taxi";
  return id;
}

function isRaceRegionId(regionId: string): boolean {
  return /^block-\d+-\d+$/.test(regionId);
}

function isRaceFinish(finish: unknown): finish is number {
  return typeof finish === "number"
    && Number.isFinite(finish)
    && Number.isInteger(finish)
    && finish >= 1
    && finish <= GAME_CONFIG.racing.aiCount + 1;
}

function raceMultiplierForFinish(finish: number): number {
  const multiplier = GAME_CONFIG.racing.finishMultipliers[finish - 1];
  return typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier >= 0
    ? multiplier
    : 1;
}

function sanitizeRaceFinishes(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [regionId, finish] of Object.entries(value)) {
    if (isRaceRegionId(regionId) && isRaceFinish(finish)) result[regionId] = finish;
  }
  return result;
}

function isVehicleStatKey(value: unknown): value is VehicleStatKey {
  return value === "acceleration"
    || value === "topSpeed"
    || value === "turning"
    || value === "braking";
}

function finiteNonnegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clampLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(GAME_CONFIG.progression.maxUpgradeLevel, Math.floor(value)));
}

function clampNumber(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}
