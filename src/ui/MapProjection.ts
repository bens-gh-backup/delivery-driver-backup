export interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MapPoint {
  x: number;
  y: number;
}

export function projectMapPoint(x: number, z: number, bounds: MapBounds): MapPoint {
  return {
    x: ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * 100,
    y: 100 - ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * 100,
  };
}

/** Inverse of projectMapPoint; inputs are percentages within the map's content area. */
export function unprojectMapPoint(x: number, y: number, bounds: MapBounds): { x: number; z: number } {
  return {
    x: bounds.minX + x / 100 * (bounds.maxX - bounds.minX),
    z: bounds.maxZ - y / 100 * (bounds.maxZ - bounds.minZ),
  };
}

export function projectMapWidth(worldWidth: number, bounds: MapBounds): number {
  return worldWidth / (bounds.maxX - bounds.minX) * 100;
}

export function projectMapHeight(worldHeight: number, bounds: MapBounds): number {
  return worldHeight / (bounds.maxZ - bounds.minZ) * 100;
}
