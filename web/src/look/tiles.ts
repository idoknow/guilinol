import * as THREE from 'three'
import {shareAtmosphere} from './atmosphere'

export const tileConfig={enabled:true,radius:400,metres:{wall:4,roof:4,road:6,sidewalk:2,bank:3}}
type Channel=keyof typeof tileConfig.metres
const textures=Object.fromEntries(Object.keys(tileConfig.metres).map(key=>[key,{value:null}])) as Record<Channel,{value:THREE.Texture|null}>
const ready={value:false}
let ktx2Promise:Promise<import('three/addons/loaders/KTX2Loader.js').KTX2Loader>|null=null
export function sharedKtx2Loader(renderer:THREE.WebGLRenderer){
  return ktx2Promise??=import('three/addons/loaders/KTX2Loader.js').then(({KTX2Loader})=>new KTX2Loader().setTranscoderPath('./basis/').setWorkerLimit(2).detectSupport(renderer))
}
export async function loadTiles(renderer:THREE.WebGLRenderer){
  if(!tileConfig.enabled)return
  const loader=await sharedKtx2Loader(renderer)
  await Promise.all((Object.keys(textures) as Channel[]).map(async key=>{
    const map=await loader.loadAsync(`./textures/${key}.ktx2`);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=THREE.SRGBColorSpace;textures[key].value=map
  }));ready.value=true
}

export function tileMaterial(material:THREE.Material,building:boolean){
  const previous=material.onBeforeCompile,cache=material.customProgramCacheKey()
  const channels:Channel[]=building?['wall','roof']:['road','sidewalk','bank']
  material.customProgramCacheKey=()=>cache+'-tiles'
  material.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer);shader.uniforms.tilesReady=ready
    for(const key of channels)shader.uniforms['tile_'+key]=textures[key]
    if(!building)shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aSurface; attribute float aAlong; varying float vSurface; varying float vAlong;').replace('#include <begin_vertex>','#include <begin_vertex>\nvSurface=aSurface; vAlong=aAlong;')
    const sample=(key:Channel,uv:string)=>`texture2D(tile_${key},(${uv})/${tileConfig.metres[key].toFixed(2)}).rgb`
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nuniform bool tilesReady;${building?'':'varying float vSurface; varying float vAlong;'}${channels.map(key=>`uniform sampler2D tile_${key};`).join('')}`)
      .replace('#include <roughnessmap_fragment>',`#ifdef USE_FOG\n${building?'':`if(vSurface>7.5){float k=abs(fract(vAlong/.6)-.5);diffuseColor.rgb*=mix(.74,1.,smoothstep(.15,.23,k));}`}if(tilesReady && distance(vFogWorld,cameraPosition)<${tileConfig.radius.toFixed(1)}){${building?
        `diffuseColor.rgb*=vRoof<.5?${sample('wall','vec2(vFacade,vFloor*3.1)')}:${sample('roof','vFogWorld.xz')};`:
        `if(vSurface<.5)diffuseColor.rgb*=${sample('road','vFogWorld.xz')};else if(vSurface<1.5)diffuseColor.rgb*=${sample('sidewalk','vFogWorld.xz')};else if(vSurface>6.5){}else if(vSurface>5.5){float dots=length(fract(vFogWorld.xz*12.)-.5);float detail=1.-smoothstep(.02,.08,fwidth(vFogWorld.x)+fwidth(vFogWorld.z));diffuseColor.rgb*=mix(.92,1.12,(1.-smoothstep(.14,.32,dots))*detail);}else if(vSurface>2.5)diffuseColor.rgb*=${sample('bank','vec2(vAlong,vFogWorld.y)')};`}}\n#endif\n#include <roughnessmap_fragment>`)
  }
}

export function wireFenceMaterial(material:THREE.Material){
  const previous=material.onBeforeCompile,cache=material.customProgramCacheKey()
  material.customProgramCacheKey=()=>cache+'-wire-fence'
  material.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer)
    shareAtmosphere(shader)
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nattribute float aAlong; varying float vAlong;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvAlong=aAlong;')
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nvarying float vAlong;')
      .replace('#include <roughnessmap_fragment>',`#ifdef USE_FOG
vec2 wire=abs(fract(vec2(vAlong*8.+vFogWorld.y*8.,vAlong*8.-vFogWorld.y*8.))-.5);
if(min(wire.x,wire.y)>.085)discard;
#endif
#include <roughnessmap_fragment>`)
  }
}
