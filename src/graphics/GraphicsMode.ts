import type { Scene } from "@babylonjs/core/scene";
import { GAME_CONFIG } from "../game/config";

export type GraphicsMode = "original" | "enhanced";
export type PlayerCabModel = "procedural" | "blender";
export type ApartmentModel = "procedural" | "pilot" | "all";
export type ServiceModel = "procedural" | "blender";
export type NeighborhoodModel = "procedural" | "blender3k" | "blender6k";

export function resolveWorldRendering(search = typeof window === "undefined" ? "" : window.location.search) {
  const params = new URLSearchParams(search), debug = params.has("debug");
  const chunk = Number(params.get("worldChunks"));
  return {
    houseInstancing: debug && params.get("houseInstances") === "off" ? false : GAME_CONFIG.graphics.houseInstancing,
    houseLod: debug && params.get("houseLod") === "off" ? false : GAME_CONFIG.graphics.houseLodEnabled,
    houseLodDistance: GAME_CONFIG.graphics.houseLodDistance,
    worldChunkBlocks: debug && [0.5, 1, 2].includes(chunk) ? chunk : GAME_CONFIG.graphics.worldChunkBlocks,
  };
}

export function resolveNeighborhoodModel(kind: "houses" | "traffic",
  search = typeof window === "undefined" ? "" : window.location.search): NeighborhoodModel {
  const params = new URLSearchParams(search), model = params.get(kind);
  if (params.has("debug") && (model === "procedural" || model === "blender3k" || model === "blender6k")) return model;
  return kind === "houses" ? GAME_CONFIG.graphics.houseModel : GAME_CONFIG.graphics.trafficModel;
}

export function houseModelForScene(scene: Scene): NeighborhoodModel {
  return hasEnhancedGraphics(scene) ? scene.metadata?.houseModel ?? GAME_CONFIG.graphics.houseModel : "procedural";
}

export function trafficModelForScene(scene: Scene): NeighborhoodModel {
  return hasEnhancedGraphics(scene) ? scene.metadata?.trafficModel ?? GAME_CONFIG.graphics.trafficModel : "procedural";
}

export function worldTriangleBudgetForScene(scene: Scene): number {
  const model = houseModelForScene(scene);
  return model === "procedural" ? GAME_CONFIG.graphics.worldTriangleBudget : GAME_CONFIG.graphics.neighborhoodWorldTriangleBudgets[model];
}

/** Developer comparison only; the selected mode is fixed for a scene's lifetime. */
export function resolveGraphicsMode(search = typeof window === "undefined" ? "" : window.location.search): GraphicsMode {
  const params = new URLSearchParams(search);
  if (params.has("debug") && params.get("graphics") === "original") return "original";
  return GAME_CONFIG.graphics.defaultMode;
}

export function resolvePlayerCabModel(search = typeof window === "undefined" ? "" : window.location.search): PlayerCabModel {
  const params = new URLSearchParams(search);
  const model = params.get("cab");
  if (params.has("debug") && (model === "procedural" || model === "blender")) return model;
  return GAME_CONFIG.graphics.playerCabModel;
}

export function resolveApartmentModel(search = typeof window === "undefined" ? "" : window.location.search): ApartmentModel {
  const params = new URLSearchParams(search), model = params.get("apartments");
  if (params.has("debug") && (model === "procedural" || model === "pilot" || model === "all")) return model;
  return GAME_CONFIG.graphics.apartmentModel;
}

export function apartmentModelForScene(scene: Scene): ApartmentModel {
  return hasEnhancedGraphics(scene) ? scene.metadata?.apartmentModel ?? GAME_CONFIG.graphics.apartmentModel : "procedural";
}

export function resolveServiceModel(search = typeof window === "undefined" ? "" : window.location.search): ServiceModel {
  const params = new URLSearchParams(search), model = params.get("services");
  if (params.has("debug") && (model === "procedural" || model === "blender")) return model;
  return GAME_CONFIG.graphics.serviceModel;
}

export function usesBlenderServices(scene: Scene): boolean {
  return hasEnhancedGraphics(scene) && (scene.metadata?.serviceModel ?? GAME_CONFIG.graphics.serviceModel) === "blender";
}

export function setSceneGraphicsMode(scene: Scene, mode: GraphicsMode, cabModel = resolvePlayerCabModel(),
  apartmentModel = resolveApartmentModel(), serviceModel = resolveServiceModel(),
  houseModel = resolveNeighborhoodModel("houses"), trafficModel = resolveNeighborhoodModel("traffic")): void {
  scene.metadata = { ...scene.metadata, ...resolveWorldRendering(), graphicsMode: mode, playerCabModel: cabModel, apartmentModel, serviceModel, houseModel, trafficModel };
}

export function usesBlenderCab(scene: Scene): boolean {
  return hasEnhancedGraphics(scene) && (scene.metadata?.playerCabModel ?? GAME_CONFIG.graphics.playerCabModel) === "blender";
}

export function hasEnhancedGraphics(scene: Scene): boolean {
  return (scene.metadata?.graphicsMode ?? GAME_CONFIG.graphics.defaultMode) === "enhanced";
}
