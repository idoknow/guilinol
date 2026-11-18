import * as THREE from 'three'
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {shareAtmosphere} from './atmosphere'
import {look} from './config'
import {treeGeometry} from './trees'
import type {LandmarkEntry, LandmarkTreeSpec} from '../world'

const NIGHT_GLOW:Record<string,[number,number]> = {
  sunGlow:[0xffbe55,1.65], bronzeBody:[0xd98c2b,0.36], goldBronze:[0xd98c2b,0.36], roofBronze:[0xd98c2b,0.36], bronzeDark:[0xd98c2b,0.36],
  lotusStone:[0xe88a38,0.25], lotusShadow:[0xe88a38,0.25], moonGlow:[0xdcebf8,1.45],
  whiteWall:[0x9ec0dc,0.22], vermilion:[0x9ec0dc,0.22], eaveTeal:[0x9ec0dc,0.22], spireSilver:[0x9ec0dc,0.22],
}

function landmarkMaterial(metalness:number, roughness:number, key:string) {
  const mat = new THREE.MeshStandardMaterial({vertexColors:true, metalness, roughness})
  mat.onBeforeCompile = (shader:THREE.WebGLProgramParametersWithUniforms)=>{
    shareAtmosphere(shader)
    shader.vertexShader = shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 aGlow; varying vec3 vGlow;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvGlow = aGlow;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uNight; varying vec3 vGlow;')
      .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * uNight;')
  }
  mat.customProgramCacheKey = ()=>key
  return mat
}

function buildWillowGeometry() {
  const parts:{g:THREE.BufferGeometry; lo:number; mid:number; hi:number}[] = [
    {g:new THREE.CylinderGeometry(0.18,0.34,5.2,5,1,true).translate(0,1.9,0).rotateZ(0.11), lo:0x382f26, mid:look.trees.trunk, hi:0x5c4f40},
    {g:new THREE.IcosahedronGeometry(2.8,0).scale(1.15,0.62,1.15).translate(-0.3,6.1,0.1), lo:0x264b26, mid:0x4b7a3a, hi:0x769f4c},
    {g:new THREE.IcosahedronGeometry(2.1,0).scale(1.1,0.68,1.1).translate(-1.7,5.4,0.6), lo:0x264b26, mid:0x4b7a3a, hi:0x769f4c},
    {g:new THREE.IcosahedronGeometry(2.0,0).scale(1.1,0.68,1.1).translate(1.0,5.5,-0.7), lo:0x264b26, mid:0x4b7a3a, hi:0x769f4c},
  ]
  for(let i=0;i<8;i++) {
    const a = i/8*Math.PI*2+(i%2)*0.2, r = 2.0+(i%3)*0.45, drop = 3.5+(i%2)*0.4
    parts.push({g:new THREE.CylinderGeometry(0.32,0.08,drop,3,1,true).rotateY(a).translate(-0.3+Math.cos(a)*r,5.5-drop*0.5,0.1+Math.sin(a)*r), lo:0x2f592c, mid:0x568640, hi:0x7ea650})
  }
  const cLo=new THREE.Color(), cMid=new THREE.Color(), cHi=new THREE.Color(), cOut=new THREE.Color()
  const baked = parts.map(({g:src,lo,mid,hi})=>{
    const g = src.index ? src.toNonIndexed() : src; g.computeBoundingBox()
    const {min,max} = g.boundingBox!, pos = g.getAttribute('position'), rgb = new Float32Array(pos.count*3)
    cLo.setHex(lo); cMid.setHex(mid); cHi.setHex(hi)
    for(let i=0;i<pos.count;i+=3) {
      const t = ((pos.getY(i)+pos.getY(i+1)+pos.getY(i+2))/3-min.y)/Math.max(0.05,max.y-min.y)
      cOut.copy(t<0.5?cLo:cMid).lerp(t<0.5?cMid:cHi,t<0.5?t*2:(t-0.5)*2)
      for(let k=0;k<3;k++) cOut.toArray(rgb,(i+k)*3)
    }
    g.setAttribute('color',new THREE.BufferAttribute(rgb,3)); g.deleteAttribute('uv'); g.deleteAttribute('normal'); return g
  })
  const merged = mergeGeometries(baked)!; merged.computeVertexNormals(); baked.forEach(p=>p.dispose())
  return merged
}

function buildLandmarkTrees(specs:LandmarkTreeSpec[]) {
  const willow = buildWillowGeometry(), conifer = treeGeometry(4)
  const parts = specs.map(t=>(t.kind==='willow'?willow:conifer.near).clone().scale(t.scale,t.scale,t.scale).rotateY(t.yaw).translate(t.dx,t.dy,t.dz))
  willow.dispose()
  const merged = mergeGeometries(parts)!; parts.forEach(p=>p.dispose())
  return new THREE.Mesh(merged, conifer.material)
}

export function createLandmarks(scene:THREE.Scene, entries:LandmarkEntry[] = []) {
  let started = false, pending = 0
  let lastCamPos:THREE.Vector3|undefined
  const lodTargets:{mesh:THREE.Object3D; anchor:THREE.Vector3; maxDistSq:number}[] = []

  function updateVisibility(camPos:THREE.Vector3) {
    for(const t of lodTargets) t.mesh.visible = camPos.distanceToSquared(t.anchor) <= t.maxDistSq
  }

  async function loadAll() {
    if(!entries.length) return
    pending = entries.length
    const {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js')
    const loader = new GLTFLoader()
    const metalMat = landmarkMaterial(0.18, 0.45, 'guilinol-lm-metal')
    const matteMat = landmarkMaterial(0.0, 0.85, 'guilinol-lm-matte')

    await Promise.all(entries.map(async entry=>{
      try {
        const {scene:raw} = await loader.loadAsync(`./${entry.model}`)
        raw.updateMatrixWorld(true)
        const metalParts:THREE.BufferGeometry[] = [], matteParts:THREE.BufferGeometry[] = [], glowTmp = new THREE.Color()
        raw.traverse(node=>{
          if(!(node instanceof THREE.Mesh)) return
          const m = (Array.isArray(node.material)?node.material[0]:node.material) as THREE.MeshStandardMaterial
          const g = (node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone()).applyMatrix4(node.matrixWorld)
          const count = g.getAttribute('position').count
          const col = new Float32Array(count*3), glow = new Float32Array(count*3)
          const spec = NIGHT_GLOW[m.name]
          if(spec) glowTmp.setHex(spec[0]).multiplyScalar(spec[1])
          else if(m.userData?.nightEmissive) glowTmp.copy(m.emissive.r||m.emissive.g||m.emissive.b ? m.emissive : m.color).multiplyScalar(1.5)
          else glowTmp.setRGB(0,0,0)
          for(let i=0;i<count;i++) {m.color.toArray(col,i*3); glowTmp.toArray(glow,i*3)}
          g.setAttribute('color',new THREE.BufferAttribute(col,3))
          g.setAttribute('aGlow',new THREE.BufferAttribute(glow,3))
          g.deleteAttribute('uv')
          ;(m.metalness>0.1 ? metalParts : matteParts).push(g)
        })
        const group = new THREE.Group()
        group.name = entry.name
        group.position.set(...entry.position)
        if(entry.yaw) group.rotation.y = entry.yaw
        if(metalParts.length) {const mg=mergeGeometries(metalParts)!; metalParts.forEach(p=>p.dispose()); group.add(new THREE.Mesh(mg,metalMat))}
        if(matteParts.length) {const mg=mergeGeometries(matteParts)!; matteParts.forEach(p=>p.dispose()); group.add(new THREE.Mesh(mg,matteMat))}
        const maxDist = entry.radius ?? 900
        lodTargets.push({mesh:group, anchor:group.position, maxDistSq:maxDist*maxDist})
        if(entry.trees?.length) {
          const treeMesh = buildLandmarkTrees(entry.trees)
          group.add(treeMesh)
          lodTargets.push({mesh:treeMesh, anchor:group.position, maxDistSq:Math.min(520,maxDist)**2})
        }
        if(lastCamPos) updateVisibility(lastCamPos)
        scene.add(group)
      } finally {pending--}
    }))
  }

  return {
    get pending() {return pending},
    tick(frame:number, camPos?:THREE.Vector3) {
      if(camPos) lastCamPos = camPos
      if(!started && frame>=2) {started=true; void loadAll().catch(err=>console.error(err))}
      if(camPos) updateVisibility(camPos)
    },
  }
}
