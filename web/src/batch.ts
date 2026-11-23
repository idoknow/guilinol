import * as THREE from 'three'
import {vehicleForbiddenAt} from './game/car-free'
import {buildingMaterial} from './look/buildings'
import {bridgeMaterial} from './look/bridge'
import {WATER_LAYER, waterMaterial} from './look/water'
import {streetFurnitureGeo, streetFurnitureMat, streetSurfaceMat} from './streets'
import type {Tile} from './world'
import {vehicleModel} from './walk/vehicle-model'
import {look} from './look/config'
import {flags} from './debug'
import {freezeStatic} from './static-freeze'

export interface TileBatchInput {
  tile:Tile
  minY:number
  maxY:number
  midY:number
  walls:THREE.BufferGeometry|null
  pond:Float32Array|null
  bridge:THREE.BufferGeometry|null
  streetSurface:THREE.BufferGeometry|null
  furnitureMatrices:Float32Array
  furnitureColors:Float32Array
  detailCount:number
  railLodCount:number
  parked:Float32Array
}

interface IndexedSlice {
  tile:Tile
  farCount:number
  indices:THREE.TypedArray|null
  vertexStart:number
  count:number
}

export type ParkedBike={id:string;x:number;y:number;z:number;yaw:number}

const WORLD_SPHERE = new THREE.Sphere(new THREE.Vector3(0,200,0),25000)

function shiftPositions(geom:THREE.BufferGeometry, dx:number, dz:number) {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const arr = pos.array as Float32Array
  for(let i=0;i<arr.length;i+=3) { arr[i]+=dx; arr[i+2]+=dz }
}

function inFrustum(frustum:THREE.Frustum, pt:THREE.Vector3, radius:number) {
  const planes = frustum.planes
  for(let i=0;i<6;i++) if(planes[i].distanceToPoint(pt)<-radius) return false
  return true
}

class StaticLayerBatch {
  mesh:THREE.Mesh
  private geom = new THREE.BufferGeometry()
  private slices:IndexedSlice[] = []
  private idxArray = new Uint32Array(0)
  private idxAttr:THREE.BufferAttribute|null = null
  private lastMask = ''

  constructor(material:THREE.Material, private attrDefs:{name:string; size:number; ctor:'f32'|'u8'}[], layer=0) {
    this.geom.boundingSphere = WORLD_SPHERE
    this.mesh = freezeStatic(new THREE.Mesh(this.geom,material))
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    if(layer) this.mesh.layers.set(layer)
  }

  rebuild(entries:{tile:Tile; geom:THREE.BufferGeometry}[]) {
    this.lastMask = ''
    this.geom.dispose()
    this.geom = new THREE.BufferGeometry()
    this.geom.boundingSphere = WORLD_SPHERE
    this.mesh.geometry = this.geom
    this.idxAttr = null
    let totalVerts = 0, totalIdx = 0
    for(const {geom} of entries) {
      const vCount = geom.getAttribute('position').count
      totalVerts += vCount
      totalIdx += geom.index ? geom.index.count : vCount
    }
    if(!totalVerts) {
      this.slices = []
      this.mesh.visible = false
      this.geom.setDrawRange(0,0)
      return
    }
    // A single tile can bind its source buffers directly. Rebuilding a
    // neighbouring bucket must never translate or mutate those buffers.
    for(const def of this.attrDefs) {
      if(entries.length===1){
        this.geom.setAttribute(def.name,entries[0].geom.getAttribute(def.name))
        continue
      }
      const merged = def.ctor==='u8' ? new Uint8Array(totalVerts*def.size) : new Float32Array(totalVerts*def.size)
      let offset = 0
      for(const {geom} of entries) {
        const src = geom.getAttribute(def.name).array as Float32Array|Uint8Array
        merged.set(src,offset)
        offset += src.length
      }
      this.geom.setAttribute(def.name,new THREE.BufferAttribute(merged,def.size))
    }

    let vertexStart=0
    this.slices=entries.map(({tile,geom})=>{
      const vertices=geom.getAttribute('position').count
      const count=geom.index?.count??vertices
      const slice={tile,vertexStart,count,indices:geom.index?.array??null,farCount:geom.userData.farIndexCount??count}
      vertexStart+=vertices
      return slice
    })
    if(totalIdx>this.idxArray.length) this.idxArray = new Uint32Array(Math.max(totalIdx,1024))
    this.idxAttr = new THREE.BufferAttribute(this.idxArray,1)
    this.idxAttr.setUsage(THREE.DynamicDrawUsage)
    this.geom.setIndex(this.idxAttr)
    this.geom.setDrawRange(0,0)
  }

  cull(visibleTiles:Set<Tile>, farTiles?:Set<Tile>) {
    if(!this.slices.length||!this.idxAttr) { this.mesh.visible = false; return }
    let mask = ''
    for(let i=0;i<this.slices.length;i++) mask += visibleTiles.has(this.slices[i].tile) ? (farTiles?.has(this.slices[i].tile)?'2':'1') : '0'
    if(mask===this.lastMask) return
    this.lastMask = mask
    let cursor = 0
    for(const slice of this.slices) {
      if(!visibleTiles.has(slice.tile)) continue
      const count=farTiles?.has(slice.tile)?slice.farCount:slice.count
      const indices=slice.indices
      if(indices && !slice.vertexStart){
        this.idxArray.set(indices.subarray(0,count),cursor)
      }else{
        for(let i=0;i<count;i++)this.idxArray[cursor+i]=slice.vertexStart+(indices?indices[i]:i)
      }
      cursor+=count
    }
    this.idxAttr.clearUpdateRanges()
    if(cursor>0) this.idxAttr.addUpdateRange(0,cursor)
    this.idxAttr.needsUpdate = true
    this.geom.setDrawRange(0,cursor)
    this.mesh.visible = cursor>0
  }
}

type AttrDef = {name:string;size:number;ctor:'f32'|'u8'}

const BUILDING_ATTRS:AttrDef[] = [
  {name:'position',size:3,ctor:'f32'},
  {name:'normal',size:3,ctor:'f32'},
  {name:'color',size:3,ctor:'f32'},
  {name:'aFloor',size:1,ctor:'f32'},
  {name:'aFacade',size:1,ctor:'f32'},
  {name:'aKind',size:1,ctor:'u8'},
  {name:'aRoof',size:1,ctor:'u8'},
]
const WATER_ATTRS:AttrDef[] = [{name:'position',size:3,ctor:'f32'}]
const BRIDGE_ATTRS:AttrDef[] = [
  {name:'position',size:3,ctor:'f32'},
  {name:'normal',size:3,ctor:'f32'},
  {name:'color',size:3,ctor:'f32'},
  {name:'aEdge',size:1,ctor:'f32'},
]
const STREET_ATTRS:AttrDef[] = [
  {name:'aSurface',size:1,ctor:'u8'},
  {name:'aAlong',size:1,ctor:'f32'},
  {name:'position',size:3,ctor:'f32'},
  {name:'normal',size:3,ctor:'f32'},
  {name:'color',size:3,ctor:'f32'},
]

// A bucket owns the merged geometry of a small group of tiles. Adding or dropping one tile only
// rebuilds its own bucket, so the cost stops scaling with how far the player has already walked.
// ?nobatch=1 collapses this to a single bucket for ablation runs.
// Default 3 tiles per side keeps the usual 480 m view inside two or three buckets, so the extra
// draw calls stay in single digits while a rebuild still only touches ~9 tiles instead of every
// tile the player has ever visited. ?buckets=N retunes the split, ?nobatch=1 collapses it to one
// bucket, so the draw-call / rebuild trade-off can be measured instead of guessed.

function bucketKey(tile:Tile) {
  const span = flags.noBatch ? Number.POSITIVE_INFINITY : 256 * flags.bucketTiles
  return `${Math.floor(tile.x/span)}:${Math.floor(tile.z/span)}`
}

class Bucket {
  readonly buildings:StaticLayerBatch
  readonly water:StaticLayerBatch
  readonly bridges:StaticLayerBatch
  readonly streets:StaticLayerBatch
  readonly items = new Map<Tile,TileBatchInput>()
  dirty = false

  constructor(private scene:THREE.Scene) {
    this.buildings = new StaticLayerBatch(buildingMaterial,BUILDING_ATTRS)
    this.water = new StaticLayerBatch(waterMaterial,WATER_ATTRS,WATER_LAYER)
    this.bridges = new StaticLayerBatch(bridgeMaterial,BRIDGE_ATTRS)
    this.streets = new StaticLayerBatch(streetSurfaceMat,STREET_ATTRS)
    scene.add(this.buildings.mesh,this.water.mesh,this.bridges.mesh,this.streets.mesh)
  }

  staticMeshes(){return [this.buildings.mesh,this.bridges.mesh]}

  rebuild() {
    this.dirty = false
    const wallList:{tile:Tile; geom:THREE.BufferGeometry}[] = []
    const waterList:{tile:Tile; geom:THREE.BufferGeometry}[] = []
    const bridgeList:{tile:Tile; geom:THREE.BufferGeometry}[] = []
    const streetList:{tile:Tile; geom:THREE.BufferGeometry}[] = []
    for(const [tile, item] of this.items) {
      if(item.walls) wallList.push({tile, geom:item.walls})
      if(item.pond?.length) {
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position',new THREE.BufferAttribute(item.pond,3))
        waterList.push({tile, geom:geometry})
      }
      if(item.bridge) bridgeList.push({tile, geom:item.bridge})
      if(item.streetSurface) streetList.push({tile, geom:item.streetSurface})
    }
    this.buildings.rebuild(wallList)
    this.water.rebuild(waterList)
    this.bridges.rebuild(bridgeList)
    this.streets.rebuild(streetList)
  }

  cull(visible:Set<Tile>, far:Set<Tile>, visibleStreets:Set<Tile>) {
    this.buildings.cull(visible,far)
    this.water.cull(visible)
    this.bridges.cull(visible)
    this.streets.cull(visibleStreets)
  }

  dispose() {
    for(const mesh of [this.buildings.mesh,this.water.mesh,this.bridges.mesh,this.streets.mesh]) {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
    }
  }
}

export class ChunkBatcher {
  feedbackMeshes(){return [...this.buckets.values()].flatMap(bucket=>bucket.staticMeshes())}
  private items = new Map<Tile,TileBatchInput>()
  private lastFocus = new THREE.Vector3(Infinity,Infinity,Infinity)
  private lastPos = new THREE.Vector3(Infinity,Infinity,Infinity)
  private lastQuat = new THREE.Quaternion()
  private lastMirror = NaN
  private lastHorizon = NaN
  private lastBuildingLod = NaN
  private lastStreetRadius = NaN
  private frustum = new THREE.Frustum()
  private projScreen = new THREE.Matrix4()
  private pt = new THREE.Vector3()

  private buckets = new Map<string,Bucket>()

  private furniture:THREE.InstancedMesh|null = null
  private parked:THREE.InstancedMesh|null = null
  private takenBikes=new Set<string>()

  nearestBike(x:number,z:number,footY:number|undefined,reach:number):ParkedBike|null {
    let nearest:ParkedBike|null=null, best=reach*reach
    for(const {tile,parked} of this.items.values()){
      if(x<tile.x-reach||x>tile.x+256+reach||z<tile.z-reach||z>tile.z+256+reach)continue
      for(let offset=0;offset<parked.length;offset+=16){
        const east=parked[offset+12],height=parked[offset+13],south=parked[offset+14]
        const distance=(east-x)**2+(south-z)**2
        if(distance>=best||footY!==undefined&&Math.abs(footY-height)>1.5)continue
        const id=`${tile.x}:${tile.z}:${offset/16}`
        if(this.takenBikes.has(id)||vehicleForbiddenAt(east,south))continue
        nearest={id,x:east,y:height,z:south,yaw:Math.atan2(parked[offset+8],parked[offset+10])};best=distance
      }
    }
    return nearest
  }

  takeBike(id:string){
    if(this.takenBikes.has(id))return false
    const [east,south,index]=id.split(':').map(Number)
    if(!Number.isInteger(index)||index<0||id!==`${east}:${south}:${index}`)return false
    for(const {tile,parked} of this.items.values()){
      if(tile.x!==east||tile.z!==south||index>=parked.length/16)continue
      if(vehicleForbiddenAt(parked[16*index+12],parked[16*index+14]))return false
      this.takenBikes.add(id);this.furnitureStale=true;return true
    }
    return false
  }

  returnBike(id:string){if(this.takenBikes.delete(id))this.furnitureStale=true}
  private lastFurnitureMask = ''
  private furnitureStale = false
  private lastFurniturePos = new THREE.Vector3(Infinity,Infinity,Infinity)

  constructor(private scene:THREE.Scene) {}

  add(input:TileBatchInput) {
    const {tile} = input
    if(input.walls) shiftPositions(input.walls,tile.x,tile.z)
    if(input.bridge) shiftPositions(input.bridge,tile.x,tile.z)
    if(input.streetSurface) shiftPositions(input.streetSurface,tile.x,tile.z)
    for(const mats of [input.furnitureMatrices,input.parked])for(let i=0;i<mats.length;i+=16) { mats[i+12]+=tile.x; mats[i+14]+=tile.z }
    this.items.set(tile,input)
    const key = bucketKey(tile)
    let bucket = this.buckets.get(key)
    if(!bucket) { bucket = new Bucket(this.scene); this.buckets.set(key,bucket) }
    bucket.items.set(tile,input)
    bucket.dirty = true
  }

  remove(tile:Tile) {
    if(!this.items.delete(tile)) return
    const key = bucketKey(tile)
    const bucket = this.buckets.get(key)
    if(!bucket) return
    bucket.items.delete(tile)
    if(bucket.items.size) { bucket.dirty = true; return }
    bucket.dispose()
    this.buckets.delete(key)
    // The emptied bucket's street furniture lives in the shared instance meshes, so the selection
    // has to be redone even if the camera never moves again.
    this.furnitureStale = true
  }

  private anyDirty() {
    for(const bucket of this.buckets.values()) if(bucket.dirty) return true
    return false
  }

  private rebuildDirty() {
    let rebuilt = false
    for(const bucket of this.buckets.values()) if(bucket.dirty) { bucket.rebuild(); rebuilt = true }
    // Only a geometry rebuild invalidates the furniture selection; a pure camera turn must not
    // re-run the selection loop and re-upload the instance buffers.
    if(rebuilt) this.lastFurnitureMask = ''
    return rebuilt
  }

  update(focus:THREE.Vector3, camera:THREE.PerspectiveCamera, mirrorLevel=148, range?:{cullHorizon?:number; buildingFarLod?:number; streetRadius?:number}) {
    const cullHorizon = range?.cullHorizon ?? look.fogHorizonTo
    const buildingFarLod = range?.buildingFarLod ?? 280
    const streetRadius = range?.streetRadius ?? 300
    if(!this.items.size) {
      this.rebuildDirty()
      if(this.furniture) this.furniture.visible = false
      if(this.parked) this.parked.visible=false
      return
    }
    const moved = focus.distanceToSquared(this.lastFocus)>=4 ||
      camera.position.distanceToSquared(this.lastPos)>=4 ||
      this.lastQuat.angleTo(camera.quaternion)>=.012 ||
      cullHorizon!==this.lastHorizon ||
      buildingFarLod!==this.lastBuildingLod ||
      streetRadius!==this.lastStreetRadius ||
      !(mirrorLevel===this.lastMirror || (Number.isFinite(mirrorLevel) && Number.isFinite(this.lastMirror) && Math.abs(mirrorLevel-this.lastMirror)<.5))
    if(!moved && !this.anyDirty() && !this.furnitureStale) return

    this.rebuildDirty()
    this.lastFocus.copy(focus); this.lastPos.copy(camera.position); this.lastQuat.copy(camera.quaternion); this.lastMirror = mirrorLevel
    this.lastHorizon = cullHorizon; this.lastBuildingLod = buildingFarLod; this.lastStreetRadius = streetRadius
    camera.updateMatrixWorld()
    this.frustum.setFromProjectionMatrix(this.projScreen.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))
    const mirrorOn = Number.isFinite(mirrorLevel) && camera.position.y>=mirrorLevel+.2 && camera.position.y<=4000

    const visibleChunks = new Set<Tile>()
    const farBuildings = new Set<Tile>()
    const visibleStreets = new Set<Tile>()
    let furnMask = ''

    for(const [tile, item] of this.items) {
      const cx = tile.x+128, cz = tile.z+128
      const cy = (item.minY+item.maxY)*.5
      const halfH = Math.max(20,(item.maxY-item.minY)*.5+35)
      // Bounding sphere of a 256×256 tile prism: sqrt(128^2 + 128^2 + halfH^2).
      const radius = Math.hypot(181.02,halfH)
      this.pt.set(cx,cy,cz)
      if(this.pt.distanceTo(camera.position)-radius>cullHorizon){furnMask+='0';continue}
      let vis = inFrustum(this.frustum,this.pt,radius)
      if(!vis && mirrorOn && cy+radius>=mirrorLevel) {
        this.pt.set(cx,2*mirrorLevel-cy,cz)
        vis = inFrustum(this.frustum,this.pt,radius)
      }
      if(vis) {
        visibleChunks.add(tile)
        if(this.pt.set(cx,cy,cz).distanceTo(camera.position)-radius>buildingFarLod)farBuildings.add(tile)
        const nearStreet = Math.hypot(
          Math.max(0,Math.abs(focus.x-cx)-128),
          Math.max(0,Math.abs(focus.z-cz)-128),
          focus.y-item.midY,
        )<=streetRadius
        if(nearStreet) {
          visibleStreets.add(tile)
          furnMask += '1'
          continue
        }
      }
      furnMask += '0'
    }

    for(const bucket of this.buckets.values()) bucket.cull(visibleChunks,farBuildings,visibleStreets)

    if(this.furnitureStale || furnMask!==this.lastFurnitureMask || camera.position.distanceToSquared(this.lastFurniturePos)>=4) {
      this.furnitureStale = false
      this.lastFurnitureMask = furnMask
      this.lastFurniturePos.copy(camera.position)
      const near=(matrices:Float32Array,index:number,radius=30)=>{
        const offset=index*16,position=camera.position
        return (matrices[offset+12]-position.x)**2+(matrices[offset+13]-position.y)**2+(matrices[offset+14]-position.z)**2<=radius**2
      }
      const selections=Array.from(visibleStreets,tile=>{
        const item=this.items.get(tile)!, bikes:number[]=[],boxes:number[]=[]
        const position=camera.position
        const tileDistance=Math.max(tile.x-position.x,position.x-tile.x-256,tile.z-position.z,position.z-tile.z-256)
        if(tileDistance<=122){
          for(let index=0;index<item.railLodCount;index++)if(near(item.furnitureMatrices,index,120))boxes.push(index)
        }
        if(tileDistance<=32){
          for(let index=0;index<item.parked.length/16;index++)if(near(item.parked,index)&&(!this.takenBikes.size||!this.takenBikes.has(`${tile.x}:${tile.z}:${index}`)))bikes.push(index)
          for(let index=item.railLodCount;index<item.detailCount;index++)if(near(item.furnitureMatrices,index))boxes.push(index)
        }
        return {item,bikes,boxes}
      })
      const count=selections.reduce((total,{bikes})=>total+bikes.length,0)
      if(count && (!this.parked || this.parked.instanceMatrix.count<count)){
        if(this.parked){this.scene.remove(this.parked);this.parked.dispose()}
        const bike=vehicleModel('bike',1)
        this.parked=new THREE.InstancedMesh(bike.geometry,bike.material,2**Math.ceil(Math.log2(count)))
        this.parked.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(this.parked.instanceMatrix.count*3),3)
        const shared=new THREE.Color(look.streets.sharedBike),privateBike=new THREE.Color(0xffffff)
        for(let index=0;index<this.parked.instanceMatrix.count;index++)this.parked.setColorAt(index,Math.floor(index/3)%3===0?shared:privateBike)
        this.parked.frustumCulled=false;this.scene.add(freezeStatic(this.parked))
      }
      if(this.parked){
        this.parked.visible=!!count;this.parked.count=count;let offset=0
        for(const {item,bikes} of selections)for(const index of bikes){this.parked.instanceMatrix.array.set(item.parked.subarray(index*16,index*16+16),offset);offset+=16}
        this.parked.instanceMatrix.clearUpdateRanges();this.parked.instanceMatrix.addUpdateRange(0,offset)
        this.parked.instanceMatrix.needsUpdate=true
      }
      const boxCount=selections.reduce((total,{item,boxes})=>total+item.furnitureMatrices.length/16-item.detailCount+boxes.length,0)
      if(!boxCount) {
        if(this.furniture) this.furniture.visible = false
        return
      }
      if(!this.furniture || this.furniture.instanceMatrix.count<boxCount) {
        if(this.furniture) { this.scene.remove(this.furniture); this.furniture.dispose() }
        const cap = Math.max(64,2**Math.ceil(Math.log2(boxCount)))
        this.furniture = new THREE.InstancedMesh(streetFurnitureGeo,streetFurnitureMat,cap)
        this.furniture.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap*3),3)
        this.furniture.frustumCulled = false
        this.scene.add(freezeStatic(this.furniture))
      }
      const matArr = this.furniture.instanceMatrix.array as Float32Array
      const colArr = this.furniture.instanceColor!.array as Float32Array
      let mCursor = 0, cCursor = 0
      for(const {item,boxes} of selections) {
        for(const index of boxes){
          matArr.set(item.furnitureMatrices.subarray(index*16,index*16+16),mCursor);mCursor+=16
          colArr.set(item.furnitureColors.subarray(index*3,index*3+3),cCursor);cCursor+=3
        }
        const matrices=item.furnitureMatrices.subarray(item.detailCount*16),colors=item.furnitureColors.subarray(item.detailCount*3)
        matArr.set(matrices,mCursor);mCursor+=matrices.length
        colArr.set(colors,cCursor);cCursor+=colors.length
      }
      this.furniture.count = boxCount
      this.furniture.visible = true
      this.furniture.instanceMatrix.clearUpdateRanges()
      this.furniture.instanceMatrix.addUpdateRange(0,mCursor)
      this.furniture.instanceMatrix.needsUpdate = true
      this.furniture.instanceColor!.clearUpdateRanges()
      this.furniture.instanceColor!.addUpdateRange(0,cCursor)
      this.furniture.instanceColor!.needsUpdate = true
    }
  }
}
