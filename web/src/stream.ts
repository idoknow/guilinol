import {fault,record} from './telemetry'
import * as THREE from 'three'
import {ChunkBatcher} from './batch'
import {DistantBuildings} from './distant-buildings'
import {Forest} from './forest'
import {setTreeFar} from './look/trees'
import {setFogMetrics} from './look/time'
import {currentMirrorLevel, isWaterInView} from './look/water'
import {
  RENDER_RADIUS_DEFAULT,
  RenderRangeStore,
  type RenderConfigSource,
  type RenderRangeConfig,
  type RenderRangeListener,
  type RenderRangeMetrics,
} from './render-range'
import {detail, type Manifest, type Tile} from './world'
import {registerTunnels, loadShizijieUnderground} from './tunnels'
import {freezeStatic} from './static-freeze'

import {TileGrid, streamBudget, frameSlots, tileEdgeDistance} from './tile-grid'
export function tileCenterDistance(tile:Tile, position:THREE.Vector3){
  return Math.hypot(tile.x+128-position.x,tile.z+128-position.z)
}

type TerrainLayer = {mesh:THREE.Object3D; toggle(tile:Tile, show:boolean):void}

export class Stream {
  private distant?:DistantBuildings
  private revision=0
  readonly grid: TileGrid
  private parseSlot = frameSlots(streamBudget.parseMs)
  private attachSlot = frameSlots(streamBudget.attachMs)
  overviewMesh(){return this.base.mesh}
  landmarks:import('./landmarks').LoadedLandmarks=new Map()
  updateLandmarks?:ReturnType<typeof import('./landmarks').landmarkStream>
  loaded = new Map<Tile,Awaited<ReturnType<typeof detail>>>()
  pending = new Map<Tile,AbortController>()
  onPendingChange?:()=>void
  failures = new Map<Tile,number>()
  visited = new Set<Tile>()
  forest:Forest
  batches:ChunkBatcher
  readonly rangeStore:RenderRangeStore
  private priorityTarget:THREE.Vector3|null = null
  private priorityUntil = 0
  private lastPosition = new THREE.Vector3(Infinity,0,0)
  private queue:Tile[]=[]
  private queueIsInner=false
  private innerPending = new Set<Tile>()

  constructor(
    private scene:THREE.Scene,
    private manifest:Manifest,
    private base:TerrainLayer,
    rangeOrRadius:number|RenderRangeStore|RenderRangeConfig = RENDER_RADIUS_DEFAULT,
    private camera:THREE.PerspectiveCamera,
  ) {
    this.rangeStore = rangeOrRadius instanceof RenderRangeStore ? rangeOrRadius : new RenderRangeStore(rangeOrRadius)
    const initialMetrics = this.rangeStore.getMetrics()
    this.grid = new TileGrid(manifest)
    if(manifest.distantBuildings)this.distant=new DistantBuildings(scene,manifest.distantBuildings.file,manifest.chunks)
    this.forest = new Forest(scene,this.grid,camera,initialMetrics)
    this.batches = new ChunkBatcher(scene)
    registerTunnels(manifest.tunnels,manifest.groundCutouts,manifest.shizijieUnderpass)
    void loadShizijieUnderground()
    this.syncMetrics(initialMetrics)
    this.rangeStore.subscribe((_cfg, metrics)=>{
      this.syncMetrics(metrics)
      if(Number.isFinite(this.lastPosition.x)){
        this.tick(this.lastPosition)
        this.updateLandmarks?.(this.lastPosition)
      }
    })
  }

  get radius(){return this.rangeStore.getMetrics().radius}
  set radius(value:number){this.setRadius(value)}
  get metrics():RenderRangeMetrics{return this.rangeStore.getMetrics()}
  getConfig():RenderRangeConfig{return this.rangeStore.getConfig()}

  setRadius(radius:number, options?:{persist?:boolean; source?:RenderConfigSource}){
    return this.rangeStore.set(radius,options)
  }

  setRenderRange(next:Partial<RenderRangeConfig>|number|string, options?:{persist?:boolean; source?:RenderConfigSource}){
    return this.rangeStore.set(next,options)
  }

  resetRenderRange(){
    return this.rangeStore.reset()
  }

  onRangeChange(listener:RenderRangeListener){
    return this.rangeStore.subscribe(listener)
  }

  prioritize(x:number, z:number, durationMs=12000){
    this.priorityTarget = new THREE.Vector3(x,0,z)
    this.priorityUntil = performance.now()+durationMs
  }

  clearPriority(){
    this.priorityTarget = null
    this.priorityUntil = 0
  }

  private syncMetrics(metrics:RenderRangeMetrics){
    this.forest.setRange(metrics)
    setTreeFar(metrics.treeFar)
    setFogMetrics(metrics)
    const nextFar = Math.max(metrics.fogHorizonTo+1200, 7500)
    if(Math.abs(this.camera.far-nextFar)>1){
      this.camera.far = nextFar
      this.camera.updateProjectionMatrix()
    }
  }

  private *innerTiles(x:number,z:number,metrics:RenderRangeMetrics){
    const radius=streamBudget.priorityRadius
    for(const tile of this.grid.near(x,z,Math.max(radius,metrics.spawnRingEdge+128))){
      if(Math.hypot(tile.x+128-x,tile.z+128-z)<=radius || tileEdgeDistance(tile,x,z)<=metrics.spawnRingEdge)yield tile
    }
  }

  // During opening, attach real chunks against the first terrain LOD. Keep
  // these same objects when the full overview and its water layer arrive.
  async loadOpeningRing(position:THREE.Vector3,progress?:(done:number,total:number)=>void){
    this.lastPosition.copy(position)
    const tiles=Array.from(this.innerTiles(position.x,position.z,this.metrics))
      .sort((a,b)=>tileCenterDistance(a,position)-tileCenterDistance(b,position))
    let done=0
    progress?.(0,tiles.length)
    for(let i=0;i<tiles.length;i+=streamBudget.innerRequests){
      const batch=tiles.slice(i,i+streamBudget.innerRequests)
      await Promise.all(batch.map(async tile=>{
        for(let attempt=1;;attempt++){
          await this.enqueue(tile,true)
          if(this.loaded.has(tile))break
          const retryAt=this.failures.get(tile)
          if(attempt===3||retryAt===undefined)throw Error('网络中断：街区数据下载失败')
          await new Promise(resolve=>setTimeout(resolve,Math.max(0,retryAt-performance.now())))
        }
        progress?.(++done,tiles.length)
      }))
    }
    this.updateBatches(position)
  }

  setTerrainLayer(layer:TerrainLayer){
    this.base=layer
    for(const tile of this.loaded.keys())layer.toggle(tile,false)
  }

  private hasUnloadedInner(x:number, z:number, metrics:RenderRangeMetrics, now:number){
    for(const tile of this.innerTiles(x,z,metrics)){
      if(!this.loaded.has(tile) && (this.failures.get(tile)??0)<=now) return true
    }
    return false
  }

  isInnerBusy(position=this.lastPosition){
    const m = this.rangeStore.getMetrics()
    const now = performance.now()
    const focus = this.priorityTarget && now<this.priorityUntil ? this.priorityTarget : position
    if(!Number.isFinite(focus.x)) return false
    if(this.hasUnloadedInner(focus.x,focus.z,m,now)) return true
    return (this.updateLandmarks?.busyPriorityCount?.()??0)>0
  }

  private enqueue(tile:Tile, inner:boolean){
    const controller = new AbortController()
    if(this.failures.has(tile))record('retry',{category:'chunk'})
    this.pending.set(tile,controller)
    this.onPendingChange?.()
    if(inner) this.innerPending.add(tile)
    const start=performance.now()
    // The inner ring is bounded in space and request count. Its decode and
    // attachment continuations run as data arrives, even on multi-second frames.
    const urgent=()=>inner || tileCenterDistance(tile,this.priorityTarget??this.lastPosition)<=streamBudget.priorityRadius
    const parseSlot=()=>urgent()?Promise.resolve():this.parseSlot()
    registerTunnels(this.manifest.tunnels,this.manifest.groundCutouts,this.manifest.shizijieUnderpass)
    return detail(tile,controller.signal,parseSlot,this.manifest.tunnels,this.manifest.groundCutouts,this.manifest.shizijieUnderpass).then(async item=>{
      if(!urgent())await this.attachSlot()
      if(controller.signal.aborted){item.dispose();return}
      this.scene.add(freezeStatic(item.group));this.batches.add(item.batch);this.base.toggle(tile,false)
      this.revision++;this.loaded.set(tile,item);this.visited.add(tile);this.failures.delete(tile)
      record('chunk',{ms:performance.now()-start,grid:Math.floor(tile.x/250)+','+Math.floor(tile.z/250)})
    }).catch(error=>{
      if(!controller.signal.aborted){record('failure',{category:'chunk'});fault('chunk','',0,error);console.error(tile.file,error);this.failures.set(tile,performance.now()+10000)}
    }).finally(()=>{
      this.pending.delete(tile)
      this.innerPending.delete(tile)
      this.fillRequests()
      this.onPendingChange?.()
    })
  }

  private fillRequests(){
    while(this.queue.length && this.pending.size<streamBudget.detailRequests){
      if(this.loaded.size+this.pending.size>=streamBudget.residentTiles)break
      if(this.queueIsInner && this.innerPending.size>=streamBudget.innerRequests)break
      this.enqueue(this.queue.pop()!,this.queueIsInner)
    }
  }

  tick(position:THREE.Vector3) {
    this.lastPosition.copy(position)
    const metrics = this.rangeStore.getMetrics()
    const now = performance.now()
    if(this.priorityTarget){
      const movedAway = Math.hypot(position.x-this.priorityTarget.x,position.z-this.priorityTarget.z)>Math.max(metrics.radius,320)
      if(now>=this.priorityUntil || movedAway || !this.hasUnloadedInner(this.priorityTarget.x,this.priorityTarget.z,metrics,now)){
        this.priorityTarget = null
        this.priorityUntil = 0
      }
    }
    const focus = this.priorityTarget ?? position
    const innerEdge = metrics.spawnRingEdge

    let waitingForInner=false
    const innerTiles:Tile[] = []
    for(const tile of this.innerTiles(focus.x,focus.z,metrics)){
      if(this.loaded.has(tile) || (this.failures.get(tile)??0)>now)continue
      waitingForInner=true
      if(!this.pending.has(tile))innerTiles.push(tile)
    }
    const innerBusy = waitingForInner || (this.updateLandmarks?.busyPriorityCount?.()??0)>0

    for(const [tile,item] of this.loaded){
      const keepInner = tileEdgeDistance(tile,focus.x,focus.z)<=innerEdge || tileEdgeDistance(tile,position.x,position.z)<=innerEdge
      if(!keepInner && tileCenterDistance(tile,position)>metrics.unloadRadius){
        this.batches.remove(tile);this.base.toggle(tile,true);this.scene.remove(item.group);item.dispose();this.loaded.delete(tile);this.revision++
      }
    }

    this.updateBatches(position)

    for(const [tile,controller] of this.pending){
      const keepInner = tileEdgeDistance(tile,focus.x,focus.z)<=innerEdge || tileEdgeDistance(tile,position.x,position.z)<=innerEdge
      if(!keepInner && tileCenterDistance(tile,position)>metrics.unloadRadius) controller.abort()
    }

    this.queueIsInner=innerBusy
    if(innerBusy){
      this.queue=innerTiles.sort((a,b)=>tileEdgeDistance(b,focus.x,focus.z)-tileEdgeDistance(a,focus.x,focus.z))
    }else{
      this.queue=Array.from(this.grid.near(position.x,position.z,metrics.radius))
        .filter(tile=>!this.loaded.has(tile)&&!this.pending.has(tile)&&(this.failures.get(tile)??0)<=now && tileCenterDistance(tile,position)<=metrics.radius)
        .sort((a,b)=>tileCenterDistance(b,position)-tileCenterDistance(a,position))
    }
    this.fillRequests()
    if(!innerBusy)this.distant?.tick(this.camera,this.loaded,this.revision)
    this.forest.tick(position,innerBusy)
  }

  updateBatches(position:THREE.Vector3){
    const metrics=this.metrics
    this.batches.update(position,this.camera,isWaterInView(this.camera)?currentMirrorLevel(this.camera):-Infinity,{
      cullHorizon:metrics.cullHorizon,
      buildingFarLod:metrics.buildingFarLod,
      streetRadius:metrics.streetRadius,
    })
  }
}
