export interface BuildOptions {
  budgetMs: number;
  onProgress?: (progress: number) => void;
  yieldToBrowser?: () => Promise<void>;
}

// A timer gives both rendering and input a turn, including in background tabs.
export const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Drain the same deterministic construction steps used by synchronous tests. */
export async function buildIncrementally<T>(steps: Generator<number, T, void>, options: BuildOptions): Promise<T> {
  const pause = options.yieldToBrowser ?? yieldToBrowser;
  let started = performance.now();
  try {
    for (;;) {
      const step = steps.next();
      if (step.done) { options.onProgress?.(1); return step.value; }
      if (performance.now() - started >= options.budgetMs) {
        options.onProgress?.(step.value);
        await pause();
        started = performance.now();
      }
    }
  } finally { steps.return(undefined as T); }
}
