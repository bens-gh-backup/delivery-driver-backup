export type CityDistrict = "downtown" | "residential" | "park";
export interface DistrictBlock { bx: number; bz: number; district: CityDistrict }

/** Shared by world generation, mission eligibility and regional races. */
export function districtForBlock(bx: number, bz: number, blocksX: number, blocksZ: number): CityDistrict {
  const cx = Math.floor(blocksX / 2), cz = Math.floor(blocksZ / 2);
  if (Math.abs(bx - cx) <= 1 && Math.abs(bz - cz) <= 1) return "downtown";
  if (bx > cx + 1 && bx <= cx + 3 && bz >= cz - 1 && bz <= cz) return "park";
  return "residential";
}

/** Park land and positions outside the block grid cannot host services or jobs. */
export function isDevelopedBlock(bx: number, bz: number, blocksX: number, blocksZ: number): boolean {
  return bx >= 0 && bx < blocksX && bz >= 0 && bz < blocksZ
    && districtForBlock(bx, bz, blocksX, blocksZ) !== "park";
}
