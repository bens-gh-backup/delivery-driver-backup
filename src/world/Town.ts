import { planBlock } from "./BlockLayout";
import { createFenceMaterial, createFenceMesh } from "./FenceVisuals";
import { gasForecourtBounds, gasForecourtOutline, WORLD_SURFACES } from "./SurfaceLayout";
import { addServiceBillboard, addServiceFascia, serviceSignMaterial } from "./ServiceSigns";
import { createLowPolyVehicleMesh } from "../vehicles/VehicleMeshFactory";
import { getVehicleDefinition } from "../vehicles/VehicleCatalog";
import { hasEnhancedGraphics } from "../graphics/GraphicsMode";
import { addPavementDetails, addStreetSign, entranceApproach, overlapsArea } from "./StreetDetails";
import { createNoirBuilding } from "./BuildingVisuals";
import { CITY_STYLE, CityGeometry, districtForBlock, visualSeed, type CityDistrict, type DistrictBlock, type BuildingLot, type BuildingFrontage } from "./CityStyle";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GAME_CONFIG } from "../game/config";
import type {
  AutoBodyShop,
  Dealership,
  BoxCollider,
  Clinic,
  DeliveryPoint,
  GasStation,
  RoadAxis,
  RoadDefinition,
  RoadTypeId,
  TrafficWaypoint,
} from "../game/types";
import { seededRandom } from "../utils/math";

export interface Town {
  districts: DistrictBlock[];
  buildings: BuildingLot[];
  residentialTrees: { x: number; z: number; radius: number }[];
  curbFootprints: BoxCollider[];
  fenceFootprints: BoxCollider[];
  meshes: Mesh[];
  staticColliders: BoxCollider[];
  roadPositionsX: number[];
  roadPositionsZ: number[];
  roads: RoadDefinition[];
  roadSpawnPoints: TrafficWaypoint[];
  deliveryPoints: DeliveryPoint[];
  gasStations: GasStation[];
  autoBodyShops: AutoBodyShop[];
  dealerships: Dealership[];
  clinics: Clinic[];
  legalDrivingAreas: BoxCollider[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface ServiceLocation {
  position: Vector3;
  inwardX: -1 | 1;
  inwardZ: -1 | 1;
  roadAxis?: RoadAxis;
  roadSide?: -1 | 1;
}

export class TownGenerator {
  private readonly config = GAME_CONFIG.world;
  private readonly materials: Record<string, StandardMaterial> = {};

  constructor(private readonly scene: Scene) {}

  generate(): Town {
    this.createMaterials();

    const { blocksX, blocksZ, blockSize, roadWidth, sidewalkWidth } = this.config;
    const totalX = blocksX * blockSize + (blocksX + 1) * roadWidth;
    const totalZ = blocksZ * blockSize + (blocksZ + 1) * roadWidth;
    const minX = -totalX / 2;
    const minZ = -totalZ / 2;
    const maxX = totalX / 2;
    const maxZ = totalZ / 2;
    const meshes: Mesh[] = [];
    const staticColliders: BoxCollider[] = [];
    const districts: DistrictBlock[] = [];
    const buildings: BuildingLot[] = [];
    const fenceFootprints: BoxCollider[] = [];

    const ground = MeshBuilder.CreateGround("ground", { width: totalX + 100, height: totalZ + 100 }, this.scene);
    ground.material = this.materials.ground;
    // Keep the foundation below paved surfaces to avoid competing depth values at a distance.
    ground.position.y = -1;
    meshes.push(ground);

    const roadPositionsX = Array.from({ length: blocksX + 1 }, (_, index) => minX + roadWidth / 2 + index * (blockSize + roadWidth));
    const roadPositionsZ = Array.from({ length: blocksZ + 1 }, (_, index) => minZ + roadWidth / 2 + index * (blockSize + roadWidth));
    const roads = this.createRoadDefinitions(roadPositionsX, roadPositionsZ);

    // Sidewalk slabs extend into the road by sidewalkWidth. Do not draw road faces beneath them.
    const visibleRoadHalf = roadWidth / 2 - sidewalkWidth;
    const roadColor = hasEnhancedGraphics(this.scene) ? CITY_STYLE.palette.road : "#212426";
    let roadTileId = 0;
    const roadTile = (x0: number, z0: number, x1: number, z1: number) => {
      const geometry = new CityGeometry(), x = (x0 + x1) / 2, z = (z0 + z1) / 2;
      geometry.face([
        [x0 - x, WORLD_SURFACES.road, z0 - z], [x1 - x, WORLD_SURFACES.road, z0 - z],
        [x1 - x, WORLD_SURFACES.road, z1 - z], [x0 - x, WORLD_SURFACES.road, z1 - z],
      ], roadColor);
      meshes.push(geometry.mesh(this.scene, `road-tile-${roadTileId++}`, this.materials.city, x, z));
    };
    // Short tiles still merge into local chunks; a city-wide mesh would keep a whole chunk visible everywhere.
    const halfStep = (blockSize + roadWidth) / 2;
    for (const x of roadPositionsX) for (const [iz, z] of roadPositionsZ.entries()) {
      roadTile(x - visibleRoadHalf, iz === 0 ? minZ : z - halfStep,
        x + visibleRoadHalf, iz === roadPositionsZ.length - 1 ? maxZ : z + halfStep);
    }
    for (const z of roadPositionsZ) for (let ix = 0; ix < roadPositionsX.length - 1; ix++) {
      roadTile(roadPositionsX[ix] + visibleRoadHalf, z - visibleRoadHalf,
        roadPositionsX[ix + 1] - visibleRoadHalf, z + visibleRoadHalf);
    }

    this.createRoadMarkings(roadPositionsX, roadPositionsZ, meshes);

    // Every training region has a deterministic home clinic and roadside bay.
    // Reserve these compact buildings before any other block contents are placed.
    const clinics = this.createClinics(roadPositionsX, roadPositionsZ, meshes, staticColliders);
    const clinicReservations = staticColliders.slice();

    // Keep fixed park features and boundary walls clear, then reserve gas stations
    // before buildings consume the available lots in the denser city districts.
    for (let bx = 0; bx < blocksX; bx++) {
      for (let bz = 0; bz < blocksZ; bz++) {
        if (districtForBlock(bx, bz, blocksX, blocksZ) !== "park") continue;
        this.createPark(`park-${bx}-${bz}`,
          roadPositionsX[bx] + roadWidth / 2 + blockSize / 2,
          roadPositionsZ[bz] + roadWidth / 2 + blockSize / 2,
          blockSize, meshes, staticColliders);
      }
    }
    staticColliders.push(...this.createBoundaries(minX, maxX, minZ, maxZ, meshes));
    const gasLocations = this.createGasStationLocations(roadPositionsX, roadPositionsZ, roads, staticColliders);
    const gasStations = this.createGasStations(gasLocations, meshes, staticColliders);
    const gasReservations = this.createLegalDrivingAreas(gasStations, [], []);
    const dealerships = this.createDealerships(roadPositionsX, roadPositionsZ, roads,
      [...staticColliders, ...gasReservations], meshes, staticColliders);
    const dealerReservations = this.createLegalDrivingAreas([], [], dealerships);
    // Reserve every service before frontage rows consume the street edge.
    const serviceLocations = this.createServiceLocations(roadPositionsX, roadPositionsZ,
      [...staticColliders, ...gasReservations, ...dealerReservations], GAME_CONFIG.repair.shopCount,
      gasStations.map(station => station.position));
    const autoBodyShops = this.createAutoBodyShops(serviceLocations, meshes, staticColliders);
    const legalDrivingAreas = this.createLegalDrivingAreas(gasStations, autoBodyShops, dealerships);
    const reservations = [...clinicReservations, ...legalDrivingAreas];


    for (let bx = 0; bx < blocksX; bx++) {
      for (let bz = 0; bz < blocksZ; bz++) {
        const leftRoad = roadPositionsX[bx];
        const topRoad = roadPositionsZ[bz];
        const centerX = leftRoad + roadWidth / 2 + blockSize / 2;
        const centerZ = topRoad + roadWidth / 2 + blockSize / 2;
        const district = districtForBlock(bx,bz,blocksX,blocksZ);
        districts.push({bx,bz,district});
        if (district === "park") {
          continue;
        }
        const sidewalk = MeshBuilder.CreateBox(`sidewalk-${bx}-${bz}`, {
          width: blockSize + sidewalkWidth * 2,
          height: 0.12,
          depth: blockSize + sidewalkWidth * 2,
        }, this.scene);
        sidewalk.position.set(centerX, WORLD_SURFACES.sidewalk - .06, centerZ);
        sidewalk.material = this.materials.sidewalk;
        meshes.push(sidewalk);

        const layout = planBlock(bx, bz, centerX, centerZ, district, reservations);
        for (const lot of layout.buildings) {
          const name = lot.frontage!.id;
          buildings.push(lot);
          meshes.push(...this.createBuildingMeshes(name, lot.x, lot.z, lot.width, lot.depth, lot.height,
            this.pickBuildingMaterial(name), district, lot.landmark, lot.facing, null, true, lot.frontage));
          staticColliders.push({ x: lot.x, z: lot.z, halfX: lot.width / 2, halfZ: lot.depth / 2 });
        }
        const details = new CityGeometry();
        for (const {area, color} of layout.ground) {
          const x = area.x - centerX, z = area.z - centerZ, y = WORLD_SURFACES.garden;
          details.face([[x-area.halfX,y,z-area.halfZ],[x+area.halfX,y,z-area.halfZ],
            [x+area.halfX,y,z+area.halfZ],[x-area.halfX,y,z+area.halfZ]], color);
        }
        // One static prism per run, with a single shared pattern for board seams.
        meshes.push(createFenceMesh(this.scene, `fences-${bx}-${bz}`, layout.fenceRuns, centerX, centerZ,
          district === "downtown" ? "#647774" : "#b9a68a", this.materials.fence));
        staticColliders.push(...layout.fences);
        fenceFootprints.push(...layout.fences);
        meshes.push(details.mesh(this.scene, `block-details-${bx}-${bz}`, this.materials.city, centerX, centerZ));
      }
    }

    const roadSpawnPoints = this.createRoadWaypoints(roadPositionsX, roadPositionsZ);
    const deliveryPoints = this.createDeliveryPoints(roadPositionsX, roadPositionsZ, roads);
    const approaches = buildings.map(entranceApproach);
    const residentialTrees: Town["residentialTrees"] = [];
    const radius = CITY_STYLE.streetDetails.treeCanopyRadius;
    // Place only after every neighboring building and service entrance is known.
    for (const [index, lot] of buildings.entries()) {
      const yard = lot.frontage?.yard;
      if (!yard || visualSeed(`tree-${lot.frontage!.id}`) / 0xffffffff >= this.config.buildings.yardTreeChance) continue;
      const candidates = [-1, 1].map(side => ({
        x: yard.x + side * Math.min(5, yard.halfX - radius - 2),
        z: yard.z + side * Math.min(5, yard.halfZ - radius - 2),
      }));
      const location = candidates.find(({x,z}) =>
        !roadPositionsX.some(road => Math.abs(x-road) < roadWidth/2 + radius) &&
        !roadPositionsZ.some(road => Math.abs(z-road) < roadWidth/2 + radius) &&
        !staticColliders.some(area => overlapsArea(x,z,radius+1,area)) &&
        !approaches.some(area => overlapsArea(x,z,radius,area)) &&
        !legalDrivingAreas.some(area => overlapsArea(x,z,radius,area)));
      if (!location) continue;
      const {x,z} = location, tree = new CityGeometry();
      tree.tree(0,0,10,CITY_STYLE.palette.foliage[index%3]);
      meshes.push(tree.mesh(this.scene,`yard-tree-${index}`,this.materials.city,x,z));
      staticColliders.push({x,z,halfX:.7,halfZ:.7});
      residentialTrees.push({x,z,radius});
    }
    const curbFootprints: BoxCollider[] = [];
    if (hasEnhancedGraphics(this.scene)) for (const {bx,bz} of districts) {
      const x = roadPositionsX[bx] + roadWidth/2 + blockSize/2;
      const z = roadPositionsZ[bz] + roadWidth/2 + blockSize/2;
      const halfBlock = blockSize/2 + sidewalkWidth, details = new CityGeometry();
      curbFootprints.push(...addPavementDetails(details,x,z,halfBlock,legalDrivingAreas,bx*17+bz*31));
      const sx = -halfBlock + 7, sz = -halfBlock + 7;
      if ((bx+bz)%3 === 0 && ![...legalDrivingAreas,...approaches,...staticColliders]
        .some(area => overlapsArea(x+sx,z+sz,3,area))) {
        addStreetSign(details,sx,sz,bx+1);
      }
      meshes.push(details.mesh(this.scene,`street-details-${bx}-${bz}`,this.materials.city,x,z));
    }
    const optimizedMeshes = this.optimizeStaticMeshes(meshes, minX, minZ);

    return {
      districts,
      buildings,
      residentialTrees,
      curbFootprints,
      fenceFootprints,
      meshes: optimizedMeshes,
      staticColliders,
      roadPositionsX,
      roadPositionsZ,
      roads,
      roadSpawnPoints,
      deliveryPoints,
      gasStations,
      autoBodyShops,
      dealerships,
      clinics,
      legalDrivingAreas,
      minX,
      maxX,
      minZ,
      maxZ,
    };
  }

  private createMaterials(): void {
    this.materials.ground = this.texturedMaterial("ground-mat", new Color3(0.28, 0.36, 0.3), "ground", 17, 72);
    this.materials.road = this.texturedMaterial("road-mat", new Color3(0.13, 0.14, 0.15), "road", 29, 44);
    this.materials.centerLine = this.material("center-line-mat", new Color3(0.96, 0.72, 0.08));
    this.materials.sidewalk = this.texturedMaterial("sidewalk-mat", new Color3(0.48, 0.5, 0.49), "sidewalk", 43, 18);
    this.materials.buildingA = this.texturedMaterial("building-a-mat", new Color3(0.48, 0.46, 0.43), "facade", 59, 2);
    this.materials.buildingB = this.texturedMaterial("building-b-mat", new Color3(0.38, 0.43, 0.49), "facade", 71, 2);
    this.materials.buildingC = this.texturedMaterial("building-c-mat", new Color3(0.52, 0.39, 0.35), "facade", 83, 2);
    this.materials.roof = this.material("building-roof-mat", new Color3(0.2, 0.22, 0.23));
    this.materials.boundary = this.material("boundary-mat", new Color3(0.18, 0.2, 0.22));
    this.materials.gasCanopy = this.material("gas-canopy-mat", new Color3(0.98, 0.86, 0.16));
    this.materials.gasBase = this.material("gas-base-mat", new Color3(0.14, 0.54, 0.74));
    this.materials.gasSign = this.material("gas-sign-mat", new Color3(0.08, 0.95, 0.64));
    this.materials.repairBase = this.material("repair-base-mat", new Color3(0.58, 0.11, 0.14));
    this.materials.repairGarage = this.material("repair-garage-mat", new Color3(0.18, 0.2, 0.22));
    this.materials.repairSign = this.material("repair-sign-mat", new Color3(1, 0.44, 0.16));
    this.materials.displayCar = this.material("shop-display-car-mat", Color3.White());
    this.materials.gasLettering = serviceSignMaterial(this.scene, "GAS");
    this.materials.repairLettering = serviceSignMaterial(this.scene, "REPAIR");
    this.materials.dealerLettering = serviceSignMaterial(this.scene, "CARS");
    this.materials.dealerBase = this.material("dealership-base", new Color3(.19, .34, .52));
    this.materials.clinicBase = this.material("clinic-base-mat", new Color3(0.82, 0.87, 0.87));
    this.materials.city = this.material("city-flat-mat",Color3.White());
    this.materials.fence = createFenceMaterial(this.scene);
    this.materials.neon = this.material("city-neon-mat",Color3.White());
    this.materials.neon.disableLighting=true;
    this.materials.neon.emissiveColor=Color3.White().scale(CITY_STYLE.lighting.signIntensity);
  }

  private createClinics(
    xs: number[], zs: number[], meshes: Mesh[], colliders: BoxCollider[],
  ): Clinic[] {
    const clinics: Clinic[] = [];
    const roadOffset = this.config.roadWidth * 0.35;
    for (let bz = 0; bz < zs.length - 1; bz++) for (let bx = 0; bx < xs.length - 1; bx++) {
      const centerX = (xs[bx] + xs[bx + 1]) / 2;
      const centerZ = (zs[bz] + zs[bz + 1]) / 2;
      const vertical = Math.abs(centerX) >= Math.abs(centerZ);
      const toward = (vertical ? centerX : centerZ) > 0 ? -1 : 1;
      const roadCenter = vertical ? (toward < 0 ? xs[bx] : xs[bx + 1]) : (toward < 0 ? zs[bz] : zs[bz + 1]);
      const position = new Vector3(
        vertical ? roadCenter + toward * 52 : centerX,
        0,
        vertical ? centerZ : roadCenter + toward * 52,
      );
      const roadIndex = vertical ? (toward < 0 ? bx : bx + 1) : (toward < 0 ? bz : bz + 1);
      const roadId = `${vertical ? "ns" : "ew"}-${roadIndex}`;
      const destinationPoint: DeliveryPoint = {
        roadId,
        position: new Vector3(
          vertical ? roadCenter + toward * roadOffset : centerX,
          0.1,
          vertical ? centerZ : roadCenter + toward * roadOffset,
        ),
      };
      const id = `clinic-${bx}-${bz}`, regionId = `block-${bx}-${bz}`;
      const building = MeshBuilder.CreateBox(`${id}-building`, { width: vertical ? 30 : 54, height: 12, depth: vertical ? 54 : 30 }, this.scene);
      building.position.set(position.x, 6, position.z); building.material = this.materials.clinicBase; meshes.push(building);
      const entrance = MeshBuilder.CreateBox(`${id}-entrance`, { width: vertical ? .4 : 12, height: 5, depth: vertical ? 12 : .4 }, this.scene);
      entrance.position.set(position.x + (vertical ? -toward * (15.2 + CITY_STYLE.facades.surfaceStep) : 0), 2.5, position.z + (vertical ? 0 : -toward * (15.2 + CITY_STYLE.facades.surfaceStep)));
      entrance.material = this.materials.repairGarage; meshes.push(entrance);
      const signX = position.x + (vertical ? -toward * (15.3 + CITY_STYLE.facades.surfaceStep) : 9);
      const signZ = position.z + (vertical ? 9 : -toward * (15.3 + CITY_STYLE.facades.surfaceStep));
      for (const arm of [0, -1, 1]) {
        const width = vertical ? .45 : arm === 0 ? 1.8 : 2.1;
        const height = arm === 0 ? 6 : 1.8;
        const depth = vertical ? arm === 0 ? 1.8 : 2.1 : .45;
        const sign = MeshBuilder.CreateBox(`${id}-medical-cross`, { width, height, depth }, this.scene);
        sign.position.set(signX + (vertical ? 0 : arm * 1.95), 8, signZ + (vertical ? arm * 1.95 : 0)); sign.material = this.materials.gasSign; meshes.push(sign);
      }
      const canopy = MeshBuilder.CreateBox(`${id}-canopy`, { width: vertical ? 6 : 15, height: .5, depth: vertical ? 15 : 6 }, this.scene);
      canopy.position.set(position.x + (vertical ? -toward * 17 : 0), 5.2, position.z + (vertical ? 0 : -toward * 17));
      canopy.material = this.materials.clinicBase; meshes.push(canopy);
      colliders.push({ x: position.x, z: position.z, halfX: vertical ? 15 : 27, halfZ: vertical ? 27 : 15 });
      clinics.push({ id, regionId, position, destinationPoint });
    }
    return clinics;
  }

  private material(name: string, color: Color3): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
    return mat;
  }

  private texturedMaterial(
    name: string,
    color: Color3,
    pattern: "ground" | "road" | "sidewalk" | "facade",
    seed: number,
    textureScale: number,
  ): StandardMaterial {
    if(hasEnhancedGraphics(this.scene)) {
      const palette = CITY_STYLE.palette;
      const flatColor = pattern === "road" ? palette.road : pattern === "sidewalk" ? palette.sidewalk
        : pattern === "ground" ? palette.ground : palette.downtown[seed%palette.downtown.length];
      return this.material(name,Color3.FromHexString(flatColor));
    }
    const material = this.material(name, Color3.White());
    const texture = this.createSurfaceTexture(`${name}-texture`, color, pattern, seed);
    const scale = textureScale;
    texture.uScale = scale;
    texture.vScale = scale;
    material.diffuseTexture = texture;
    return material;
  }

  private createSurfaceTexture(
    name: string,
    base: Color3,
    pattern: "ground" | "road" | "sidewalk" | "facade",
    seed: number,
  ): RawTexture {
    const size = GAME_CONFIG.graphics.surfaceTextureSize;
    const data = new Uint8Array(size * size * 4);
    const random = seededRandom(seed);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const pixel = (y * size + x) * 4;
        let variation = (random() * 2 - 1) * (pattern === "road" ? 11 : 8);
        let red = base.r * 255 + variation;
        let green = base.g * 255 + variation;
        let blue = base.b * 255 + variation;

        if (pattern === "ground" && random() > 0.93) {
          green += 13;
          red -= 7;
        } else if (pattern === "road" && random() > 0.965) {
          red += 18;
          green += 18;
          blue += 18;
        } else if (pattern === "sidewalk" && (x % 16 === 0 || y % 16 === 0)) {
          red -= 18;
          green -= 18;
          blue -= 18;
        } else if (pattern === "facade") {
          const windowX = x % 16 >= 3 && x % 16 <= 11;
          const windowY = y % 16 >= 4 && y % 16 <= 11;
          if (windowX && windowY) {
            const lit = ((Math.floor(x / 16) + Math.floor(y / 16) + seed) % 5) === 0;
            red = lit ? 194 : 31;
            green = lit ? 170 : 47;
            blue = lit ? 105 : 58;
            variation = 0;
          }
        }

        data[pixel] = Math.max(0, Math.min(255, Math.round(red + variation * 0.15)));
        data[pixel + 1] = Math.max(0, Math.min(255, Math.round(green + variation * 0.15)));
        data[pixel + 2] = Math.max(0, Math.min(255, Math.round(blue + variation * 0.15)));
        data[pixel + 3] = 255;
      }
    }
    const texture = RawTexture.CreateRGBATexture(
      data,
      size,
      size,
      this.scene,
      true,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    texture.name = name;
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 2;
    return texture;
  }

  private pickBuildingMaterial(name: string): StandardMaterial {
    const options = [this.materials.buildingA, this.materials.buildingB, this.materials.buildingC];
    return options[visualSeed(name)%options.length];
  }

  private createPark(name: string,x: number,z: number,size: number,meshes: Mesh[],colliders: BoxCollider[]): void {
    const g=new CityGeometry(),p=CITY_STYLE.palette,random=seededRandom(visualSeed(name));
    // Tile the ground instead of layering lawns and paths over a full sidewalk slab.
    const edges=[-size/2-this.config.sidewalkWidth,-size/2+9,-5,5,size/2-9,size/2+this.config.sidewalkWidth];
    for(let ix=0;ix<edges.length-1;ix++) for(let iz=0;iz<edges.length-1;iz++) {
      const color=ix===0||iz===0||ix===4||iz===4?p.sidewalk:ix===2||iz===2?p.path:p.lawn;
      g.face([[edges[ix],WORLD_SURFACES.sidewalk,edges[iz]],[edges[ix+1],WORLD_SURFACES.sidewalk,edges[iz]],
        [edges[ix+1],WORLD_SURFACES.sidewalk,edges[iz+1]],[edges[ix],WORLD_SURFACES.sidewalk,edges[iz+1]]],color);
    }
    g.box(0,3,0,20,6,20,p.trim);
    g.roof(0,6,0,24,24,4,p.roof);
    // Recess-colored doorway and windows turn the pavilion into a recognizable park building.
    g.box(0,1.8,-10.05-CITY_STYLE.facades.surfaceStep,3,3.6,.1,p.window);
    for(const sign of [-1,1]) g.box(sign*7,2,-10.05-CITY_STYLE.facades.surfaceStep,3,3,.1,p.window);
    colliders.push({x,z,halfX:10,halfZ:10});
    for(const side of [-1,1]) for(const along of [-65,65]) {
      const bx=side*10,bz=along;
      g.box(bx,1.3,bz,5,.4,1.8,p.trunk);
      g.box(bx,2.2,bz+.75,5,1.4,.25,p.trunk);
      for(const leg of [-1.7,1.7]) g.box(bx+leg,.65,bz,.35,1.3,1.4,p.roof);
      colliders.push({x:x+bx,z:z+bz,halfX:2.5,halfZ:1});
    }
    for(let i=0;i<CITY_STYLE.parkTrees;i++) {
      // A broad clear perimeter protects curbside pickups and service approaches.
      const quadrant=i%4,tx=(quadrant%2 ? 1:-1)*(30+random()*(size/2-95));
      const tz=(quadrant<2 ? 1:-1)*(30+random()*(size/2-95));
      if (colliders.some(area => overlapsArea(x + tx, z + tz, 8, area))) continue;
      g.tree(tx,tz,12+random()*7,p.foliage[i%p.foliage.length]);
      colliders.push({x:x+tx,z:z+tz,halfX:.7,halfZ:.7});
    }
    meshes.push(g.mesh(this.scene,name,this.materials.city,x,z));
  }

  private createBuildingMeshes(
    name: string,
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    facadeMaterial: StandardMaterial,
    district: CityDistrict = "residential",
    landmark = false,
    facing = 0,
    cornerSide: number | null = null,
    streetFrontage = true,
    frontage?: BuildingFrontage,
  ): Mesh[] {
    // Roof detail uses its own seed so render-mode choices cannot change placement.
    const random=seededRandom(visualSeed(name));
    const detail = random() < GAME_CONFIG.graphics.buildingRoofDetailChance ? {
      height: 0.8 + random() * 1.6,
      offsetX: (random() * 2 - 1) * width * 0.18,
      offsetZ: (random() * 2 - 1) * depth * 0.18,
    } : null;
    if (hasEnhancedGraphics(this.scene)) {
      return createNoirBuilding(this.scene,name,x,z,width,depth,height,this.materials.city,this.materials.neon,district,landmark,facing,cornerSide,streetFrontage,frontage);
    }
    const building = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    building.position.set(x, height / 2, z);
    building.material = facadeMaterial;

    const roofTrim = MeshBuilder.CreateBox(`${name}-roof-trim`, {
      width: width + 0.7,
      height: 0.35,
      depth: depth + 0.7,
    }, this.scene);
    roofTrim.position.set(x, height + 0.175, z);
    roofTrim.material = this.materials.roof;
    const meshes = [building, roofTrim];

    if (detail) {
      const unitWidth = Math.min(6, width * 0.25);
      const unitDepth = Math.min(5, depth * 0.22);
      const unitHeight = detail.height;
      const rooftopUnit = MeshBuilder.CreateBox(`${name}-roof-unit`, {
        width: unitWidth,
        height: unitHeight,
        depth: unitDepth,
      }, this.scene);
      rooftopUnit.position.set(
        x + detail.offsetX,
        height + 0.35 + unitHeight / 2,
        z + detail.offsetZ,
      );
      rooftopUnit.material = this.materials.roof;
      meshes.push(rooftopUnit);
    }
    return meshes;
  }

  private createRoadMarkings(roadPositionsX: number[], roadPositionsZ: number[], meshes: Mesh[]): void {
    const marking = this.config.roadMarkings;
    const lineOffset = marking.lineGap / 2 + marking.lineWidth / 2;
    const segmentInset = this.config.roadWidth / 2 + marking.intersectionBuffer;
    const lines: Mesh[] = [];

    for (const x of roadPositionsX) {
      for (let iz = 0; iz < roadPositionsZ.length - 1; iz++) {
        const start = roadPositionsZ[iz] + segmentInset;
        const end = roadPositionsZ[iz + 1] - segmentInset;
        const length = end - start;
        if (length <= 0) continue;
        for (const offset of [-lineOffset, lineOffset]) {
          const line = MeshBuilder.CreateBox(`center-line-ns-${x}-${iz}-${offset}`, {
            width: marking.lineWidth,
            height: marking.height,
            depth: length,
          }, this.scene);
          line.position.set(x + offset, WORLD_SURFACES.markings - marking.height / 2, (start + end) / 2);
          line.material = this.materials.centerLine;
          lines.push(line);
        }
      }
    }

    for (const z of roadPositionsZ) {
      for (let ix = 0; ix < roadPositionsX.length - 1; ix++) {
        const start = roadPositionsX[ix] + segmentInset;
        const end = roadPositionsX[ix + 1] - segmentInset;
        const length = end - start;
        if (length <= 0) continue;
        for (const offset of [-lineOffset, lineOffset]) {
          const line = MeshBuilder.CreateBox(`center-line-ew-${z}-${ix}-${offset}`, {
            width: length,
            height: marking.height,
            depth: marking.lineWidth,
          }, this.scene);
          line.position.set((start + end) / 2, WORLD_SURFACES.markings - marking.height / 2, z + offset);
          line.material = this.materials.centerLine;
          lines.push(line);
        }
      }
    }

    const merged = Mesh.MergeMeshes(lines, true, true, undefined, false, false);
    if (merged) {
      merged.name = "center-lines";
      meshes.push(merged);
    }
  }

  private createLegalDrivingAreas(gasStations: GasStation[], shops: AutoBodyShop[], dealerships: Dealership[]): BoxCollider[] {
    const padding = GAME_CONFIG.drivingRules.serviceAreaPadding;
    const gasDepth = Math.max(GAME_CONFIG.world.roadWidth / 2 + GAME_CONFIG.world.sidewalkWidth + 17,
      gasForecourtBounds().back);
    return [
      ...gasStations.map((station) => ({
        x: station.position.x,
        z: station.position.z,
        halfX: (station.roadAxis ?? "northSouth") === "northSouth"
          ? gasDepth + padding
          : GAME_CONFIG.world.servicePlacement.gasStationLegalHalfWidth + padding,
        halfZ: (station.roadAxis ?? "northSouth") === "northSouth"
          ? GAME_CONFIG.world.servicePlacement.gasStationLegalHalfWidth + padding
          : gasDepth + padding,
      })),
      ...shops.map(shop => ({ ...shop.serviceArea,
        halfX: shop.serviceArea.halfX + padding, halfZ: shop.serviceArea.halfZ + padding })),
      ...dealerships.map(dealer => ({ ...dealer.serviceArea,
        halfX: dealer.serviceArea.halfX + this.config.sidewalkWidth * 2 + padding,
        halfZ: dealer.serviceArea.halfZ + this.config.sidewalkWidth * 2 + padding })),
    ];
  }

  private createBoundaries(minX: number, maxX: number, minZ: number, maxZ: number, meshes: Mesh[]): BoxCollider[] {
    const thickness = 12;
    const height = 3;
    const width = maxX - minX + this.config.boundaryPadding * 2;
    const depth = maxZ - minZ + this.config.boundaryPadding * 2;
    const colliders: BoxCollider[] = [
      { x: 0, z: minZ - thickness / 2, halfX: width / 2, halfZ: thickness / 2 },
      { x: 0, z: maxZ + thickness / 2, halfX: width / 2, halfZ: thickness / 2 },
      { x: minX - thickness / 2, z: 0, halfX: thickness / 2, halfZ: depth / 2 },
      { x: maxX + thickness / 2, z: 0, halfX: thickness / 2, halfZ: depth / 2 },
    ];

    for (const [index, collider] of colliders.entries()) {
      const wall = MeshBuilder.CreateBox(`boundary-${index}`, {
        width: collider.halfX * 2,
        height,
        depth: collider.halfZ * 2,
      }, this.scene);
      wall.position.set(collider.x, height / 2, collider.z);
      wall.material = this.materials.boundary;
      meshes.push(wall);
    }

    return colliders;
  }

  private createRoadWaypoints(roadPositionsX: number[], roadPositionsZ: number[]): TrafficWaypoint[] {
    const waypoints: TrafficWaypoint[] = [];
    for (let ix = 0; ix < roadPositionsX.length; ix++) {
      for (let iz = 0; iz < roadPositionsZ.length; iz++) {
        waypoints.push({ position: new Vector3(roadPositionsX[ix], 0, roadPositionsZ[iz]), ix, iz });
      }
    }
    return waypoints;
  }

  private createRoadDefinitions(roadPositionsX: number[], roadPositionsZ: number[]): RoadDefinition[] {
    return [
      ...this.createRoadDefinitionsForAxis("northSouth", "ns", roadPositionsX),
      ...this.createRoadDefinitionsForAxis("eastWest", "ew", roadPositionsZ),
    ];
  }

  private createRoadDefinitionsForAxis(
    axis: RoadAxis,
    idPrefix: string,
    positions: number[],
  ): RoadDefinition[] {
    return positions.map((center, index) => {
      const isPerimeter = index === 0 || index === positions.length - 1;
      const type = (isPerimeter
        ? this.config.perimeterRoadType
        : this.config.interiorRoadType) as RoadTypeId;
      const rules = this.config.roadTypes[type];
      return {
        id: `${idPrefix}-${index}`,
        axis,
        index,
        center,
        type,
        speedLimitMph: rules.speedLimitMph,
        allowsMissionStops: rules.allowsMissionStops,
      };
    });
  }

  private createDeliveryPoints(
    roadPositionsX: number[],
    roadPositionsZ: number[],
    roads: RoadDefinition[],
  ): DeliveryPoint[] {
    const points: DeliveryPoint[] = [];
    const offset = this.config.roadWidth * 0.35;
    const roadsById = new Map(roads.map((road) => [road.id, road]));
    for (let ix = 0; ix < roadPositionsX.length; ix++) {
      for (let iz = 0; iz < roadPositionsZ.length; iz++) {
        const eastWestRoadId = `ew-${iz}`;
        if (ix < roadPositionsX.length - 1 && roadsById.get(eastWestRoadId)?.allowsMissionStops) {
          const midX = (roadPositionsX[ix] + roadPositionsX[ix + 1]) / 2;
          points.push({ position: new Vector3(midX, 0.1, roadPositionsZ[iz] + offset), roadId: eastWestRoadId });
          points.push({ position: new Vector3(midX, 0.1, roadPositionsZ[iz] - offset), roadId: eastWestRoadId });
        }
        const northSouthRoadId = `ns-${ix}`;
        if (iz < roadPositionsZ.length - 1 && roadsById.get(northSouthRoadId)?.allowsMissionStops) {
          const midZ = (roadPositionsZ[iz] + roadPositionsZ[iz + 1]) / 2;
          points.push({ position: new Vector3(roadPositionsX[ix] + offset, 0.1, midZ), roadId: northSouthRoadId });
          points.push({ position: new Vector3(roadPositionsX[ix] - offset, 0.1, midZ), roadId: northSouthRoadId });
        }
      }
    }
    return points;
  }

  private createServiceLocations(
    roadPositionsX: number[],
    roadPositionsZ: number[],
    colliders: BoxCollider[],
    count: number,
    existing: readonly Vector3[] = [],
  ): ServiceLocation[] {
    const candidates: ServiceLocation[] = [];
    const offset = this.config.roadWidth / 2 + this.config.sidewalkWidth + 12;

    for (let ix = 0; ix < roadPositionsX.length; ix++) {
      for (let iz = 0; iz < roadPositionsZ.length; iz++) {
        for (const inwardX of [-1, 1] as const) {
          const blockX = ix + (inwardX < 0 ? -1 : 0);
          if (blockX < 0 || blockX >= roadPositionsX.length - 1) continue;
          for (const inwardZ of [-1, 1] as const) {
            const blockZ = iz + (inwardZ < 0 ? -1 : 0);
            if (blockZ < 0 || blockZ >= roadPositionsZ.length - 1) continue;
            candidates.push({
              position: new Vector3(
                roadPositionsX[ix] + inwardX * offset,
                0.1,
                roadPositionsZ[iz] + inwardZ * offset,
              ),
              inwardX,
              inwardZ,
            });
          }
        }
      }
    }

    const random = seededRandom(this.config.servicePlacement.seed);
    for (let index = candidates.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(random() * (index + 1));
      [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
    }

    // This conservative footprint covers either service type, including its roadside sign.
    const footprintHalfX = 31;
    const footprintHalfZ = 21;
    const clearance = this.config.servicePlacement.buildingClearance;
    const buildableCandidates = candidates.filter(({ position }) => existing.every(other =>
      Math.hypot(position.x-other.x, position.z-other.z) >= this.config.servicePlacement.minimumSpacing)
      && !colliders.some((collider) => (
      Math.abs(position.x - collider.x) < footprintHalfX + collider.halfX + clearance
      && Math.abs(position.z - collider.z) < footprintHalfZ + collider.halfZ + clearance
    )));
    const selected: ServiceLocation[] = [];
    let minimumSpacing: number = this.config.servicePlacement.minimumSpacing;
    while (selected.length < count && minimumSpacing >= 0) {
      selected.length = 0;
      for (const candidate of buildableCandidates) {
        if (selected.every(({ position }) => (
          Math.hypot(candidate.position.x - position.x, candidate.position.z - position.z) >= minimumSpacing
        ))) {
          selected.push(candidate);
          if (selected.length === count) break;
        }
      }
      if (selected.length < count) minimumSpacing = minimumSpacing === 0 ? -1 : Math.max(0, minimumSpacing - 25);
    }
    return selected;
  }

  private createGasStationLocations(
    roadPositionsX: number[],
    roadPositionsZ: number[],
    roads: RoadDefinition[],
    colliders: BoxCollider[],
  ): ServiceLocation[] {
    const candidates: ServiceLocation[] = [];
    const roadOffset = this.config.roadWidth / 2 + this.config.sidewalkWidth + 14;
    // Eligibility is fixed before distributing stations, so highways are never candidates.
    // Match mission-stop eligibility and explicitly exclude both perimeter roads.
    const cityRoads = roads.filter(road => road.type === "city" && road.allowsMissionStops
      && road.index > 0
      && road.index < (road.axis === "northSouth" ? roadPositionsX.length : roadPositionsZ.length) - 1);
    for (const { index: roadIndex } of cityRoads.filter(road => road.axis === "northSouth")) {
      for (let blockZ = 0; blockZ < roadPositionsZ.length - 1; blockZ++) {
        candidates.push(...([-1, 1] as const).map((roadSide) => ({
          position: new Vector3(
            roadPositionsX[roadIndex] + roadSide * roadOffset,
            0.1,
            (roadPositionsZ[blockZ] + roadPositionsZ[blockZ + 1]) / 2,
          ),
          inwardX: roadSide,
          inwardZ: 1 as const,
          roadAxis: "northSouth" as const,
          roadSide,
        })));
      }
    }
    for (const { index: roadIndex } of cityRoads.filter(road => road.axis === "eastWest")) {
      for (let blockX = 0; blockX < roadPositionsX.length - 1; blockX++) {
        candidates.push(...([-1, 1] as const).map((roadSide) => ({
          position: new Vector3(
            (roadPositionsX[blockX] + roadPositionsX[blockX + 1]) / 2,
            0.1,
            roadPositionsZ[roadIndex] + roadSide * roadOffset,
          ),
          inwardX: 1 as const,
          inwardZ: roadSide,
          roadAxis: "eastWest" as const,
          roadSide,
        })));
      }
    }

    const random = seededRandom(this.config.servicePlacement.seed + 17);
    for (let index = candidates.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(random() * (index + 1));
      [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
    }
    const clearance = this.config.servicePlacement.buildingClearance;
    // Reserve the whole lot, including the rear roof, before selecting sites near clinics/parks.
    const footprint = gasForecourtBounds();
    const inwardCenter = (footprint.front + footprint.back) / 2;
    const halfDepth = (footprint.back - footprint.front) / 2;
    const buildable = candidates.filter((candidate) => {
      const ns = candidate.roadAxis === "northSouth", side = candidate.roadSide!;
      const x = candidate.position.x + (ns ? side * inwardCenter : 0);
      const z = candidate.position.z + (ns ? 0 : side * inwardCenter);
      return !colliders.some(collider => Math.abs(x - collider.x) < (ns ? halfDepth : footprint.halfLength) + collider.halfX + clearance
        && Math.abs(z - collider.z) < (ns ? footprint.halfLength : halfDepth) + collider.halfZ + clearance);
    });
    // Start near the center, then fill the largest remaining gap. Normalize each
    // axis so rectangular maps get coverage along both their width and height.
    // The seeded shuffle above breaks ties without favoring one road or district.
    const width = roadPositionsX.at(-1)! - roadPositionsX[0];
    const depth = roadPositionsZ.at(-1)! - roadPositionsZ[0];
    const centerX = (roadPositionsX[0] + roadPositionsX.at(-1)!) / 2;
    const centerZ = (roadPositionsZ[0] + roadPositionsZ.at(-1)!) / 2;
    const remaining = buildable.map(location => ({
      location,
      x: (location.position.x - centerX) / width,
      z: (location.position.z - centerZ) / depth,
      nearestDistanceSquared: Infinity,
    }));
    const selected: ServiceLocation[] = [];
    while (selected.length < GAME_CONFIG.fuel.stationCount && remaining.length > 0) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let index = 0; index < remaining.length; index++) {
        const candidate = remaining[index];
        const score = selected.length === 0
          ? -(candidate.x * candidate.x + candidate.z * candidate.z)
          : candidate.nearestDistanceSquared;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
      const [chosen] = remaining.splice(bestIndex, 1);
      selected.push(chosen.location);
      for (const candidate of remaining) {
        const dx = candidate.x - chosen.x;
        const dz = candidate.z - chosen.z;
        candidate.nearestDistanceSquared = Math.min(candidate.nearestDistanceSquared, dx * dx + dz * dz);
      }
    }
    return selected;
  }

  private createGasStations(
    locations: ServiceLocation[],
    meshes: Mesh[],
    colliders: BoxCollider[],
  ): GasStation[] {
    return locations.map(({ position, inwardX, roadAxis, roadSide }, index) => {
      const axis = roadAxis ?? "northSouth";
      const side = roadSide ?? inwardX;
      const layout = GAME_CONFIG.presentation.gasStation;
      const ns = axis === "northSouth";
      // Visuals, collision and refueling all use these same pump centers.
      const pumpPositions = [-layout.pumpSpacing / 2, layout.pumpSpacing / 2].map(along => new Vector3(
        position.x + (ns ? layout.pumpSetback * side : along),
        WORLD_SURFACES.service,
        position.z + (ns ? along : layout.pumpSetback * side),
      ));
      const station: GasStation = { position, pumpPositions, radius: GAME_CONFIG.fuel.refuelRadius,
        roadAxis: axis, roadSide: side };
      meshes.push(...this.createGasStationMeshes(station, index, colliders));
      return station;
    });
  }

  private createGasStationMeshes(
    station: GasStation,
    index: number,
    colliders: BoxCollider[],
  ): Mesh[] {
    const { position, roadAxis, roadSide } = station;
    const meshes: Mesh[] = [];
    const ns = roadAxis === "northSouth";
    const layout = GAME_CONFIG.presentation.gasStation;
    const point = (along: number, inward: number) => ({
      x: position.x + (ns ? inward * roadSide : along),
      z: position.z + (ns ? along : inward * roadSide),
    });
    // All details share the existing vertex-color material and static city batches.
    const details = new CityGeometry();
    const box = (along: number, inward: number, y: number, width: number, depth: number,
      height: number, color: string, solid = false) => {
      const p = point(along, inward);
      details.box(p.x - position.x, y, p.z - position.z, ns ? depth : width, height, ns ? width : depth, color);
      if (solid) colliders.push({ x: p.x, z: p.z, halfX: (ns ? depth : width) / 2, halfZ: (ns ? width : depth) / 2 });
    };
    const paving = new CityGeometry();
    const outline = gasForecourtOutline().map(([along, y, inward]) => [
      roadAxis === "northSouth" ? inward * roadSide : along,
      y,
      roadAxis === "northSouth" ? along : inward * roadSide,
    ] as [number, number, number]);
    // Mirroring an outline reverses its winding, so restore the upward-facing normal.
    if ((roadAxis === "northSouth" ? -roadSide : roadSide) < 0) outline.reverse();
    paving.face(outline, hasEnhancedGraphics(this.scene) ? CITY_STYLE.palette.road : "#212426");
    meshes.push(paving.mesh(this.scene, `gas-forecourt-${index}`, this.materials.city, position.x, position.z));

    // Keep the roof beyond the rear pump reach + camera.distance; no roof over either lane.
    const rear = point(0, layout.canopySetback);
    const canopy = MeshBuilder.CreateBox(`gas-canopy-${index}`, { width: ns ? layout.canopyDepth : 34,
      height: GAME_CONFIG.presentation.serviceSigns.gasHeight, depth: ns ? 34 : layout.canopyDepth }, this.scene);
    canopy.position.set(rear.x, 7.5 + GAME_CONFIG.presentation.serviceSigns.gasHeight / 2, rear.z);
    canopy.material = this.materials.gasCanopy;
    meshes.push(canopy);
    meshes.push(...addServiceFascia(this.scene, `gas-lettering-${index}`, rear.x,
      canopy.position.y, rear.z, ns ? layout.canopyDepth : 34,
      ns ? 34 : layout.canopyDepth, 22, GAME_CONFIG.presentation.serviceSigns.gasHeight - .3,
      this.materials.gasLettering));

    // A small rear kiosk supports the relocated roof. Walls stop at its underside,
    // with an overhang and physically separated window faces to avoid z-fighting.
    const ground = WORLD_SURFACES.service;
    box(0, layout.canopySetback, (ground + 7.5) / 2, 32, layout.canopyDepth - 2, 7.5 - ground, "#d1d8ce", true);
    const wallFront = layout.canopySetback - (layout.canopyDepth - 2) / 2;
    const face = wallFront - CITY_STYLE.facades.surfaceStep - .1;
    for (const along of [-10, 10]) box(along, face, 4.2, 7, .2, 3.4, "#263f4a");
    box(0, face, ground + 2.8, 3.8, .2, 5.6, "#263f4a");

    // Two uncovered dispensers with clear, road-parallel lanes on both sides.
    for (const pump of station.pumpPositions) {
      const along = ns ? pump.z - position.z : pump.x - position.x;
      const inward = (ns ? pump.x - position.x : pump.z - position.z) * roadSide;
      // Compact, drive-over plinth; only the dispenser body blocks the car.
      box(along, inward, ground + .25, 4, 3, .5, "#b2b9b3");
      box(along, inward, ground + 1.2, 2.6, 2.1, 1.4, "#246784");
      box(along, inward, ground + 3.15, 3, 2.5, 2.5, "#e3e9df", true);
      box(along, inward, ground + 4.55, 3.2, 2.7, .3, "#249b78");
      for (const side of [-1, 1]) {
        const display = inward + side * (1.25 + CITY_STYLE.facades.surfaceStep + .08);
        box(along, display, ground + 3.45, 2, .16, .9, "#142d35");
        box(along, display + side * (.08 + CITY_STYLE.facades.surfaceStep + .04), ground + 3.5,
          1.25, .08, .2, "#8be2a7");
      }
      // A blocky loop and nozzle read as a hose without curves, textures, or animation.
      box(along + 2.05, inward, ground + 3.65, 1.2, .28, .28, "#24323b");
      // Meet the horizontal pieces edge-to-edge; overlapping boxes would leave
      // coplanar front/back faces at both corners of this small loop.
      box(along + 2.5, inward, ground + 2.315, .28, .28, 2.39, "#24323b");
      box(along + 2, inward, ground + .98, 1.3, .28, .28, "#24323b");
      box(along + 1.55, inward, ground + 1.65, .35, .42, 1.2, "#24323b");
    }
    meshes.push(details.mesh(this.scene, `gas-details-${index}`, this.materials.city, position.x, position.z));

    // Roadside, beside the apron rather than in either entrance or behind the kiosk.
    const sign = point(layout.signAlongOffset, layout.signSetback);
    meshes.push(...addServiceBillboard(this.scene, `gas-${index}`, sign.x, sign.z,
      "GAS", this.materials.gasBase, this.materials.gasSign, this.materials.gasLettering, roadAxis));
    colliders.push({ x: sign.x, z: sign.z, halfX: .75, halfZ: .75 });

    return meshes;
  }

  private createDealerships(
    xs: number[], zs: number[], roads: RoadDefinition[], reserved: BoxCollider[],
    meshes: Mesh[], colliders: BoxCollider[],
  ): Dealership[] {
    const config = GAME_CONFIG.dealership;
    const candidates: Dealership[] = [];
    const offset = this.config.roadWidth / 2 + this.config.sidewalkWidth + config.lotDepth / 2;
    for (const road of roads) {
      const across = road.axis === "northSouth" ? xs : zs;
      const along = road.axis === "northSouth" ? zs : xs;
      if (road.type !== "city" || !road.allowsMissionStops || road.index === 0 || road.index === across.length - 1) continue;
      for (let segment = 1; segment < along.length - 2; segment++) for (const fraction of [.3, .7]) {
        for (const side of [-1, 1] as const) {
          const center = along[segment] + (along[segment + 1] - along[segment]) * fraction;
          const position = new Vector3(road.axis === "northSouth" ? road.center + side * offset : center, .1,
            road.axis === "northSouth" ? center : road.center + side * offset);
          const serviceArea = { x: position.x, z: position.z,
            halfX: (road.axis === "northSouth" ? config.lotDepth : config.lotWidth) / 2,
            halfZ: (road.axis === "northSouth" ? config.lotWidth : config.lotDepth) / 2 };
          const clearance = this.config.servicePlacement.buildingClearance + this.config.sidewalkWidth;
          if (reserved.some(area => Math.abs(area.x - position.x) < area.halfX + serviceArea.halfX + clearance
            && Math.abs(area.z - position.z) < area.halfZ + serviceArea.halfZ + clearance)) continue;
          candidates.push({ position, serviceArea, roadAxis: road.axis, roadSide: side });
        }
      }
    }
    // A central first dealership is easy to discover. Subsequent sites fill the largest gaps.
    candidates.sort((a, b) => a.position.lengthSquared() - b.position.lengthSquared());
    const selected: Dealership[] = [];
    while (selected.length < config.count && candidates.length) {
      let best = 0, bestDistance = -1;
      if (selected.length) {
        for (let index = 0; index < candidates.length; index++) {
          const distance = Math.min(...selected.map(other => Vector3.DistanceSquared(other.position, candidates[index].position)));
          if (distance > bestDistance) { bestDistance = distance; best = index; }
        }
        if (bestDistance < config.minimumSpacing ** 2) break;
      }
      selected.push(candidates.splice(best, 1)[0]);
    }
    for (const [index, dealer] of selected.entries()) {
      const ns = dealer.roadAxis === "northSouth", side = dealer.roadSide;
      const point = (u: number, v: number) => ({
        x: dealer.position.x + (ns ? v * side : u),
        z: dealer.position.z + (ns ? u : v * side),
      });
      const box = (name: string, u: number, v: number, y: number, width: number, depth: number, height: number,
        material: StandardMaterial, solid = false) => {
        const p = point(u, v);
        const mesh = MeshBuilder.CreateBox(`dealership-${name}-${index}`, {
          width: ns ? depth : width, depth: ns ? width : depth, height,
        }, this.scene);
        mesh.position.set(p.x, y, p.z); mesh.material = material; meshes.push(mesh);
        if (solid) colliders.push({ x: p.x, z: p.z, halfX: (ns ? depth : width) / 2, halfZ: (ns ? width : depth) / 2 });
        return mesh;
      };
      box("forecourt", 0, 0, WORLD_SURFACES.service / 2, config.lotWidth, config.lotDepth, WORLD_SURFACES.service, this.materials.dealerBase);
      const entranceDepth = this.config.sidewalkWidth * 2 + 1;
      box("entrance", 0, -config.lotDepth / 2 - entranceDepth / 2, WORLD_SURFACES.service / 2,
        config.lotWidth, entranceDepth, WORLD_SURFACES.service, this.materials.road);
      const building = box("showroom", 0, config.lotDepth / 2 - 7, 2.75, config.lotWidth - 4, 12, 5.5, this.materials.clinicBase, true);
      const fascia = box("fascia", 0, config.lotDepth / 2 - 7, 7, config.lotWidth - 3, 13, 3, this.materials.dealerBase);
      for (const u of [-16, -6, 6, 16]) box(`window-${u}`, u, config.lotDepth / 2 - 13 - GAME_CONFIG.presentation.serviceSigns.surfaceGap - .125, 3,
        8, .25, 4, this.materials.repairGarage);
      meshes.push(...addServiceFascia(this.scene, `dealership-lettering-${index}`, building.position.x, 7,
        fascia.position.z, ns ? 13 : config.lotWidth - 3, ns ? config.lotWidth - 3 : 13,
        26, 2.8, this.materials.dealerLettering));
      for (const [slot, vehicleId] of ["used-compact", "performance-coupe"].entries()) {
        const appearance = getVehicleDefinition(vehicleId)!.appearance;
        const car = createLowPolyVehicleMesh(this.scene, `dealer-display-${index}-${slot}`, this.materials.displayCar,
          { ...appearance, bodyColor: Color3.FromHexString(appearance.bodyColor) });
        const p = point((slot ? 1 : -1) * (config.lotWidth / 2 - 12), -8);
        car.position.set(p.x, 1.05, p.z);
        car.rotation.y = ns ? -side * Math.PI / 2 : side > 0 ? Math.PI : 0;
        meshes.push(car);
        colliders.push({ x: p.x, z: p.z, halfX: (ns ? appearance.bodyLength : appearance.bodyWidth) / 2,
          halfZ: (ns ? appearance.bodyWidth : appearance.bodyLength) / 2 });
      }
    }
    return selected;
  }

  private createAutoBodyShops(
    locations: ServiceLocation[],
    meshes: Mesh[],
    colliders: BoxCollider[],
  ): AutoBodyShop[] {
    return locations.map(({ position, inwardX, inwardZ }, index) => {
      meshes.push(...this.createAutoBodyShopMeshes(position, index, colliders, inwardX, inwardZ));
      return { position, bayDirection: inwardZ, serviceArea: {
        x: position.x, z: position.z + inwardZ * (21 - GAME_CONFIG.repair.forecourtFrontDepth) / 2,
        halfX: GAME_CONFIG.repair.forecourtHalfWidth, halfZ: (21 + GAME_CONFIG.repair.forecourtFrontDepth) / 2,
      } };
    });
  }

  private createAutoBodyShopMeshes(
    position: Vector3,
    index: number,
    colliders: BoxCollider[],
    inwardX: -1 | 1,
    inwardZ: -1 | 1,
  ): Mesh[] {
    const meshes: Mesh[] = [];
    const frontDepth = GAME_CONFIG.repair.forecourtFrontDepth;
    const pad = MeshBuilder.CreateBox(`repair-pad-${index}`, {
      width: GAME_CONFIG.repair.forecourtHalfWidth * 2, height: WORLD_SURFACES.service, depth: frontDepth + 21,
    }, this.scene);
    pad.position.set(position.x, WORLD_SURFACES.service / 2, position.z + inwardZ * (21 - frontDepth) / 2);
    pad.material = this.materials.repairBase;
    meshes.push(pad);

    // The bay is hollow in both its geometry and its 2D collision footprint.
    const box = (name: string, x: number, y: number, z: number, width: number, height: number, depth: number, solid = true) => {
      const wall = MeshBuilder.CreateBox(`repair-${name}-${index}`, { width, height, depth }, this.scene);
      wall.position.set(x, y, z); wall.material = this.materials.repairGarage; meshes.push(wall);
      if (solid) colliders.push({ x, z, halfX: width / 2, halfZ: depth / 2 });
    };
    const garageZ = position.z + inwardZ * 11;
    for (const side of [-1, 1]) box(`side-${side}`, position.x + side * 13.25, 4.3, garageZ, 1.5, 8.6, 16);
    box("back", position.x, 4.3, position.z + inwardZ * 18.25, 25, 8.6, 1.5);
    box("roof", position.x, 9.3, garageZ, 28, 1.4, 16, false);
    box("header", position.x, 7.6, position.z + inwardZ * 3.75, 25, 2, 1.5, false);
    meshes.push(...addServiceFascia(this.scene, `repair-lettering-${index}`, position.x,
      8.2, garageZ, 28, 16, GAME_CONFIG.presentation.serviceSigns.repairWidth,
      GAME_CONFIG.presentation.serviceSigns.repairHeight, this.materials.repairLettering));

    meshes.push(...addServiceBillboard(this.scene, `repair-${index}`, position.x + inwardX * 22, position.z,
      "REPAIR", this.materials.gasBase, this.materials.repairSign, this.materials.repairLettering));
    colliders.push({ x: position.x + inwardX * 22, z: position.z, halfX: .75, halfZ: .75 });

    return meshes;
  }

  private optimizeStaticMeshes(meshes: Mesh[], minX: number, minZ: number): Mesh[] {
    const chunkSize = (this.config.blockSize + this.config.roadWidth) * 2;
    const groups = new Map<string, Mesh[]>();
    for (const mesh of meshes) {
      const chunkX = Math.floor((mesh.position.x - minX) / chunkSize);
      const chunkZ = Math.floor((mesh.position.z - minZ) / chunkSize);
      const materialId = mesh.material?.uniqueId ?? -1;
      const key = `${chunkX},${chunkZ},${materialId}`;
      const group = groups.get(key);
      if (group) group.push(mesh);
      else groups.set(key, [mesh]);
    }

    const optimized: Mesh[] = [];
    for (const [key, group] of groups) {
      if (group.length === 1) {
        optimized.push(group[0]);
        continue;
      }
      const merged = Mesh.MergeMeshes(group, true, true, undefined, false, false);
      if (merged) {
        merged.name = `world-chunk-${key}`;
        optimized.push(merged);
      } else {
        optimized.push(...group);
      }
    }

    for (const material of Object.values(this.materials)) material.freeze();
    for (const mesh of optimized) {
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
    }
    return optimized;
  }
}
