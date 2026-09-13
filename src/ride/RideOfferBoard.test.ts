import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { PlayerCar } from "../player/PlayerCar";
import { TownGenerator } from "../world/Town";
import { RideOfferBoard } from "./RideOfferBoard";

describe("RideOfferBoard", () => {
  it("keeps regional Taxi pools isolated when one pool rotates or accepts an offer", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const town = new TownGenerator(scene).generate();
    const player = new PlayerCar(scene, town.roadSpawnPoints);
    const regions = [{ id:"a",label:"A",bx:0,bz:0,minX:-1e4,maxX:0,minZ:-1e4,maxZ:1e4,x:-100,z:0,pickups:town.deliveryPoints.slice(0,4) },
      { id:"b",label:"B",bx:1,bz:0,minX:0,maxX:1e4,minZ:-1e4,maxZ:1e4,x:100,z:0,pickups:town.deliveryPoints.slice(4,8) }];
    const board = new RideOfferBoard(town.deliveryPoints, player, regions);
    const first = board.ensurePool("taxi", "a")!;
    const second = board.ensurePool("taxi", "b")!;
    const secondIds = second.offers.map((offer) => offer.id);

    first.update(GAME_CONFIG.ride.offerLifetimeSeconds, true);
    expect(second.offers.map((offer) => offer.id)).toEqual(secondIds);

    const accepted = board.acceptOffer("taxi", first.offers[0].id, "a");
    expect(accepted?.missionCategoryId).toBe("taxi");
    expect(first.offers).toHaveLength(0);
    expect(second.offers).toHaveLength(3);
    scene.dispose();
    engine.dispose();
  });
});
