import * as THREE from 'three'
import {buildingMaterial} from './look/buildings'
import {bridgeMaterial} from './look/bridge'
import {WATER_LAYER, waterMaterial} from './look/water'
import {streetFurnitureGeo, streetFurnitureMat, streetSurfaceMat} from './streets'
import type {Tile} from './world'
import {vehicleModel} from './walk/vehicle-model'
import {look} from './look/config'

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
  indices:Uint32Array
}

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
    this.mesh = new THREE.Mesh(this.geom,material)
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
    for(const def of this.attrDefs) {
      const merged = def.ctor==='u8' ? new Uint8Array(totalVerts*def.size) : new Float32Array(totalVerts*def.size)
      let offset = 0
      for(const {geom} of entries) {
        const src = geom.getAttribute(def.name).array as Float32Array|Uint8Array
        merged.set(src,offset)
        offset += src.length
      }
      this.geom.setAttribute(def.name,new THREE.BufferAttribute(merged,def.size))
    }

    const slices:IndexedSlice[] = []
    let vStart = 0
    for(const {tile, geom} of entries) {
      const vCount = geom.getAttribute('position').count
      let idx:Uint32Array
      if(geom.index) {
        const src = geom.index.array
        idx = new Uint32Array(src.length)
        for(let i=0;i<src.length;i++) idx[i] = src[i]+vStart
      } else {
        idx = new Uint32Array(vCount)
        for(let i=0;i<vCount;i++) idx[i] = vStart+i
      }
      slices.push({tile, indices:idx,farCount:geom.userData.farIndexCount??idx.length})
      vStart += vCount
    }
    this.slices = slices
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
      const indices=farTiles?.has(slice.tile)?slice.indices.subarray(0,slice.farCount):slice.indices
      this.idxArray.set(indices,cursor)
      cursor += indices.length
    }
    this.idxAttr.clearUpdateRanges()
    if(cursor>0) this.idxAttr.addUpdateRange(0,cursor)
    this.idxAttr.needsUpdate = true
    this.geom.setDrawRange(0,cursor)
    this.mesh.visible = cursor>0
  }
}

export class ChunkBatcher {
  private items = new Map<Tile,TileBatchInput>()
  private dirty = false
  private lastFocus = new THREE.Vector3(Infinity,Infinity,Infinity)
  private lastPos = new THREE.Vector3(Infinity,Infinity,Infinity)
  private lastQuat = new THREE.Quaternion()
  private lastMirror = NaN
  private frustum = new THREE.Frustum()
  private projScreen = new THREE.Matrix4()
  private pt = new THREE.Vector3()

  private buildings = new StaticLayerBatch(buildingMaterial,[
    {name:'position',size:3,ctor:'f32'},
    {name:'normal',size:3,ctor:'f32'},
    {name:'color',size:3,ctor:'f32'},
    {name:'aFloor',size:1,ctor:'f32'},
    {name:'aFacade',size:1,ctor:'f32'},
    {name:'aKind',size:1,ctor:'u8'},
    {name:'aRoof',size:1,ctor:'u8'},
  ])
  private water = new StaticLayerBatch(waterMaterial,[
    {name:'position',size:3,ctor:'f32'},
  ],WATER_LAYER)
  private bridges = new StaticLayerBatch(bridgeMaterial,[
    {name:'position',size:3,ctor:'f32'},
    {name:'normal',size:3,ctor:'f32'},
    {name:'color',size:3,ctor:'f32'},
    {name:'aEdge',size:1,ctor:'f32'},
  ])
  private streets = new StaticLayerBatch(streetSurfaceMat,[
    {name:'aSurface',size:1,ctor:'u8'},
    {name:'aAlong',size:1,ctor:'f32'},
    {name:'position',size:3,ctor:'f32'},
    {name:'normal',size:3,ctor:'f32'},
    {name:'color',size:3,ctor:'f32'},
  ])

  private furniture:THREE.InstancedMesh|null = null
  private parked:THREE.InstancedMesh|null = null
  private lastFurnitureMask = ''
  private lastFurniturePos = new THREE.Vector3(Infinity,Infinity,Infinity)

  constructor(private scene:THREE.Scene) {
    scene.add(this.buildings.mesh,this.water.mesh,this.bridges.mesh,this.streets.mesh)
  }

  add(input:TileBatchInput) {
    const {tile} = input
    if(input.walls) shiftPositions(input.walls,tile.x,tile.z)
    if(input.bridge) shiftPositions(input.bridge,tile.x,tile.z)
    if(input.streetSurface) shiftPositions(input.streetSurface,tile.x,tile.z)
    for(const mats of [input.furnitureMatrices,input.parked])for(let i=0;i<mats.length;i+=16) { mats[i+12]+=tile.x; mats[i+14]+=tile.z }
    this.items.set(tile,input)
    this.dirty = true
  }

  remove(tile:Tile) {
    if(this.items.delete(tile)) this.dirty = true
  }

  private rebuildStatic() {
    this.dirty = false
    const wallList:{tile:Tile; geom:THREE.BufferGeometry}[] = []
    const waterList:{tile:Tile; geom:THREE.BufferGeometry}[] = []
    const bridgeList:{tile:Tile; geom:THREE.BufferGeometry}[] = []
    const streetList:{tile:Tile; geom:THREE.BufferGeometry}[] = []

    for(const [tile, item] of this.items) {
      if(item.walls) wallList.push({tile, geom:item.walls})
      if(item.pond?.length) {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position',new THREE.BufferAttribute(item.pond,3))
        waterList.push({tile, geom:g})
      }
      if(item.bridge) bridgeList.push({tile, geom:item.bridge})
      if(item.streetSurface) streetList.push({tile, geom:item.streetSurface})
    }
    this.buildings.rebuild(wallList)
    this.water.rebuild(waterList)
    this.bridges.rebuild(bridgeList)
    this.streets.rebuild(streetList)
    this.lastFurnitureMask = ''
  }

  update(focus:THREE.Vector3, camera:THREE.PerspectiveCamera, mirrorLevel=148) {
    if(!this.items.size) {
      if(this.dirty) this.rebuildStatic()
      if(this.furniture) this.furniture.visible = false
      if(this.parked) this.parked.visible=false
      return
    }
    const moved = focus.distanceToSquared(this.lastFocus)>=4 ||
      camera.position.distanceToSquared(this.lastPos)>=4 ||
      this.lastQuat.angleTo(camera.quaternion)>=.012 ||
      !(mirrorLevel===this.lastMirror || (Number.isFinite(mirrorLevel) && Number.isFinite(this.lastMirror) && Math.abs(mirrorLevel-this.lastMirror)<.5))
    if(!this.dirty && !moved) return

    if(this.dirty) this.rebuildStatic()
    this.lastFocus.copy(focus); this.lastPos.copy(camera.position); this.lastQuat.copy(camera.quaternion); this.lastMirror = mirrorLevel
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
      if(this.pt.distanceTo(camera.position)-radius>look.fogHorizonTo){furnMask+='0';continue}
      let vis = inFrustum(this.frustum,this.pt,radius)
      if(!vis && mirrorOn && cy+radius>=mirrorLevel) {
        this.pt.set(cx,2*mirrorLevel-cy,cz)
        vis = inFrustum(this.frustum,this.pt,radius)
      }
      if(vis) {
        visibleChunks.add(tile)
        if(this.pt.set(cx,cy,cz).distanceTo(camera.position)-radius>280)farBuildings.add(tile)
        const nearStreet = Math.hypot(
          Math.max(0,Math.abs(focus.x-cx)-128),
          Math.max(0,Math.abs(focus.z-cz)-128),
          focus.y-item.midY,
        )<=300
        if(nearStreet) {
          visibleStreets.add(tile)
          furnMask += '1'
          continue
        }
      }
      furnMask += '0'
    }

    this.buildings.cull(visibleChunks,farBuildings)
    this.water.cull(visibleChunks)
    this.bridges.cull(visibleChunks)
    this.streets.cull(visibleStreets)

    if(furnMask!==this.lastFurnitureMask || camera.position.distanceToSquared(this.lastFurniturePos)>=4) {
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
          for(let index=0;index<item.parked.length/16;index++)if(near(item.parked,index))bikes.push(index)
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
        this.parked.frustumCulled=false;this.scene.add(this.parked)
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
        this.scene.add(this.furniture)
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
