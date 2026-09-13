import { FrameTimingWindow } from "./FrameTimingWindow";
import { GAME_CONFIG } from "./config";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import type { Scene } from "@babylonjs/core/scene";
import type { DrivingBehaviorManager } from "../player/DrivingBehaviorManager";

export class PerformanceMonitor {
  private readonly enabled = new URLSearchParams(window.location.search).has("debug");
  private readonly element: HTMLDivElement | null;
  private instrumentation: SceneInstrumentation | null = null;
  private scene: Scene;
  private readonly frameTimings = new FrameTimingWindow(GAME_CONFIG.graphics.performanceSampleCount);
  private startupMilliseconds = 0;
  private updateStartedAt = 0;
  private updateMilliseconds = 0;
  private lastDisplayUpdate = 0;
  private uiStartedAt = 0;
  private uiMilliseconds = 0;
  private lastUpdateMilliseconds = 0;
  private updatePeak = 0;
  private uiPeak = 0;
  private previousCpu = { update:0, ui:0, render:0 };
  private renderStartedAt = 0;
  private renderMilliseconds = 0;
  private skipNextInterval = true;
  private lastStall: { interval:number; update:number; ui:number; render:number } | null = null;
  private readonly onVisibilityChange = () => {
    this.frameTimings.clear();
    this.lastStall=null;
    this.skipNextInterval=true;
  };

  constructor(private readonly engine: Engine, scene: Scene, uiRoot: HTMLElement) {
    this.scene = scene;
    if (!this.enabled) {
      this.element = null;
      return;
    }

    this.element = document.createElement("div");
    this.element.className = "performance-monitor";
    uiRoot.append(this.element);
    this.attachScene(scene);
    document.addEventListener("visibilitychange",this.onVisibilityChange);
  }

  attachScene(scene: Scene): void {
    this.scene = scene;
    this.instrumentation?.dispose();
    this.frameTimings.clear();
    this.lastStall=null;
    this.skipNextInterval=true;
    if (!this.enabled) {
      return;
    }
    this.instrumentation = new SceneInstrumentation(scene);
    this.instrumentation.captureFrameTime = true;
    this.instrumentation.captureRenderTime = true;
    this.instrumentation.captureActiveMeshesEvaluationTime = true;
  }

  setStartupMilliseconds(value: number): void { this.startupMilliseconds = value; }

  beginUpdate(): void {
    if (this.enabled) {
      this.updateStartedAt = performance.now();
      this.uiMilliseconds=0;
    }
  }

  endUpdate(): void {
    if (this.enabled) {
      const elapsed = performance.now() - this.updateStartedAt;
      this.lastUpdateMilliseconds=elapsed;
      this.updatePeak=Math.max(this.updatePeak,elapsed);
      this.updateMilliseconds += (elapsed - this.updateMilliseconds) * 0.1;
    }
  }

  beginUiUpdate(): void { if(this.enabled) this.uiStartedAt=performance.now(); }
  endUiUpdate(): void {
    if(!this.enabled)return;
    this.uiMilliseconds+=performance.now()-this.uiStartedAt;
    this.uiPeak=Math.max(this.uiPeak,this.uiMilliseconds);
  }
  beginRender(): void { if(this.enabled) this.renderStartedAt=performance.now(); }
  endRender(): void { if(this.enabled) this.renderMilliseconds=performance.now()-this.renderStartedAt; }

  /** Debug-only, bounded report. UI time is a subset of update time, not additional work. */
  getDiagnostics() {
    return {enabled:this.enabled,frame:this.frameTimings.summarize(),lastStall:this.lastStall,
      updatePeakMs:this.updatePeak,uiPeakMs:this.uiPeak,graphicsMode:this.scene.metadata?.graphicsMode};
  }

  afterRender(activeAiCount: number, collisionCandidates: number, drivingBehavior: DrivingBehaviorManager | null): void {
    if (!this.element || !this.instrumentation) {
      return;
    }
    const interval=this.engine.getDeltaTime();
    if(!document.hidden&&!this.skipNextInterval) {
      this.frameTimings.add(interval);
      // RAF interval follows the preceding frame's CPU work and browser presentation.
      if(interval>50) this.lastStall={interval,...this.previousCpu};
    }
    this.skipNextInterval=document.hidden;
    this.previousCpu.update=this.lastUpdateMilliseconds;
    this.previousCpu.ui=this.uiMilliseconds;
    this.previousCpu.render=this.renderMilliseconds;
    const now = performance.now();
    if (now - this.lastDisplayUpdate < 500) {
      return;
    }
    this.lastDisplayUpdate = now;
    const activeMeshes = this.scene.getActiveMeshes();
    let visibleVertices = 0;
    let visibleTriangles = 0;
    for (let index = 0; index < activeMeshes.length; index++) {
      const mesh = activeMeshes.data[index];
      visibleVertices += mesh.getTotalVertices();
      visibleTriangles += Math.floor(mesh.getTotalIndices() / 3);
    }
    const timing = this.frameTimings.summarize();
    const lines = [
      `${this.engine.getFps().toFixed(0)} FPS · ${this.scene.metadata?.graphicsMode ?? GAME_CONFIG.graphics.defaultMode}`,
      `${timing.median.toFixed(2)} ms median / ${timing.p95.toFixed(2)} ms p95 (${timing.samples} frames)`,
      `${timing.p99.toFixed(2)} ms p99 / ${timing.max.toFixed(2)} ms worst`,
      `${timing.over33ms} frames >33ms / ${timing.over50ms} >50ms`,
      `${this.startupMilliseconds.toFixed(0)} ms startup`,
      `${this.updateMilliseconds.toFixed(2)} ms update / ${this.updatePeak.toFixed(2)} ms peak (0.5s)`,
      `${this.uiPeak.toFixed(2)} ms HUD peak (included in update)`,
      `${this.instrumentation.renderTimeCounter.lastSecAverage.toFixed(2)} ms CPU render (not GPU)`,
      `${this.instrumentation.drawCallsCounter.current} draw calls`,
      `${this.scene.getActiveMeshes().length}/${this.scene.meshes.length} meshes`,
      `${formatCount(visibleTriangles)} triangles / ${formatCount(visibleVertices)} vertices`,
      `${activeAiCount} active AI`,
      `${collisionCandidates} collision candidates`,
    ];
    if(this.lastStall) lines.push(
      `Last hitch: ${this.lastStall.interval.toFixed(1)} ms interval`,
      `Prior CPU: update ${this.lastStall.update.toFixed(1)} (HUD ${this.lastStall.ui.toFixed(1)}) / render ${this.lastStall.render.toFixed(1)} ms`,
    );
    this.updatePeak=0;this.uiPeak=0;
    if (drivingBehavior) {
      const current = drivingBehavior.current;
      const totals = drivingBehavior.totals;
      lines.push(
        `violations speed ${current.speeding.toFixed(2)} wrong ${current.wrongSide.toFixed(2)} sidewalk ${current.sidewalk.toFixed(2)}`,
        `illegal points ${totals.total.toFixed(1)} (speed ${totals.speeding.toFixed(1)} wrong ${totals.wrongSide.toFixed(1)} sidewalk ${totals.sidewalk.toFixed(1)})`,
      );
    }
    this.element.textContent = lines.join("\n");
  }

  dispose(): void {
    this.instrumentation?.dispose();
    this.element?.remove();
    document.removeEventListener("visibilitychange",this.onVisibilityChange);
  }
}

function formatCount(value: number): string {
  if (value < 1000) return `${value}`;
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}m`;
}
