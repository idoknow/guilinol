import * as THREE from 'three'
import {ChunkBatcher} from './batch'
import {flags} from './debug'
import {Forest} from './forest'
import {currentMirrorLevel, isWaterInView} from './look/water'
import {prewarmStreetWorker} from './street-loader'
import {detail, fetchAsset, type Manifest, type Tile, overview} from './world'

type LoadedTile = Awaited<ReturnType<typeof detail>>

/**
 * 街块流式加载。做法照开放世界那套：
 *
 * 1. **按「接下来会看到什么」排队**，不是按「离我多远」排队：正前方、以及顺着行走方向
 *    即将进入的块先到（GTA 的 streaming volume 就是这个意思）。
 * 2. **下载和解码分开限流**：网线可以同时挂好几条（手机上单条 TCP 起速很慢，
 *    只开 2 条等于浪费带宽），但每帧「上台」（挂进场景 + 重建批次）的块数有预算，
 *    不会一步到位地砸出长帧。
 * 3. **已经拿到的字节留在内存里**：走出半径再回来不用重新下载，来回走不再反复花流量。
 * 4. **加载屏期间先按目标点抓**（`prefetch`）：山体还在解压时，出生点周围就已经下载好了。
 */
export class Stream {
  overviewMesh(){return this.base.mesh}
  landmarks:import('./landmarks').LoadedLandmarks=new Map()
  updateLandmarks?:ReturnType<typeof import('./landmarks').landmarkStream>
  loaded = new Map<Tile,LoadedTile>()
  pending = new Map<Tile,AbortController>()
  failures = new Map<Tile,number>()
  visited = new Set<Tile>()
  /** 同时在解码的块数。手机网络单条连接起速慢，2 条会明显吃不满带宽。 */
  maxPending = 3
  /** 上一次解码耗时（ms），仅用于诊断。 */
  lastCost = 0
  /** 上一块完成的时间戳，仅用于诊断。 */
  lastFinish = 0
  /** 传送到新区域时暂停树木流式加载，先保证落地帧率。 */
  holdTrees = false
  forest:Forest
  batches:ChunkBatcher

  /** 解压过的块字节：按 LRU 存着，回头路不再走网线。 */
  private packed = new Map<string,ArrayBuffer>()
  private packedBytes = 0
  /** 解码好、等这一帧上台的块（每帧有预算，避免一帧里连挂好几块）。 */
  private ready:{tile:Tile;item:LoadedTile}[] = []
  private readyTiles = new Set<Tile>()
  /** 加载屏 / 传送遮罩期间先按这个点抓，相机这时候还停在别处。 */
  private focus?:THREE.Vector3
  /** focus 的有效期：万一进入流程失败，别一直按错误的位置推流。 */
  private focusUntil = 0
  private velocity = new THREE.Vector3()
  private lastEye = new THREE.Vector3(NaN,0,0)
  private lastTick = 0
  private forward = new THREE.Vector3()
  private candidates:{tile:Tile;score:number}[] = []

  constructor(private scene:THREE.Scene, private manifest:Manifest, private base:Awaited<ReturnType<typeof overview>>, public radius:number, private camera:THREE.PerspectiveCamera) {
    this.forest=new Forest(scene,manifest.chunks,camera)
    this.batches=new ChunkBatcher(scene)
    // 街面 worker 的脚本（带一份 three.js）要先下，提前建好，别让第一块地块去等它
    prewarmStreetWorker()
  }

  /** 加载屏、传送遮罩期间先把某个点周围抓起来；`clearFocus` 之后交还给相机/玩家位置。 */
  prefetch(x:number, z:number){
    this.focus ??= new THREE.Vector3()
    this.focus.set(x,0,z)
    this.focusUntil = performance.now()+60000
  }
  clearFocus(){ this.focus = undefined; this.focusUntil = 0 }
  /** 当前推流中心：遮罩期间是目标点，之后是玩家/相机位置。 */
  private pivot(position:THREE.Vector3){
    if(flags.legacyStream||!this.focus||performance.now()>this.focusUntil) return position
    return this.focus
  }

  /** 还有块在路上：地标这种大文件先别抢带宽。 */
  get busy(){ return this.pending.size>0 || this.ready.length>0 }

  private cachedPacked(file:string){
    const data = this.packed.get(file)
    if(!data) return undefined
    // 命中就挪到队尾，LRU 淘汰的是最久没用的
    this.packed.delete(file); this.packed.set(file,data)
    return data
  }

  private keepPacked(file:string, data:ArrayBuffer){
    if(this.packed.has(file)) return
    this.packed.set(file,data); this.packedBytes += data.byteLength
    // 大约 6 MB 就够覆盖「走开再走回来」的来回，再多就只是占内存
    while(this.packedBytes>6e6 && this.packed.size>1){
      const oldest = this.packed.keys().next().value as string
      const dropped = this.packed.get(oldest)!
      this.packed.delete(oldest); this.packedBytes -= dropped.byteLength
    }
  }

  /** 每帧把解码好的块挂进场景。预算到就把剩下的留到下一帧，别一帧连挂好几块。 */
  private commit(distance:(tile:Tile)=>number){
    if(!this.ready.length) return
    const started = performance.now()
    while(this.ready.length){
      const {tile,item} = this.ready.shift()!
      this.readyTiles.delete(tile)
      // 解码期间人可能已经走开了：这时候再挂上去纯属浪费一次批次重建
      if(this.loaded.has(tile)||distance(tile)>this.radius+190){ item.dispose(); continue }
      this.scene.add(item.group)
      this.batches.add(item.batch)
      this.base.toggle(tile,false)
      this.loaded.set(tile,item)
      this.visited.add(tile)
      this.failures.delete(tile)
      if(!flags.legacyStream && performance.now()-started>7) break
    }
  }

  /** 诊断用：最近若干条解码时间线（生产里没人读）。 */
  log?:string[]
  private start(tile:Tile){
    const controller = new AbortController()
    this.pending.set(tile,controller)
    const began = performance.now()
    const packed = flags.legacyStream ? undefined : this.cachedPacked(tile.file)
    const note = (this.log ??= [])
    note.push(`${Math.round(began)} start ${tile.file}${packed?' cached':''}`)
    const task = packed
      ? detail(tile,controller.signal,packed)
      : fetchAsset(tile.file,controller.signal,'high').then(raw=>{
        note.push(`${Math.round(performance.now())} bytes ${tile.file} ${raw.byteLength}`)
        if(!flags.legacyStream && !controller.signal.aborted) this.keepPacked(tile.file,raw)
        return detail(tile,controller.signal,raw)
      })
    task.then(item=>{
      note.push(`${Math.round(performance.now())} decoded ${tile.file}`)
      if(controller.signal.aborted){ item.dispose(); return }
      this.ready.push({tile,item}); this.readyTiles.add(tile)
    }).catch(error=>{
      note.push(`${Math.round(performance.now())} fail ${tile.file} ${error}`)
      if(!controller.signal.aborted) {console.error(tile.file,error); this.failures.set(tile,performance.now()+10000)}
    }).finally(()=>{
      this.lastCost = performance.now()-began
      this.lastFinish = performance.now()
      this.pending.delete(tile)
    })
  }

  tick(position:THREE.Vector3) {
    const now = performance.now()
    // 行走 / 骑行方向：往哪走就先抓哪，避免「跑到块边才开始下」。
    const moving = Number.isFinite(this.lastEye.x)
    if(moving){
      const dt = Math.max(0.016,(now-this.lastTick)/1000)
      const blend = 1-Math.exp(-dt/0.35)
      this.velocity.x += ((position.x-this.lastEye.x)/dt-this.velocity.x)*blend
      this.velocity.z += ((position.z-this.lastEye.z)/dt-this.velocity.z)*blend
    }
    this.lastEye.copy(position); this.lastTick = now
    this.forest.tick(position)

    // 遮罩期间按目标点抓：相机这时还在天上，按相机推流等于白花流量。
    const leg = flags.legacyStream
    const eye = this.pivot(position)
    const distance = (tile:Tile)=>Math.hypot(tile.x+128-eye.x,tile.z+128-eye.z)

    for(const [tile,item] of this.loaded) if(distance(tile)>this.radius+190) {
      this.batches.remove(tile); this.base.toggle(tile,true); this.scene.remove(item.group); item.dispose(); this.loaded.delete(tile)
    }
    // 不再因为「人走远了」中途掐断解码：一块只有十几 KB，掐断省不下流量，
    // 却会把刚预热好的块扔掉再重下。到上台那一步再按距离筛。
    this.commit(distance)
    this.batches.update(position,this.camera,isWaterInView(this.camera)?currentMirrorLevel(this.camera):-Infinity)

    if(this.pending.size>=this.maxPending) return
    this.camera.getWorldDirection(this.forward)
    const speed = leg?0:Math.hypot(this.velocity.x,this.velocity.z)
    const lead = speed>1.2?Math.min(1,speed/9):0
    const candidates = this.candidates
    candidates.length = 0
    for(const tile of this.manifest.chunks) {
      const dist = distance(tile)
      if(dist > this.radius) continue
      if(this.loaded.has(tile) || this.pending.has(tile) || this.readyTiles.has(tile)) continue
      if((this.failures.get(tile)??0) > now) continue
      const dx = tile.x+128-eye.x, dz = tile.z+128-eye.z
      const len = Math.hypot(dx,dz)||1
      // 视线方向加权，再按行进方向加一份：正前方、马上要进的块排前面
      const ahead = (dx*this.forward.x+dz*this.forward.z)/len
      const along = lead&&speed>0?Math.max(0,(dx*this.velocity.x+dz*this.velocity.z)/(len*speed)):0
      candidates.push({tile,score:dist-ahead*90-along*lead*130})
    }
    if(!candidates.length) return
    candidates.sort((a,b)=>a.score-b.score)
    // 每帧只花几毫秒决定「下一批下什么」，不把一帧都耗在排队上
    const started = performance.now()
    for(const {tile} of candidates) {
      this.start(tile)
      if(this.pending.size>=this.maxPending) break
      if(leg) break
      if(performance.now()-started>2.5) break
    }
  }
}
