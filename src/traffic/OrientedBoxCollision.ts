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
  pointCount: number;
  point1X: number; point1Z: number;
  point2X: number; point2Z: number;
}

export function createBoxContact(): OrientedBoxCollision {
  return { normalX: 0, normalZ: 0, depth: 0, pointCount: 0,
    point1X: 0, point1Z: 0, point2X: 0, point2Z: 0 };
}

export function findOrientedBoxCollision(
  moving: OrientedBox2D,
  obstacle: OrientedBox2D,
  result: OrientedBoxCollision = createBoxContact(),
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
  let referenceIsMoving = true;
  let testingMoving = true;

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
      referenceIsMoving = testingMoving;
    }
    return true;
  };

  if (!testAxis(movingCos, -movingSin)) return null;
  if (!testAxis(movingSin, movingCos)) return null;
  testingMoving = false;
  if (!testAxis(obstacleCos, -obstacleSin)) return null;
  if (!testAxis(obstacleSin, obstacleCos)) return null;

  if (dx * normalX + dz * normalZ < 0) {
    normalX *= -1;
    normalZ *= -1;
  }
  result.normalX = normalX; result.normalZ = normalZ; result.depth = minimumDepth;
  contactPoints(referenceIsMoving ? moving : obstacle, referenceIsMoving ? obstacle : moving,
    referenceIsMoving ? -normalX : normalX, referenceIsMoving ? -normalZ : normalZ, result);
  return result;
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

/** Clip the incident edge to the reference face; the midpoint of penetration is the shared contact. */
function contactPoints(ref: OrientedBox2D, incident: OrientedBox2D, nx: number, nz: number,
  out: OrientedBoxCollision): void {
  const rs = Math.sin(ref.heading), rc = Math.cos(ref.heading);
  const acrossWidth = Math.abs(nx * rc - nz * rs) > 0.5;
  const normalExtent = acrossWidth ? ref.halfWidth : ref.halfLength;
  const tangentExtent = acrossWidth ? ref.halfLength : ref.halfWidth;
  const faceX = ref.x + nx * normalExtent, faceZ = ref.z + nz * normalExtent;
  const tx = -nz, tz = nx;
  const s = Math.sin(incident.heading), c = Math.cos(incident.heading);
  const rightDot = nx * c - nz * s, forwardDot = nx * s + nz * c;
  const side = Math.abs(rightDot) > Math.abs(forwardDot);
  const sign = (side ? rightDot : forwardDot) > 0 ? -1 : 1;
  const inX = incident.x + (side ? c * incident.halfWidth : s * incident.halfLength) * sign;
  const inZ = incident.z + (side ? -s * incident.halfWidth : c * incident.halfLength) * sign;
  const edgeX = side ? s * incident.halfLength : c * incident.halfWidth;
  const edgeZ = side ? c * incident.halfLength : -s * incident.halfWidth;
  const ax = inX - edgeX, az = inZ - edgeZ, dx = 2 * edgeX, dz = 2 * edgeZ;
  const start = (ax - faceX) * tx + (az - faceZ) * tz, span = dx * tx + dz * tz;
  let lo = 0, hi = 1;
  if (Math.abs(span) > 1e-10) {
    const a = (-tangentExtent - start) / span, b = (tangentExtent - start) / span;
    lo = Math.max(0, Math.min(a, b)); hi = Math.min(1, Math.max(a, b));
  }
  out.pointCount = 0;
  for (let index = 0; index < 2; index++) {
    const t = index === 0 ? lo : hi;
    if (hi < lo || (index === 1 && hi - lo < 1e-7)) continue;
    const x = ax + dx * t, z = az + dz * t;
    const separation = (x - faceX) * nx + (z - faceZ) * nz;
    if (separation > 1e-6) continue;
    if (out.pointCount++ === 0) { out.point1X = x - nx * separation * .5; out.point1Z = z - nz * separation * .5; }
    else { out.point2X = x - nx * separation * .5; out.point2Z = z - nz * separation * .5; }
  }
  // Degenerate, deeply overlapping spawn: bounded separation still needs a stable contact.
  if (!out.pointCount) {
    out.pointCount = 1; out.point1X = (ref.x + incident.x) * .5; out.point1Z = (ref.z + incident.z) * .5;
  }
}
