export const TAILLIGHT_COLOR = [0.8, 0.035, 0.025] as const;

/** Geometry shared by the built-in lamps and blinking NPC overlays. */
export function vehicleLightLayout(width: number, length: number, height: number, side: number, front: boolean) {
  return {
    width: width * 0.22,
    height: height * (front ? 0.15 : 0.14),
    depth: 0.08,
    x: side * width * 0.28,
    y: height * 0.08,
    z: (front ? 1 : -1) * (length / 2 - 0.04),
  };
}
