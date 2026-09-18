const TARGET_FRAME_MS = 1000 / 60;
const WINDOW_MS = 5000;
const FRESH_MS = 1000;
const MIN_SAMPLES = 30;
const CAPACITY = 1200;

/** Bounded, allocation-free collection; sort only when the debug panel refreshes. */
class WorkSamples {
  private readonly values = new Float64Array(CAPACITY);
  private readonly timestamps = new Float64Array(CAPACITY);
  private count = 0;
  private cursor = 0;
  private latest = -Infinity;

  add(milliseconds: number, now: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || !Number.isFinite(now)) return;
    this.values[this.cursor] = milliseconds;
    this.timestamps[this.cursor] = now;
    this.cursor = (this.cursor + 1) % CAPACITY;
    this.count = Math.min(CAPACITY, this.count + 1);
    this.latest = now;
  }

  p95(now: number): number | null {
    if (now - this.latest > FRESH_MS) return null;
    const recent: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.timestamps[i] >= now - WINDOW_MS) recent.push(this.values[i]);
    }
    if (recent.length < MIN_SAMPLES) return null;
    recent.sort((a, b) => a - b);
    return recent[Math.ceil(recent.length * 0.95) - 1];
  }

  clear(): void { this.count = 0; this.cursor = 0; this.latest = -Infinity; }
}

/** An estimate of measured work capacity, not a prediction of attainable FPS. */
export class FrameHeadroom {
  private readonly cpu = new WorkSamples();
  private readonly gpu = new WorkSamples();

  addCpu(milliseconds: number, now: number): void { this.cpu.add(milliseconds, now); }
  addGpu(milliseconds: number, now: number): void {
    // Zero/negative GPU results mean no usable timer result, not unlimited capacity.
    if (milliseconds > 0) this.gpu.add(milliseconds, now);
  }
  clear(): void { this.cpu.clear(); this.gpu.clear(); }

  summarize(now: number) {
    const cpuP95Ms = this.cpu.p95(now), gpuP95Ms = this.gpu.p95(now);
    // CPU submission and GPU execution overlap. Adding their timings double-counts work.
    const remainingMs = cpuP95Ms === null || gpuP95Ms === null
      ? null : TARGET_FRAME_MS - Math.max(cpuP95Ms, gpuP95Ms);
    return {
      budgetMs: TARGET_FRAME_MS, cpuP95Ms, gpuP95Ms, remainingMs,
      remainingPercent: remainingMs === null ? null : remainingMs / TARGET_FRAME_MS * 100,
    };
  }
}

export function formatHeadroom(timing: ReturnType<FrameHeadroom["summarize"]>, gpuSupported: boolean): string[] {
  const cpu = timing.cpuP95Ms === null ? "sampling…" : `${timing.cpuP95Ms.toFixed(2)} ms`;
  const gpu = !gpuSupported ? "unavailable" : timing.gpuP95Ms === null ? "waiting for samples…" : `${timing.gpuP95Ms.toFixed(2)} ms`;
  const cpuOnly = timing.remainingMs === null;
  const remaining = cpuOnly
    ? timing.cpuP95Ms === null ? null : timing.budgetMs - timing.cpuP95Ms
    : timing.remainingMs;
  const label = cpuOnly ? "CPU-only 60 FPS headroom" : "Est. 60 FPS headroom";
  const margin = remaining === null ? "sampling…"
    : remaining < 0 ? `over budget by ${(-remaining).toFixed(1)} ms`
    : `~${Math.floor(remaining / timing.budgetMs * 100)}% (${remaining.toFixed(1)} ms)`;
  return [
    `${label}: ${margin}`,
    `CPU work ${cpu} / GPU ${gpu}`,
    `p95 · recent 5s · ${timing.budgetMs.toFixed(2)} ms budget`,
    cpuOnly ? "GPU unknown · overall headroom unknown" : "Estimate excludes browser/compositor work",
  ];
}
