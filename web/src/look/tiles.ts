import * as THREE from 'three'
import railwayStyle from '../../../pipeline/railway-style.json'
import {shareAtmosphere} from './atmosphere'
import {cityUpgradeUniforms} from '../city-upgrade/state'
import {groundUpgradeUniforms,sharedGroundDetailTexture} from './urban-ground'

export const tileConfig={enabled:true,radius:400,bump:.35,metres:{wall:4,roof:4,road:3,sidewalk:2,bank:3}}
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
  const stationFinish = building ? '' : `
    if (vSurface > 9.5) {
      vec2 cell = vFogWorld.xz / vec2(${railwayStyle.station.plazaSlabMetres.join(',')});
      cell.x += 0.5 * mod(floor(cell.y), 2.0);
      vec2 edge = min(fract(cell), 1.0 - fract(cell));
      vec2 line = 1.0 - smoothstep(vec2(0.008), vec2(0.008) + max(fwidth(cell), vec2(0.001)), edge);
      diffuseColor.rgb *= 1.0 - 0.21 * max(line.x, line.y);
    } else if(vSurface>8.5){float w=clamp(fwidth(vAlong),.015,.25);float line=1.-smoothstep(.09,.09+w,abs(vAlong-.85));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(${new THREE.Color(railwayStyle.station.platformWarning).toArray().join(',')}),line);}`
  const channels:Channel[]=building?['wall','roof']:['road','sidewalk','bank']
  material.customProgramCacheKey=()=>cache+(building?'-tiles':'-tiles-2')
  const legacyRoadColor = new THREE.Color(0x4a4d50)
  const legacySidewalkColor = new THREE.Color(0x8e8d89)
  const legacyMarkingColor = new THREE.Color(0xf1eee4)
  material.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer);shader.uniforms.tilesReady=ready
    if(!building){
      shader.uniforms.uCityUpgradeEnabled=cityUpgradeUniforms.uCityUpgradeEnabled
      shader.uniforms.uGroundUpgrade=groundUpgradeUniforms.uGroundUpgrade
      shader.uniforms.uStreetMicroTex={value:sharedGroundDetailTexture()}
      shader.uniforms.uLegacyRoad={value:legacyRoadColor}
      shader.uniforms.uLegacySidewalk={value:legacySidewalkColor}
      shader.uniforms.uLegacyMarking={value:legacyMarkingColor}
    }
    for(const key of channels)shader.uniforms['tile_'+key]=textures[key]
    if(!building)shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aSurface; attribute float aAlong; varying float vSurface; varying float vAlong;').replace('#include <begin_vertex>','#include <begin_vertex>\nvSurface=aSurface; vAlong=aAlong;')
    // Tiles are greyscale: keep the sample in gDetail so roughness and bump below can reuse it (IDOK-291).
    const sample=(key:Channel,uv:string)=>`vec3(gDetail=texture2D(tile_${key},(${uv})/${tileConfig.metres[key].toFixed(2)}).r)`
    const roadMacro = building ? '' : `
float spRoadMacro = 0.0;
float stDist = 9999.0;
bool stIsMedianGrass = false;
#ifdef USE_FOG
stDist = distance(vFogWorld, cameraPosition);
stIsMedianGrass = vSurface >= 0.5 && vSurface < 1.5 && (diffuseColor.g > diffuseColor.b * 1.14);
if (uGroundUpgrade < 0.5) {
  if (vSurface < 0.5) diffuseColor.rgb = uLegacyRoad;
  else if (vSurface < 1.5 && !stIsMedianGrass) diffuseColor.rgb = uLegacySidewalk;
  else if (vSurface >= 1.5 && vSurface < 2.5) diffuseColor.rgb = uLegacyMarking;
}
{
  float m1 = sin(vFogWorld.x * 0.055 + vFogWorld.z * 0.041) * cos(vFogWorld.z * 0.062 - vFogWorld.x * 0.037);
  float m2 = sin(vFogWorld.x * 0.19 - vFogWorld.z * 0.23) * cos(vFogWorld.x * 0.14 + vFogWorld.z * 0.17);
  float m3 = sin(vFogWorld.x * 0.017 - vFogWorld.z * 0.021) * cos(vFogWorld.z * 0.019 + vFogWorld.x * 0.013);
  spRoadMacro = m1 * 0.55 + m2 * 0.30 + m3 * 0.15;
  float macroGain = uGroundUpgrade > 0.5 ? 1.0 : step(0.5, uCityUpgradeEnabled);
  if (macroGain > 0.5) {
    if (vSurface < 0.5) {
      // City-wide asphalt patina & subtle tire-wear sheen (IDOK-134 + IDOK-432)
      diffuseColor.rgb *= 1.0 + spRoadMacro * 0.115;
    } else if (vSurface < 1.5) {
      diffuseColor.rgb *= 1.0 + spRoadMacro * (stIsMedianGrass ? 0.10 : 0.075);
    } else if (vSurface < 2.5 && uGroundUpgrade > 0.5) {
      // Subtle traffic scuff weathering on zebra crossings & lane lines
      diffuseColor.rgb *= 0.975 + spRoadMacro * 0.045;
    }
  }
}
#endif`
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nuniform bool tilesReady;${building?'':'uniform float uCityUpgradeEnabled; uniform float uGroundUpgrade; uniform sampler2D uStreetMicroTex; uniform vec3 uLegacyRoad, uLegacySidewalk, uLegacyMarking; varying float vSurface; varying float vAlong;'}${channels.map(key=>`uniform sampler2D tile_${key};`).join('')}`)
      .replace('#include <roughnessmap_fragment>',`float gDetail=1.;\n${roadMacro}\n#ifdef USE_FOG\n${building?'':`${stationFinish}else if(vSurface>7.5){float k=abs(fract(vAlong/.6)-.5);diffuseColor.rgb*=mix(.74,1.,smoothstep(.15,.23,k));}`}if(tilesReady && ${building?'distance(vFogWorld,cameraPosition)':'stDist'}<${tileConfig.radius.toFixed(1)}){${building?
        `if(vRoof>=.5){diffuseColor.rgb*=${sample('roof','vFogWorld.xz')};}else if(vKind<15.5){diffuseColor.rgb*=${sample('wall','vec2(vFacade,vFloor*3.1)')};}`:
        `float stNearFade = 1.0 - smoothstep(140.0, ${tileConfig.radius.toFixed(1)}, stDist);
        if(vSurface<.5){
          float rd = texture2D(tile_road, vFogWorld.xz/${tileConfig.metres.road.toFixed(2)}).r;
          if(uGroundUpgrade > 0.5){
            float micro = texture2D(uStreetMicroTex, vFogWorld.xz/6.8).r;
            // Blend CC0 asphalt grain with mid-scale aggregate variation & smooth distance roll-off
            gDetail = mix(1.0, rd * (0.94 + micro * 0.12), stNearFade);
            // Soften harsh dark trough crush on low-angle asphalt while keeping crisp mineral grit
            diffuseColor.rgb *= mix(0.92, 1.08, clamp((gDetail - 0.78) / 0.24, 0.0, 1.0)) * mix(1.0, rd, 0.45 * stNearFade);
          }else{
            gDetail = rd;
            diffuseColor.rgb *= vec3(rd);
          }
        }else if(vSurface<1.5){
          if(stIsMedianGrass && uGroundUpgrade > 0.5){
            // Road medians/planters (surfaces[4]) get organic turf texture instead of granite paver grid
            float tg = texture2D(uStreetMicroTex, vFogWorld.xz/3.8).g;
            float tg2 = texture2D(uStreetMicroTex, (mat2(0.8,-0.6,0.6,0.8)*vFogWorld.xz)/11.5).g;
            float grassMix = tg * 0.68 + tg2 * 0.32;
            gDetail = mix(1.0, 0.86 + grassMix * 0.24, stNearFade);
            diffuseColor.rgb *= gDetail;
          }else{
            float sw = texture2D(tile_sidewalk, vFogWorld.xz/${tileConfig.metres.sidewalk.toFixed(2)}).r;
            if(uGroundUpgrade > 0.5){
              float swMicro = texture2D(uStreetMicroTex, vFogWorld.xz/9.4).r;
              gDetail = mix(1.0, sw * (0.95 + swMicro * 0.10), stNearFade);
              diffuseColor.rgb *= gDetail;
            }else{
              gDetail = sw;
              diffuseColor.rgb *= vec3(sw);
            }
          }
        }else if(vSurface<2.5){
          if(uGroundUpgrade > 0.5){
            // Subtle asphalt aggregate bleed-through on painted markings & crosswalks
            float mk = texture2D(tile_road, vFogWorld.xz/${tileConfig.metres.road.toFixed(2)}).r;
            gDetail = mix(1.0, 0.90 + mk * 0.10, stNearFade);
            diffuseColor.rgb *= gDetail;
          }
        }else if(vSurface>9.5)diffuseColor.rgb*=mix(vec3(1.),${sample('sidewalk','vFogWorld.xz')},.3);else if(vSurface>6.5){}else if(vSurface>5.5){float dots=length(fract(vFogWorld.xz*12.)-.5);float detail=1.-smoothstep(.02,.08,fwidth(vFogWorld.x)+fwidth(vFogWorld.z));diffuseColor.rgb*=mix(.92,1.12,(1.-smoothstep(.14,.32,dots))*detail);}else if(vSurface>2.5)diffuseColor.rgb*=${sample('bank','vec2(vAlong,vFogWorld.y)')};`}}\n#endif\n#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+(1.-gDetail)*${building?'(vKind<15.5?1.2:0.0)':'2.1'}${building?'':'-spRoadMacro*0.14-(uGroundUpgrade>0.5&&vSurface<.5?0.10:0.0)'},0.32,1.);`)
      .replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>\n${building?'':`if(gDetail<.999){vec3 dpx=dFdx(-vViewPosition),dpy=dFdy(-vViewPosition);float h=gDetail*${tileConfig.bump.toFixed(3)},hx=dFdx(h),hy=dFdy(h);vec3 r1=cross(dpy,normal),r2=cross(normal,dpx);float det=dot(dpx,r1);if(abs(det)>1e-7)normal=normalize(abs(det)*normal-sign(det)*(hx*r1+hy*r2));}`}`)
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
