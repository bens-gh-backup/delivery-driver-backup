export interface FrameTimingSummary { samples: number; median: number; p95: number; p99: number; max: number; over33ms: number; over50ms: number }

export class FrameTimingWindow {
  private readonly values: number[] = [];
  private cursor = 0;
  constructor(private readonly capacity: number) {}

  add(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0 || this.capacity < 1) return;
    if (this.values.length < this.capacity) this.values.push(milliseconds);
    else this.values[this.cursor] = milliseconds;
    this.cursor = (this.cursor + 1) % this.capacity;
  }

  clear(): void { this.values.length = 0; this.cursor = 0; }

  summarize(): FrameTimingSummary {
    if (!this.values.length) return { samples: 0, median: 0, p95: 0, p99: 0, max: 0, over33ms: 0, over50ms: 0 };
    const sorted = [...this.values].sort((a,b) => a-b), n=sorted.length;
    let over33ms=0,over50ms=0;
    for(const value of sorted) { if(value>1000/30)over33ms++;if(value>50)over50ms++; }
    return { samples:n, median:n%2 ? sorted[(n-1)/2] : (sorted[n/2-1]+sorted[n/2])/2,
      p95:sorted[Math.ceil(n*0.95)-1], p99:sorted[Math.ceil(n*0.99)-1], max:sorted[n-1],
      over33ms, over50ms };
  }
}
