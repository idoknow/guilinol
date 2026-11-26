// IDOK-350 街景导航：atlas 路网 → 图 → A*。纯数据模块（不依赖 three / DOM），node 里也能直接跑。
//
// atlas.bin 的路是 OSM way 经 simplify(1.5 m) + 取整到米之后的折线（pipeline/atlas.py），所以：
//  - 同一个 OSM 节点在两条路里坐标完全相同 → 按整数坐标合并成一个图节点；
//  - 但 T 字路口/十字路口的交点常被 simplify 掉，只靠“同坐标”时全城只有 ~35% 的节点连在主连通块上。
//    这里补两步：①路端点距别的路段 ≤ SNAP 米 → 把该段在投影处切开接上；②两条同层路段几何相交
//    → 在交点切开。桥（b）和隧道（tunnel）不参与②，免得立交上下层被误连（它们靠两端共点接入路网）。
//
// 机动车路线（car）不走 class 3（pedestrian/footway/steps/path/cycleway）。car.ts 的“步行区或非机动车道”
// 判定是按已加载 chunk 的路面逐点做的，寻路时远处 chunk 多半没加载，所以这里按 OSM 道路等级过滤：
// 步行街（正阳步行街等）在 OSM 里就是 pedestrian = class 3，和 car.ts 禁行的范围一致。

export interface RouteRoad {n:string; c:number; w:number; b?:1; tunnel?:boolean; p:number[]}
export type RouteMode = 'walk'|'car'

const SNAP = 3, CELL = 48

export interface RouteGraph {
  roads:RouteRoad[]
  /** node coordinates, x/z interleaved */
  xz:Float64Array
  /** CSR adjacency: edges of node i are first[i]..first[i+1] */
  first:Int32Array; to:Int32Array; len:Float32Array; road:Int32Array
  /** edges (undirected, one entry per pair) for snapping a point onto the network */
  edgeA:Int32Array; edgeB:Int32Array; edgeRoad:Int32Array
  grid:Map<number,number[]>; left:number; top:number
  /** per mode: connected-component id of every node + the id of the largest one (lazy) */
  comps:Partial<Record<RouteMode,{id:Int32Array,main:number}>>
}

const cellKey = (cx:number,cz:number)=>cz*65536+cx

export function buildRouteGraph(roads:RouteRoad[]):RouteGraph {
  // --- 1. nodes from integer vertex coordinates; one raw segment per consecutive vertex pair
  const ids = new Map<number,number>(), xs:number[] = []
  const node = (x:number,z:number)=>{const k = (x+200000)*400000+(z+200000); let i = ids.get(k)
    if(i===undefined){i = xs.length/2; ids.set(k,i); xs.push(x,z)} return i}
  const segA:number[] = [], segB:number[] = [], segRoad:number[] = []
  roads.forEach((r,ri)=>{for(let i=0;i+3<r.p.length;i+=2){const a = node(r.p[i],r.p[i+1]), b = node(r.p[i+2],r.p[i+3])
    if(a!==b){segA.push(a); segB.push(b); segRoad.push(ri)}}})
  let left = Infinity, top = Infinity
  for(let i=0;i<xs.length;i+=2){left = Math.min(left,xs[i]); top = Math.min(top,xs[i+1])}
  left -= CELL; top -= CELL
  const cx = (x:number)=>Math.floor((x-left)/CELL), cz = (z:number)=>Math.floor((z-top)/CELL)
  // Unpadded segment grid (bridges/tunnels included; callers filter).
  const XC = 24, crossGrid = new Map<number,number[]>()
  const bx0 = new Float64Array(segA.length), bz0 = new Float64Array(segA.length), bx1 = new Float64Array(segA.length), bz1 = new Float64Array(segA.length)
  for(let s=0;s<segA.length;s++){
    const ax = xs[segA[s]*2], az = xs[segA[s]*2+1], bx = xs[segB[s]*2], bz = xs[segB[s]*2+1]
    bx0[s] = Math.min(ax,bx); bx1[s] = Math.max(ax,bx); bz0[s] = Math.min(az,bz); bz1[s] = Math.max(az,bz)
    for(let gz=Math.floor((bz0[s]-top)/XC);gz<=Math.floor((bz1[s]-top)/XC);gz++)
      for(let gx=Math.floor((bx0[s]-left)/XC);gx<=Math.floor((bx1[s]-left)/XC);gx++){
        const k = cellKey(gx,gz); const list = crossGrid.get(k); if(list) list.push(s); else crossGrid.set(k,[s])}
  }
  // splits[s] = [t, node, t, node, …]
  const splits = new Map<number,number[]>()
  const addSplit = (s:number,t:number,n:number)=>{const l = splits.get(s); if(l) l.push(t,n); else splits.set(s,[t,n])}
  const degree = new Int32Array(xs.length/2), nodeRoad = new Int32Array(xs.length/2)
  for(let s=0;s<segA.length;s++){degree[segA[s]]++; degree[segB[s]]++; nodeRoad[segA[s]] = nodeRoad[segB[s]] = segRoad[s]}
  const layered = (ri:number)=>!!(roads[ri].b||roads[ri].tunnel)

  // --- 2. dangling road ends within SNAP of another road's segment → T junction
  for(let n=0;n<degree.length;n++){
    if(degree[n]!==1) continue
    const x = xs[n*2], z = xs[n*2+1]
    let best = SNAP*SNAP, bestS = -1, bestT = 0
    const gx = Math.floor((x-left)/XC), gz = Math.floor((z-top)/XC)
    for(let oz=-1;oz<=1;oz++) for(let ox=-1;ox<=1;ox++) for(const s of crossGrid.get(cellKey(gx+ox,gz+oz))??[]){
      if(bx0[s]>x+SNAP||bx1[s]<x-SNAP||bz0[s]>z+SNAP||bz1[s]<z-SNAP) continue
      const a = segA[s], b = segB[s]; if(a===n||b===n) continue
      // a street ending under a bridge deck is not connected to it
      if(layered(segRoad[s])!==layered(nodeRoad[n])) continue
      const ax = xs[a*2], az = xs[a*2+1], dx = xs[b*2]-ax, dz = xs[b*2+1]-az, nn = dx*dx+dz*dz
      const t = Math.min(1,Math.max(0,((x-ax)*dx+(z-az)*dz)/nn)), d = (x-ax-t*dx)**2+(z-az-t*dz)**2
      if(d<best){best = d; bestS = s; bestT = t}
    }
    if(bestS<0) continue
    if(bestT<=1e-6) {segA.push(n); segB.push(segA[bestS]); segRoad.push(segRoad[bestS])}
    else if(bestT>=1-1e-6) {segA.push(n); segB.push(segB[bestS]); segRoad.push(segRoad[bestS])}
    else addSplit(bestS,bestT,n)
  }
  // --- 3. same-grade crossings that lost their shared vertex in simplification: tested in every cell both
  // segments share, kept only in the cell containing the crossing point (no dedupe set).
  for(const [key,list] of crossGrid) for(let i=0;i<list.length;i++){
    const s = list[i], a = segA[s], b = segB[s], ax = xs[a*2], az = xs[a*2+1], rx = xs[b*2]-ax, rz = xs[b*2+1]-az
    if(layered(segRoad[s])) continue
    for(let j=i+1;j<list.length;j++){
      const q = list[j]
      if(bx0[q]>bx1[s]||bx1[q]<bx0[s]||bz0[q]>bz1[s]||bz1[q]<bz0[s]) continue
      if(segRoad[s]===segRoad[q]||layered(segRoad[q])) continue
      const c = segA[q], d = segB[q]
      if(a===c||a===d||b===c||b===d) continue
      const qx = xs[c*2], qz = xs[c*2+1], sx = xs[d*2]-qx, sz = xs[d*2+1]-qz
      const den = rx*sz-rz*sx; if(Math.abs(den)<1e-9) continue
      const t = ((qx-ax)*sz-(qz-az)*sx)/den; if(t<=1e-6||t>=1-1e-6) continue
      const u = ((qx-ax)*rz-(qz-az)*rx)/den; if(u<=1e-6||u>=1-1e-6) continue
      const px = ax+t*rx, pz = az+t*rz
      if(cellKey(Math.floor((px-left)/XC),Math.floor((pz-top)/XC))!==key) continue
      const m = xs.length/2; xs.push(px,pz)
      addSplit(s,t,m); addSplit(q,u,m)
    }
  }
  // --- 4. chain split segments into edges
  const ea:number[] = [], eb:number[] = [], er:number[] = []
  for(let s=0;s<segA.length;s++){
    const l = splits.get(s)
    if(!l){ea.push(segA[s]); eb.push(segB[s]); er.push(segRoad[s]); continue}
    const order:number[] = []; for(let i=0;i<l.length;i+=2) order.push(i)
    order.sort((p,q)=>l[p]-l[q])
    let prev = segA[s]
    for(const i of order){const n = l[i+1]; if(n!==prev){ea.push(prev); eb.push(n); er.push(segRoad[s]); prev = n}}
    if(prev!==segB[s]){ea.push(prev); eb.push(segB[s]); er.push(segRoad[s])}
  }
  const nodes = xs.length/2, xz = Float64Array.from(xs)
  const first = new Int32Array(nodes+1)
  for(let e=0;e<ea.length;e++){first[ea[e]+1]++; first[eb[e]+1]++}
  for(let i=0;i<nodes;i++) first[i+1] += first[i]
  const fill = first.slice(0,nodes), to = new Int32Array(ea.length*2), len = new Float32Array(ea.length*2), road = new Int32Array(ea.length*2)
  const grid = new Map<number,number[]>()
  for(let e=0;e<ea.length;e++){
    const a = ea[e], b = eb[e], ax = xz[a*2], az = xz[a*2+1], bx = xz[b*2], bz = xz[b*2+1], l = Math.hypot(bx-ax,bz-az)
    to[fill[a]] = b; len[fill[a]] = l; road[fill[a]++] = er[e]
    to[fill[b]] = a; len[fill[b]] = l; road[fill[b]++] = er[e]
    for(let gz=cz(Math.min(az,bz));gz<=cz(Math.max(az,bz));gz++) for(let gx=cx(Math.min(ax,bx));gx<=cx(Math.max(ax,bx));gx++){
      const k = cellKey(gx,gz); const list = grid.get(k); if(list) list.push(e); else grid.set(k,[e])}
  }
  return {roads,xz,first,to,len,road,edgeA:Int32Array.from(ea),edgeB:Int32Array.from(eb),edgeRoad:Int32Array.from(er),grid,left,top,comps:{}}
}

const allowed = (g:RouteGraph,ri:number,mode:RouteMode)=>mode!=='car'||g.roads[ri].c<=2

function components(g:RouteGraph,mode:RouteMode) {
  const cached = g.comps[mode]; if(cached) return cached
  const n = g.xz.length/2, id = new Int32Array(n).fill(-1), sizes:number[] = [], stack:number[] = []
  for(let s=0;s<n;s++){
    if(id[s]>=0) continue
    const c = sizes.length; id[s] = c; stack.push(s); let size = 0
    while(stack.length){const u = stack.pop()!; size++
      for(let i=g.first[u];i<g.first[u+1];i++){const v = g.to[i]; if(id[v]<0&&allowed(g,g.road[i],mode)){id[v] = c; stack.push(v)}}}
    sizes.push(size)
  }
  let main = 0; for(let c=1;c<sizes.length;c++) if(sizes[c]>sizes[main]) main = c
  return g.comps[mode] = {id,main}
}

/**
 * Nearest point on an allowed edge within `max` metres. Prefers the main connected network: a closer edge on a
 * small island (a campus service loop, a park path cut off by the play boundary) would make A* fail.
 */
export function snapToGraph(g:RouteGraph,x:number,z:number,mode:RouteMode,max=160):Snap|null {
  const comp = components(g,mode)
  return snapWhere(g,x,z,mode,max,e=>comp.id[g.edgeA[e]]===comp.main) ?? snapWhere(g,x,z,mode,Math.min(max,40),()=>true)
}
export interface Snap {edge:number; t:number; x:number; z:number; dist:number}
function snapWhere(g:RouteGraph,x:number,z:number,mode:RouteMode,max:number,ok:(e:number)=>boolean):Snap|null {
  let best = max*max, hit = null as Snap|null
  const r = Math.ceil(max/CELL), gx = Math.floor((x-g.left)/CELL), gz = Math.floor((z-g.top)/CELL)
  // search rings outward so the common (near) case touches only a few cells
  for(let ring=0;ring<=r;ring++){
    for(let dz=-ring;dz<=ring;dz++) for(let dx=-ring;dx<=ring;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dz))!==ring) continue
      for(const e of g.grid.get(cellKey(gx+dx,gz+dz))??[]){
        if(!allowed(g,g.edgeRoad[e],mode)||!ok(e)) continue
        const a = g.edgeA[e], b = g.edgeB[e], ax = g.xz[a*2], az = g.xz[a*2+1], ex = g.xz[b*2]-ax, ez = g.xz[b*2+1]-az, nn = ex*ex+ez*ez
        const t = nn?Math.min(1,Math.max(0,((x-ax)*ex+(z-az)*ez)/nn)):0, px = ax+t*ex, pz = az+t*ez, d = (x-px)**2+(z-pz)**2
        if(d<best){best = d; hit = {edge:e,t,x:px,z:pz,dist:Math.sqrt(d)}}
      }
    }
    // anything found within the rings checked so far is at most (ring)*CELL away; stop once the next ring can't beat it
    if(hit&&hit.dist<=ring*CELL) break
  }
  return hit
}

export type TurnKind = 'left'|'right'|'slight-left'|'slight-right'|'sharp-left'|'sharp-right'|'uturn'|'arrive'
export interface Maneuver {
  /** distance from route start, metres */
  at:number; x:number; z:number; kind:TurnKind
  /** road the player turns onto (Road.n, may be '') */
  road:string
}
export interface Route {
  mode:RouteMode
  /** polyline x/z interleaved; starts at the player's snap point, ends at the target's snap point */
  points:number[]
  /** cumulative distance at each point */
  dist:number[]
  /** atlas road index for segment i (points i → i+1) */
  roads:number[]
  /** per segment: road class (0 arterial … 3 path) and whether it is a bridge/tunnel deck (height not from terrain) */
  cls:number[]; deck:number[]
  length:number
  maneuvers:Maneuver[]
  /** metres from the player / target to the network */
  startGap:number; endGap:number
  /** search stats, for verify */
  expanded:number
}

class Heap {
  k:number[] = []; v:number[] = []
  push(key:number,val:number){const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val)
    while(i>0){const p = (i-1)>>1; if(k[p]<=key) break; k[i] = k[p]; v[i] = v[p]; i = p} k[i] = key; v[i] = val}
  pop(){const k = this.k, v = this.v, top = v[0], lk = k.pop()!, lv = v.pop()!
    if(k.length){let i = 0; const n = k.length
      for(;;){let c = 2*i+1; if(c>=n) break; if(c+1<n&&k[c+1]<k[c]) c++; if(k[c]>=lk) break; k[i] = k[c]; v[i] = v[c]; i = c}
      k[i] = lk; v[i] = lv}
    return top}
  get size(){return this.k.length}
}

/** A* over the road graph from (fx,fz) to (tx,tz). Returns null when either end is off-network or no connection exists. */
export function findRoute(g:RouteGraph,fx:number,fz:number,tx:number,tz:number,mode:RouteMode,opts:{maxSnap?:number}={}):Route|null {
  const from = snapToGraph(g,fx,fz,mode,opts.maxSnap??160), dest = snapToGraph(g,tx,tz,mode,opts.maxSnap??320)
  if(!from||!dest) return null
  const xz = g.xz, nodes = xz.length/2
  const fa = g.edgeA[from.edge], fb = g.edgeB[from.edge], ta = g.edgeA[dest.edge], tb = g.edgeB[dest.edge]
  const eLen = (e:number)=>Math.hypot(xz[g.edgeB[e]*2]-xz[g.edgeA[e]*2],xz[g.edgeB[e]*2+1]-xz[g.edgeA[e]*2+1])
  const fl = eLen(from.edge), tl = eLen(dest.edge)
  // Same edge: walk straight along it.
  if(from.edge===dest.edge) return assemble(g,mode,[from.x,from.z,dest.x,dest.z],[g.edgeRoad[from.edge]],from.dist,dest.dist,0)
  const cost = new Float64Array(nodes).fill(Infinity), prev = new Int32Array(nodes).fill(-1), via = new Int32Array(nodes).fill(-1)
  const done = new Uint8Array(nodes)
  const h = (n:number)=>Math.hypot(xz[n*2]-dest.x,xz[n*2+1]-dest.z)
  const heap = new Heap()
  const seed = (n:number,c:number)=>{if(c<cost[n]){cost[n] = c; prev[n] = -2; via[n] = g.edgeRoad[from.edge]; heap.push(c+h(n),n)}}
  seed(fa,from.t*fl); seed(fb,(1-from.t)*fl)
  const goal = new Map<number,number>([[ta,dest.t*tl],[tb,(1-dest.t)*tl]])
  let best = Infinity, bestEnd = -1, expanded = 0
  while(heap.size){
    const n = heap.pop(); if(done[n]) continue; done[n] = 1; expanded++
    if(cost[n]+h(n)>=best) break
    const tail = goal.get(n); if(tail!==undefined&&cost[n]+tail<best){best = cost[n]+tail; bestEnd = n}
    for(let i=g.first[n];i<g.first[n+1];i++){
      if(!allowed(g,g.road[i],mode)) continue
      const m = g.to[i], c = cost[n]+g.len[i]
      if(c<cost[m]){cost[m] = c; prev[m] = n; via[m] = g.road[i]; heap.push(c+h(m),m)}
    }
  }
  if(bestEnd<0) return null
  const chain:number[] = []
  for(let n = bestEnd; n>=0; n = prev[n]) chain.push(n)
  chain.reverse()
  const points = [from.x,from.z], roads:number[] = []
  for(const n of chain){points.push(xz[n*2],xz[n*2+1]); roads.push(via[n])}
  points.push(dest.x,dest.z); roads.push(g.edgeRoad[dest.edge])
  return assemble(g,mode,points,roads,from.dist,dest.dist,expanded)
}

function assemble(g:RouteGraph,mode:RouteMode,raw:number[],rawRoads:number[],startGap:number,endGap:number,expanded:number):Route {
  // drop zero-length steps (snap point == node)
  const points:number[] = [raw[0],raw[1]], roads:number[] = []
  for(let i=2;i<raw.length;i+=2){
    const px = points[points.length-2], pz = points[points.length-1]
    if(Math.hypot(raw[i]-px,raw[i+1]-pz)<.05){if(roads.length) roads[roads.length-1] = rawRoads[i/2-1]; continue}
    points.push(raw[i],raw[i+1]); roads.push(rawRoads[i/2-1])
  }
  const dist = [0]
  for(let i=2;i<points.length;i+=2) dist.push(dist[dist.length-1]+Math.hypot(points[i]-points[i-2],points[i+1]-points[i-1]))
  const length = dist[dist.length-1]
  const cls = roads.map(r=>g.roads[r]?.c??2), deck = roads.map(r=>g.roads[r]?.b||g.roads[r]?.tunnel?1:0)
  return {mode,points,dist,roads,cls,deck,length,maneuvers:maneuvers(g,points,dist,roads),startGap,endGap,expanded}
}

/** Point at distance `d` along the route (clamped). */
export function pointAt(route:Route,d:number,out:{x:number,z:number,i:number} = {x:0,z:0,i:0}) {
  const {points,dist} = route, n = dist.length
  if(d<=0){out.x = points[0]; out.z = points[1]; out.i = 0; return out}
  if(d>=route.length){out.x = points[n*2-2]; out.z = points[n*2-1]; out.i = n-2; return out}
  let lo = 0, hi = n-1
  while(hi-lo>1){const mid = (lo+hi)>>1; if(dist[mid]<=d) lo = mid; else hi = mid}
  const t = (d-dist[lo])/((dist[lo+1]-dist[lo])||1)
  out.x = points[lo*2]+(points[lo*2+2]-points[lo*2])*t; out.z = points[lo*2+1]+(points[lo*2+3]-points[lo*2+1])*t; out.i = lo
  return out
}

/**
 * Turn points: heading change measured between points LOOK metres before and after each vertex (so the 1.5 m
 * simplification wiggle on curved roads doesn't read as turns). Kept when the change is ≥ 35°; nearby
 * candidates within MERGE metres collapse to the strongest one. Signs follow canvas/world axes (x east, z south):
 * cross > 0 is a right turn.
 */
function maneuvers(g:RouteGraph,points:number[],dist:number[],roads:number[]):Maneuver[] {
  const LOOK = 14, MERGE = 22, out:Maneuver[] = []
  const a = {x:0,z:0,i:0}, b = {x:0,z:0,i:0}
  const route = {points,dist,length:dist[dist.length-1]} as Route
  const cand:{at:number,angle:number,i:number}[] = []
  for(let i=1;i<dist.length-1;i++){
    const d = dist[i]
    pointAt(route,d-LOOK,a); pointAt(route,d+LOOK,b)
    const ix = points[i*2]-a.x, iz = points[i*2+1]-a.z, ox = b.x-points[i*2], oz = b.z-points[i*2+1]
    if(Math.hypot(ix,iz)<1||Math.hypot(ox,oz)<1) continue
    const angle = Math.atan2(ix*oz-iz*ox,ix*ox+iz*oz)
    if(Math.abs(angle)>=35*Math.PI/180) cand.push({at:d,angle,i})
  }
  for(let k=0;k<cand.length;k++){
    const c = cand[k]
    const rival = cand.find(o=>o!==c&&Math.abs(o.at-c.at)<MERGE&&(Math.abs(o.angle)>Math.abs(c.angle)||(Math.abs(o.angle)===Math.abs(c.angle)&&o.at<c.at)))
    if(rival) continue
    const deg = Math.abs(c.angle)*180/Math.PI, side = c.angle>0?'right':'left'
    const kind:TurnKind = deg>=160?'uturn':deg>=120?`sharp-${side}`:deg>=60?side:`slight-${side}`
    // name of the road we turn onto: first named segment within 60 m after the turn
    let road = ''
    for(let j=c.i;j<roads.length&&dist[j]<c.at+60;j++){const n = g.roads[roads[j]]?.n; if(n){road = n; break}}
    out.push({at:c.at,x:points[c.i*2],z:points[c.i*2+1],kind,road})
  }
  const n = dist.length
  out.push({at:dist[n-1],x:points[n*2-2],z:points[n*2-1],kind:'arrive',road:''})
  return out
}

export const TURN_TEXT:Record<TurnKind,string> = {
  'left':'左转', 'right':'右转', 'slight-left':'向左前方', 'slight-right':'向右前方',
  'sharp-left':'向左急转', 'sharp-right':'向右急转', 'uturn':'掉头', 'arrive':'到达',
}
