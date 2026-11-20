import * as THREE from 'three'
import {look} from './look/config'
import {nightLit, nightPeaks} from './look/night'
import {sharedKtx2Loader} from './look/tiles'
import {fetchAsset} from './world'
import type {PeakWorkerInput, PeakWorkerOutput} from './peaks-worker'

interface Section {offset:number; vertices:number; indices:number; indexOffset:number}
export interface Peaks {
  file:string; entries:{name:string; center:[number,number,number]; baseHeight?:number; lods:Section[]; model?:string}[]
}
export interface PeakColliderData {
  name:string
  center:[number,number,number]
  vertices:Float32Array
  indices:Uint32Array
}
export interface PeaksGroup extends THREE.Group {
  colliders:PeakColliderData[]
  modelPeaks:THREE.Object3D[]
  stats:{calls:number; lod0Peaks:number; lod1Peaks:number}
  loadModels(renderer:THREE.WebGLRenderer):void
  update(camera:THREE.PerspectiveCamera, mirrorLevel?:number):void
}

// Spin up the worker immediately on module evaluation so it warms while manifest.json fetches.
let prewarmedWorker:Worker|null = typeof Worker!=='undefined'
  ? new Worker(new URL('./peaks-worker.ts',import.meta.url),{type:'module'})
  : null

function inFrustum(frustum:THREE.Frustum, pt:THREE.Vector3, radius:number) {
  const planes = frustum.planes
  for(let i=0;i<6;i++) if(planes[i].distanceToPoint(pt)<-radius) return false
  return true
}

export function startPeaks(asset:Peaks) {
  const worker = prewarmedWorker ?? new Worker(new URL('./peaks-worker.ts',import.meta.url),{type:'module'})
  prewarmedWorker = null
  const palette = [
    look.peakFoot,look.peakGreen,look.peakGreenDark,look.peakGreenLight,
    look.peakRock,look.peakRockDark,look.peakRockOchre,
  ].map(hex=>new THREE.Color(hex).toArray())

  let markDispatched!:()=>void
  const dispatched = new Promise<void>(r=>{markDispatched=r})
  const workerDone = fetchAsset(asset.file).then(packed=>{
    const workerPromise = new Promise<PeakWorkerOutput>((resolve,reject)=>{
      worker.onmessage = event=>{worker.terminate();resolve(event.data)}
      worker.onerror = err=>{worker.terminate();reject(err)}
      const msg:PeakWorkerInput = {
        packed, entries:asset.entries, palette,
        bareFrom:look.peakBareFrom, rockShare:look.peakRockShare, jitter:look.peakJitter,
      }
      worker.postMessage(msg,[packed])
    })
    markDispatched()
    return workerPromise
  }).catch(err=>{markDispatched();throw err})

  const modelEntries = asset.entries.filter(e=>e.model)
  const finish = workerDone.then(data=>{
    const group = assemblePeaks(data,[])
    group.userData.modelEntries = modelEntries
    return group
  })
  return {dispatched, finish}
}

export async function loadPeaks(asset:Peaks):Promise<PeaksGroup> {
  return startPeaks(asset).finish
}

function assemblePeaks(data:PeakWorkerOutput, models:THREE.Object3D[]):PeaksGroup {

  const material = new THREE.MeshStandardMaterial({flatShading:true,vertexColors:true,roughness:look.roughness,metalness:look.metalness})
  nightPeaks(material)

  const worldSphere = new THREE.Sphere(new THREE.Vector3(0,200,0),25000)

  function buildGeometry(pos:Float32Array, norm:Int8Array, col:Float32Array, height:Uint8Array, pick:Uint16Array) {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position',new THREE.BufferAttribute(pos,3))
    geom.setAttribute('normal',new THREE.BufferAttribute(norm,3,true))
    geom.setAttribute('color',new THREE.BufferAttribute(col,3))
    geom.setAttribute('aHeight',new THREE.BufferAttribute(height,1,true))
    geom.setAttribute('aPick',new THREE.BufferAttribute(pick,1,true))
    geom.boundingSphere = worldSphere
    return geom
  }

  const geom0 = buildGeometry(data.pos0,data.norm0,data.col0,data.height0,data.pick0)
  const geom1 = buildGeometry(data.pos1,data.norm1,data.col1,data.height1,data.pick1)

  const perPeakIdx0 = data.peaks[0]?.idx0.length ?? 9216
  let idxArray0 = new Uint32Array(Math.min(data.peaks.length,28)*perPeakIdx0)
  let idxAttr0 = new THREE.BufferAttribute(idxArray0,1)
  idxAttr0.setUsage(THREE.DynamicDrawUsage)
  geom0.setIndex(idxAttr0)
  geom0.setDrawRange(0,0)

  const totalIdx1 = data.peaks.reduce((sum,p)=>sum+p.idx1.length,0)
  const idxArray1 = new Uint16Array(totalIdx1)
  const idxAttr1 = new THREE.BufferAttribute(idxArray1,1)
  idxAttr1.setUsage(THREE.DynamicDrawUsage)
  geom1.setIndex(idxAttr1)
  geom1.setDrawRange(0,0)

  // Named proxy hierarchy so Raycaster hits keep `hit.object.parent.name === peak.name` (e.g. '独秀峰').
  const proxies = data.peaks.map(peak=>{
    const anchor = new THREE.Group()
    anchor.name = peak.name
    const proxy = new THREE.Object3D()
    anchor.add(proxy)
    return proxy
  })

  const mesh0 = new THREE.Mesh(geom0,material)
  const mesh1 = new THREE.Mesh(geom1,material)
  mesh0.frustumCulled = false; mesh0.visible = false; mesh0.name = 'peaks-lod0'
  mesh1.frustumCulled = false; mesh1.visible = false; mesh1.name = 'peaks-lod1'
  mesh0.raycast = ()=>{}
  mesh1.raycast = ()=>{}

  // Initial hysteresis state matches THREE.LOD: level 1 starts visible, so switching into LOD 0 uses 800*(1-0.05)=760 m.
  const farState = new Uint8Array(data.peaks.length).fill(1)
  let prevMask0 = -1n, prevMask1 = -1n
  const lastPos = new THREE.Vector3(Infinity,Infinity,Infinity)
  const lastQuat = new THREE.Quaternion()
  let lastMirror = NaN
  const frustum = new THREE.Frustum()
  const projScreen = new THREE.Matrix4()
  const pt = new THREE.Vector3()
  const stats = {calls:0, lod0Peaks:0, lod1Peaks:0}

  const colliders:PeakColliderData[] = data.peaks.map(p=>({
    name:p.name,
    center:p.center,
    vertices:data.pos0.subarray(p.vStart0*3,(p.vStart0+p.vCount0)*3),
    indices:p.idx0.length===data.localIdx0.length ? data.localIdx0 : p.idx0.map(index=>index-p.vStart0),
  }))

  const group = Object.assign(new THREE.Group(),{
    colliders,
    modelPeaks:models,
    stats,
    update(camera:THREE.PerspectiveCamera, mirrorLevel=148) {
      if(
        camera.position.distanceToSquared(lastPos)<4 &&
        lastQuat.angleTo(camera.quaternion)<.012 &&
        (mirrorLevel===lastMirror || (Number.isFinite(mirrorLevel) && Number.isFinite(lastMirror) && Math.abs(mirrorLevel-lastMirror)<.5))
      ) return
      lastPos.copy(camera.position); lastQuat.copy(camera.quaternion); lastMirror = mirrorLevel
      camera.updateMatrixWorld()
      frustum.setFromProjectionMatrix(projScreen.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))
      const cxCam = camera.position.x, cyCam = camera.position.y, czCam = camera.position.z
      const invZoom = 1/camera.zoom
      const mirrorOn = Number.isFinite(mirrorLevel) && cyCam>=mirrorLevel+.2 && cyCam<=4000

      let mask0 = 0n, mask1 = 0n
      const vis0:number[] = [], vis1:number[] = []
      for(let i=0;i<data.peaks.length;i++) {
        const p = data.peaks[i]
        const [px,py,pz] = p.center
        const dist = Math.hypot(cxCam-px,cyCam-py,czCam-pz)*invZoom
        const limit = farState[i] ? 760 : 800
        const isFar = dist>=limit
        farState[i] = isFar ? 1 : 0

        pt.set(px,py,pz)
        let visible = inFrustum(frustum,pt,p.radius)
        if(!visible && mirrorOn && py+p.radius>=mirrorLevel) {
          pt.set(px,2*mirrorLevel-py,pz)
          visible = inFrustum(frustum,pt,p.radius)
        }
        if(!visible) continue
        const bit = 1n<<BigInt(i)
        if(isFar) { mask1 |= bit; vis1.push(i) }
        else { mask0 |= bit; vis0.push(i) }
      }

      if(mask0!==prevMask0) {
        prevMask0 = mask0
        const needed = vis0.reduce((sum,i)=>sum+data.peaks[i].idx0.length,0)
        if(needed>idxArray0.length) {
          idxArray0 = new Uint32Array(Math.max(needed,idxArray0.length*2))
          idxAttr0 = new THREE.BufferAttribute(idxArray0,1)
          idxAttr0.setUsage(THREE.DynamicDrawUsage)
          geom0.setIndex(idxAttr0)
        }
        let cursor = 0
        for(const i of vis0) {
          const slice = data.peaks[i].idx0
          idxArray0.set(slice,cursor)
          cursor += slice.length
        }
        idxAttr0.clearUpdateRanges()
        if(cursor>0) idxAttr0.addUpdateRange(0,cursor)
        idxAttr0.needsUpdate = true
        geom0.setDrawRange(0,cursor)
        mesh0.visible = cursor>0
      }

      if(mask1!==prevMask1) {
        prevMask1 = mask1
        let cursor = 0
        for(const i of vis1) {
          const slice = data.peaks[i].idx1
          idxArray1.set(slice,cursor)
          cursor += slice.length
        }
        idxAttr1.clearUpdateRanges()
        if(cursor>0) idxAttr1.addUpdateRange(0,cursor)
        idxAttr1.needsUpdate = true
        geom1.setDrawRange(0,cursor)
        mesh1.visible = cursor>0
      }

      stats.lod0Peaks = vis0.length
      stats.lod1Peaks = vis1.length
      stats.calls = (mesh0.visible?1:0)+(mesh1.visible?1:0)+models.length
    },
  }) as PeaksGroup

  const raySphere = new THREE.Sphere(), vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), hitVec = new THREE.Vector3()
  group.raycast = (raycaster:THREE.Raycaster, intersects:THREE.Intersection[])=>{
    const ray = raycaster.ray
    for(let i=0;i<data.peaks.length;i++) {
      const p = data.peaks[i]
      raySphere.center.set(p.center[0],p.center[1],p.center[2])
      raySphere.radius = p.radius
      if(!ray.intersectsSphere(raySphere)) continue
      const {vertices:verts,indices:idx} = colliders[i]
      for(let t=0;t<idx.length;t+=3) {
        const a = idx[t]*3, b = idx[t+1]*3, c = idx[t+2]*3
        vA.set(verts[a],verts[a+1],verts[a+2])
        vB.set(verts[b],verts[b+1],verts[b+2])
        vC.set(verts[c],verts[c+1],verts[c+2])
        if(!ray.intersectTriangle(vA,vB,vC,true,hitVec)) continue
        const distance = ray.origin.distanceTo(hitVec)
        if(distance>=raycaster.near && distance<=raycaster.far) {
          intersects.push({distance, point:hitVec.clone(), object:proxies[i], faceIndex:t/3, face:null})
        }
      }
    }
  }

  group.add(mesh0,mesh1,...models)
  group.loadModels = renderer => {
    const entries = group.userData.modelEntries as Peaks['entries']|undefined
    if(!entries?.length || group.userData.modelsStarted) return
    group.userData.modelsStarted = true
    void (async()=>{
      const [{GLTFLoader},{MeshoptDecoder},basis] = await Promise.all([
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/libs/meshopt_decoder.module.js'),
        sharedKtx2Loader(renderer),
      ])
      const loader = new GLTFLoader().setKTX2Loader(basis).setMeshoptDecoder(MeshoptDecoder)
      for(const entry of entries){
        if(!entry.model) continue
        const url = entry.model.includes('/')?`./${entry.model}`:`./world/${entry.model}`
        try{
          const {scene} = await loader.loadAsync(url)
          const holder = new THREE.Group()
          holder.name = entry.name
          holder.position.set(entry.center[0], entry.baseHeight??entry.center[1], entry.center[2])
          scene.traverse(node=>{
            if(/^collision/i.test(node.name)||node.name==='lod1'||node.name==='lod2') node.visible = false
            if(node instanceof THREE.Mesh) for(const material of [node.material].flat()) nightLit(material)
          })
          holder.add(scene)
          group.add(holder)
          models.push(holder)
        }catch(error){console.warn(entry.name, error)}
      }
    })()
  }
  return group
}
