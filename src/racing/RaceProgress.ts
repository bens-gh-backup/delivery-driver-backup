import type { RacePoint } from "./RaceCourse";

export interface RacerProgress {
  id: number;
  checkpointIndex: number;
  finishTime: number | null;
  position: RacePoint;
}

/** First entry into a checkpoint disc, expressed as a fraction of this movement. */
export function checkpointCrossing(from: RacePoint, to: RacePoint, target: RacePoint, radius: number): number | null {
  const dx = to.x - from.x, dz = to.z - from.z;
  const ox = from.x - target.x, oz = from.z - target.z;
  const c = ox * ox + oz * oz - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz;
  if (a <= 1e-12) return null;
  const b = 2 * (ox * dx + oz * dz), discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

export function advanceRaceProgress(progress: RacerProgress, from: RacePoint, to: RacePoint,
  checkpoints: readonly RacePoint[], radius: number, elapsed: number, dt: number): void {
  progress.position.x = to.x; progress.position.z = to.z;
  if (progress.finishTime !== null) return;
  let previousCrossing = 0;
  while (progress.checkpointIndex < checkpoints.length) {
    const crossing = checkpointCrossing(from, to, checkpoints[progress.checkpointIndex], radius);
    if (crossing === null || crossing < previousCrossing) break;
    previousCrossing = crossing;
    progress.checkpointIndex++;
    if (progress.checkpointIndex === checkpoints.length) progress.finishTime = elapsed + dt * crossing;
  }
}

export function rankRacers(racers: readonly RacerProgress[], checkpoints: readonly RacePoint[]): RacerProgress[] {
  return [...racers].sort((a, b) => {
    if (a.finishTime !== null || b.finishTime !== null) {
      if (a.finishTime === null) return 1;
      if (b.finishTime === null) return -1;
      return a.finishTime - b.finishTime || a.id - b.id;
    }
    if (a.checkpointIndex !== b.checkpointIndex) return b.checkpointIndex - a.checkpointIndex;
    const target = checkpoints[a.checkpointIndex];
    return target ? Math.hypot(a.position.x - target.x, a.position.z - target.z)
      - Math.hypot(b.position.x - target.x, b.position.z - target.z) || a.id - b.id : a.id - b.id;
  });
}
