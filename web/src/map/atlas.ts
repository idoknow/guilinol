import type {Manifest} from '../world'

const kinds = ['scenic','peak','gate','bridge','museum','park','water','memorial','road'] as const
export type Kind = typeof kinds[number]
export interface Place {n:string; k:Kind; x:number; z:number; a?:string[]}
interface Road {n:string; c:0|1|2|3; w:number; b?:1; p:number[]}
export interface AtlasData {
  extent:[number,number,number,number]; roads:Road[]; water:number[][][]; green:number[][][];
  buildings:number[][]; places:Place[]
}
export interface Atlas extends AtlasData {
  roadAt(x:number,z:number,max?:number):{name:string,c:number}|null
  search(query:string,limit?:number):Place[]
}

function indexed(data:AtlasData):Atlas {
  const [left,top,width,depth] = data.extent
  const cell = 64, cols = Math.floor(width/cell)+1, rows = Math.floor(depth/cell)+1
  const column = (x:number)=>Math.floor((x-left)/cell)
  const row = (z:number)=>Math.floor((z-top)/cell)
  interface Segment {road:Road; x:number; z:number; dx:number; dz:number; norm:number}
  const grid = new Map<number,Segment[]>()
  for(const road of data.roads) {
    if(!road.n) continue
    const path = road.p
    for(let index=0;index+3<path.length;index+=2) {
      const [x,z,endX,endZ] = path.slice(index,index+4)
      const dx=endX-x, dz=endZ-z, norm=dx*dx+dz*dz
      if(!norm) continue
      const segment = {road,x,z,dx,dz,norm}
      for(let rz=row(Math.min(z,endZ));rz<=row(Math.max(z,endZ));rz++) {
        for(let cx=column(Math.min(x,endX));cx<=column(Math.max(x,endX));cx++) {
          const key=rz*cols+cx, bucket=grid.get(key)
          if(bucket) bucket.push(segment); else grid.set(key,[segment])
        }
      }
    }
  }
  return {...data,
    roadAt(x,z,max=18) {
      if(max<0 || !Number.isFinite(x) || !Number.isFinite(z)) return null
      let best=max*max, nearest:Road|undefined
      const lastCol=Math.min(cols-1,column(x+max)), lastRow=Math.min(rows-1,row(z+max))
      for(let rz=Math.max(0,row(z-max));rz<=lastRow;rz++) {
        for(let cx=Math.max(0,column(x-max));cx<=lastCol;cx++) {
          const bucket=grid.get(rz*cols+cx)
          if(!bucket) continue
          for(const seg of bucket) {
            const ex=x-seg.x, ez=z-seg.z
            const t=Math.min(1,Math.max(0,(ex*seg.dx+ez*seg.dz)/seg.norm))
            const dist=(ex-t*seg.dx)**2+(ez-t*seg.dz)**2
            if(dist<=best) {best=dist; nearest=seg.road}
          }
        }
      }
      return nearest ? {name:nearest.n,c:nearest.c} : null
    },
    search(query,limit) {
      const needle=query.trim().toLowerCase()
      if(!needle) return []
      const matches:{place:Place;rank:number}[]=[]
      for(const place of data.places) {
        let rank=3
        for(const label of [place.n,...place.a??[]]) {
          const name=label.toLowerCase()
          rank=Math.min(rank,name===needle?0:name.startsWith(needle)?1:name.includes(needle)?2:3)
        }
        if(rank<3) matches.push({place,rank})
      }
      matches.sort((a,b)=>a.rank-b.rank || kinds.indexOf(a.place.k)-kinds.indexOf(b.place.k) || a.place.n.length-b.place.n.length)
      return matches.slice(0,limit===undefined?matches.length:Math.max(0,limit)).map(hit=>hit.place)
    }
  }
}

export async function loadAtlas(manifest:Manifest):Promise<Atlas> {
  const response=await fetch(`./world/${manifest.atlas.file}`)
  if(!response.ok || !response.body) throw Error(`Atlas: HTTP ${response.status}`)
  return indexed(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json())
}
