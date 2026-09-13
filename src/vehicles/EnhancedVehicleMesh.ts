import { Color3 } from "@babylonjs/core/Maths/math.color";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { GAME_CONFIG } from "../game/config";
import { beveledRing, createFacetedMesh, createLoftMesh, type Point3 } from "../graphics/FacetedMesh";
import type { LowPolyVehicleOptions } from "./VehicleMeshFactory";
import { TAILLIGHT_COLOR, vehicleLightLayout } from "./VehicleLightLayout";

export function createEnhancedVehicleMesh(scene: Scene, name: string, material: StandardMaterial, o: LowPolyVehicleOptions): Mesh {
  const { bodyLength: l, bodyWidth: w, bodyHeight: h, cabinHeight: ch, cabinLength: cl, cabinWidth: cw } = o;
  const parts: Mesh[] = [];
  const paint = o.bodyColor, trim = new Color3(0.055, 0.065, 0.073), glass = new Color3(0.16, 0.28, 0.34);
  const bevel = GAME_CONFIG.graphics.vehicleBodyBevel;
  function add(mesh: Mesh, color: Color3): Mesh {
    const colors = Array.from({ length: mesh.getTotalVertices() }, () => [color.r, color.g, color.b, 1]).flat();
    mesh.setVerticesData(VertexBuffer.ColorKind, colors);
    mesh.useVertexColors = true; mesh.material = material; parts.push(mesh); return mesh;
  }
  function box(label: string, width: number, height: number, depth: number, x: number, y: number, z: number, color: Color3): Mesh {
    const mesh = add(MeshBuilder.CreateBox(`${name}-${label}`, { width, height, depth }, scene), color);
    mesh.position.set(x, y, z); return mesh;
  }
  function panel(label: string, corners: Point3[], inside: Point3, color: Color3): void {
    add(createFacetedMesh(scene, `${name}-${label}`, [...corners, inside], [[0, 1, 2, 3]]), color);
  }
  add(createLoftMesh(scene, `${name}-body`, [
    beveledRing(w * 0.94, l * 0.98, -h * 0.29, bevel),
    beveledRing(w, l, h * 0.10, bevel),
    beveledRing(w * 0.94, l * 0.96, h * 0.29, bevel * 1.4),
  ]), paint);
  if (o.ambulance) {
    box("patient-compartment",w*.94,o.cabinHeight,l*.6,0,h*.55+o.cabinHeight/2,-l*.16,new Color3(.89,.93,.93));
    for (const xs of [-1,1]) box("medical-panel",.08,.55,2.2,xs*(w/2-.03),h*.92,-.7,new Color3(.04,.48,.44));
    box("rear-cross-vertical",1,2.8,.09,0,h*.55+o.cabinHeight/2,-l*.46-.06,new Color3(.04,.48,.44));
    box("rear-cross-horizontal",2.8,1,.09,0,h*.55+o.cabinHeight/2,-l*.46-.06,new Color3(.04,.48,.44));
  }
  for (const [label, depth, z, rise] of [
    ["hood", l * 0.30, l * 0.335, h * 0.475],
    ["trunk", l * 0.23, -l * 0.385, h * 0.43],
  ] as const) {
    const mesh = add(createLoftMesh(scene, `${name}-${label}`, [
      beveledRing(w * 0.92, depth, h * 0.23, bevel),
      beveledRing(w * 0.85, depth * 0.9, rise, bevel),
    ]), paint);
    mesh.position.z = z;
  }
  const y0 = h * 0.55 - ch / 2, y1 = h * 0.55 + ch / 2;
  const bottom: Point3[] = [[-cw / 2,y0,-cl / 2],[cw / 2,y0,-cl / 2],[cw / 2,y0,cl / 2],[-cw / 2,y0,cl / 2]];
  const top: Point3[] = bottom.map(([x,,z]) => [x * 0.78, y1, z * 0.70]);
  add(createLoftMesh(scene, `${name}-cabin`, [bottom, top]), paint);
  // Glass is opaque and slightly offset from the painted cabin, leaving real roof pillars without transparency sorting.
  function interpolate(a: Point3, b: Point3, t: number): Point3 { return a.map((v,i) => v + (b[i]-v)*t) as unknown as Point3; }
  const glassSurfaceOffset = 0.045;
  for (let side = 0; side < 4; side++) {
    const next = (side + 1) % 4;
    const sideWindow = side === 1 || side === 3;
    const intervals = sideWindow ? [[0.07,0.47],[0.54,0.93]] : [[0.08,0.92]];
    for (const [u0,u1] of intervals) {
      const low0 = interpolate(bottom[side],bottom[next],u0), low1 = interpolate(bottom[side],bottom[next],u1);
      const high0 = interpolate(top[side],top[next],u0), high1 = interpolate(top[side],top[next],u1);
      const faceOffset: Point3 = side === 0
        ? [0, 0, -glassSurfaceOffset]
        : side === 1
          ? [glassSurfaceOffset, 0, 0]
          : side === 2
            ? [0, 0, glassSurfaceOffset]
            : [-glassSurfaceOffset, 0, 0];
      const corners = [interpolate(low0,high0,0.13),interpolate(low1,high1,0.13),interpolate(low1,high1,0.86),interpolate(low0,high0,0.86)]
        .map(([x,y,z]) => [x + faceOffset[0], y + faceOffset[1], z + faceOffset[2]] as Point3);
      panel("glass", corners, [0,h * 0.55,0], glass);
    }
  }
  add(createLoftMesh(scene, `${name}-roof`, [
    beveledRing(cw * 0.80, cl * 0.72, y1, bevel * 0.5),
    beveledRing(cw * 0.75, cl * 0.66, y1 + 0.06, bevel * 0.5),
  ]), paint);

  const radius = Math.max(0.42, h * 0.34), tireWidth = Math.max(0.42,w * 0.1);
  for (const xs of [-1,1]) for (const zs of [-1,1]) {
    const wheel = add(MeshBuilder.CreateCylinder(`${name}-tire`, {
      diameter: radius * 2, height: tireWidth, tessellation: GAME_CONFIG.graphics.vehicleWheelTessellation,
    },scene), trim);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(xs * (w / 2 - tireWidth / 2), -h * 0.22, zs * l * 0.31);
    const hub = add(MeshBuilder.CreateCylinder(`${name}-hub`, {
      diameter: radius * 1.18,height: 0.025,tessellation: GAME_CONFIG.graphics.vehicleDetailSegments,
    },scene), new Color3(0.44,0.48,0.51));
    hub.rotation.z = Math.PI / 2; hub.position.set(xs * (w / 2 - 0.03),-h * 0.22,zs * l * 0.31);
    // A dark inset and painted lip outline each wheel well using a shallow polygon strip.
    const segments = GAME_CONFIG.graphics.vehicleDetailSegments;
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI, b = (i + 1) / segments * Math.PI;
      const point = (angle: number, r: number): Point3 => [xs * (w / 2 - 0.03), -h * 0.22 + Math.sin(angle) * r, zs * l * 0.31 + Math.cos(angle) * r];
      panel("wheel-arch",[point(a,radius * 1.03),point(b,radius * 1.03),point(b,radius * 1.23),point(a,radius * 1.23)],[0,0,zs*l*0.31],trim);
    }
  }
  for (const xs of [-1,1]) {
    for (const front of [true, false]) {
      const lamp = vehicleLightLayout(w, l, h, xs, front);
      box(front ? "headlight" : "taillight", lamp.width, lamp.height, lamp.depth,
        lamp.x, lamp.y, lamp.z, front ? new Color3(1,0.94,0.72) : new Color3(...TAILLIGHT_COLOR));
    }
  }
  box("grille",w*0.32,h*0.20,0.04,0,h*0.06,l/2-0.06,trim);
  for (const zs of [-1,1]) box("bumper",w*0.84,h*0.13,0.18,0,-h*0.2,zs*(l/2-0.09),trim);
  if (o.police) {
    for (const xs of [-1,1]) box("police-door",0.08,h*0.42,l*0.34,xs*(w/2-0.04),0,0,new Color3(0.88,0.91,0.92));
    box("lightbar-red",w*0.22,0.28,0.65,-w*0.12,y1+0.14,-0.2,new Color3(0.95,0.03,0.03));
    box("lightbar-blue",w*0.22,0.28,0.65,w*0.12,y1+0.14,-0.2,new Color3(0.03,0.22,1));
  }
  const shadow = add(MeshBuilder.CreateCylinder(`${name}-contact-shadow`, {
    diameter:1,height:0.025,tessellation:GAME_CONFIG.graphics.vehicleShadowTessellation,
  },scene),new Color3(0.025,0.027,0.029));
  shadow.position.y = -h*0.22-radius-0.03; shadow.scaling.set(w*0.42,1,l*0.44);
  const merged = Mesh.MergeMeshes(parts,true,true,undefined,false,false)!;
  merged.name = name; merged.material = material; merged.useVertexColors = true; merged.isPickable = false;
  const normals = merged.getVerticesData(VertexBuffer.NormalKind);
  if (normals) {
    for (let i = 0; i < normals.length; i += 3) {
      const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
      normals[i] /= length; normals[i + 1] /= length; normals[i + 2] /= length;
    }
    merged.setVerticesData(VertexBuffer.NormalKind, normals);
  }
  return merged;
}
