export interface OrientedBox2D {
  x: number;
  z: number;
  heading: number;
  halfWidth: number;
  halfLength: number;
}

export interface OrientedBoxCollision {
  normalX: number;
  normalZ: number;
  depth: number;
}

export function findOrientedBoxCollision(
  moving: OrientedBox2D,
  obstacle: OrientedBox2D,
): OrientedBoxCollision | null {
  const movingSin = Math.sin(moving.heading);
  const movingCos = Math.cos(moving.heading);
  const obstacleSin = Math.sin(obstacle.heading);
  const obstacleCos = Math.cos(obstacle.heading);
  const dx = moving.x - obstacle.x;
  const dz = moving.z - obstacle.z;
  let minimumDepth = Number.POSITIVE_INFINITY;
  let normalX = 0;
  let normalZ = 0;

  const testAxis = (axisX: number, axisZ: number): boolean => {
    const movingRadius = projectedRadius(
      moving,
      movingCos,
      -movingSin,
      movingSin,
      movingCos,
      axisX,
      axisZ,
    );
    const obstacleRadius = projectedRadius(
      obstacle,
      obstacleCos,
      -obstacleSin,
      obstacleSin,
      obstacleCos,
      axisX,
      axisZ,
    );
    const centerDistance = Math.abs(dx * axisX + dz * axisZ);
    const depth = movingRadius + obstacleRadius - centerDistance;
    if (depth <= 0) return false;
    if (depth < minimumDepth) {
      minimumDepth = depth;
      normalX = axisX;
      normalZ = axisZ;
    }
    return true;
  };

  if (!testAxis(movingCos, -movingSin)) return null;
  if (!testAxis(movingSin, movingCos)) return null;
  if (!testAxis(obstacleCos, -obstacleSin)) return null;
  if (!testAxis(obstacleSin, obstacleCos)) return null;

  if (dx * normalX + dz * normalZ < 0) {
    normalX *= -1;
    normalZ *= -1;
  }
  return { normalX, normalZ, depth: minimumDepth };
}

function projectedRadius(
  box: OrientedBox2D,
  rightX: number,
  rightZ: number,
  forwardX: number,
  forwardZ: number,
  axisX: number,
  axisZ: number,
): number {
  return box.halfWidth * Math.abs(rightX * axisX + rightZ * axisZ)
    + box.halfLength * Math.abs(forwardX * axisX + forwardZ * axisZ);
}
