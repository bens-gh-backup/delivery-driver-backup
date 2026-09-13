import type { BoxCollider, CircleCollider } from "../game/types";

export function resolveCircleBox(circle: CircleCollider, box: BoxCollider): { x: number; z: number; depth: number } | null {
  return resolveCircleBoxValues(circle.x, circle.z, circle.radius, box);
}

export function resolveCircleBoxValues(circleX: number, circleZ: number, radius: number, box: BoxCollider): { x: number; z: number; depth: number } | null {
  const closestX = Math.max(box.x - box.halfX, Math.min(circleX, box.x + box.halfX));
  const closestZ = Math.max(box.z - box.halfZ, Math.min(circleZ, box.z + box.halfZ));
  let dx = circleX - closestX;
  let dz = circleZ - closestZ;
  let distance = Math.hypot(dx, dz);

  if (distance >= radius) {
    return null;
  }

  if (distance < 0.0001) {
    const overlapX = box.halfX - Math.abs(circleX - box.x);
    const overlapZ = box.halfZ - Math.abs(circleZ - box.z);
    if (overlapX < overlapZ) {
      dx = circleX >= box.x ? 1 : -1;
      dz = 0;
      distance = 1;
      return { x: dx, z: dz, depth: radius + overlapX };
    }
    dx = 0;
    dz = circleZ >= box.z ? 1 : -1;
    distance = 1;
    return { x: dx, z: dz, depth: radius + overlapZ };
  }

  return { x: dx / distance, z: dz / distance, depth: radius - distance };
}
