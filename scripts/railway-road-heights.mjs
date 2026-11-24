// Sample the same triangulated carriageways that the street worker sends to physics.
// Run with tsx so the sampler uses the current worker and projection directly.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {gunzipSync} from 'node:zlib'
import {Color} from 'three'
import {ll2xz} from '../lib/projection.ts'

const [directory, inventory,check] = process.argv.slice(2)
const painted=check==='--audit-painted'
const audit=painted || check==='--audit-levels'
const style=JSON.parse(readFileSync(new URL('../pipeline/railway-style.json',import.meta.url)))
const steel=new Color(style.steel)
const deviations=[]
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json')))
const {bridgeDepth}=JSON.parse(readFileSync(new URL('../pipeline/vessel-bounds.json',import.meta.url)))
const nodes = new Map()
for (const row of JSON.parse(readFileSync(inventory))) {
  if(audit && row.type!=='level')continue
  const key = row.type === 'level' ? row.sharedNode : [row.rail,row.road,row.lat,row.lon].join('/')
  nodes.set(key, ll2xz(row.lat, row.lon))
}

function request(tile) {
  const data = gunzipSync(readFileSync(join(directory, tile.file)))
  const n = manifest.chunkSize / manifest.grid + 1, fieldBytes = n*n*2
  const start = 24 + 2*fieldBytes + 9*data.readUInt32LE(4) + 4*data.readUInt32LE(8)
  const end = start + data.readUInt32LE(12)
  const [,paths,thin=[],,rails=[]] = JSON.parse(data.toString('utf8', start, end))
  const tail = end + data.readUInt32LE(16) + 18*data.readUInt32LE(20)
  if (data.toString('ascii',0,4) !== 'GL04' || ![0,fieldBytes].includes(data.length-tail))
    throw Error('Unsupported tile ' + tile.file)
  const underlay = tail === data.length ? 24 : tail
  const wet = (col,row) => data.readInt16LE(24 + fieldBytes + 2*(row*n+col)) !== -32768
  const y = (col,row) => data.readInt16LE(underlay+2*(row*n+col))/10
  const edge = Array.from({length:n}, (_,i)=>i)
  const dryX = [0,n-1].map(x => !edge.some(z=>wet(x,z)))
  const dryZ = [0,n-1].map(z => !edge.some(x=>wet(x,z)))
  const stride = edge.some(z=>edge.some(x=>wet(x,z))) ? 1 : 2
  const elevations = []
  for (let z=0;z<n;z+=stride) for (let x=0;x<n;x+=stride) {
    let height = y(x,z)
    if ((x===0 && dryX[0]) || (x===n-1 && dryX[1])) {
      const i=z&~7
      height=y(x,i)+(y(x,Math.min(n-1,i+8))-y(x,i))*(z-i)/8
    } else if ((z===0 && dryZ[0]) || (z===n-1 && dryZ[1])) {
      const i=x&~7
      height=y(i,z)+(y(Math.min(n-1,i+8),z)-y(i,z))*(x-i)/8
    }
    elevations.push(height)
  }
  const deckCount = data.readUInt32LE(20)*9
  const deckStart = tail-2*deckCount
  const deck = Float32Array.from({length:deckCount}, (_,i)=>data.readInt16LE(deckStart+2*i)/100)
  const underside=deck.slice()
  const thinSet=new Set(thin)
  for(let i=1;i<underside.length;i+=3)underside[i]-=thinSet.has(Math.floor(i/9))?.6:bridgeDepth
  return {deck, underside, worker:{id:0, paths, rails:audit?rails.filter(section=>(section[7]&16) && (!painted || (section[7]&64))):[], step:stride*manifest.grid, elevations:Float32Array.from(elevations)}}
}

const bins=new WeakMap()
function at(triangles,x,z) {
  let index=bins.get(triangles)
  if(!index){
    index=new Map()
    for(let i=0;i<triangles.length;i+=9){
      const xs=[triangles[i],triangles[i+3],triangles[i+6]],zs=[triangles[i+2],triangles[i+5],triangles[i+8]]
      for(let col=Math.floor(Math.min(...xs)/8);col<=Math.floor(Math.max(...xs)/8);col++){
        for(let row=Math.floor(Math.min(...zs)/8);row<=Math.floor(Math.max(...zs)/8);row++){
          const key=col+','+row
          if(!index.has(key))index.set(key,[])
          index.get(key).push(i)
        }
      }
    }
    bins.set(triangles,index)
  }
  let top=null
  for(const i of index.get(Math.floor(x/8)+','+Math.floor(z/8))??[]){
    const [ax,ay,az,bx,by,bz,cx,cy,cz]=triangles.subarray(i,i+9)
    const det=(bx-ax)*(cz-az)-(cx-ax)*(bz-az)
    if (Math.abs(det)<1e-9) continue
    const u=((x-ax)*(cz-az)-(z-az)*(cx-ax))/det
    const v=((z-az)*(bx-ax)-(x-ax)*(bz-az))/det
    if(u>=-1e-8 && v>=-1e-8 && u+v<=1+1e-8)
      top=Math.max(top??-Infinity,ay+u*(by-ay)+v*(cy-ay))
  }
  return top
}

let triangles,mesh
globalThis.self = globalThis
self.postMessage = response => {
  if(response.error) throw Error(response.error)
  mesh=response.data
  triangles=mesh.road
}
await import('../web/src/street-worker.ts')
const result={}
for(const tile of manifest.chunks){
  const local=[...nodes].filter(([,p])=>p.x>=tile.x && p.x<tile.x+256 && p.z>=tile.z && p.z<tile.z+256)
  if(!audit && !local.length)continue
  const {deck,underside,worker} = request(tile)
  if(audit && !worker.rails.length && !local.length)continue
  self.onmessage({data:worker})
  if(audit){
    const {positions,colors,kinds}=mesh
    for(let i=0;i<positions.length;i+=9){
      if(kinds[i/3]!==7 || Math.abs(colors[i]-steel.r)>1e-6)continue
      const triangle=positions.subarray(i,i+9)
      // Inspect triangle interiors as well as endpoints at street triangulation seams.
      for(const weights of [[1,0,0],[0,1,0],[0,0,1],[1/3,1/3,1/3]]){
        const [x,y,z]=[0,1,2].map(k=>weights.reduce((v,w,j)=>v+w*triangle[j*3+k],0))
        let road=at(triangles,x,z)
        if(painted && road===null){
          const {elevations,step}=worker,n=256/step+1
          const col=Math.min(n-2,Math.max(0,Math.floor(x/step))),row=Math.min(n-2,Math.max(0,Math.floor(z/step)))
          const i=row*n+col,u=x/step-col,v=z/step-row
          const a=elevations[i],b=elevations[i+1],c=elevations[i+n],d=elevations[i+n+1]
          road=u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v)
        }
        if(road===null)continue
        deviations.push({x:tile.x+x,z:tile.z+z,gap:y-road})
      }
    }
  }
  for(const [id,{x,z}] of local) {
    const lx=x-tile.x, lz=z-tile.z
    result[id]={road:at(triangles,lx,lz),deck:at(deck,lx,lz),soffit:at(underside,lx,lz)}
  }
}
if(Object.keys(result).length!==nodes.size) throw Error('Missing crossing tile')
if(audit){
  const worst=deviations.sort((a,b)=>Math.abs(b.gap)-Math.abs(a.gap))
  console.log(JSON.stringify({samples:worst.length,over2cm:worst.filter(p=>Math.abs(p.gap)>.02).length,
    maxAbsM:Math.abs(worst[0]?.gap??0),worst:worst.slice(0,30)}))
}else console.log(JSON.stringify(result))
