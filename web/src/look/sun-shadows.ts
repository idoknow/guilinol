import * as THREE from 'three'
import {env} from './time'
import type {Options,Tier} from './gfx-state'

const blockerFilter=`
  if(uGfxPCSS){
    float blockers=0.0,count=0.0;
    for(int i=0;i<8;i++){
      float angle=float(i)*2.399963;
      vec2 offset=vec2(cos(angle),sin(angle))*sqrt(float(i)+0.5)*shadowRadius/shadowMapSize;
      float depth=unpackRGBAToDepth(texture2D(shadowMap,shadowCoord.xy+offset));
      if(depth<shadowCoord.z){blockers+=depth;count+=1.0;}
    }
    if(count==0.0)return 1.0;
    float radius=clamp((shadowCoord.z-blockers/count)*160.0*shadowRadius,1.0,12.0);
    float coverage=0.0;
    for(int i=0;i<12;i++){
      float angle=float(i)*2.399963;
      vec2 delta=vec2(cos(angle),sin(angle))*sqrt((float(i)+0.5)/12.0)*radius/shadowMapSize;
      coverage+=texture2DCompare(shadowMap,shadowCoord.xy+delta,shadowCoord.z);
    }
    return mix(1.0,coverage/12.0,uShadowStrength);
  }`
export function sunShadows(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera,light:THREE.DirectionalLight){
  const shadow=light.shadow,anchor=light.target
  scene.add(anchor);renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false
  Object.assign(shadow.camera,{left:-100,right:100,top:100,bottom:-100,near:1,far:480});shadow.camera.updateProjectionMatrix()
  shadow.normalBias=.18;shadow.bias=-.00035
  const high={value:false},strength={value:0.5},patched=new WeakSet<THREE.Material>()
  let frames=Infinity,extent=0,casters=0
  return (tier:Tier,settings:Options['shadow'],focus:THREE.Vector3)=>{
    const active=tier!=='low'&&settings.enabled&&env.sunDir.y>0&&env.night<.99
    light.castShadow=renderer.shadowMap.enabled=active
    if(!active){frames=Infinity;return 0}
    high.value=tier==='high';strength.value=shadow.intensity=settings.strength;shadow.radius=settings.softness
    if(shadow.mapSize.x!==settings.mapSize){shadow.map?.dispose();shadow.map=null;shadow.mapSize.setScalar(settings.mapSize)}
    if(++frames<(tier==='high'?1:settings.updateEvery)&&anchor.position.distanceTo(focus)<settings.moveThreshold&&extent===settings.distance&&shadow.map)return casters
    frames=0;renderer.shadowMap.needsUpdate=true
    extent=settings.distance;anchor.position.copy(focus);light.position.copy(anchor.position).addScaledVector(env.sunDir,extent)
    Object.assign(shadow.camera,{left:-extent/2,right:extent/2,top:extent/2,bottom:-extent/2,far:extent*2});shadow.camera.updateProjectionMatrix()
    light.updateWorldMatrix(true,false);anchor.updateWorldMatrix(true,false);shadow.updateMatrices(light)
    const frustum=shadow.getFrustum()
    casters=0;scene.traverseVisible(object=>{
      const mesh=object as THREE.Mesh
      if(!mesh.isMesh)return
      const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material]
      if(!materials.some(mat=>!mat.transparent && ('isMeshStandardMaterial' in mat||'isMeshPhongMaterial' in mat||'isMeshLambertMaterial' in mat||'isMeshToonMaterial' in mat)))return
      mesh.receiveShadow=true
      mesh.castShadow=camera.layers.test(mesh.layers)&&frustum.intersectsObject(mesh)&&mesh.geometry.drawRange.count>0
      if(mesh.castShadow)casters++
      for(const material of materials){
        if(patched.has(material))continue
        patched.add(material);const previous=material.onBeforeCompile,key=material.customProgramCacheKey()
        material.customProgramCacheKey=()=>`${key}-gfx-shadow`
        material.onBeforeCompile=function(shader,context){previous.call(this,shader,context);shader.uniforms.uGfxPCSS=high;shader.uniforms.uShadowStrength=strength
          shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmap_pars_fragment>',()=>`uniform bool uGfxPCSS; uniform float uShadowStrength;\n${THREE.ShaderChunk.shadowmap_pars_fragment.replace('if ( frustumTest ) {',`if ( frustumTest ) {${blockerFilter}`)}`)}
        material.needsUpdate=true
      }
    })
    return casters
  }
}
