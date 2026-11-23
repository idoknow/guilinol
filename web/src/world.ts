import * as THREE from 'three'
import {buildingGeometry,type Building} from './buildings'
import {loadStreetGeometry} from './street-loader'
import type {Streets} from './street-worker'
import {bridgeGeometry} from './look/bridge'
import {look} from './look/config'
import {nightGround} from './look/night'
import {chunkWater, farWater} from './look/water'
import type {TileBatchInput} from './batch'
import type {Peaks} from './peaks'

interface Asset {file:string; bytes:number}
export interface Tile extends Asset {x:number; z:number}
export interface Manifest {
  landmarks?:import('./landmarks').Landmark[]
  version:number; extent:[number,number,number,number]; grid:number; chunkSize:number; chunks:Tile[];
  peaks:Peaks; atlas:Asset; vehicles?:Asset; overview:{step:number; heights:Asset; underlay:Asset; texture:Asset; waterMask?:string}
}
export let bytes = 0
/** 拉一个 world 资源。priority 交给浏览器的网络调度：街块最高、地标和山体让路。 */
export async function fetchAsset(file:string, signal?:AbortSignal, priority:RequestPriority='auto') {
  const response = await fetch(`./world/${file}`, {signal, priority})
  if (!response.ok) throw Error(`${file}: HTTP ${response.status}`)
  const data = await response.arrayBuffer()
  bytes += data.byteLength
  return data
}

function bitmapMaterial(bitmap:ImageBitmap) {
  const map = new THREE.Texture(bitmap)
  map.colorSpace = THREE.SRGBColorSpace
  map.needsUpdate = true
  const material = new THREE.MeshStandardMaterial({map, roughness:look.roughness, metalness:look.metalness})
  nightGround(material)
  return material
}

async function surfaceMaterial(data:ArrayBuffer) {
  const bitmap = await createImageBitmap(new Blob([data],{type:'image/png'}),{imageOrientation:'flipY'})
  return bitmapMaterial(bitmap)
}

function ground(width:number, depth:number, step:number, height:(col:number,row:number)=>number) {
  const geometry = new THREE.PlaneGeometry(width,depth,width/step,depth/step)
  geometry.rotateX(-Math.PI/2).translate(width/2,0,depth/2)
  const positions = geometry.getAttribute('position')
  for(let row=0;row<=depth/step;row++) for(let col=0;col<=width/step;col++)
    positions.setY(row*(width/step+1)+col,height(col,row))
  geometry.computeVertexNormals()
  return geometry
}

async function inflateMask(encoded:string) {
  const bytes=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0))
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export function startOverview(manifest:Manifest) {
  const {underlay,texture,step,waterMask} = manifest.overview
  const [left,top,width,depth] = manifest.extent
  const dispatched = Promise.all([fetchAsset(underlay.file),fetchAsset(texture.file)]).then(([values,image])=>{
    const blob = new Blob([image],{type:'image/png'})
    const bitmaps = Promise.all([
      createImageBitmap(blob,{imageOrientation:'flipY'}),
      waterMask?inflateMask(waterMask):createImageBitmap(blob),
    ])
    return {values,bitmaps}
  })
  const finish = dispatched.then(async ({values,bitmaps})=>{
    const [flipped,upright] = await bitmaps
    const samples = new Int16Array(values), cols = width/step
    const geometry = ground(width,depth,step,(col,row)=>samples[row*(cols+1)+col]/10)
    const mesh = new THREE.Mesh(geometry,bitmapMaterial(flipped))
    const lake = await farWater(manifest,upright,samples)
    mesh.position.set(left,0,top)
    const indices = geometry.index!, original = indices.array.slice(), side = manifest.chunkSize/step
    function toggle(tile:Tile, show:boolean) {
      const first = ((tile.z-top)/step*cols+(tile.x-left)/step)*6
      for(let row=0;row<side;row++) {
        const from = first+row*cols*6, to = from+side*6
        if(show) indices.array.set(original.subarray(from,to),from)
        else indices.array.fill(0,from,to)
        indices.addUpdateRange(from,to-from)
      }
      indices.needsUpdate = true
      lake.toggle(tile,show)
    }
    mesh.add(lake.mesh); lake.mesh.position.set(0,0,0)
    return {mesh,toggle,water:lake.mesh}
  })
  return {dispatched,finish}
}

export async function overview(manifest:Manifest) {
  return startOverview(manifest).finish
}

export async function detail(tile:Tile, signal:AbortSignal, packed?:ArrayBuffer) {
  // packed 是已经在内存里的压缩块（走过一次又回来），省掉一次往返。
  const trace = (globalThis as {__detailLog?:string[]}).__detailLog ??= []
  const mark = (where:string)=>trace.push(`${Math.round(performance.now())} ${tile.file} ${where}`)
  mark('begin')
  const compressed = packed ?? await fetchAsset(tile.file,signal,'high')
  mark('bytes')
  const buffer = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  mark('inflated')
  signal.throwIfAborted()
  const view = new DataView(buffer)
  if(view.getUint32(0)!==0x474c3034) throw Error('Invalid GL04 tile')
  const [vertices,count,collision,imageBytes,triangles] = [4,8,12,16,20].map(offset=>view.getUint32(offset,true))
  let offset = 24
  const terrain = new Int16Array(buffer,offset,4225); offset+=8450
  const water = new Int16Array(buffer,offset,4225); offset+=8450
  const positions = new Int16Array(buffer,offset,vertices*3); offset+=vertices*6
  const normals = new Int8Array(buffer,offset,vertices*3); offset+=vertices*3
  const indices = new Uint32Array(buffer.slice(offset,offset+count*4)); offset+=count*4
  const [rings,paths,thinIndices=[],asphalt=[]]:[Building[],Streets,number[]?,number[]?]=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,offset,collision))); offset+=collision
  const thin=new Set(thinIndices)
  const end = offset+imageBytes, tail = end+triangles*18, extra = buffer.byteLength-tail
  if(extra!==0 && extra!==8450) throw Error('Invalid GL04 sections')
  const deck = Float32Array.from(new Int16Array(buffer.slice(end,tail)),value=>value/100)
  const underlay = extra ? new Int16Array(buffer.slice(tail)) : terrain
  const sample = (col:number,row:number)=>{
    const index = row*65+col
    return underlay[index]/10
  }
  let minY = Infinity, maxY = -Infinity
  const step=water.some(value=>value!==-32768)?4:8, segments=256/step, stride=segments+1
  const edgeWet=(vertical:boolean,edge:number)=>Array.from({length:65},(_,at)=>water[vertical?at*65+edge:edge*65+at]).some(value=>value!==-32768)
  const wetEdges=[edgeWet(true,0),edgeWet(true,64),edgeWet(false,0),edgeWet(false,64)]
  const geometry = ground(256,256,step,(column,line)=>{
    const col=column*step/4,row=line*step/4
    let y:number
    if((col===0&&!wetEdges[0])||(col===64&&!wetEdges[1])) y = THREE.MathUtils.lerp(sample(col,row&~7),sample(col,Math.min(64,(row&~7)+8)),(row%8)/8)
    else if((row===0&&!wetEdges[2])||(row===64&&!wetEdges[3])) y = THREE.MathUtils.lerp(sample(col&~7,row),sample(Math.min(64,(col&~7)+8),row),(col%8)/8)
    else y = sample(col,row)
    if(y<minY) minY = y
    if(y>maxY) maxY = y
    return y
  })
  for(const [,topLevel] of rings) if(topLevel/10+8>maxY) maxY = topLevel/10+8
  const heights = geometry.getAttribute('position')
  mark('terrain')
  const streets = await loadStreetGeometry(paths,step,heights)
  mark('streets')
  signal.throwIfAborted()
  const material = await surfaceMaterial(buffer.slice(offset,end))
  mark('texture')
  const group = new THREE.Group()
  group.position.set(tile.x,0,tile.z)
  const groundMesh = new THREE.Mesh(geometry,material)
  group.add(groundMesh)
  const pond = chunkWater(water,tile.x,tile.z)
  const walls = vertices ? buildingGeometry(positions,normals,indices,rings) : null
  const bridge = deck.length ? bridgeGeometry(deck,thin,asphalt) : null
  const batch:TileBatchInput = {
    tile, minY, maxY, midY:heights.getY(segments/2*(stride+1)),
    walls, pond:pond?.positions ?? null, bridge,
    streetSurface:streets.surface,
    detailCount:streets.detailCount,
    railLodCount:streets.railLodCount,
    furnitureMatrices:streets.furnitureMatrices,
    furnitureColors:streets.furnitureColors,
    // 地块自带的路边车辆不再渲染：全城统一用青桂出行的电车（见 walk/vehicles.ts）
    parked:new Float32Array(0),
  }
  return {
    group,groundMesh,terrain,water,rings,deck,thin,streets,batch,
    dispose(){
      pond?.dispose(); streets.surface?.dispose(); bridge?.dispose(); geometry.dispose(); walls?.dispose()
      material.map!.dispose(); material.dispose()
    },
  }
}
