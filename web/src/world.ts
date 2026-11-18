import * as THREE from 'three'
import {bridgeGeometry, bridgeMaterial} from './look/bridge'
import {look} from './look/config'
import type {Peaks} from './peaks'

interface Asset {file:string; bytes:number}
export interface Tile extends Asset {x:number; z:number}
export interface Manifest {
  version:number; extent:[number,number,number,number]; grid:number; chunkSize:number; chunks:Tile[];
  peaks:Peaks; overview:{step:number; heights:Asset; underlay:Asset; texture:Asset}
}
export let bytes = 0
export async function fetchAsset(file:string, signal?:AbortSignal) {
  const response = await fetch(`./world/${file}`, {signal})
  if (!response.ok) throw Error(`${file}: HTTP ${response.status}`)
  const data = await response.arrayBuffer()
  bytes += data.byteLength
  return data
}

async function surfaceMaterial(data:ArrayBuffer) {
  const bitmap = await createImageBitmap(new Blob([data],{type:'image/png'}),{imageOrientation:'flipY'})
  const map = new THREE.Texture(bitmap)
  map.colorSpace = THREE.SRGBColorSpace
  map.needsUpdate = true
  return new THREE.MeshStandardMaterial({map, roughness:look.roughness, metalness:look.metalness})
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

export async function overview(manifest:Manifest) {
  const {underlay,texture,step} = manifest.overview
  const [left,top,width,depth] = manifest.extent
  const [values,image] = await Promise.all([fetchAsset(underlay.file),fetchAsset(texture.file)])
  const samples = new Int16Array(values), cols = width/step
  const geometry = ground(width,depth,step,(col,row)=>samples[row*(cols+1)+col]/10)
  const mesh = new THREE.Mesh(geometry,await surfaceMaterial(image))
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
  }
  return {mesh,toggle}
}

const buildings = new THREE.MeshStandardMaterial({vertexColors:true,roughness:look.roughness,metalness:look.metalness})
const wall = new THREE.Color(look.wall), roof = new THREE.Color(look.roof)
export async function detail(tile:Tile, signal:AbortSignal) {
  const compressed = await fetchAsset(tile.file,signal)
  const buffer = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  signal.throwIfAborted()
  const view = new DataView(buffer)
  if(view.getUint32(0)!==0x474c3033) throw Error('Invalid GL03 tile')
  const [vertices,count,collision,imageBytes,triangles] = [4,8,12,16,20].map(offset=>view.getUint32(offset,true))
  let offset = 24
  const terrain = new Int16Array(buffer,offset,4225); offset+=8450
  const water = new Int16Array(buffer,offset,4225); offset+=8450
  const positions = new Int16Array(buffer,offset,vertices*3); offset+=vertices*6
  const normals = new Int8Array(buffer,offset,vertices*3); offset+=vertices*3
  const indices = new Uint32Array(buffer.slice(offset,offset+count*4)); offset+=count*4
  const rings = new Uint8Array(buffer,offset,collision); offset+=collision
  const end = offset+imageBytes, tail = end+triangles*18, extra = buffer.byteLength-tail
  if(extra!==0 && extra!==8450) throw Error('Invalid GL03 sections')
  const deck = Float32Array.from(new Int16Array(buffer.slice(end,tail)),(value,index)=>value/(index%3===1?10:100))
  const underlay = extra ? new Int16Array(buffer.slice(tail)) : terrain
  const material = await surfaceMaterial(buffer.slice(offset,end))
  const sample = (col:number,row:number)=>{
    const index = row*65+col
    return (water[index]===-32768?underlay[index]:water[index])/10
  }
  const geometry = ground(256,256,8,(column,line)=>{
    const col=column*2,row=line*2
    if(col===0||col===64) return THREE.MathUtils.lerp(sample(col,row&~7),sample(col,Math.min(64,(row&~7)+8)),(row%8)/8)
    if(row===0||row===64) return THREE.MathUtils.lerp(sample(col&~7,row),sample(Math.min(64,(col&~7)+8),row),(col%8)/8)
    return sample(col,row)
  })
  const group = new THREE.Group()
  group.position.set(tile.x,0,tile.z)
  const groundMesh = new THREE.Mesh(geometry,material)
  group.add(groundMesh)
  const walls = new THREE.BufferGeometry()
  if(vertices) {
    const meters = Float32Array.from(positions,(value,index)=>value/(index%3===1?10:100))
    walls.setAttribute('position',new THREE.BufferAttribute(meters,3))
    walls.setAttribute('normal',new THREE.BufferAttribute(normals,3,true))
    // 白墙灰瓦: upward faces take the tile grey, walls stay lime-white.
    const colors = new Float32Array(vertices*3)
    for(let index=0;index<vertices;index++) (normals[index*3+1]>90?roof:wall).toArray(colors,index*3)
    walls.setAttribute('color',new THREE.BufferAttribute(colors,3))
    walls.setIndex(new THREE.BufferAttribute(indices,1))
    group.add(new THREE.Mesh(walls,buildings))
  }
  const bridge = new THREE.BufferGeometry()
  if(deck.length) group.add(new THREE.Mesh(bridge.copy(bridgeGeometry(deck)),bridgeMaterial))
  return {group,groundMesh,terrain,water,rings,deck,dispose(){bridge.dispose();geometry.dispose(); walls.dispose(); material.map!.image.close(); material.map!.dispose(); material.dispose()}}
}
