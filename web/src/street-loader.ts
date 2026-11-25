import * as THREE from 'three'
import type {StreetData, StreetRequest, StreetResponse, Streets} from './street-worker'

let worker:Worker|undefined
let nextId=0
const pending=new Map<number,{resolve:(data:StreetData)=>void; reject:(error:Error)=>void}>()

function streetWorker(){
  if(worker)return worker
  worker=new Worker(new URL('./street-worker.ts',import.meta.url),{type:'module'})
  worker.onmessage=({data}:MessageEvent<StreetResponse>)=>{
    const job=pending.get(data.id)
    pending.delete(data.id)
    if('error' in data)job?.reject(new Error(data.error))
    else job?.resolve(data.data)
  }
  worker.onerror=event=>{
    for(const job of pending.values())job.reject(new Error(event.message))
    pending.clear()
    worker?.terminate()
    worker=undefined
  }
  return worker
}

export async function loadStreetGeometry(paths:Streets,step:number,heights:THREE.BufferAttribute|THREE.InterleavedBufferAttribute,rails?:StreetRequest['rails'],signs?:StreetRequest['signs'],railCuts?:StreetRequest['railCuts']){
  const elevations=Float32Array.from({length:heights.count},(_,i)=>heights.getY(i))
  const target=streetWorker(), id=nextId++
  const data=await new Promise<StreetData>((resolve,reject)=>{
    target.postMessage({id,paths,step,elevations,rails,signs,railCuts} satisfies StreetRequest,[elevations.buffer])
    pending.set(id,{resolve,reject})
  })
  const {positions,normals,colors,kinds,along,fencePositions,fenceNormals,fenceColors,fenceAlong,...instances}=data
  const surface=positions.length?new THREE.BufferGeometry():null
  if(surface){
    surface.setAttribute('position',new THREE.BufferAttribute(positions,3))
    surface.setAttribute('normal',new THREE.BufferAttribute(normals,3))
    surface.setAttribute('color',new THREE.BufferAttribute(colors,3))
    surface.setAttribute('aSurface',new THREE.BufferAttribute(kinds,1))
    surface.setAttribute('aAlong',new THREE.BufferAttribute(along,1))
  }
  const fence=fencePositions.length?new THREE.BufferGeometry():null
  if(fence){
    fence.setAttribute('position',new THREE.BufferAttribute(fencePositions,3))
    fence.setAttribute('normal',new THREE.BufferAttribute(fenceNormals,3))
    fence.setAttribute('color',new THREE.BufferAttribute(fenceColors,3))
    fence.setAttribute('aAlong',new THREE.BufferAttribute(fenceAlong,1))
  }
  return {...instances,banks:paths[2],surface,fence}
}
