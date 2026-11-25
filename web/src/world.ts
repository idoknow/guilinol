import {cacheResponse} from './telemetry'
import * as THREE from 'three'
import {buildingGeometry,type Building} from './buildings'
import {loadStreetGeometry} from './street-loader'
import type {StationPavingStyle,Streets} from './street-worker'
import {bridgeGeometry} from './look/bridge'
import {look} from './look/config'
import {nightGround} from './look/night'
import {countryside,setupCountryside,touchesCountryside} from './look/countryside'
import {chunkWater, farWater} from './look/water'
import type {TileBatchInput} from './batch'
import type {Peaks} from './peaks'
import {joinPortalRoads,tunnelGeometry,type Tunnel} from './tunnels'
import {freezeStatic} from './static-freeze'

interface Asset {file:string; bytes:number}
export interface Tile extends Asset {x:number; z:number; stationPaving?:StationPavingStyle; roadbeds?:number[]}
export interface Manifest {
  region?:import('../../lib/play-region').Region
  tunnels?:Tunnel[]
  builtArea?:{type:'Polygon';coordinates:[number,number][][]}
  distantBuildings?:Asset
  landmarks?:import('./landmarks').Landmark[]
  version:number; bbox:[number,number,number,number]; extent:[number,number,number,number]; grid:number; chunkSize:number; chunks:Tile[];
  peaks:Peaks; atlas:Asset; vehicles?:Asset; overview:{step:number; heights:Asset; underlay:Asset; packedUnderlay?:Asset; texture:Asset; waterMask?:string}
}
export let bytes = 0
type ByteProgress=(done:number,total:number)=>void
export async function fetchAsset(file:string, signal?:AbortSignal,progress?:ByteProgress) {
  const response = await fetch(`./world/${file}`, {signal})
  cacheResponse(response)
  if (!response.ok) throw Error(`${file}: HTTP ${response.status}`)
  let data:ArrayBuffer
  const total=Number(response.headers.get('content-length'))
  if(progress&&total>0&&response.body){
    const reader=response.body.getReader(),parts:Uint8Array<ArrayBuffer>[]=[];let done=0
    while(true){const part=await reader.read();if(part.done)break
      parts.push(part.value as Uint8Array<ArrayBuffer>);done+=part.value.length;progress(done,Math.max(done,total))}
    data=await new Blob(parts).arrayBuffer()
  }else data=await response.arrayBuffer()
  progress?.(data.byteLength,data.byteLength)
  bytes += data.byteLength
  return data
}

function bitmapMaterial(bitmap:ImageBitmap,bakedWater=false) {
  const map = new THREE.Texture(bitmap)
  map.colorSpace = THREE.SRGBColorSpace
  map.needsUpdate = true
  const material = new THREE.MeshStandardMaterial({map, roughness:look.roughness, metalness:look.metalness})
  nightGround(material,bakedWater)
  return material
}

async function surfaceMaterial(data:ArrayBuffer,bakedWater=false) {
  const bitmap = await createImageBitmap(new Blob([data],{type:'image/png'}),{imageOrientation:'flipY'})
  return bitmapMaterial(bitmap,bakedWater)
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

// GLF1 is independent of the chunk table and the peak-sector catalogue.
export async function openingTerrain(progress?:ByteProgress){
  const data=await fetchAsset('opening.bin',undefined,progress)
  const view=new DataView(data)
  if(view.getUint32(0)!==0x474c4631)throw Error('Invalid opening terrain')
  const bbox=Array.from({length:4},(_,i)=>view.getFloat64(4+i*8,true)) as Manifest['bbox']
  const extent=Array.from({length:4},(_,i)=>view.getInt32(36+i*4,true)) as Manifest['extent']
  const [left,top,width,depth]=extent, step=view.getUint32(52,true)
  const cols=width/step+1, rows=depth/step+1
  const heights=new Int16Array(data,56,cols*rows)
  const material=await surfaceMaterial(data.slice(56+heights.byteLength),true)
  const mesh=new THREE.Mesh(ground(width,depth,step,(x,z)=>heights[z*cols+x]/10),material)
  mesh.position.set(left,0,top)
  freezeStatic(mesh)
  const index=mesh.geometry.index!
  function toggle(tile:Tile,show:boolean){
    const tx=(tile.x-left)/step,tz=(tile.z-top)/step,side=256/step
    for(let row=tz;row<tz+side;row++){
      const start=6*(row*(cols-1)+tx)
      if(show){
        for(let col=0;col<side;col++){
          const a=row*cols+tx+col,b=a+cols
          index.array.set([a,b,a+1,b,b+1,a+1],start+6*col)
        }
      }else index.array.fill(0,start,start+6*side)
      index.addUpdateRange(start,6*side)
    }
    index.needsUpdate=true
  }
  return {bbox,extent,mesh,toggle,dispose(){
    mesh.removeFromParent()
    mesh.geometry.dispose()
    material.map?.source.data.close()
    material.map?.dispose()
    material.dispose()
  }}
}

export function measureFirstWorldBytes(firstMs:number, publish:(bytes:number)=>void){
  const root=new URL('./world/',document.baseURI).href
  let total=0
  function add(entries:PerformanceEntry[]){
    for(const resource of entries as PerformanceResourceTiming[]){
      if(resource.name.startsWith(root) && resource.startTime<=firstMs)total+=resource.encodedBodySize
    }
    publish(total)
  }
  // Loads already in flight at the boundary can publish their resource
  // timing after the first frame. Include them once their size is known.
  const observer=new PerformanceObserver(list=>add(list.getEntries()))
  observer.observe({entryTypes:['resource']})
  add(performance.getEntriesByType('resource'))
}

// All overview tiles share vertices, material and one draw. Only coarse cells
// touching a fine tile need the intermediate vertices along their common edge.
function terrainPattern(side:number,stride:number,coarse:boolean,edges:number){
  const out:number[]=[]
  const v=(x:number,z:number)=>x+z*stride
  const n=coarse?Math.min(4,side):1
  for(let z=0;z<side;z+=n)for(let x=0;x<side;x+=n){
    const a=v(x,z), b=v(x,z+n), c=v(x+n,z+n), d=v(x+n,z)
    const ring=[a]
    if(x===0 && edges&1)for(let i=1;i<n;i++)ring.push(v(x,z+i))
    ring.push(b)
    if(z+n===side && edges&2)for(let i=1;i<n;i++)ring.push(v(x+i,z+n))
    ring.push(c)
    if(x+n===side && edges&4)for(let i=1;i<n;i++)ring.push(v(x+n,z+n-i))
    ring.push(d)
    if(z===0 && edges&8)for(let i=1;i<n;i++)ring.push(v(x+n-i,z))
    if(ring.length===4)out.push(a,b,d,b,c,d)
    else for(let i=0;i<ring.length;i++)out.push(v(x+n/2,z+n/2),ring[i],ring[(i+1)%ring.length])
  }
  return out
}

// Carry the last measured elevation and colour into the surrounding ground
// plane. The apron is visual only and does not extend travel or physics bounds.
function perimeterApron(width:number,depth:number,step:number,samples:Int16Array,image:ImageBitmap) {
  const canvas = new OffscreenCanvas(image.width,image.height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image,0,0)
  const pixels = ctx.getImageData(0,0,image.width,image.height).data
  const points:[number,number][] = []
  for(let x=0;x<width;x+=step)points.push([x,0])
  for(let z=0;z<depth;z+=step)points.push([width,z])
  for(let x=width;x>0;x-=step)points.push([x,depth])
  for(let z=depth;z>0;z-=step)points.push([0,z])
  const positions:number[]=[],colors:number[]=[],indices:number[]=[]
  const outer=new THREE.Color(look.outerGround),inner=new THREE.Color()
  for(const [i,[x,z]] of points.entries()) {
    const dx=x===0?-1:x===width?1:0, dz=z===0?-1:z===depth?1:0
    const px=Math.min(image.width-1,Math.floor(x/width*image.width))
    const py=Math.max(0,image.height-1-Math.floor(z/depth*image.height))
    const at=4*(py*image.width+px)
    inner.setRGB(pixels[at]/255,pixels[at+1]/255,pixels[at+2]/255,THREE.SRGBColorSpace)
    positions.push(x,samples[z/step*(width/step+1)+x/step]/10,z,
                   x+512*dx,look.outerGroundY+.01,z+512*dz)
    colors.push(inner.r,inner.g,inner.b,outer.r,outer.g,outer.b)
    const a=i*2,b=(i+1)%points.length*2
    indices.push(a,b,b+1,a,b+1,a+1)
  }
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({vertexColors:true}))
}

async function inflateMask(encoded:string) {
  const bytes=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0))
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export function startOverview(manifest:Manifest) {
  const {underlay,packedUnderlay,texture,step,waterMask} = manifest.overview
  const [left,top,width,depth] = manifest.extent
  if(manifest.region)setupCountryside(manifest.region,manifest.extent,step,manifest.chunkSize)
  const elevations = packedUnderlay
    ? fetchAsset(packedUnderlay.file).then(data=>new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
    : fetchAsset(underlay.file)
  const dispatched = Promise.all([elevations,fetchAsset(texture.file)]).then(([values,image])=>{
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
    const mesh = new THREE.Group()
    mesh.position.set(left,0,top)
    const material = bitmapMaterial(flipped)
    countryside(material)
    const size=manifest.chunkSize, side=size/step, stride=cols+1
    const terrain=new THREE.BufferGeometry()
    const positions=new Float32Array(samples.length*3), normals=new Float32Array(samples.length*3)
    const uv=new Float32Array(samples.length*2)
    const rows=depth/step
    for(let z=0;z<=rows;z++)for(let x=0;x<=cols;x++){
      const i=z*stride+x
      positions[3*i]=x*step;positions[3*i+1]=samples[i]/10;positions[3*i+2]=z*step
      const dx=(samples[i+(x>0?-1:0)]-samples[i+(x<cols?1:0)])/(10*step*(x>0&&x<cols?2:1))
      const dz=(samples[i-(z>0?stride:0)]-samples[i+(z<rows?stride:0)])/(10*step*(z>0&&z<rows?2:1))
      const n=1/Math.sqrt(dx*dx+1+dz*dz)
      normals[3*i]=dx*n;normals[3*i+1]=n;normals[3*i+2]=dz*n
      uv[2*i]=x/cols;uv[2*i+1]=1-z/rows
    }
    terrain.setAttribute('position',new THREE.BufferAttribute(positions,3))
    terrain.setAttribute('normal',new THREE.BufferAttribute(normals,3))
    terrain.setAttribute('uv',new THREE.BufferAttribute(uv,2))
    terrain.setIndex(new THREE.BufferAttribute(new Uint32Array(cols*rows*6),1))
    const terrainMesh=new THREE.Mesh(terrain,material)
    mesh.add(terrainMesh)
    const index=terrain.index!
    index.setUsage(THREE.DynamicDrawUsage)
    const fine=terrainPattern(side,stride,false,0)
    const coarse=Array.from({length:16},(_,mask)=>terrainPattern(side,stride,true,mask))
    const covered=new Set<Tile>()
    // Bound both the measured terrain and its water reflection vertically;
    // the same index buffer serves the normal and mirrored cameras.
    let low=Infinity,highY=-Infinity
    for(const dm of samples){low=Math.min(low,dm/10);highY=Math.max(highY,dm/10)}
    const floor=2*low-highY,ceiling=2*highY-low
    // The overview covers the whole sampled terrain, including cells outside the play boundary.
    const tileCols = width/size, tileRows = depth/size
    const tiles = new Array<Tile | undefined>(tileCols*tileRows)
    for (const tile of manifest.chunks) {
      tiles[(tile.z-top)/size*tileCols+(tile.x-left)/size] = tile
    }
    const box = new THREE.Box3()
    const frustum=new THREE.Frustum(), projection=new THREE.Matrix4(), lastView=new THREE.Matrix4()
    let dirty=true
    function update(camera:THREE.PerspectiveCamera){
      lake.update(camera)
      const {position,far}=camera
      const ax=Math.floor(position.x/size), az=Math.floor(position.z/size)
      projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
      if(!dirty && lastView.equals(projection))return
      lastView.copy(projection);dirty=false
      frustum.setFromProjectionMatrix(projection)
      // The entire fine-detail streaming radius fits inside this square.
      const fineRadius=7
      const high=(x:number,z:number)=>Math.max(Math.abs(x-ax),Math.abs(z-az))<=fineRadius
      let cursor=0
      const radius = Math.ceil(far/size)+2
      const col0 = Math.max(0, Math.ceil(ax-left/size-radius)), col1 = Math.min(tileCols-1, Math.floor(ax-left/size+radius))
      const row0 = Math.max(0, Math.ceil(az-top/size-radius)), row1 = Math.min(tileRows-1, Math.floor(az-top/size+radius))
      for(let row=row0;row<=row1;row++)for(let col=col0;col<=col1;col++){
        const tile=tiles[row*tileCols+col]
        if(tile && covered.has(tile))continue
        const west=left+col*size,north=top+row*size
        const x=west/size,z=north/size
        if(Math.hypot(x-ax,z-az)*size>far+2*size)continue
        box.min.set(west,floor,north)
        box.max.set(west+size,ceiling,north+size)
        if(!frustum.intersectsBox(box))continue
        const mask=Number(high(x-1,z))+2*Number(high(x,z+1))+4*Number(high(x+1,z))+8*Number(high(x,z-1))
        const pattern=tile && high(x,z)?fine:coarse[mask]
        const offset=(north-top)/step*stride+(west-left)/step
        for(const i of pattern)index.array[cursor++]=offset+i
      }
      index.clearUpdateRanges()
      if(cursor)index.addUpdateRange(0,cursor)
      index.needsUpdate=true
      terrain.setDrawRange(0,cursor)
    }
    if(manifest.chunks.length>512)mesh.add(perimeterApron(width,depth,step,samples,flipped))
    const lake = await farWater(manifest,upright,samples)
    mesh.add(lake.mesh)
    lake.mesh.position.set(0,0,0)
    freezeStatic(mesh)
    function toggle(tile:Tile, show:boolean) {
      if(show)covered.delete(tile)
      else covered.add(tile)
      dirty=true
      lake.toggle(tile,show)
    }
    return {mesh,toggle,update,water:lake.mesh}
  })
  return {dispatched,finish}
}

export async function overview(manifest:Manifest) {
  return startOverview(manifest).finish
}

type SurfacePoly={kind:number,minX:number,maxX:number,minZ:number,maxZ:number,shell:[number,number][],holes:[number,number][][]}
function pointInRing(x:number,z:number,ring:[number,number][]){
  let hit=false
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [ax,az]=ring[i],[bx,bz]=ring[j]
    if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)hit=!hit
  }
  return hit
}
function buildSurfaceLookup(tile:Tile,paths:Streets){
  const polys:SurfacePoly[]=[]
  for(const [kind,...rings] of paths[0]){
    if(kind!==0&&kind!==1&&kind!==4&&kind!==5&&kind!==6)continue
    const shell=rings[0]
    if(!shell||shell.length<3)continue
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity
    for(const [rx,rz] of shell){
      if(rx<minX)minX=rx;if(rx>maxX)maxX=rx
      if(rz<minZ)minZ=rz;if(rz>maxZ)maxZ=rz
    }
    polys.push({kind,minX,maxX,minZ,maxZ,shell,holes:rings.slice(1)})
  }
  return (wx:number,wz:number)=>{
    const lx=(wx-tile.x)*100,lz=(wz-tile.z)*100
    const kinds:number[]=[]
    for(const poly of polys){
      if(lx<poly.minX||lx>poly.maxX||lz<poly.minZ||lz>poly.maxZ)continue
      if(pointInRing(lx,lz,poly.shell)&&!poly.holes.some(h=>pointInRing(lx,lz,h)))kinds.push(poly.kind)
    }
    return kinds
  }
}

export async function detail(tile:Tile, signal:AbortSignal, parseSlot?:()=>Promise<void>, tunnels?:Tunnel[]) {
  const compressed = await fetchAsset(tile.file,signal)
  const buffer = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  if(parseSlot) await parseSlot()
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
  const [solids,paths,thinIndices=[],asphalt=[],rails=[],signs=[],railCuts=[],walkFloors=[]]:[Building[],Streets,number[]?,number[]?,import('./railways').RailSection[]?,import('./railways').CrossingSign[]?,[number,number][]?,Building[]?]=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,offset,collision))); offset+=collision
  const rings=walkFloors.length ? solids.concat(walkFloors) : solids
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
  const streets = await loadStreetGeometry(paths,step,heights,rails,signs,railCuts,tile.stationPaving,tile.roadbeds)
  if(tunnels)joinPortalRoads(tile,tunnels,[streets.road,streets.sidewalk,...(streets.surface?[streets.surface.getAttribute('position').array as Float32Array]:[])])
  signal.throwIfAborted()
  const material = await surfaceMaterial(buffer.slice(offset,end))
  if(touchesCountryside(tile.x,tile.z))countryside(material)
  if(parseSlot)await parseSlot()
  const group = new THREE.Group()
  group.position.set(tile.x,0,tile.z)
  // Cut after street construction to preserve the original carriageway grade.
  for(const [index,cm] of railCuts)heights.setY(index,cm/100)
  if(railCuts.length){geometry.computeVertexNormals();geometry.computeBoundingSphere()}
  const groundMesh = new THREE.Mesh(geometry,material)
  group.add(groundMesh)
  const tunnel=tunnels?tunnelGeometry(tile,geometry,tunnels):null
  if(tunnel){
    if(tunnel.fringe){tunnel.fringe.material.dispose();tunnel.fringe.material=material}
    if('lining' in tunnel)group.add(tunnel.floor,tunnel.portal,tunnel.interior)
    else group.add(...Object.values(tunnel))
  }
  const pond = chunkWater(water,underlay,tile.x,tile.z)
  const walls = vertices ? buildingGeometry(positions,normals,indices,rings) : null
  const bridge = deck.length ? bridgeGeometry(deck,thin,asphalt) : null
  const batch:TileBatchInput = {
    tile, minY, maxY, midY:heights.getY(segments/2*(stride+1)),
    walls, pond:pond?.positions ?? null, bridge,
    streetSurface:streets.surface,
    tunnelLining:tunnel && 'lining' in tunnel?tunnel.lining.geometry:undefined,
    tunnelLights:tunnel && 'lights' in tunnel?tunnel.lights.geometry:undefined,
    streetFence:streets.fence,
    detailCount:streets.detailCount,
    railLodCount:streets.railLodCount,
    furnitureMatrices:streets.furnitureMatrices,
    furnitureColors:streets.furnitureColors,
    parked:streets.parked,
  }
  const surfaceAt = buildSurfaceLookup(tile, paths)
  return {
    group,groundMesh,terrain,underlay,water,rings,deck,thin,streets,batch,tunnel,surfaceAt,railCutVertices:new Set(railCuts.map(([index])=>index)),
    dispose(){
      if(tunnel){
        for(const mesh of Object.values(tunnel))if(mesh){
          mesh.geometry.dispose()
          if(tunnel.fringe && mesh!==tunnel.fringe)mesh.material.dispose()
        }
        if(!tunnel.fringe)tunnel.floor.material.dispose()
      }
      pond?.dispose(); streets.surface?.dispose(); streets.fence?.dispose(); bridge?.dispose(); geometry.dispose(); walls?.dispose()
      material.map!.image.close(); material.map!.dispose(); material.dispose()
    },
  }
}
