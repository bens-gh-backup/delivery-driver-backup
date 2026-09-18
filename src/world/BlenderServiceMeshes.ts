import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { GasStation } from "../game/types";
import { GAME_CONFIG } from "../game/config";
import { WORLD_SURFACES } from "./SurfaceLayout";
import services from "./assets/services.json";

type ServicePart = keyof typeof services.parts;
/** Created once, then consumed by Town's existing material/chunk merger. */
function serviceMesh(scene: Scene, name: string, part: ServicePart, material: StandardMaterial,
  x: number, y: number, z: number, heading: number,
  scale: { depth?: number; height?: number; heightOrigin?: number } = {}): Mesh {
  const depthScale = scale.depth ?? 1, heightScale = scale.height ?? 1, heightOrigin = scale.heightOrigin ?? 0;
  const source = services.parts[part];
  const data = new VertexData();
  const positions = new Float32Array(source.positions), normals = new Float32Array(source.normals);
  if (depthScale !== 1 || heightScale !== 1) for (let i = 0; i < positions.length; i += 3) {
    positions[i + 2] *= depthScale;
    positions[i + 1] = heightOrigin + (positions[i + 1] - heightOrigin) * heightScale;
    const nx = normals[i], ny = normals[i + 1] / heightScale, nz = normals[i + 2] / depthScale;
    const length = Math.hypot(nx, ny, nz);
    normals[i] = nx / length; normals[i + 1] = ny / length; normals[i + 2] = nz / length;
  }
  Object.assign(data, { positions, normals, colors: source.colors, indices: source.indices });
  const mesh = new Mesh(name, scene); data.applyToMesh(mesh); mesh.material = material;
  mesh.position.set(x, y, z); mesh.rotation.y = heading;
  mesh.useVertexColors = true; mesh.hasVertexAlpha = false; mesh.isPickable = false;
  mesh.metadata = { serviceModel: part };
  return mesh;
}

export function createBlenderGasStation(scene: Scene, station: GasStation, index: number,
  material: StandardMaterial): Mesh[] {
  const { position, roadSide: side } = station, ns = station.roadAxis === "northSouth";
  const layout = GAME_CONFIG.presentation.gasStation;
  const heading = ns ? side * Math.PI / 2 : side === 1 ? 0 : Math.PI;
  const x = position.x + (ns ? layout.canopySetback * side : 0);
  const z = position.z + (ns ? 0 : layout.canopySetback * side);
  return [
    serviceMesh(scene, `gas-kiosk-${index}`, "gas_kiosk", material, x, WORLD_SURFACES.service, z, heading,
      { depth: (layout.canopyDepth - 2) / 14 }),
    serviceMesh(scene, `gas-canopy-${index}`, "gas_roof", material, x, WORLD_SURFACES.service, z, heading,
      { depth: layout.canopyDepth / 16, height: GAME_CONFIG.presentation.serviceSigns.gasHeight / 4.5, heightOrigin: 7.24 }),
    ...station.pumpPositions.map((p, i) => serviceMesh(scene, `gas-pump-${index}-${i}`, "gas_pump", material,
      p.x, WORLD_SURFACES.service, p.z, heading)),
  ];
}

export function createBlenderRepairShop(scene: Scene, x: number, z: number, inward: number,
  index: number, material: StandardMaterial): Mesh[] {
  const heading = inward === 1 ? 0 : Math.PI;
  return [
    serviceMesh(scene, `repair-shell-${index}`, "repair_shell", material, x, 0, z, heading),
    serviceMesh(scene, `repair-roof-${index}`, "repair_roof", material, x, 0, z, heading),
  ];
}
