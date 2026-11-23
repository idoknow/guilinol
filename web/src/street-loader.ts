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
    // 第一次建 worker 要现下 three.js（手机上几秒），这期间任何一次脚本层失败都会走到这里。
    // 只把这次失败吞掉就行：调用方会换一个新 worker 重试，别让整块地块空十秒。
    for(const job of pending.values())job.reject(new Error(event.message||'street worker failed'))
    pending.clear()
    worker?.terminate()
    worker=undefined
  }
  return worker
}

/** 提前把街面 worker 建起来：它的 three.js 依赖要几百 KB，放在首块地块里等就白等好几秒。 */
export function prewarmStreetWorker(){ streetWorker() }

async function request(paths:Streets,step:number,heights:THREE.BufferAttribute|THREE.InterleavedBufferAttribute){
  const elevations=Float32Array.from({length:heights.count},(_,i)=>heights.getY(i))
  const target=streetWorker(), id=nextId++
  return new Promise<StreetData>((resolve,reject)=>{
    pending.set(id,{resolve,reject})
    target.postMessage({id,paths,step,elevations} satisfies StreetRequest,[elevations.buffer])
  })
}

export async function loadStreetGeometry(paths:Streets,step:number,heights:THREE.BufferAttribute|THREE.InterleavedBufferAttribute){
  // 失败一次就换 worker 重试同一块：elevations 是 transfer 出去的，重试时重新算一遍。
  const data=await request(paths,step,heights).catch(()=>request(paths,step,heights))
  const {positions,normals,colors,kinds,along,...instances}=data
  const surface=positions.length?new THREE.BufferGeometry():null
  if(surface){
    surface.setAttribute('position',new THREE.BufferAttribute(positions,3))
    surface.setAttribute('normal',new THREE.BufferAttribute(normals,3))
    surface.setAttribute('color',new THREE.BufferAttribute(colors,3))
    surface.setAttribute('aSurface',new THREE.BufferAttribute(kinds,1))
    surface.setAttribute('aAlong',new THREE.BufferAttribute(along,1))
  }
  return {...instances,banks:paths[2],surface}
}
