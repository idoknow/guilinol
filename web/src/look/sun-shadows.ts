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
  const shadow=light.shadow,anchor=light.target,point=new THREE.Vector3(),sphere=new THREE.Sphere()
  scene.add(anchor);renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false
  Object.assign(shadow.camera,{left:-100,right:100,top:100,bottom:-100,near:1,far:480});shadow.camera.updateProjectionMatrix()
  shadow.normalBias=.08;shadow.bias=-.0002
  const high={value:false},strength={value:0.5},patched=new WeakSet<THREE.Material>()
  let scanned=-Infinity
  return (tier:Tier,settings:Options['shadow'])=>{
    const active=tier!=='low'&&settings.enabled&&env.sunDir.y>0&&env.night<.99
    light.castShadow=renderer.shadowMap.enabled=active
    anchor.position.copy(camera.position);light.position.copy(anchor.position).addScaledVector(env.sunDir,240)
    if(!active){scanned=-Infinity;return}
    renderer.shadowMap.needsUpdate=true
    high.value=tier==='high';strength.value=shadow.intensity=settings.strength;shadow.radius=settings.softness
    if(shadow.mapSize.x!==settings.mapSize){shadow.map?.dispose();shadow.map=null;shadow.mapSize.setScalar(settings.mapSize)}
    if(performance.now()-scanned<300)return
    scanned=performance.now();scene.traverseVisible(object=>{
      const mesh=object as THREE.Mesh
      if(!mesh.isMesh)return
      const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material]
      if(!materials.some(mat=>!mat.transparent && ('isMeshStandardMaterial' in mat||'isMeshPhongMaterial' in mat||'isMeshLambertMaterial' in mat||'isMeshToonMaterial' in mat)))return
      mesh.receiveShadow=true
      const instanced=mesh as THREE.InstancedMesh
      if(instanced.isInstancedMesh&&!instanced.boundingSphere)instanced.computeBoundingSphere()
      if(!mesh.geometry.boundingSphere)mesh.geometry.computeBoundingSphere()
      sphere.copy(instanced.boundingSphere??mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld)
      mesh.castShadow=point.copy(sphere.center).distanceTo(camera.position)<sphere.radius+160
      for(const material of materials){
        if(patched.has(material))continue
        patched.add(material);const previous=material.onBeforeCompile,key=material.customProgramCacheKey()
        material.customProgramCacheKey=()=>`${key}-gfx-shadow`
        material.onBeforeCompile=function(shader,context){previous.call(this,shader,context);shader.uniforms.uGfxPCSS=high;shader.uniforms.uShadowStrength=strength
          shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmap_pars_fragment>',()=>`uniform bool uGfxPCSS; uniform float uShadowStrength;\n${THREE.ShaderChunk.shadowmap_pars_fragment.replace('if ( frustumTest ) {',`if ( frustumTest ) {${blockerFilter}`)}`)}
        material.needsUpdate=true
      }
    })
  }
}
