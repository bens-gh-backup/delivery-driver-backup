import type { Scene } from "@babylonjs/core/scene";
import { GAME_CONFIG } from "../game/config";

export type GraphicsMode = "original" | "enhanced";

/** Developer comparison only; the selected mode is fixed for a scene's lifetime. */
export function resolveGraphicsMode(search = typeof window === "undefined" ? "" : window.location.search): GraphicsMode {
  const params = new URLSearchParams(search);
  if (params.has("debug") && params.get("graphics") === "original") return "original";
  return GAME_CONFIG.graphics.defaultMode;
}

export function setSceneGraphicsMode(scene: Scene, mode: GraphicsMode): void {
  scene.metadata = { ...scene.metadata, graphicsMode: mode };
}

export function hasEnhancedGraphics(scene: Scene): boolean {
  return (scene.metadata?.graphicsMode ?? GAME_CONFIG.graphics.defaultMode) === "enhanced";
}
