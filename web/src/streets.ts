import * as THREE from 'three'
import {nightStreets} from './look/night'
import {tileMaterial,wireFenceMaterial} from './look/tiles'
import {look} from './look/config'

export function bindStreetSurface(geometry:THREE.BufferGeometry,role:string,color?:string){
  const kind=({road:0,sidewalk:1,plaza:1,curb:1,marking:2} as Record<string,number>)[role]
  if(kind===undefined)throw Error(`Unknown street surface: ${role}`)
  if(!geometry.hasAttribute('normal'))geometry.computeVertexNormals()
  const count=geometry.getAttribute('position').count,colors=new Float32Array(count*3)
  const tone=new THREE.Color(color??look.streets.surfaces[kind]);for(let i=0;i<count;i++)tone.toArray(colors,i*3)
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3))
  geometry.setAttribute('aSurface',new THREE.Uint8BufferAttribute(new Uint8Array(count).fill(kind),1))
  geometry.setAttribute('aAlong',new THREE.Float32BufferAttribute(new Float32Array(count),1))
}

export const streetSurfaceMat=new THREE.MeshStandardMaterial({
  vertexColors:true,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4,
})
export const streetFenceMat=new THREE.MeshStandardMaterial({
  vertexColors:true,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4,
})
export const streetFurnitureGeo=new THREE.BoxGeometry()
export const streetFurnitureMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8})
nightStreets(streetSurfaceMat,streetFurnitureMat)

const compileFurniture=streetFurnitureMat.onBeforeCompile
let sloganTexture:THREE.CanvasTexture|undefined
streetFurnitureMat.onBeforeCompile=function(shader,renderer){
  compileFurniture.call(this,shader,renderer)
  if(!sloganTexture){
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=160
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='black';ctx.fillRect(0,0,256,160)
    ctx.font='bold 37px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='white';ctx.fillText('文明  公正法治',128,40,246)
    ctx.fillText('注意火车',128,120,246)
    sloganTexture=new THREE.CanvasTexture(canvas)
  }
  shader.uniforms.uSlogan={value:sloganTexture}
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSlogan;').replace('#include <begin_vertex>',`#include <begin_vertex>
    vSlogan=vec3(uv,0.);
    #ifdef USE_INSTANCING
    vSlogan.z=step(abs(length(instanceMatrix[0].xyz)-1.35),.001)*step(abs(length(instanceMatrix[1].xyz)-.42),.001)*abs(normal.z);
    vSlogan.z+=2.*step(abs(length(instanceMatrix[0].xyz)-.08),.001)*step(abs(length(instanceMatrix[1].xyz)-.55),.001)*abs(normal.x);
    #endif`)
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vSlogan; uniform sampler2D uSlogan;').replace('#include <color_fragment>',`#include <color_fragment>
    if(vSlogan.z>.5){bool warning=vSlogan.z>1.5;vec2 uv=vec2(vSlogan.x,vSlogan.y*.5+(warning?0.:.5));diffuseColor.rgb=mix(diffuseColor.rgb,warning?vec3(.02):vec3(.93),texture2D(uSlogan,uv).r);}`)
}
streetFurnitureMat.customProgramCacheKey=()=>'street-furniture-night-slogan'

tileMaterial(streetSurfaceMat,false)
wireFenceMaterial(streetFenceMat)
