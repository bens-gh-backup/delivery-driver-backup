import { GAME_CONFIG } from "../game/config";
import type { RaceCourse, RacePoint } from "./RaceCourse";

export interface RaceGrid { player: RacePoint; opponents: RacePoint[] }

/** The fourth-place slot stays empty until the player joins. */
export function createRaceGrid(course: RaceCourse, playerLength: number): RaceGrid {
  const fx = Math.sin(course.heading), fz = Math.cos(course.heading);
  const position = (index: number): RacePoint => {
    const backward = (Math.floor(index / 2) + 1)
      * Math.max(GAME_CONFIG.racing.grid.longitudinalSpacing, playerLength + 2);
    const lateral = (index % 2 === 0 ? -1 : 1) * GAME_CONFIG.racing.grid.lateralSpacing / 2;
    return {x: course.start.x - fx * backward + fz * lateral,
      z: course.start.z - fz * backward - fx * lateral};
  };
  return {player: position(3), opponents: Array.from({length: GAME_CONFIG.racing.aiCount},
    (_,i) => position(i < 3 ? i : i + 1))};
}
