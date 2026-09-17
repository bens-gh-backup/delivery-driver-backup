import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { BoxCollider } from "../game/types";
import { GAME_CONFIG } from "../game/config";
import type { Point3 } from "../graphics/FacetedMesh";
import { WORLD_SURFACES } from "./SurfaceLayout";

/** One 4 KiB opaque pattern for the whole city: clean plank seams and two rails. */
export function createFenceMaterial(scene: Scene): StandardMaterial {
  const width=16,height=64,data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const seam=x%8===0,rail=(y>=15&&y<=18)||(y>=45&&y<=48);
    const value=rail?222:seam?160:x<8?250:238;
    const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  const texture=RawTexture.CreateRGBATexture(data,width,height,scene,true,false,Texture.TRILINEAR_SAMPLINGMODE);
  texture.name="fence-board-pattern";texture.wrapU=Texture.WRAP_ADDRESSMODE;texture.wrapV=Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel=4;
  const material=new StandardMaterial("fence-mat",scene);
  material.diffuseColor=Color3.White();material.specularColor=Color3.Black();material.diffuseTexture=texture;
  return material;
}

/** Five faces per run; lines are part of the face material, never hovering decals. */
export function createFenceMesh(scene: Scene,name:string,runs:readonly BoxCollider[],
  centerX:number,centerZ:number,color:string,material:StandardMaterial):Mesh {
  const positions:number[]=[],indices:number[]=[],uvs:number[]=[],colors:number[]=[],normals:number[]=[];
  const tint=Color3.FromHexString(color),rules=GAME_CONFIG.world.buildings;
  const face=(points:Point3[],repeat:number|null) => {
    const start=positions.length/3;
    for(const p of points){positions.push(...p);colors.push(tint.r,tint.g,tint.b,1);}
    if(repeat===null)uvs.push(.25,.4,.25,.4,.25,.4,.25,.4);
    else uvs.push(0,0,repeat,0,repeat,1,0,1);
    indices.push(start,start+1,start+2,start,start+2,start+3);
  };
  for(const r of runs) {
    const x0=r.x-centerX-r.halfX,x1=r.x-centerX+r.halfX,z0=r.z-centerZ-r.halfZ,z1=r.z-centerZ+r.halfZ;
    const bottom=WORLD_SURFACES.garden,top=bottom+rules.fenceHeight,ns=r.halfX>r.halfZ;
    const repeat=(ns?r.halfX:r.halfZ)/rules.fenceBoardWidth;
    face([[x0,bottom,z0],[x1,bottom,z0],[x1,top,z0],[x0,top,z0]],ns?repeat:null);
    face([[x1,bottom,z1],[x0,bottom,z1],[x0,top,z1],[x1,top,z1]],ns?repeat:null);
    face([[x0,bottom,z1],[x0,bottom,z0],[x0,top,z0],[x0,top,z1]],ns?null:repeat);
    face([[x1,bottom,z0],[x1,bottom,z1],[x1,top,z1],[x1,top,z0]],ns?null:repeat);
    face([[x0,top,z0],[x1,top,z0],[x1,top,z1],[x0,top,z1]],null);
  }
  VertexData.ComputeNormals(positions,indices,normals);
  const data=new VertexData();Object.assign(data,{positions,indices,normals,uvs,colors});
  const mesh=new Mesh(name,scene);data.applyToMesh(mesh);mesh.material=material;
  mesh.position.set(centerX,0,centerZ);return mesh;
}
