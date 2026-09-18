import { beforeAll, afterAll } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { PlayerProfile, defaultProgression } from "../player/PlayerProfile";
import { ProgressionStore } from "../progression/ProgressionStore";
import { VEHICLE_CATALOG } from "../vehicles/VehicleCatalog";
import type { PlayerProgression } from "../vehicles/VehicleTypes";
import { GameUI } from "./GameUI";

// Exercise the real shop renderer and profile transactions without a WebGL/DOM constructor.
function fixture(overrides: Partial<PlayerProgression> = {}) {
  const store = new ProgressionStore(null);
  vi.spyOn(store, "load").mockReturnValue({ ...defaultProgression(), ...overrides });
  const profile = new PlayerProfile(store);
  profile.configureTrainingRegions([{ id: "block-0-0", label: "Region 1", bx: 0, bz: 0,
    minX: 0, maxX: 360, minZ: 0, maxZ: 360, x: 180, z: 180, pickups: [] }]);
  let html = "", writes = 0;
  const content = {
    get innerHTML() { return html; },
    set innerHTML(value: string) { html = value; writes++; },
  };
  const ui = Object.assign(Object.create(GameUI.prototype), {
    lastVehicleShopHtml: "", lastVehicleShopState: "", shopFeedback: "",
    vehicleShopContent: content, vehicleShopOverlay: { classList: { add: vi.fn(), remove: vi.fn() } },
  });
  const cards = vi.spyOn(ui, "vehicleCard");
  const player = { getSpeedMph: () => speed };
  let speed = 0;
  const render = () => ui.renderVehicleShop(profile, player);
  const carHtml = (id: string) => {
    const name = VEHICLE_CATALOG.find(vehicle => vehicle.id === id)!.name;
    return html.split('<div class="garage-card').find(card => card.includes(`<div class="vehicle-name">${name}</div>`))!;
  };
  return { profile, ui, cards, render, carHtml, setSpeed: (value: number) => { speed = value; },
    html: () => html, writes: () => writes };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("vehicle shop display cache", () => {
  it("does no card generation or DOM writes during unchanged updates, including fractional income", () => {
    const f = fixture();
    f.profile.completeAmbulanceJob(0, { regionId: "block-0-0", categoryId: "ambulance_driver" });
    f.render(); f.cards.mockClear();
    const money = f.profile.money;
    for (let i = 0; i < 360; i++) { f.profile.accrueTrainingIncome(1 / 60); f.render(); }
    expect(f.profile.money).toBeGreaterThan(money);
    expect(f.cards).not.toHaveBeenCalled();
    expect(f.writes()).toBe(1);
  });

  it("updates affordability in both directions, exactly at the quoted price", () => {
    const f = fixture(), id = "used-compact", price = f.profile.getVehiclePurchaseQuote(id)!.price;
    f.profile.money = price - .01; f.render();
    expect(f.carHtml(id)).toContain('disabled>INSUFFICIENT FUNDS');
    f.profile.money = price; f.render();
    expect(f.carHtml(id)).toContain('>BUY</button>');
    expect(f.carHtml(id)).not.toContain('disabled');
    f.profile.money = price - .01; f.render();
    expect(f.carHtml(id)).toContain('disabled>INSUFFICIENT FUNDS');
  });

  it("refreshes when passive income makes a vehicle affordable", () => {
    const f = fixture(), id = "used-compact";
    f.profile.completeAmbulanceJob(0, { regionId: "block-0-0", categoryId: "ambulance_driver" });
    f.profile.money = f.profile.getVehiclePurchaseQuote(id)!.price - .001; f.render();
    f.profile.accrueTrainingIncome(1); f.render();
    expect(f.carHtml(id)).toContain('>BUY</button>');
  });

  it("reflects purchases and equipped state while preserving authoritative insufficient-funds checks", () => {
    const f = fixture({ money: 100000 }); f.render();
    expect(f.profile.purchaseVehicle("used-compact", false)).toBe(true); f.render();
    expect(f.carHtml("used-compact")).toContain('>OWNED</div>');
    expect(f.carHtml("used-compact")).toContain('>EQUIP</button>');
    expect(f.profile.equipVehicle("used-compact")).toBe(true); f.render();
    expect(f.carHtml("used-compact")).toContain('disabled>EQUIPPED');
    expect(f.carHtml("starter")).toContain('>EQUIP</button>');
    f.profile.money = 0;
    expect(f.profile.purchaseVehicle("old-sedan", true)).toBe(false); f.render();
    expect(f.carHtml("old-sedan")).toContain('disabled>INSUFFICIENT FUNDS');
  });

  it("refreshes stop-to-equip only when crossing the stopped threshold", () => {
    const f = fixture({ ownedVehicleIds: ["starter", "used-compact"] }); f.render();
    f.setSpeed(GAME_CONFIG.progression.equipMaxSpeedMph + .1); f.render();
    expect(f.carHtml("used-compact")).toContain('disabled>STOP TO EQUIP');
    f.cards.mockClear(); f.setSpeed(GAME_CONFIG.progression.equipMaxSpeedMph + 10); f.render();
    expect(f.cards).not.toHaveBeenCalled();
    f.setSpeed(GAME_CONFIG.progression.equipMaxSpeedMph); f.render();
    expect(f.carHtml("used-compact")).toContain('>EQUIP</button>');
  });

  it("updates coupon prices, reward counts and upgrades after transactions", () => {
    const f = fixture({ money: 100000, vehicleCoupons: 1, freeUpgradeCredits: 2, jailFreeCards: 3 });
    f.render();
    expect(f.html()).toContain('Vehicle coupons: 1');
    expect(f.carHtml("used-compact")).toContain('coupon discount');
    expect(f.profile.purchaseVehicle("used-compact", true)).toBe(true); f.render();
    expect(f.html()).toContain('Vehicle coupons: 0');
    expect(f.carHtml("old-sedan")).not.toContain('coupon discount');
    expect(f.profile.purchaseUpgrade("turning")).toBe(true); f.render();
    expect(f.carHtml("starter")).toContain('(+1%)');
    expect(f.html()).toContain('Free upgrade credits: 1');
    f.profile.setUpgradeLevel("turning", 0); f.render();
    expect(f.carHtml("starter")).not.toContain('(+1%)');
  });

  it("invalidates on reward/profile changes and on reopening", () => {
    const f = fixture(); f.render();
    const replacement = fixture({ vehicleCoupons: 2, jailFreeCards: 4, freeUpgradeCredits: 5 });
    f.ui.renderVehicleShop(replacement.profile, { getSpeedMph: () => 0 });
    expect(f.html()).toContain('Get Out of Jail Free cards: 4');
    expect(f.html()).toContain('Vehicle coupons: 2');
    expect(f.html()).toContain('Free upgrade credits: 5');
    f.ui.closeVehicleShop(); f.ui.openVehicleShopOverlay(); f.cards.mockClear();
    f.ui.renderVehicleShop(replacement.profile, { getSpeedMph: () => 0 });
    expect(f.cards).toHaveBeenCalledTimes(VEHICLE_CATALOG.length);
  });

  it("shows feedback immediately and clears it after its timeout", () => {
    const f = fixture();
    vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout });
    f.render(); f.ui.showShopFeedback("PURCHASE FAILED"); f.render();
    expect(f.html()).toContain('PURCHASE FAILED');
    f.cards.mockClear(); f.render(); expect(f.cards).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2500); f.render();
    expect(f.html()).not.toContain('PURCHASE FAILED');
    expect(f.cards).toHaveBeenCalledTimes(VEHICLE_CATALOG.length);
  });
});

// These tests exercise the preserved legacy systems with their feature gates enabled.
const savedGameplay = { ...GAME_CONFIG.gameplay };
beforeAll(() => Object.assign(GAME_CONFIG.gameplay, {"regionalTrainingEnabled": true}));
afterAll(() => Object.assign(GAME_CONFIG.gameplay, savedGameplay));
