import * as THREE from 'three'
import {ChunkBatcher} from './batch'
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
import {detail, type Manifest, type Tile, overview} from './world'

export function tileCenterDistance(tile:Tile, position:THREE.Vector3){
  return Math.hypot(tile.x+128-position.x,tile.z+128-position.z)
}

export function tileEdgeDistance(tile:Tile, x:number, z:number){
  return Math.hypot(Math.max(0,Math.abs(x-tile.x-128)-128),Math.max(0,Math.abs(z-tile.z-128)-128))
}

export class Stream {
  overviewMesh(){return this.base.mesh}
  landmarks:import('./landmarks').LoadedLandmarks=new Map()
  updateLandmarks?:ReturnType<typeof import('./landmarks').landmarkStream>
  loaded = new Map<Tile,Awaited<ReturnType<typeof detail>>>()
  pending = new Map<Tile,AbortController>()
  failures = new Map<Tile,number>()
  visited = new Set<Tile>()
  forest:Forest
  batches:ChunkBatcher
  readonly rangeStore:RenderRangeStore
  private priorityTarget:THREE.Vector3|null = null
  private priorityUntil = 0
  private lastPosition = new THREE.Vector3(Infinity,0,0)
  private innerPending = new Set<Tile>()

  constructor(
    private scene:THREE.Scene,
    private manifest:Manifest,
    private base:Awaited<ReturnType<typeof overview>>,
    rangeOrRadius:number|RenderRangeStore|RenderRangeConfig = RENDER_RADIUS_DEFAULT,
    private camera:THREE.PerspectiveCamera,
  ) {
    this.rangeStore = rangeOrRadius instanceof RenderRangeStore ? rangeOrRadius : new RenderRangeStore(rangeOrRadius)
    const initialMetrics = this.rangeStore.getMetrics()
    this.forest = new Forest(scene,manifest.chunks,camera,initialMetrics)
    this.batches = new ChunkBatcher(scene)
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

  private hasUnloadedInner(x:number, z:number, metrics:RenderRangeMetrics, now:number){
    for(const tile of this.manifest.chunks){
      if(tileEdgeDistance(tile,x,z)<=metrics.spawnRingEdge && !this.loaded.has(tile) && (this.failures.get(tile)??0)<=now) return true
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
    this.pending.set(tile,controller)
    if(inner) this.innerPending.add(tile)
    detail(tile,controller.signal).then(item=>{
      if(controller.signal.aborted){item.dispose();return}
      this.scene.add(item.group);this.batches.add(item.batch);this.base.toggle(tile,false)
      this.loaded.set(tile,item);this.visited.add(tile);this.failures.delete(tile)
    }).catch(error=>{
      if(!controller.signal.aborted){console.error(tile.file,error);this.failures.set(tile,performance.now()+10000)}
    }).finally(()=>{
      this.pending.delete(tile)
      this.innerPending.delete(tile)
    })
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

    const innerTiles:Tile[] = []
    for(const tile of this.manifest.chunks){
      if(tileEdgeDistance(tile,focus.x,focus.z)<=innerEdge && !this.loaded.has(tile) && !this.pending.has(tile) && (this.failures.get(tile)??0)<=now){
        innerTiles.push(tile)
      }
    }
    const innerBusy = innerTiles.length>0 || this.innerPending.size>0 || (this.updateLandmarks?.busyPriorityCount?.()??0)>0

    this.forest.tick(position,innerBusy)

    for(const [tile,item] of this.loaded){
      const keepInner = tileEdgeDistance(tile,focus.x,focus.z)<=innerEdge || tileEdgeDistance(tile,position.x,position.z)<=innerEdge
      if(!keepInner && tileCenterDistance(tile,position)>metrics.unloadRadius){
        this.batches.remove(tile);this.base.toggle(tile,true);this.scene.remove(item.group);item.dispose();this.loaded.delete(tile)
      }
    }

    this.batches.update(position,this.camera,isWaterInView(this.camera)?currentMirrorLevel(this.camera):-Infinity,{
      cullHorizon:metrics.cullHorizon,
      buildingFarLod:metrics.buildingFarLod,
      streetRadius:metrics.streetRadius,
    })

    for(const [tile,controller] of this.pending){
      const keepInner = tileEdgeDistance(tile,focus.x,focus.z)<=innerEdge || tileEdgeDistance(tile,position.x,position.z)<=innerEdge
      if(!keepInner && tileCenterDistance(tile,position)>metrics.unloadRadius) controller.abort()
    }

    if(innerTiles.length){
      innerTiles.sort((a,b)=>tileEdgeDistance(a,focus.x,focus.z)-tileEdgeDistance(b,focus.x,focus.z))
      for(const tile of innerTiles){
        if(this.innerPending.size>=4 || this.pending.size>=6) break
        this.enqueue(tile,true)
      }
      return
    }
    if(innerBusy) return

    const outerTiles:{tile:Tile; dist:number}[] = []
    for(const tile of this.manifest.chunks){
      if(this.loaded.has(tile)||this.pending.has(tile)||(this.failures.get(tile)??0)>now) continue
      const dist = tileCenterDistance(tile,position)
      if(dist<=metrics.radius) outerTiles.push({tile,dist})
    }
    if(!outerTiles.length) return
    outerTiles.sort((a,b)=>a.dist-b.dist)
    const maxAllowed = outerTiles[0].dist<=metrics.nearLoadRadius ? metrics.nearConcurrency : metrics.outerConcurrency
    let launched = 0
    for(const {tile} of outerTiles){
      if(this.pending.size>=maxAllowed || launched>=2) break
      this.enqueue(tile,false)
      launched++
    }
  }
}
