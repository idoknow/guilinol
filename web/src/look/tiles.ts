import * as THREE from 'three'

export const tileConfig={enabled:true,radius:400,metres:{wall:4,roof:4,road:6,sidewalk:2,bank:3}}
type Channel=keyof typeof tileConfig.metres
const textures=Object.fromEntries(Object.keys(tileConfig.metres).map(key=>[key,{value:null}])) as Record<Channel,{value:THREE.Texture|null}>
const ready={value:false}
export async function loadTiles(renderer:THREE.WebGLRenderer){
  if(!tileConfig.enabled)return
  const {KTX2Loader}=await import('three/addons/loaders/KTX2Loader.js')
  const loader=new KTX2Loader().setTranscoderPath('./basis/').detectSupport(renderer)
  try{await Promise.all((Object.keys(textures) as Channel[]).map(async key=>{
    const map=await loader.loadAsync(`./textures/${key}.ktx2`);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=THREE.SRGBColorSpace;textures[key].value=map
  }));ready.value=true}finally{loader.dispose()}
}

export function tileMaterial(material:THREE.Material,building:boolean){
  const previous=material.onBeforeCompile,cache=material.customProgramCacheKey()
  const channels:Channel[]=building?['wall','roof']:['road','sidewalk','bank']
  material.customProgramCacheKey=()=>cache+'-tiles'
  material.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer);shader.uniforms.tilesReady=ready
    for(const key of channels)shader.uniforms['tile_'+key]=textures[key]
    if(!building)shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aSurface; varying float vSurface;').replace('#include <begin_vertex>','#include <begin_vertex>\nvSurface=aSurface;')
    const sample=(key:Channel,uv:string)=>`texture2D(tile_${key},(${uv})/${tileConfig.metres[key].toFixed(2)}).rgb`
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nuniform bool tilesReady;${building?'':'varying float vSurface;'}${channels.map(key=>`uniform sampler2D tile_${key};`).join('')}`)
      .replace('#include <roughnessmap_fragment>',`#ifdef USE_FOG\nif(tilesReady && distance(vFogWorld,cameraPosition)<${tileConfig.radius.toFixed(1)}){${building?
        `diffuseColor.rgb*=vRoof<.5?${sample('wall','vec2(vFacade,vFloor*3.1)')}:${sample('roof','vFogWorld.xz')};`:
        `if(vSurface<.5)diffuseColor.rgb*=${sample('road','vFogWorld.xz')};else if(vSurface<1.5)diffuseColor.rgb*=${sample('sidewalk','vFogWorld.xz')};else if(vSurface>2.5)diffuseColor.rgb*=${sample('bank','vec2(vFogWorld.x+vFogWorld.z,vFogWorld.y)')};`}}\n#endif\n#include <roughnessmap_fragment>`)
  }
}
