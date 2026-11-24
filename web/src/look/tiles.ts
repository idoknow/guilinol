import * as THREE from 'three'
import railStyle from '../../../pipeline/railway-style.json'

// One sleeper interval across the full ballast bed. Hardware mip levels
// integrate the narrow rail heads and ties as their screen footprint shrinks.
function trackTexture(){
  const width=128,height=32,pixels=new Uint8Array(width*height*4)
  const colors=[railStyle.ballast,railStyle.sleeper,railStyle.steel].map(s=>parseInt(s.slice(1),16))
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const across=Math.abs(((x+.5)/width*2-1)*railStyle.ballastHalfWidth)
    const rail=across>=railStyle.gauge/2 && across<=railStyle.gauge/2+railStyle.headWidth
    const tie=across<1.275 && Math.min(y+.5,height-y-.5)/height*railStyle.sleeperSpacing<.11
    const color=colors[rail?2:tie?1:0]
    pixels.set([color>>16,(color>>8)&255,color&255,255],4*(y*width+x))
  }
  const map=new THREE.DataTexture(pixels,width,height)
  map.wrapT=THREE.RepeatWrapping;map.colorSpace=THREE.SRGBColorSpace
  map.generateMipmaps=true;map.minFilter=THREE.LinearMipmapLinearFilter;map.magFilter=THREE.LinearFilter
  map.needsUpdate=true
  return map
}
const railTexture=trackTexture()

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
    if(!building)shader.uniforms.railTexture={value:railTexture}
    for(const key of channels)shader.uniforms['tile_'+key]=textures[key]
    if(!building)shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aSurface; attribute float aAlong; varying float vSurface; varying float vAlong;').replace('#include <begin_vertex>','#include <begin_vertex>\nvSurface=aSurface; vAlong=aAlong;')
    const sample=(key:Channel,uv:string)=>`texture2D(tile_${key},(${uv})/${tileConfig.metres[key].toFixed(2)}).rgb`
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nuniform bool tilesReady;${building?'' :'uniform sampler2D railTexture; varying float vSurface; varying float vAlong;'}${channels.map(key=>`uniform sampler2D tile_${key};`).join('')}`)
      .replace('#include <roughnessmap_fragment>',`#ifdef USE_FOG\n${building?'':`float railDistance=distance(vFogWorld,cameraPosition);
if(vSurface>=12.){
  vec3 bed=texture2D(railTexture,vec2((vSurface-12.)/232.,vAlong/${railStyle.sleeperSpacing})).rgb;
  diffuseColor.rgb=mix(diffuseColor.rgb,bed,smoothstep(52.,60.,railDistance));
}else if(vSurface==10. && railDistance>60.)discard;
else if(vSurface==9.){
  vec2 grid=vec2(vAlong+vFogWorld.y,vAlong-vFogWorld.y)*8.;
  vec2 wire=abs(fract(grid)-.5);
  if(max(fwidth(grid.x),fwidth(grid.y))>.7 || min(wire.x,wire.y)>.085)discard;
}`}if(tilesReady && distance(vFogWorld,cameraPosition)<${tileConfig.radius.toFixed(1)}){${building?
        `diffuseColor.rgb*=vRoof<.5?${sample('wall','vec2(vFacade,vFloor*3.1)')}:${sample('roof','vFogWorld.xz')};`:
        `if(vSurface<.5)diffuseColor.rgb*=${sample('road','vFogWorld.xz')};else if(vSurface<1.5)diffuseColor.rgb*=${sample('sidewalk','vFogWorld.xz')};else if(vSurface>6.5){}else if(vSurface>5.5){float dots=length(fract(vFogWorld.xz*12.)-.5);float detail=1.-smoothstep(.02,.08,fwidth(vFogWorld.x)+fwidth(vFogWorld.z));diffuseColor.rgb*=mix(.92,1.12,(1.-smoothstep(.14,.32,dots))*detail);}else if(vSurface>2.5)diffuseColor.rgb*=${sample('bank','vec2(vAlong,vFogWorld.y)')};`}}\n#endif\n#include <roughnessmap_fragment>`)
  }
}
