import * as THREE from 'three'
import {nightStreets} from './look/night'
import {tileMaterial} from './look/tiles'

export const streetSurfaceMat=new THREE.MeshStandardMaterial({
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
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=80
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='black';ctx.fillRect(0,0,256,80)
    ctx.font='bold 37px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='white';ctx.fillText('文明  公正法治',128,40,246)
    sloganTexture=new THREE.CanvasTexture(canvas)
  }
  shader.uniforms.uSlogan={value:sloganTexture}
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSlogan;').replace('#include <begin_vertex>',`#include <begin_vertex>
    vSlogan=vec3(uv,0.);
    #ifdef USE_INSTANCING
    vSlogan.z=step(abs(length(instanceMatrix[0].xyz)-1.35),.001)*step(abs(length(instanceMatrix[1].xyz)-.42),.001)*abs(normal.z);
    #endif`)
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vSlogan; uniform sampler2D uSlogan;').replace('#include <color_fragment>',`#include <color_fragment>
    if(vSlogan.z>.5)diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.93),texture2D(uSlogan,vSlogan.xy).r);`)
}
streetFurnitureMat.customProgramCacheKey=()=>'street-furniture-night-slogan'

tileMaterial(streetSurfaceMat,false)
