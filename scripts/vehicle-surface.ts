// Vertical intersections with the triangles used by the fine-detail renderer.
import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {gunzipSync} from 'node:zlib'
import {streetGeometry} from '../web/src/street-worker'
import {floorLevel,nearbyTunnels,joinPortalRoads} from '../web/src/tunnels'

class Triangles {
  bins=new Map<string,number[]>()
  constructor(private vertices:Float32Array){
    for(let i=0;i<vertices.length;i+=9){
      const xs=[vertices[i],vertices[i+3],vertices[i+6]],zs=[vertices[i+2],vertices[i+5],vertices[i+8]]
      for(let x=Math.floor(Math.min(...xs)/8);x<=Math.floor(Math.max(...xs)/8);x++)
        for(let z=Math.floor(Math.min(...zs)/8);z<=Math.floor(Math.max(...zs)/8);z++){
          const key=x+','+z
          if(!this.bins.has(key))this.bins.set(key,[])
          this.bins.get(key)!.push(i)
        }
    }
  }
  hits(x:number,z:number){
    const ys=[],v=this.vertices
    for(const i of this.bins.get(Math.floor(x/8)+','+Math.floor(z/8))??[]){
      const ax=v[i+3]-v[i],az=v[i+5]-v[i+2],bx=v[i+6]-v[i],bz=v[i+8]-v[i+2]
      const det=ax*bz-az*bx
      if(Math.abs(det)<1e-8)continue
      const dx=x-v[i],dz=z-v[i+2],a=(dx*bz-dz*bx)/det,b=(dz*ax-dx*az)/det
      if(a>=-1e-6&&b>=-1e-6&&a+b<=1.000001)ys.push(v[i+1]+a*(v[i+4]-v[i+1])+b*(v[i+7]-v[i+1]))
    }
    return ys
  }
}

function tileSurface(world,entry,tunnels){
  const data=gunzipSync(fs.readFileSync(path.join(world,entry.file)))
  const [verts,indices,jsonSize,imageBytes,triangles]=[4,8,12,16,20].map(i=>data.readUInt32LE(i))
  const jsonStart=24+16900+9*verts+4*indices
  const [,paths,,,legacy,,,savedBed]=JSON.parse(data.toString('utf8',jsonStart,jsonStart+jsonSize))
  // Historical terrain replacements are objects. New GL04 walking floors are
  // polygon arrays and do not replace any vehicle ground triangles.
  const bed=(Array.isArray(savedBed)?undefined:savedBed)??(legacy&&!Array.isArray(legacy)?legacy:undefined)
  const deckStart=jsonStart+jsonSize+imageBytes,tail=deckStart+18*triangles
  const groundStart=data.length===tail?24:tail
  const grid=new Float32Array(4225),wet=new Uint8Array(4225)
  for(let i=0;i<4225;i++){grid[i]=data.readInt16LE(groundStart+2*i)/10;wet[i]=Number(data.readInt16LE(8474+2*i)!==-32768)}
  for(const [base,stride] of [[0,1],[4160,1],[0,65],[64,65]]){
    if(Array.from({length:65},(_,i)=>wet[base+i*stride]).some(Boolean))continue
    for(let i=0;i<64;i++){const j=base+(i&~7)*stride;grid[base+i*stride]=grid[j]+(grid[j+8*stride]-grid[j])*(i%8)/8}
  }
  const step=wet.some(Boolean)?4:8,s=step/4
  function ground(x,z){
    const col=Math.max(0,Math.min(256/step-1,Math.floor(x/step))),row=Math.max(0,Math.min(256/step-1,Math.floor(z/step)))
    const i=(row*65+col)*s,u=x/step-col,v=z/step-row,a=grid[i],b=grid[i+s],c=grid[i+s*65],d=grid[i+s*66]
    return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v)
  }
  const roads=streetGeometry(paths,ground).road
  joinPortalRoads(entry,tunnels,[roads])
  const modified=bed&&new Set(bed.drop),replacement=bed&&new Triangles(Float32Array.from(bed.vertices.flat()))
  function visibleGround(x,z){
    if(!modified)return ground(x,z)
    const col=Math.min(256/step-1,Math.floor(x/step)),row=Math.min(256/step-1,Math.floor(z/step))
    const face=2*(row*256/step+col)+Number(x/step-col+z/step-row>1)
    if(!modified.has(face))return ground(x,z)
    const hits=replacement.hits(x,z)
    return hits.length?Math.max(...hits):ground(x,z)
  }
  return {ground:visibleGround,road:new Triangles(roads),deck:new Triangles(Float32Array.from({length:triangles*9},(_,i)=>data.readInt16LE(deckStart+2*i)/100))}
}

export function vehicleSurface(world,m){
  const chunks=new Map(m.chunks.map(e=>[e.x+','+e.z,e])),cache=new Map()
  const tunnels=m.tunnels??[],landmarks=new Map<string,any[]>()
  const roles=JSON.parse(fs.readFileSync('pipeline/seam-surfaces.json','utf8'))
  for(const entry of m.landmarks){
    const atlas=[roles.atlas[entry.id]??[]].flat().filter(part=>part.role==='road')
    const sources=atlas.length?atlas:Object.entries(roles.surfaces[entry.id]??{}).filter(([,role])=>role==='road').map(([material])=>({material}))
    if(entry.id==='jiefang_bridge')sources.push({material:'pave',bikeDeck:true})
    for(const source of sources){
      const args=['pipeline/glb-triangles.mjs',path.join('public',entry.file),'--visible','',source.material]
      if(source.box)args.push(JSON.stringify(source.box))
      const bytes=execFileSync(process.execPath,args,{maxBuffer:64*1024*1024})
      const vertices=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length))
      const angle=entry.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle)
      let west=Infinity,east=-Infinity,north=Infinity,south=-Infinity
      for(let i=0;i<vertices.length;i+=3){
        const x=vertices[i],z=vertices[i+2]
        vertices[i]=entry.position[0]+cos*x+sin*z
        vertices[i+1]+=entry.position[1]
        vertices[i+2]=entry.position[2]-sin*x+cos*z
        west=Math.min(west,vertices[i]);east=Math.max(east,vertices[i])
        north=Math.min(north,vertices[i+2]);south=Math.max(south,vertices[i+2])
      }
      const mesh={id:entry.id,bikeDeck:source.bikeDeck,triangles:new Triangles(vertices)}
      for(let col=Math.floor(west/256);col<=Math.floor(east/256);col++)
        for(let row=Math.floor(north/256);row<=Math.floor(south/256);row++){
          const key=col*256+','+row*256
          if(!landmarks.has(key))landmarks.set(key,[])
          landmarks.get(key)!.push(mesh)
        }
    }
  }
  return (x,z,lane,diagnostic?:{hidden:boolean,deck?:number,missingFloor?:boolean,road?:number,terrain?:number})=>{
    const ox=Math.floor(x/256)*256,oz=Math.floor(z/256)*256,key=ox+','+oz
    if(!cache.has(key)){
      if(!chunks.has(key))throw Error('No rendered chunk at '+[x,z])
      if(cache.size>=48)cache.delete(cache.keys().next().value)
      cache.set(key,tileSurface(world,chunks.get(key),nearbyTunnels(tunnels,x,z)))
    }
    const tile=cache.get(key),lx=x-ox,lz=z-oz
    const local=nearbyTunnels(tunnels,x,z)
    for(const t of local){
      if(t.way!==lane.way)continue
      const floor=floorLevel(t,x,z)
      if(floor!==undefined)return floor
    }
    // A surface way can share the actual floor of the adjoining cut across
    // a daylight junction. Ground below that floor is not wheel support.
    if(!lane.structure||lane.structure==='surface'){
      for(const t of local){
        if(!t.nodes)continue
        const onLanding=t.nodes.some((node,end)=>{
          if(!(t.mouths?.[end]||t.gradedLanding)||!(node===lane.from||node===lane.to||lane.nodes?.has(node)))return false
          const [px,,pz]=t.portals[end]
          return Math.hypot(x-px,z-pz)<=4*t.halfWidth
        })
        if(onLanding){
          const floor=floorLevel(t,x,z)
          if(floor!==undefined){
            if(diagnostic)diagnostic.road=floor
            return floor
          }
        }
      }
    }
    if(lane.structure==='tunnel'&&lane.start&&lane.end){
      const along=(x-lane.start.x)*lane.dx+(z-lane.start.z)*lane.dz
      const end=along<0?lane.start:along>lane.length?lane.end:null
      if(end){
        for(const t of local){
          if(!t.portals.some(([px,,pz])=>Math.hypot(end.x-px,end.z-pz)<.05))continue
          const floor=floorLevel(t,x,z)
          if(floor!==undefined)return floor
        }
      }else if(diagnostic)diagnostic.missingFloor=true
    }
    const terrain=tile.ground(lx,lz),road=Math.max(...tile.road.hits(lx,lz))
    let y=Math.max(terrain,road)
    for(const mesh of landmarks.get(key)??[]){
      if(mesh.bikeDeck&&lane.way!==1531308751&&lane.way!==1531308752)continue
      const hits=mesh.triangles.hits(x,z)
      if(!hits.length)continue
      // Binjiang and the eastern riverbank street continue beneath the span.
      if(mesh.id==='jiefang_bridge'&&[1531308427,1531308428,675174045,682893309].includes(lane.way)){
        const lower=Math.min(...hits)
        if(lower<y+2)y=Math.max(y,lower)
      }else y=Math.max(y,...hits)
    }
    if(lane.structure==='bridge'){
      const deck=Math.max(...tile.deck.hits(lx,lz))
      if(diagnostic)diagnostic.deck=deck
      y=Math.max(y,deck)
    }
    if(diagnostic){
      diagnostic.road=road;diagnostic.terrain=terrain
      diagnostic.hidden=y===terrain&&Number.isFinite(road)&&terrain>road+.005
    }
    return y
  }
}
