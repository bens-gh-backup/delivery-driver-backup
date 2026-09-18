import { describe, expect, it } from "vitest";
import { FrameHeadroom, formatHeadroom } from "./FrameHeadroom";

function sample(timing: FrameHeadroom, cpu: number, gpu: number | null, start = 0, count = 60) {
  for (let i = 0; i < count; i++) {
    const now = start + i * 16;
    timing.addCpu(cpu, now);
    if (gpu !== null) timing.addGpu(gpu, now);
  }
  return start + (count - 1) * 16;
}

describe("measured frame headroom", () => {
  it("uses the heavier of CPU and GPU work, without adding overlapping work", () => {
    const timing = new FrameHeadroom();
    const now = sample(timing, 4, 10);
    expect(timing.summarize(now)).toMatchObject({ cpuP95Ms: 4, gpuP95Ms: 10, remainingPercent: 40 });
    expect(timing.summarize(now).remainingMs).toBeCloseTo(6.6667);
  });

  it("does not claim overall headroom when GPU timing is absent or invalid", () => {
    const timing = new FrameHeadroom();
    const now = sample(timing, 3, null);
    [0, -1, NaN, Infinity].forEach(value => timing.addGpu(value, now));
    const result = timing.summarize(now);
    expect(result).toMatchObject({ cpuP95Ms: 3, gpuP95Ms: null, remainingMs: null });
    expect(formatHeadroom(result, false).join("\n")).toContain("CPU-only 60 FPS headroom");
    expect(formatHeadroom(result, false).join("\n")).toContain("overall headroom unknown");
  });

  it("waits for enough samples and withdraws stale GPU estimates", () => {
    const timing = new FrameHeadroom();
    const early = sample(timing, 2, 4, 0, 29);
    expect(timing.summarize(early).remainingMs).toBeNull();
    const now = sample(timing, 2, 4, 500);
    expect(timing.summarize(now).remainingMs).not.toBeNull();
    timing.addCpu(2, now + 1100);
    expect(timing.summarize(now + 1100)).toMatchObject({ cpuP95Ms: 2, gpuP95Ms: null, remainingMs: null });
  });

  it("uses slower p95 work, reports overload, and expires old workloads", () => {
    const timing = new FrameHeadroom();
    sample(timing, 2, 4, 0, 90);
    const now = sample(timing, 22, 4, 1500, 10);
    expect(timing.summarize(now).cpuP95Ms).toBe(22);
    expect(timing.summarize(now).remainingMs).toBeLessThan(0);
    expect(formatHeadroom(timing.summarize(now), true)[0]).toContain("over budget by 5.3 ms");
    const later = sample(timing, 2, 4, 7000);
    expect(timing.summarize(later).cpuP95Ms).toBe(2);
  });

  it("resets both sets of timings after a scene or visibility change", () => {
    const timing = new FrameHeadroom();
    const now = sample(timing, 2, 4);
    timing.clear();
    expect(timing.summarize(now)).toMatchObject({ cpuP95Ms: null, gpuP95Ms: null, remainingMs: null });
    expect(timing.summarize(sample(timing, 6, 3, 1000)).cpuP95Ms).toBe(6);
  });

  it("remains bounded and replaces old samples when collection wraps", () => {
    const timing = new FrameHeadroom();
    for (let i = 0; i < 1200; i++) { timing.addCpu(30, 0); timing.addGpu(30, 0); }
    for (let i = 0; i < 1200; i++) { timing.addCpu(3, 1); timing.addGpu(4, 1); }
    expect(timing.summarize(1)).toMatchObject({ cpuP95Ms: 3, gpuP95Ms: 4 });
  });
});
