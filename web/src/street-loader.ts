import * as THREE from 'three'
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js'
import type {StreetData, StreetRequest, StreetResponse, Streets} from './street-worker'
import type {RoadMarkingBusStop, RoadMarkingGraph, RoadMarkingLane, RoadMarkingNode, RoadMarkingSignal} from './road-markings'

interface RawRoadCell {
  nodes: {id: number; x: number; z: number}[]
  lanes: {from: number; to: number; kind?: string; cls?: string; offset?: number; width?: number; oneway?: boolean; gradeSeparated?: 'linear' | 'jiefang'}[]
  signals?: {node: number; group?: number}[]
}

let cellsPromise: Promise<Set<string> | null> | undefined
let busStopsPromise: Promise<RoadMarkingBusStop[]> | undefined
const cellCache = new Map<string, Promise<RawRoadCell | null>>()

async function fetchJsonMaybeGzip<T>(url: string): Promise<T | null> {
  if (typeof fetch !== 'function') return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const bytes = new Uint8Array(buf)
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b && typeof DecompressionStream === 'function') {
      const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
      return JSON.parse(text) as T
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    return null
  }
}

function getRoadCells(): Promise<Set<string> | null> {
  if (!cellsPromise) {
    cellsPromise = fetchJsonMaybeGzip<string[]>('./world/roads/cells.json').then(list => (list ? new Set(list) : null))
  }
  return cellsPromise
}

function getBusStops(): Promise<RoadMarkingBusStop[]> {
  if (!busStopsPromise) {
    busStopsPromise = fetchJsonMaybeGzip<{stops?: [number, number, number, number, number, ...unknown[]][]}>('./street-furniture/bus-stops.json')
      .then(data => (data?.stops ?? []).map(([x, z, yaw, , side]) => ({x, z, yaw, side})))
  }
  return busStopsPromise
}

function getRoadCell(key: string): Promise<RawRoadCell | null> {
  let p = cellCache.get(key)
  if (!p) {
    p = getRoadCells().then(cells => {
      if (cells && !cells.has(key)) return null
      return fetchJsonMaybeGzip<RawRoadCell>(`./world/roads/${key}.json.gz`)
    })
    cellCache.set(key, p)
  }
  return p
}

async function loadTileRoadGraph(origin?: readonly [number, number]): Promise<RoadMarkingGraph | undefined> {
  if (!origin || typeof fetch !== 'function') return undefined
  const cx = Math.floor(origin[0] / 512), cz = Math.floor(origin[1] / 512)
  const [cell, stops] = await Promise.all([getRoadCell(`${cx}_${cz}`), getBusStops()])
  if (!cell?.nodes?.length || !cell?.lanes?.length) return undefined

  const minX = origin[0] - 80, maxX = origin[0] + 336
  const minZ = origin[1] - 80, maxZ = origin[1] + 336
  const rawNodes = new Map<number, RoadMarkingNode>()
  for (const n of cell.nodes) rawNodes.set(n.id, {id: n.id, x: n.x, z: n.z})

  const nearNodeIds = new Set<number>()
  for (const l of cell.lanes) {
    const u = rawNodes.get(l.from), v = rawNodes.get(l.to)
    if (!u || !v) continue
    const eMinX = Math.min(u.x, v.x), eMaxX = Math.max(u.x, v.x)
    const eMinZ = Math.min(u.z, v.z), eMaxZ = Math.max(u.z, v.z)
    if (eMaxX >= minX && eMinX <= maxX && eMaxZ >= minZ && eMinZ <= maxZ) {
      nearNodeIds.add(l.from); nearNodeIds.add(l.to)
    }
  }
  if (!nearNodeIds.size) return undefined

  const keptNodes = new Map<number, RoadMarkingNode>()
  const lanes: RoadMarkingLane[] = []
  for (const l of cell.lanes) {
    if (!nearNodeIds.has(l.from) && !nearNodeIds.has(l.to)) continue
    const u = rawNodes.get(l.from), v = rawNodes.get(l.to)
    if (!u || !v) continue
    keptNodes.set(u.id, u); keptNodes.set(v.id, v)
    lanes.push({
      from: l.from,
      to: l.to,
      kind: (l.kind as RoadMarkingLane['kind']) ?? 'motor',
      cls: l.cls ?? 'unclassified',
      offset: l.offset ?? 0,
      width: l.width,
      oneway: !!l.oneway,
      gradeSeparated: l.gradeSeparated,
    })
  }
  const signals: RoadMarkingSignal[] = []
  for (const s of cell.signals ?? []) {
    if (keptNodes.has(s.node)) signals.push({node: s.node, group: s.group})
  }
  const busStops = stops.filter(s => s.x >= origin[0] - 32 && s.x <= origin[0] + 288 && s.z >= origin[1] - 32 && s.z <= origin[1] + 288)
  return {nodes: Array.from(keptNodes.values()), lanes, signals, busStops}
}

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

export async function loadStreetGeometry(paths:Streets,step:number,heights:THREE.BufferAttribute|THREE.InterleavedBufferAttribute,rails?:StreetRequest['rails'],signs?:StreetRequest['signs'],railCuts?:StreetRequest['railCuts'],paving?:StreetRequest['paving'],roadbeds?:number[],origin?:readonly [number,number]){
  const [elevations,roadGraph]=await Promise.all([
    Promise.resolve(Float32Array.from({length:heights.count},(_,i)=>heights.getY(i))),
    loadTileRoadGraph(origin),
  ])
  const target=streetWorker(), id=nextId++
  const data=await new Promise<StreetData>((resolve,reject)=>{
    target.postMessage({id,paths,step,elevations,rails,signs,railCuts,paving,roadbeds,origin,roadGraph} satisfies StreetRequest,[elevations.buffer])
    pending.set(id,{resolve,reject})
  })
  const {positions,normals,colors,kinds,along,fencePositions,fenceNormals,fenceColors,fenceAlong,...instances}=data
  let surface=positions.length?new THREE.BufferGeometry():null
  if(surface){
    surface.setAttribute('position',new THREE.BufferAttribute(positions,3))
    surface.setAttribute('normal',new THREE.BufferAttribute(normals,3))
    surface.setAttribute('color',new THREE.BufferAttribute(colors,3))
    surface.setAttribute('aSurface',new THREE.BufferAttribute(kinds,1))
    surface.setAttribute('aAlong',new THREE.BufferAttribute(along,1))
    if(paths[16]?.length){
      // Adjacent clipped shoulder triangles share positions and material attributes.
      const triangles=surface
      surface=mergeVertices(triangles,1e-4)
      triangles.dispose()
    }
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
