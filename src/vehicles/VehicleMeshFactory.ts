import { hasEnhancedGraphics } from "../graphics/GraphicsMode";
import { createEnhancedVehicleMesh } from "./EnhancedVehicleMesh";
import { TAILLIGHT_COLOR, vehicleLightLayout } from "./VehicleLightLayout";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { GAME_CONFIG } from "../game/config";

export interface LowPolyVehicleOptions {
  bodyLength: number;
  bodyWidth: number;
  bodyHeight: number;
  cabinLength: number;
  cabinWidth: number;
  cabinHeight: number;
  bodyColor: Color3;
  police?: boolean;
  ambulance?: boolean;
}

export function createLowPolyVehicleMesh(
  scene: Scene,
  name: string,
  material: StandardMaterial,
  options: LowPolyVehicleOptions,
): Mesh {
  if (hasEnhancedGraphics(scene)) return createEnhancedVehicleMesh(scene, name, material, options);
  const { bodyLength: length, bodyWidth: width, bodyHeight: height } = options;
  const parts: Mesh[] = [];
  const glass = new Color3(0.055, 0.11, 0.14);
  const darkTrim = new Color3(0.035, 0.04, 0.045);
  const bumper = new Color3(0.14, 0.16, 0.17);

  parts.push(coloredBox(scene, `${name}-lower-body`, {
    width,
    height: height * 0.58,
    depth: length,
  }, options.bodyColor, material, 0, 0, 0));

  parts.push(coloredBox(scene, `${name}-hood`, {
    width: width * 0.91,
    height: height * 0.25,
    depth: length * 0.3,
  }, lighten(options.bodyColor, 0.06), material, 0, height * 0.35, length * 0.335));

  parts.push(coloredBox(scene, `${name}-trunk`, {
    width: width * 0.92,
    height: height * 0.22,
    depth: length * 0.23,
  }, darken(options.bodyColor, 0.05), material, 0, height * 0.32, -length * 0.385));

  if (options.ambulance) {
    parts.push(coloredBox(scene, `${name}-patient-compartment`, {
      width: width * .94, height: options.cabinHeight, depth: length * .6,
    }, new Color3(.89,.93,.93), material, 0, height * .55 + options.cabinHeight / 2, -length * .16));
    for (const side of [-1, 1]) parts.push(coloredBox(scene, `${name}-medical-panel-${side}`, {
      width: .08, height: .55, depth: 2.2,
    }, new Color3(.04,.48,.44), material, side * (width / 2 - .03), height * .92, -.7));
    parts.push(coloredBox(scene,`${name}-rear-cross-vertical`,{width:1,height:2.8,depth:.09},
      new Color3(.04,.48,.44),material,0,height*.55+options.cabinHeight/2,-length*.46-.06));
    parts.push(coloredBox(scene,`${name}-rear-cross-horizontal`,{width:2.8,height:1,depth:.09},
      new Color3(.04,.48,.44),material,0,height*.55+options.cabinHeight/2,-length*.46-.06));
  }

  const cabin = taperedBox(
    scene,
    `${name}-cabin`,
    options.cabinWidth,
    options.cabinHeight,
    options.cabinLength,
    0.78,
    0.7,
  );
  cabin.position.y = height * 0.55;
  cabin.material = material;
  applyVertexColor(cabin, glass);
  parts.push(cabin);

  const wheelRadius = Math.max(0.42, height * 0.34);
  const tireWidth = Math.max(0.42, width * 0.1);
  for (const xSign of [-1, 1]) {
    for (const zSign of [-1, 1]) {
      const wheel = MeshBuilder.CreateCylinder(`${name}-wheel-${xSign}-${zSign}`, {
        diameter: wheelRadius * 2,
        height: tireWidth,
        tessellation: GAME_CONFIG.graphics.originalWheelTessellation,
      }, scene);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(
        xSign * (width / 2 - tireWidth / 2),
        -height * 0.22,
        zSign * length * 0.31,
      );
      wheel.material = material;
      applyVertexColor(wheel, darkTrim);
      parts.push(wheel);
    }
  }

  for (const xSign of [-1, 1]) {
    for (const front of [true, false]) {
      const layout = vehicleLightLayout(width, length, height, xSign, front);
      parts.push(coloredBox(scene, `${name}-${front ? "headlight" : "taillight"}-${xSign}`, layout,
        front ? new Color3(1, 0.94, 0.68) : new Color3(...TAILLIGHT_COLOR),
        material, layout.x, layout.y, layout.z));
    }
  }

  parts.push(coloredBox(scene, `${name}-front-bumper`, {
    width: width * 0.84,
    height: height * 0.13,
    depth: 0.18,
  }, bumper, material, 0, -height * 0.2, length / 2 - 0.09));
  parts.push(coloredBox(scene, `${name}-rear-bumper`, {
    width: width * 0.84,
    height: height * 0.13,
    depth: 0.18,
  }, bumper, material, 0, -height * 0.2, -length / 2 + 0.09));

  if (options.police) {
    for (const xSign of [-1, 1]) {
      parts.push(coloredBox(scene, `${name}-door-panel-${xSign}`, {
        width: 0.08,
        height: height * 0.42,
        depth: length * 0.34,
      }, new Color3(0.88, 0.91, 0.92), material, xSign * (width / 2 - 0.04), 0, 0));
    }
    parts.push(coloredBox(scene, `${name}-lightbar-red`, {
      width: width * 0.22,
      height: 0.28,
      depth: 0.65,
    }, new Color3(0.95, 0.03, 0.03), material, -width * 0.12, height * 0.55 + options.cabinHeight / 2 + 0.14, -0.2));
    parts.push(coloredBox(scene, `${name}-lightbar-blue`, {
      width: width * 0.22,
      height: 0.28,
      depth: 0.65,
    }, new Color3(0.03, 0.22, 1), material, width * 0.12, height * 0.55 + options.cabinHeight / 2 + 0.14, -0.2));
  }

  const shadow = MeshBuilder.CreateCylinder(`${name}-contact-shadow`, {
    diameter: 1,
    height: 0.025,
    tessellation: GAME_CONFIG.graphics.vehicleShadowTessellation,
  }, scene);
  shadow.position.y = -height * 0.22 - wheelRadius - 0.03;
  shadow.scaling.set(width * 0.42, 1, length * 0.44);
  shadow.material = material;
  applyVertexColor(shadow, new Color3(0.025, 0.027, 0.029));
  parts.push(shadow);

  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
  merged.name = name;
  merged.material = material;
  merged.useVertexColors = true;
  merged.isPickable = false;
  return merged;
}

function coloredBox(
  scene: Scene,
  name: string,
  dimensions: { width: number; height: number; depth: number },
  color: Color3,
  material: StandardMaterial,
  x: number,
  y: number,
  z: number,
): Mesh {
  const mesh = MeshBuilder.CreateBox(name, dimensions, scene);
  mesh.position.set(x, y, z);
  mesh.material = material;
  applyVertexColor(mesh, color);
  return mesh;
}

function taperedBox(
  scene: Scene,
  name: string,
  width: number,
  height: number,
  depth: number,
  topWidthScale: number,
  topDepthScale: number,
): Mesh {
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const indices = mesh.getIndices()!;
  for (let index = 0; index < positions.length; index += 3) {
    if (positions[index + 1] <= 0) continue;
    positions[index] *= topWidthScale;
    positions[index + 2] *= topDepthScale;
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  mesh.setVerticesData(VertexBuffer.PositionKind, positions);
  mesh.setVerticesData(VertexBuffer.NormalKind, normals);
  return mesh;
}

function applyVertexColor(mesh: Mesh, color: Color3): void {
  const rgba = new Color4(color.r, color.g, color.b, 1);
  const colors: number[] = [];
  for (let index = 0; index < mesh.getTotalVertices(); index++) {
    colors.push(rgba.r, rgba.g, rgba.b, rgba.a);
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  mesh.useVertexColors = true;
}

function lighten(color: Color3, amount: number): Color3 {
  return new Color3(
    color.r + (1 - color.r) * amount,
    color.g + (1 - color.g) * amount,
    color.b + (1 - color.b) * amount,
  );
}

function darken(color: Color3, amount: number): Color3 {
  return new Color3(color.r * (1 - amount), color.g * (1 - amount), color.b * (1 - amount));
}
