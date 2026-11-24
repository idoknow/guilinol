// Sample the same triangulated carriageways that the street worker sends to physics.
// Run with tsx so the sampler uses the current worker and projection directly.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {gunzipSync} from 'node:zlib'
import {ll2xz} from '../lib/projection.ts'

const [directory, inventory] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json')))
const {bridgeDepth}=JSON.parse(readFileSync(new URL('../pipeline/vessel-bounds.json',import.meta.url)))
const nodes = new Map()
for (const row of JSON.parse(readFileSync(inventory))) {
  const key = row.type === 'level' ? row.sharedNode : [row.rail,row.road,row.lat,row.lon].join('/')
  nodes.set(key, ll2xz(row.lat, row.lon))
}

function request(tile) {
  const data = gunzipSync(readFileSync(join(directory, tile.file)))
  const n = manifest.chunkSize / manifest.grid + 1, fieldBytes = n*n*2
  const start = 24 + 2*fieldBytes + 9*data.readUInt32LE(4) + 4*data.readUInt32LE(8)
  const end = start + data.readUInt32LE(12)
  const [,paths,thin=[]] = JSON.parse(data.toString('utf8', start, end))
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
  return {deck, underside, worker:{id:0, paths, step:stride*manifest.grid, elevations:Float32Array.from(elevations)}}
}

function at(triangles,x,z) {
  let top=null
  for(let i=0;i<triangles.length;i+=9){
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

let triangles
globalThis.self = globalThis
self.postMessage = response => {
  if(response.error) throw Error(response.error)
  triangles=response.data.road
}
await import('../web/src/street-worker.ts')
const result={}
for(const tile of manifest.chunks){
  const local=[...nodes].filter(([,p])=>p.x>=tile.x && p.x<tile.x+256 && p.z>=tile.z && p.z<tile.z+256)
  if(!local.length)continue
  const {deck,underside,worker} = request(tile)
  self.onmessage({data:worker})
  for(const [id,{x,z}] of local) {
    const lx=x-tile.x, lz=z-tile.z
    result[id]={road:at(triangles,lx,lz),deck:at(deck,lx,lz),soffit:at(underside,lx,lz)}
  }
}
if(Object.keys(result).length!==nodes.size) throw Error('Missing crossing tile')
console.log(JSON.stringify(result))
