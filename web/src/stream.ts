import * as THREE from 'three'
import {ChunkBatcher} from './batch'
import {Forest} from './forest'
import {currentMirrorLevel, isWaterInView} from './look/water'
import {detail, type Manifest, type Tile, overview} from './world'

export class Stream {
  landmarks:import('./landmarks').LoadedLandmarks=new Map()
  loaded = new Map<Tile,Awaited<ReturnType<typeof detail>>>()
  pending = new Map<Tile,AbortController>()
  failures = new Map<Tile,number>()
  visited = new Set<Tile>()
  forest:Forest
  batches:ChunkBatcher
  constructor(private scene:THREE.Scene, private manifest:Manifest, private base:Awaited<ReturnType<typeof overview>>,public radius:number,private camera:THREE.PerspectiveCamera) {
    this.forest=new Forest(scene,manifest.chunks,camera)
    this.batches=new ChunkBatcher(scene)
  }
  tick(position:THREE.Vector3) {
    this.forest.tick(position)
    const distance = (tile:Tile)=>Math.hypot(tile.x+128-position.x,tile.z+128-position.z)
    for(const [tile,item] of this.loaded) if(distance(tile)>this.radius+190) {
      this.batches.remove(tile); this.base.toggle(tile,true); this.scene.remove(item.group); item.dispose(); this.loaded.delete(tile)
    }
    this.batches.update(position,this.camera,isWaterInView(this.camera)?currentMirrorLevel(this.camera):-Infinity)
    for(const [tile,controller] of this.pending) if(distance(tile)>this.radius+190) controller.abort()
    if(this.pending.size>=2) return
    let nearest:Tile|undefined, best = this.radius
    for(const tile of this.manifest.chunks) {
      const dist = distance(tile)
      if(dist<=best && !this.loaded.has(tile) && !this.pending.has(tile) && (this.failures.get(tile)??0)<=performance.now()) {
        nearest=tile; best=dist
      }
    }
    if(!nearest) return
    const tile = nearest, controller = new AbortController()
    this.pending.set(tile,controller)
    detail(tile,controller.signal).then(item=>{
      if(controller.signal.aborted) {item.dispose();return}
      this.scene.add(item.group); this.batches.add(item.batch); this.base.toggle(tile,false); this.loaded.set(tile,item); this.visited.add(tile); this.failures.delete(tile)
    }).catch(error=>{
      if(!controller.signal.aborted) {console.error(tile.file,error); this.failures.set(tile,performance.now()+10000)}
    }).finally(()=>this.pending.delete(tile))
  }
}
