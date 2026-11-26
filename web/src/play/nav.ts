import * as THREE from 'three'
import type {Host} from './host'
import {pointAt,TURN_TEXT,type Maneuver,type Route,type RouteMode,type TurnKind} from '../map/route'
import type {RouteReply,RouteRequest} from '../map/route-worker'
import './nav.css'

// IDOK-350 街景导航：地图面板「标记导航」→ 沿 atlas 路网寻路 → 场景里一条贴地的漓江青路线 + 前方浮动箭头
// + 顶部导航卡（下一转向 / 剩余距离）+ 接近路口时 toast。docs/style.md：漓江青 #20d6c1 = 路线和任务。
//
// 性能约束（issue 第 7 条）：
//  - 寻路（图构建 + A*）在 route-worker 里，只在设定目的地、偏离重算（≥3 s 一次）、换乘交通方式时各跑一次；
//  - 路线几何只在拿到新路线时重建；之后每秒一次的“补高度”只改已存在顶点的 y（远处 chunk 加载后才知道地面高），
//    高度来自 chunk 地面网格的规则网格插值，不做 raycast；
//  - 每帧只做窗口内的投影求进度、箭头定位，全部复用预分配对象。

export interface NavTarget {x:number; z:number; name:string}

const JADE = '#20d6c1', LAYER = 2
const ARRIVE = 10, OFF_ROUTE = 25, RECALC_MS = 3000, STEP = 3
const WIDTH = [2.6,2.2,1.7,1.2]  // ribbon width (m) by atlas road class 0 arterial … 3 path
const LIFT = .32

function chevronTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(32,214,193,.58)'; g.fillRect(0,0,64,128)
  // bright edges so the band reads on pale paving and dark asphalt alike
  g.fillStyle = 'rgba(190,255,247,.9)'; g.fillRect(0,0,4,128); g.fillRect(60,0,4,128)
  // one chevron per tile, pointing to canvas top (= +v = forward along the route)
  g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round'
  g.beginPath(); g.moveTo(14,86); g.lineTo(32,58); g.lineTo(50,86); g.stroke()
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4
  return t
}
function arrowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')!
  g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 10; g.shadowOffsetY = 3
  g.fillStyle = JADE; g.beginPath(); g.arc(64,64,48,0,Math.PI*2); g.fill()
  g.shadowColor = 'transparent'
  g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.arc(64,64,45,0,Math.PI*2); g.stroke()
  // arrow pointing up (sprite rotation turns it to the route direction on screen)
  g.fillStyle = '#ffffff'; g.beginPath()
  g.moveTo(64,26); g.lineTo(92,62); g.lineTo(74,62); g.lineTo(74,98); g.lineTo(54,98); g.lineTo(54,62); g.lineTo(36,62); g.closePath(); g.fill()
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

// 24×24 turn glyphs for the card (stroke = currentColor)
const GLYPH:Record<TurnKind|'straight'|'lost',string> = {
  straight:'<path d="M12 21V4M6 10l6-6 6 6"/>',
  left:'<path d="M16 21v-8a3 3 0 0 0-3-3H5M9 6l-4 4 4 4"/>',
  right:'<path d="M8 21v-8a3 3 0 0 1 3-3h8M15 6l4 4-4 4"/>',
  'slight-left':'<path d="M15 21v-7L8 7M8 13V7h6"/>',
  'slight-right':'<path d="M9 21v-7l7-7M10 7h6v6"/>',
  'sharp-left':'<path d="M15 3v9L6 20M6 13v7h7"/>',
  'sharp-right':'<path d="M9 3v9l9 8M18 13v7h-7"/>',
  uturn:'<path d="M16 21V9a5 5 0 0 0-10 0v4M2.5 10 6 14l3.5-4"/>',
  arrive:'<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>',
  lost:'<circle cx="12" cy="12" r="8"/><path d="M12 7v6M12 16.5v.5"/>',
}

const fmtDist = (m:number)=>m>=1000?`${(m/1000).toFixed(m>=10000?0:1)} 公里`:`${Math.max(10,Math.round(m/10)*10)} 米`
const speedOf = (vehicle:string|undefined)=>vehicle==='car'?8.5:vehicle==='bike'?5.5:vehicle==='bicycle'?4.2:1.35

export function navigation(host:Host, opts:{visible():boolean; onEnd():void}) {
  let target:NavTarget|null = null, route:Route|null = null, straight = false
  let worker:Worker|undefined, requestId = 0, pending = false, lastRequestAt = -Infinity, requests = 0, recalcs = 0
  let progress = 0, peak = 0, seg = 0, off = 0, announced = new Set<number>(), lastToast = '', sinceFull = 0, sinceHeights = 0, hudClock = 0
  const plans:number[] = []
  let lastMode:RouteMode = 'walk', forced:RouteMode|null = null

  // --- scene objects: created when a navigation starts, disposed (geometry, material, textures) when it ends
  let objects:{ribbon:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>, arrow:THREE.Sprite}|null = null
  function scene() {
    if(objects) return objects
    const material = new THREE.MeshBasicMaterial({map:chevronTexture(),transparent:true,opacity:.85,depthWrite:false,fog:false,toneMapped:false,
      side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4})
    const ribbon = new THREE.Mesh(new THREE.BufferGeometry(),material)
    ribbon.name = 'nav-route'; ribbon.layers.set(LAYER); ribbon.renderOrder = 8; ribbon.frustumCulled = false; ribbon.visible = false
    const arrow = new THREE.Sprite(new THREE.SpriteMaterial({map:arrowTexture(),sizeAttenuation:false,depthTest:false,fog:false,transparent:true,toneMapped:false}))
    arrow.name = 'nav-arrow'; arrow.layers.set(LAYER); arrow.renderOrder = 11; arrow.scale.set(.05,.05,1); arrow.visible = false
    host.scene.add(ribbon,arrow)
    return objects = {ribbon,arrow}
  }
  function disposeScene() {
    if(!objects) return
    const {ribbon,arrow} = objects
    ribbon.removeFromParent(); arrow.removeFromParent()
    ribbon.geometry.dispose(); ribbon.material.map?.dispose(); ribbon.material.dispose()
    arrow.material.map?.dispose(); arrow.material.dispose()
    objects = null; count = 0
  }

  // samples along the route every ≤ STEP metres
  let sx = new Float32Array(0), sz = new Float32Array(0), sd = new Float32Array(0), sy = new Float32Array(0)
  let sok = new Uint8Array(0), sdeck = new Uint8Array(0), shalf = new Float32Array(0), count = 0, resolvedTo = 0

  // --- HUD card
  const card = document.createElement('div'); card.className = 'nav-card'; card.hidden = true; card.setAttribute('role','status')
  card.innerHTML = `<i class="nav-glyph"><svg viewBox="0 0 24 24" aria-hidden="true"></svg></i>
    <div class="nav-main"><b class="nav-dist"></b><span class="nav-what"></span></div>
    <div class="nav-meta"><span class="nav-left"></span><span class="nav-dest"></span></div>
    <button type="button" class="nav-stop" aria-label="结束导航" title="结束导航">×</button>`
  document.body.append(card)
  const $ = (s:string)=>card.querySelector<HTMLElement>(s)!
  $('.nav-stop').onclick = ()=>{toast('已结束导航'); end()}
  let cardText = ''

  /** unit facing on the ground plane: vehicle heading when riding, walker yaw on foot */
  const heading = ()=>{const w = host.walker() as (ReturnType<Host['walker']>&{vehicle?:string,heading?:number})|undefined
    if(!w?.active) return null
    const yaw = w.vehicle&&w.vehicle!=='foot'&&typeof w.heading==='number'?w.heading:w.yaw
    return {x:-Math.sin(yaw),z:-Math.cos(yaw)}}
  const toast = (text:string,ms=2600)=>{lastToast = text; window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text,ms}}))}
  const here = ()=>{const w = host.walker(); return w?.active?w.position:host.camera.position}
  const vehicle = ()=>{const w = host.walker() as (ReturnType<Host['walker']>&{vehicle?:string})|undefined; return w?.active?w.vehicle??'foot':undefined}
  /** Routing mode for the current way of travel; null = boat / flying (keep the route, don't re-plan). */
  const travelMode = ():RouteMode|null=>{const v = vehicle(); return v===undefined||v==='boat'?null:v==='car'?'car':'walk'}

  function request(reason:'set'|'off'|'mode') {
    if(!target||pending) return
    pending = true; lastRequestAt = performance.now(); requests++
    plans.push(Math.round(lastRequestAt)); if(plans.length>12) plans.shift()
    if(reason!=='set') recalcs++
    const p = here(), mode = forced ?? travelMode() ?? lastMode
    lastMode = mode
    worker ??= createWorker()
    const msg:RouteRequest = {id:++requestId,url:new URL(`./world/${host.manifest.atlas.file}`,location.href).href,fx:p.x,fz:p.z,tx:target.x,tz:target.z,mode}
    worker.postMessage(msg)
  }
  function createWorker() {
    const w = new Worker(new URL('../map/route-worker.ts',import.meta.url),{type:'module'})
    w.onmessage = (event:MessageEvent<RouteReply>)=>{
      const reply = event.data
      if(reply.id!==requestId) return
      pending = false
      if(!target) return
      stats = {buildMs:reply.buildMs,searchMs:reply.searchMs,error:reply.error}
      const first = !route&&!straight
      if(!reply.route) {
        if(!straight||first) toast(reply.error?'路线规划失败，先按直线方向指引':'附近没有连通的道路，先按直线方向指引',3200)
        setRoute(null)
        return
      }
      setRoute(reply.route)
      const facing = heading(), r = reply.route
      if(!first&&facing&&r.points.length>=4){
        pointAt(r,Math.min(r.length,15),a)
        const dx = a.x-r.points[0], dz = a.z-r.points[1], l = Math.hypot(dx,dz)
        if(l>1&&(dx*facing.x+dz*facing.z)/l<-.5){toast('请掉头',2400); return}
      }
      if(first) {
        const m = nextManeuver()
        if(m&&m.kind!=='arrive'&&m.at-progress<=announceAt()) announce(m)
        else toast(`路线已规划 · 全程 ${fmtDist(reply.route.length)}`,2400)
      }
    }
    w.onerror = event=>{console.warn('route worker',event); pending = false; setRoute(null)}
    return w
  }
  let stats:{buildMs:number,searchMs:number,error?:string} = {buildMs:0,searchMs:0}

  function setRoute(next:Route|null) {
    route = next; straight = !next; announced = new Set(); progress = 0; peak = 0; seg = 0; off = 0
    const {ribbon} = scene()
    ribbon.geometry.dispose()
    ribbon.geometry = new THREE.BufferGeometry()
    count = 0; resolvedTo = 0
    if(next) {
      announced = new Set(next.maneuvers.map((m,i)=>m.at<1?i:-1).filter(i=>i>=0))
      build(next)
      locate(true)
    }
    hudClock = 1
  }

  // --- geometry
  function build(r:Route) {
    const xs:number[] = [], zs:number[] = [], ds:number[] = [], cls:number[] = [], deck:number[] = []
    const n = r.dist.length
    for(let i=0;i<n-1;i++){
      const ax = r.points[i*2], az = r.points[i*2+1], bx = r.points[i*2+2], bz = r.points[i*2+3], len = r.dist[i+1]-r.dist[i]
      const k = Math.max(1,Math.ceil(len/STEP))
      for(let j=0;j<k;j++){const t = j/k; xs.push(ax+(bx-ax)*t); zs.push(az+(bz-az)*t); ds.push(r.dist[i]+len*t); cls.push(r.cls[i]); deck.push(r.deck[i])}
    }
    xs.push(r.points[n*2-2]); zs.push(r.points[n*2-1]); ds.push(r.length); cls.push(r.cls[n-2]??2); deck.push(r.deck[n-2]??0)
    count = xs.length
    sx = Float32Array.from(xs); sz = Float32Array.from(zs); sd = Float32Array.from(ds); sdeck = Uint8Array.from(deck)
    sy = new Float32Array(count); sok = new Uint8Array(count); shalf = new Float32Array(count)
    const scale = r.mode==='car'?1.35:1
    for(let i=0;i<count;i++) shalf[i] = WIDTH[Math.min(3,Math.max(0,cls[i]))]*scale/2
    const position = new Float32Array(count*6), uv = new Float32Array(count*4), index = new Uint32Array(Math.max(0,count-1)*6)
    const period = r.mode==='car'?7:4.5
    for(let i=0;i<count;i++){
      const a = Math.max(0,i-1), b = Math.min(count-1,i+1)
      let tx = sx[b]-sx[a], tz = sz[b]-sz[a]; const tl = Math.hypot(tx,tz)||1; tx /= tl; tz /= tl
      // miter: widen at corners so the band keeps its width through a 90° turn
      let miter = 1
      if(i>0&&i<count-1){const ix = sx[i]-sx[a], iz = sz[i]-sz[a], il = Math.hypot(ix,iz)||1; miter = Math.min(1.8,1/Math.max(.55,(ix*tx+iz*tz)/il))}
      const nx = -tz*shalf[i]*miter, nz = tx*shalf[i]*miter
      position[i*6] = sx[i]+nx; position[i*6+2] = sz[i]+nz; position[i*6+3] = sx[i]-nx; position[i*6+5] = sz[i]-nz
      uv[i*4] = 0; uv[i*4+1] = sd[i]/period; uv[i*4+2] = 1; uv[i*4+3] = sd[i]/period
      if(i<count-1){const o = i*6, v = i*2; index[o] = v; index[o+1] = v+1; index[o+2] = v+2; index[o+3] = v+1; index[o+4] = v+3; index[o+5] = v+2}
    }
    const geometry = scene().ribbon.geometry
    geometry.setAttribute('position',new THREE.BufferAttribute(position,3))
    geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2))
    geometry.setIndex(new THREE.BufferAttribute(index,1))
    geometry.setDrawRange(0,0)
    refreshHeights(true)
  }

  // Ground height from a chunk's regular terrain grid (same triangulation as THREE.PlaneGeometry), no raycast.
  const tiles:{x:number,z:number,mesh:THREE.Mesh}[] = []
  function groundY(x:number,z:number) {
    for(const t of tiles){
      const lx = x-t.x, lz = z-t.z
      if(lx<0||lz<0||lx>256||lz>256) continue
      const geo = t.mesh.geometry as THREE.PlaneGeometry, p = geo.parameters
      if(!p?.widthSegments) return NaN
      const cols = p.widthSegments, cw = p.width/cols, fx = lx/cw, fz = lz/cw
      const col = Math.min(cols-1,Math.floor(fx)), row = Math.min(cols-1,Math.floor(fz)), u = fx-col, v = fz-row, i = row*(cols+1)+col
      const pos = geo.getAttribute('position'), a = pos.getY(i), b = pos.getY(i+1), c = pos.getY(i+cols+1), d = pos.getY(i+cols+2)
      return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v)
    }
    return NaN
  }
  /** Fill heights for samples whose chunk is now loaded; bridge/tunnel runs interpolate between their ends. */
  function refreshHeights(all=false) {
    if(!count) return
    tiles.length = 0
    for(const [tile,item] of host.stream.loaded) if(item.groundMesh) tiles.push({x:tile.x,z:tile.z,mesh:item.groundMesh})
    let changed = false
    for(let i=0;i<count;i++){
      if(sok[i]||sdeck[i]) continue
      const y = groundY(sx[i],sz[i]); if(Number.isFinite(y)){sy[i] = y; sok[i] = 1; changed = true}
    }
    // decks: linear between the last terrain sample before and the first after
    for(let i=0;i<count;i++){
      if(!sdeck[i]||sok[i]) continue
      let j = i; while(j<count&&sdeck[j]) j++
      const a = i-1, b = j<count?j:-1
      if(a>=0&&b>=0&&sok[a]&&sok[b]) for(let k=i;k<j;k++){sy[k] = sy[a]+(sy[b]-sy[a])*(sd[k]-sd[a])/((sd[b]-sd[a])||1); sok[k] = 1; changed = true}
      else if(a>=0&&b<0&&sok[a]) for(let k=i;k<j;k++){sy[k] = sy[a]; sok[k] = 1; changed = true}
      i = j
    }
    if(!changed&&!all) return
    const position = objects?.ribbon.geometry.getAttribute('position') as THREE.BufferAttribute|undefined
    if(!position) return
    const arr = position.array as Float32Array
    for(let i=0;i<count;i++) if(sok[i]){arr[i*6+1] = arr[i*6+4] = sy[i]+LIFT}
    position.needsUpdate = true
    resolvedTo = 0
    while(resolvedTo<count&&sok[resolvedTo]) resolvedTo++
    // not-yet-known heights may still be resolved further along (a chunk ahead loaded before one behind): the draw
    // range only ever shows the contiguous known stretch from the player forward, so nothing floats or sinks.
    updateDrawRange()
  }
  let drawFrom = 0
  function updateDrawRange() {
    if(!count||!objects) return
    // start just ahead of the player's feet, so the band leads away instead of running under the figure
    let from = 0; while(from<count-1&&sd[from+1]<progress+1.5) from++
    let to = from; while(to<count&&sok[to]) to++
    drawFrom = from
    objects.ribbon.geometry.setDrawRange(from*6,Math.max(0,to-1-from)*6)
  }
  function heightAt(d:number) {
    if(!count) return here().y
    let lo = 0, hi = count-1
    while(hi-lo>1){const mid = (lo+hi)>>1; if(sd[mid]<=d) lo = mid; else hi = mid}
    if(!sok[lo]||!sok[hi]) return here().y
    const t = (d-sd[lo])/((sd[hi]-sd[lo])||1)
    return sy[lo]+(sy[hi]-sy[lo])*t
  }

  // --- progress: nearest point on the route, searched in a window around the last segment
  function locate(full:boolean) {
    if(!route) return
    const p = here(), pts = route.points, n = route.dist.length
    const lo = full?0:Math.max(0,seg-4), hi = full?n-1:Math.min(n-1,seg+48)
    let best = Infinity, bestSeg = seg, bestD = progress
    for(let i=lo;i<hi;i++){
      const ax = pts[i*2], az = pts[i*2+1], dx = pts[i*2+2]-ax, dz = pts[i*2+3]-az, nn = dx*dx+dz*dz||1
      const t = Math.min(1,Math.max(0,((p.x-ax)*dx+(p.z-az)*dz)/nn)), ex = p.x-ax-t*dx, ez = p.z-az-t*dz, dd = ex*ex+ez*ez
      if(dd<best){best = dd; bestSeg = i; bestD = route.dist[i]+t*Math.sqrt(nn)}
    }
    seg = bestSeg; progress = bestD; off = Math.sqrt(best)
  }
  function nextManeuver():Maneuver|undefined {
    if(!route) return
    for(const m of route.maneuvers) if(m.at>progress+2) return m
    return route.maneuvers[route.maneuvers.length-1]
  }
  const announceAt = ()=>route?.mode==='car'||vehicle()==='bike'?110:50
  function phrase(m:Maneuver) {
    if(m.kind==='arrive') return `到达 ${target?.name??'目的地'}`
    return `${TURN_TEXT[m.kind]}${m.road?` 进入 ${m.road}`:''}`
  }
  function announce(m:Maneuver) {
    if(!route) return
    announced.add(route.maneuvers.indexOf(m))
    toast(`前方 ${fmtDist(m.at-progress)} ${phrase(m)}`,3000)
  }

  // --- per frame
  const a = {x:0,z:0,i:0}, b = {x:0,z:0,i:0}
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3()
  let clock = 0
  function tick(dt:number) {
    if(!target) return
    clock += dt
    const show = opts.visible()
    const p = here()
    // arrival: at the target, or at the end of the network leg when the target itself is off-road (a peak, a lake)
    const toTarget = Math.hypot(target.x-p.x,target.z-p.z)
    if(route) {
      sinceFull += dt; locate(sinceFull>1); if(sinceFull>1) sinceFull = 0
      // a teleport / respawn can land outside the search window: confirm with a full scan before calling it off-route
      if(off>OFF_ROUTE) locate(true)
      peak = Math.max(peak,progress)
    }
    if(toTarget<ARRIVE||(route&&route.length-progress<6&&off<15&&travelMode())) {
      toast(`已到达「${target.name}」，导航结束`,3000); end(); return
    }
    const mode = travelMode()
    const now = performance.now()
    if(mode&&!pending&&now-lastRequestAt>=RECALC_MS) {
      if(route&&off>OFF_ROUTE){toast('已偏离路线，正在重新规划',1800); request('off')}
      // going back along the route (a U-turn) for 30 m also re-plans, like a car navigator does
      else if(route&&peak-progress>30){toast('方向相反，正在重新规划',1800); request('off')}
      else if(route&&!forced&&mode!==route.mode) request('mode')
      else if(straight&&now-lastRequestAt>=RECALC_MS*4) request('off')
    }
    if(route) {
      const m = nextManeuver()
      if(m&&!announced.has(route.maneuvers.indexOf(m))&&m.at-progress<=announceAt()) announce(m)
      sinceHeights += dt
      if(sinceHeights>1){sinceHeights = 0; refreshHeights()}
      else if(count&&sd[Math.min(count-1,drawFrom+1)]<progress+1.5) updateDrawRange()
    }
    const {ribbon,arrow} = scene()
    if(route) ribbon.material.map!.offset.y = -clock*(route.mode==='car'?1.2:.55)
    ribbon.visible = show&&!!route
    // arrow: hovering a little ahead on the route (or straight at the target without one), turned on screen
    // to the direction of travel there
    arrow.visible = show
    if(show) {
      const car = vehicle()==='car', ahead = car?20:9
      let ax:number, az:number, bx:number, bz:number, y:number
      if(route){
        pointAt(route,Math.min(route.length,progress+ahead),a); pointAt(route,Math.min(route.length,progress+ahead)+4,b)
        ax = a.x; az = a.z; bx = b.x; bz = b.z
        if(route.length-progress<4){bx = target.x; bz = target.z}
        y = heightAt(Math.min(route.length,progress+ahead))
      } else {
        const d = toTarget||1; ax = p.x+(target.x-p.x)/d*ahead; az = p.z+(target.z-p.z)/d*ahead; bx = target.x; bz = target.z; y = p.y-1
      }
      arrow.position.set(ax,y+(car?3.6:2.4)+Math.sin(clock*2.2)*.12,az)
      v0.set(ax,y+1,az).project(host.camera); v1.set(bx,y+1,bz).project(host.camera)
      const aspect = host.camera.aspect
      arrow.material.rotation = Math.atan2(v1.y-v0.y,(v1.x-v0.x)*aspect)-Math.PI/2
      const s = car?.058:.05; arrow.scale.set(s,s,1)
    }
    hudClock += dt
    if(hudClock>=.2){hudClock = 0; renderCard(show,toTarget)}
  }

  function renderCard(show:boolean,toTarget:number) {
    card.hidden = !show||!target
    if(card.hidden||!target) return
    let kind:keyof typeof GLYPH = 'lost', dist = '', what = '', left = ''
    if(route) {
      const m = nextManeuver()!
      const gap = m.at-progress
      kind = gap>400&&m.kind!=='arrive'?'straight':m.kind
      dist = fmtDist(gap)
      what = gap>400&&m.kind!=='arrive'?`沿当前道路直行${m.road?`，之后${TURN_TEXT[m.kind]}进入 ${m.road}`:''}`:phrase(m)
      const remain = Math.max(0,route.length-progress)
      left = `剩 ${fmtDist(remain)} · 约 ${Math.max(1,Math.round(remain/speedOf(vehicle())/60))} 分钟`
    } else if(pending) {
      kind = 'straight'; dist = '规划中'; what = '正在沿路网找路线…'; left = `直线 ${fmtDist(toTarget)}`
    } else {
      kind = 'lost'; dist = fmtDist(toTarget); what = '没有连通的道路 · 按箭头直线前往'; left = '离开路网时每 12 秒重试'
    }
    const text = kind+dist+what+left+target.name
    if(text===cardText) return
    cardText = text
    card.dataset.kind = kind
    $('.nav-glyph svg').innerHTML = GLYPH[kind]
    $('.nav-dist').textContent = dist
    $('.nav-what').textContent = what
    $('.nav-left').textContent = left
    $('.nav-dest').textContent = `去 ${target.name}`
  }

  /** `mode` pins the routing mode (verify only); normally it follows the way of travel. */
  function set(next:NavTarget|null, opt:{mode?:RouteMode}={}) {
    if(!next){if(target) end(false); return}
    const pin = opt.mode ?? null
    if(target&&Math.hypot(target.x-next.x,target.z-next.z)<1&&(route||pending)&&pin===forced) return
    forced = pin
    disposeScene()
    target = {...next}; route = null; straight = false; pending = false; requestId++
    lastRequestAt = -Infinity; cardText = ''
    request('set')
    hudClock = 1
  }
  function end(notify=true) {
    target = null; route = null; straight = false; pending = false; requestId++; forced = null
    disposeScene()
    card.hidden = true; cardText = ''
    if(notify) opts.onEnd()
  }

  return {
    set, end, tick,
    get target(){return target},
    /** route polyline still ahead of the player (x/z interleaved), for the minimap */
    path():number[]|null {
      if(!route) return null
      pointAt(route,progress,a)
      const out = [a.x,a.z]
      for(let i=a.i+1;i<route.dist.length;i++) out.push(route.points[i*2],route.points[i*2+1])
      return out
    },
    /** verify/debug snapshot */
    state() {
      return {target, pending, straight, requests, recalcs, plans:[...plans], progress, off, lastToast, stats,
        route:route&&{mode:route.mode,length:route.length,points:route.points.length/2,startGap:route.startGap,endGap:route.endGap,
          first:[route.points[0],route.points[1]],classes:[0,1,2,3].map(c=>route!.cls.filter(k=>k===c).length),maneuvers:route.maneuvers.map(m=>({at:m.at,kind:m.kind,road:m.road,x:m.x,z:m.z}))},
        scene:{ribbon:!!objects?.ribbon.parent,arrow:!!objects?.arrow.parent,navObjects:host.scene.children.filter(o=>o.name==='nav-route'||o.name==='nav-arrow').length,
          samples:count,resolved:resolvedTo,drawCount:objects?.ribbon.geometry.drawRange.count??0,
          vertices:(objects?.ribbon.geometry.getAttribute('position')?.count)??0},
        card:card.hidden?null:{dist:$('.nav-dist').textContent,what:$('.nav-what').textContent,left:$('.nav-left').textContent}}
    },
  }
}
