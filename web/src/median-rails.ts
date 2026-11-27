export type Point = {x:number; z:number}
type Node = Point & {edges:Edge[]}
type Edge = {start:Node; end:Node; banner:boolean; seen:boolean}

export interface DividerLeg {
  start: Point
  end: Point
  length: number
  banner: boolean
  rawKind: number
  sideSign: number
}

export interface DividerChain {
  group: string
  legs: DividerLeg[]
  totalLength: number
  /** True when the chain begins at a real street opening (crosswalk / junction / U-turn / bridgehead), not a 256 m tile border. */
  startOpen: boolean
  /** True when the chain ends at a real street opening (crosswalk / junction / U-turn / bridgehead), not a 256 m tile border. */
  endOpen: boolean
  /** True when the chain forms a closed loop. */
  closed: boolean
}

export interface DividerSegmentInput {
  group: string
  rawKind: number
  sideSign: number
  banner: boolean
  startX: number
  startZ: number
  endX: number
  endZ: number
  exact: boolean
}

const TILE_BORDER_EPS = 0.45

function isNearTileBorder(x: number, z: number): boolean {
  return x <= TILE_BORDER_EPS || x >= 256 - TILE_BORDER_EPS || z <= TILE_BORDER_EPS || z >= 256 - TILE_BORDER_EPS
}

/**
 * Legacy median rail topology tracer (preserved for 100% API compatibility with existing unit tests).
 */
export function medianRails(decor:readonly number[][], suppressed:(kind:number,x:number,z:number)=>boolean,
  beam:(start:Point,end:Point,banner:boolean)=>void, post:(point:Point)=>void) {
  const buckets=new Map<string,Node[]>(), nodes:Node[]=[], edges:Edge[]=[]
  function nodeAt(x:number,z:number,tolerance:number){
    const col=Math.floor(x), row=Math.floor(z)
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
      for(const node of buckets.get(`${col+dx}:${row+dz}`)??[])if(Math.hypot(node.x-x,node.z-z)<=tolerance)return node
    }
    const node:Node={x,z,edges:[]},key=`${col}:${row}`
    const bucket=buckets.get(key)??[];bucket.push(node);buckets.set(key,bucket);nodes.push(node);return node
  }
  for(const [kind,east,south,heading,span,ax,az,bx,bz] of decor){
    if((kind!==1&&kind!==2)||suppressed(kind,east/10,south/10))continue
    const exact=bz!==undefined, dx=Math.cos(heading/100)*span/20,dz=Math.sin(heading/100)*span/20
    const start=nodeAt(exact?ax/100:east/10-dx,exact?az/100:south/10-dz,exact?.001:.18)
    const end=nodeAt(exact?bx/100:east/10+dx,exact?bz/100:south/10+dz,exact?.001:.18)
    if(start===end)continue
    const edge={start,end,banner:kind===2,seen:false};edges.push(edge);start.edges.push(edge);end.edges.push(edge)
  }
  const caps=new Set<Node>()
  function trace(first:Edge,start:Node){
    let from=start,edge:Edge|undefined=first,total=0
    const legs=[]
    while(edge&&!edge.seen){
      edge.seen=true
      const to:Node=edge.start===from?edge.end:edge.start,length=Math.hypot(to.x-from.x,to.z-from.z)
      beam(from,to,edge.banner);legs.push({from,to,length});total+=length;from=to
      edge=to.edges.length===2?to.edges.find(candidate=>!candidate.seen):undefined
    }
    caps.add(start);caps.add(from)
    const spacing=total/Math.max(1,Math.round(total));let travelled=0,next=spacing
    for(const {from,to,length} of legs){
      while(next<travelled+length&&next<total-1e-6){
        const fraction=(next-travelled)/length
        post({x:from.x+(to.x-from.x)*fraction,z:from.z+(to.z-from.z)*fraction});next+=spacing
      }
      travelled+=length
    }
  }
  for(const node of nodes)if(node.edges.length!==2)for(const edge of node.edges)if(!edge.seen)trace(edge,node)
  for(const edge of edges)if(!edge.seen)trace(edge,edge.start)
  for(const cap of caps)post(cap)
}

interface ChainNode extends Point {
  edges: ChainEdge[]
}
interface ChainEdge {
  start: ChainNode
  end: ChainNode
  banner: boolean
  rawKind: number
  sideSign: number
  seen: boolean
}

/**
 * Traces continuous divider runs (both central medians and motor/non-motor verges) grouped by divider profile.
 * Welds legacy 0.1 m quantization noise (<= 0.18 m) while strictly preserving every real crosswalk,
 * intersection, U-turn bay, and bridgehead opening (>= 0.30 m). Distinguishes real open ends from
 * 256 m chunk borders so end-cap treatments only appear at actual roadway openings.
 */
export function traceDividerChains(
  segments: readonly DividerSegmentInput[],
  maxWeldGap = 0.18,
): DividerChain[] {
  const byGroup = new Map<string, DividerSegmentInput[]>()
  for (const seg of segments) {
    let list = byGroup.get(seg.group)
    if (!list) { list = []; byGroup.set(seg.group, list) }
    list.push(seg)
  }

  const chains: DividerChain[] = []
  for (const [group, list] of byGroup) {
    const buckets = new Map<string, ChainNode[]>()
    const nodes: ChainNode[] = []
    const edges: ChainEdge[] = []

    const nodeAt = (x: number, z: number, tol: number): ChainNode => {
      const col = Math.floor(x), row = Math.floor(z)
      let best: ChainNode | undefined
      let bestD = tol
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = buckets.get(`${col + dx}:${row + dz}`)
          if (!bucket) continue
          for (const candidate of bucket) {
            const d = Math.hypot(candidate.x - x, candidate.z - z)
            if (d <= bestD) { bestD = d; best = candidate }
          }
        }
      }
      if (best) return best
      const created: ChainNode = {x, z, edges: []}
      const key = `${col}:${row}`
      let bucket = buckets.get(key)
      if (!bucket) { bucket = []; buckets.set(key, bucket) }
      bucket.push(created)
      nodes.push(created)
      return created
    }

    for (const seg of list) {
      const tol = seg.exact ? 0.001 : maxWeldGap
      const start = nodeAt(seg.startX, seg.startZ, tol)
      const end = nodeAt(seg.endX, seg.endZ, tol)
      if (start === end) continue
      const edge: ChainEdge = {
        start,
        end,
        banner: seg.banner,
        rawKind: seg.rawKind,
        sideSign: seg.sideSign,
        seen: false,
      }
      edges.push(edge)
      start.edges.push(edge)
      end.edges.push(edge)
    }

    const traceFrom = (first: ChainEdge, startNode: ChainNode) => {
      let from = startNode
      let edge: ChainEdge | undefined = first
      let totalLength = 0
      const legs: DividerLeg[] = []
      while (edge && !edge.seen) {
        edge.seen = true
        const to: ChainNode = edge.start === from ? edge.end : edge.start
        const length = Math.hypot(to.x - from.x, to.z - from.z)
        if (length > 1e-4) {
          // Preserve original lateral sideSign when traversing an edge in reverse order.
          const forward = edge.start === from
          legs.push({
            start: {x: from.x, z: from.z},
            end: {x: to.x, z: to.z},
            length,
            banner: edge.banner,
            rawKind: edge.rawKind,
            sideSign: forward ? edge.sideSign : -edge.sideSign,
          })
          totalLength += length
        }
        from = to
        if (to.edges.length === 2) {
          edge = to.edges.find(c => !c.seen)
        } else {
          edge = undefined
        }
      }
      if (!legs.length) return
      const closed = from === startNode && startNode.edges.length === 2
      const startOpen = !closed && startNode.edges.length === 1 && !isNearTileBorder(startNode.x, startNode.z)
      const endOpen = !closed && from.edges.length === 1 && !isNearTileBorder(from.x, from.z)
      chains.push({group, legs, totalLength, startOpen, endOpen, closed})
    }

    for (const node of nodes) {
      if (node.edges.length !== 2) {
        for (const edge of node.edges) {
          if (!edge.seen) traceFrom(edge, node)
        }
      }
    }
    for (const edge of edges) {
      if (!edge.seen) traceFrom(edge, edge.start)
    }
  }
  return chains
}

/**
 * Samples a point + unit tangent + lateral normal at chainage `s` along a traced DividerChain.
 */
export function sampleChainAt(
  chain: DividerChain,
  s: number,
): {x: number; z: number; tx: number; tz: number; nx: number; nz: number; yaw: number; sideSign: number} {
  let acc = 0
  const clamped = Math.max(0, Math.min(chain.totalLength, s))
  for (let i = 0; i < chain.legs.length; i++) {
    const leg = chain.legs[i]
    if (clamped <= acc + leg.length || i === chain.legs.length - 1) {
      const u = leg.length > 1e-6 ? Math.max(0, Math.min(1, (clamped - acc) / leg.length)) : 0
      const dx = leg.end.x - leg.start.x
      const dz = leg.end.z - leg.start.z
      const len = Math.hypot(dx, dz) || 1
      const tx = dx / len
      const tz = dz / len
      const yaw = -Math.atan2(dz, dx)
      // Matches street-worker box() local +Z = (sin(yaw), cos(yaw))
      const nx = Math.sin(yaw)
      const nz = Math.cos(yaw)
      return {
        x: leg.start.x + dx * u,
        z: leg.start.z + dz * u,
        tx,
        tz,
        nx,
        nz,
        yaw,
        sideSign: leg.sideSign,
      }
    }
    acc += leg.length
  }
  const last = chain.legs[chain.legs.length - 1]
  return {x: last.end.x, z: last.end.z, tx: 1, tz: 0, nx: 0, nz: 1, yaw: 0, sideSign: last.sideSign}
}

/**
 * Merges consecutive collinear, constant-grade, non-banner legs in a traced chain up to `maxRun` metres
 * to eliminate mid-span seams and cut InstancedMesh box count by ~40% on straight boulevards.
 */
export function mergeCollinearChainLegs(
  legs: readonly DividerLeg[],
  baseLevel: (x: number, z: number) => number,
  maxRun = 12,
): DividerLeg[] {
  if (legs.length <= 1) return legs.slice()
  const out: DividerLeg[] = []
  let cur = {...legs[0], start: {...legs[0].start}, end: {...legs[0].end}}
  for (let i = 1; i < legs.length; i++) {
    const next = legs[i]
    const canMerge =
      !cur.banner &&
      !next.banner &&
      cur.sideSign === next.sideSign &&
      cur.length + next.length <= maxRun
    if (canMerge) {
      const dx1 = cur.end.x - cur.start.x, dz1 = cur.end.z - cur.start.z
      const dx2 = next.end.x - next.start.x, dz2 = next.end.z - next.start.z
      const l1 = Math.hypot(dx1, dz1) || 1, l2 = Math.hypot(dx2, dz2) || 1
      const dot = (dx1 * dx2 + dz1 * dz2) / (l1 * l2)
      if (dot > 0.9992) {
        const y0 = baseLevel(cur.start.x, cur.start.z)
        const yMid = baseLevel(cur.end.x, cur.end.z)
        const y1 = baseLevel(next.end.x, next.end.z)
        const yExpected = y0 + (y1 - y0) * (l1 / (l1 + l2))
        if (Math.abs(yMid - yExpected) <= 0.035) {
          cur.end = {...next.end}
          cur.length = Math.hypot(cur.end.x - cur.start.x, cur.end.z - cur.start.z)
          continue
        }
      }
    }
    out.push(cur)
    cur = {...next, start: {...next.start}, end: {...next.end}}
  }
  out.push(cur)
  return out
}
