import { afterEach, describe, expect, it, vi } from "vitest";
import { Game } from "./Game";

afterEach(() => vi.unstubAllGlobals());

describe("game initialization", () => {
  it("coalesces overlapping loads and allows retry after failure", async () => {
    const game = Object.create(Game.prototype) as any;
    let resolve!: (ready: boolean) => void;
    game.loadSimulation = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
    const a = game.initialize(), b = game.initialize();
    expect(a).toBe(b);
    expect(game.loadSimulation).toHaveBeenCalledTimes(1);
    resolve(false); expect(await a).toBe(false);
    const retry = game.initialize();
    expect(game.loadSimulation).toHaveBeenCalledTimes(2);
    resolve(true); expect(await retry).toBe(true);
  });

  it("cleans a partial scene and exposes retry without enabling play", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
    const game = Object.create(Game.prototype) as any;
    const oldScene = { dispose: vi.fn() }, newScene = { whenReadyAsync: async () => {}, render: vi.fn() };
    Object.assign(game, {
      initialized: false, scene: oldScene, incomeClock: { reset: vi.fn() },
      loadingOverlay: { show: vi.fn(), update: vi.fn(), hide: vi.fn(), fail: vi.fn() },
      buildSimulation: vi.fn().mockRejectedValueOnce(new Error("construction failed")).mockResolvedValue(undefined),
      disposeSimulation: vi.fn(), createScene: vi.fn(() => newScene),
      performanceMonitor: { attachScene: vi.fn(), setStartupMilliseconds: vi.fn() },
      ui: { showStart: vi.fn() },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await game.initialize()).toBe(false);
      expect(game.initialized).toBe(false);
      expect(game.disposeSimulation).toHaveBeenCalledOnce();
      expect(oldScene.dispose).toHaveBeenCalledOnce();
      expect(game.loadingOverlay.fail).toHaveBeenCalledOnce();
      expect(await game.initialize()).toBe(true);
      expect(game.initialized).toBe(true);
      expect(game.ui.showStart).toHaveBeenCalledOnce();
      expect(game.loadingOverlay.hide).toHaveBeenCalledOnce();
    } finally { error.mockRestore(); }
  });

  it("starts only one render loop and does not simulate or accrue income while loading", () => {
    const game = Object.create(Game.prototype) as any;
    let frame!: () => void;
    game.engine = { runRenderLoop: vi.fn((callback: () => void) => { frame = callback; }) };
    game.update = vi.fn();
    game.startRenderLoop(); game.startRenderLoop(); frame();
    expect(game.engine.runRenderLoop).toHaveBeenCalledOnce();
    expect(game.update).not.toHaveBeenCalled();
  });
});
