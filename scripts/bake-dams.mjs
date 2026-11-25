import {existsSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {gzipSync,gunzipSync} from 'node:zlib'

const directory=process.argv[2]
if(!directory)throw Error('Usage: node scripts/bake-dams.mjs <world directory>')
const manifestFile=join(directory,'manifest.json')
if(!existsSync(manifestFile)){console.log('No world supplied; skipping dam assembly');process.exit(0)}
const dams=JSON.parse(readFileSync(new URL('../pipeline/dam-cells.json',import.meta.url)))
const passages=JSON.parse(readFileSync(new URL('../pipeline/dam-passages.json',import.meta.url)))
const manifest=JSON.parse(readFileSync(manifestFile))
const origins=new Map(manifest.chunks.map(tile=>[[tile.x,tile.z].join(),tile]))
const cache=new Map(),dry=-32768
function samples(col,row) {
  const east=col*4,south=row*4
  const baseX=Math.floor(col/64)*256,baseZ=Math.floor(row/64)*256
  const result=[]
  for(const left of east===baseX?[baseX,baseX-256]:[baseX])for(const top of south===baseZ?[baseZ,baseZ-256]:[baseZ]){
    const tile=origins.get([left,top].join());if(!tile)continue
    if(!cache.has(tile)){
      const data=gunzipSync(readFileSync(join(directory,tile.file)))
      const end=24+16900+data.readUInt32LE(4)*9+data.readUInt32LE(8)*4+data.readUInt32LE(12)+data.readUInt32LE(16)+data.readUInt32LE(20)*18
      if(data.toString('ascii',0,4)!=='GL04'||![0,8450].includes(data.length-end))throw Error('Unexpected terrain layout: '+tile.file)
      cache.set(tile,{data,underlay:data.length>end?end:24,changed:false})
    }
    const chunk=cache.get(tile),offset=2*((south-top)/4*65+(east-left)/4)
    result.push({chunk,offset,water:chunk.data.readInt16LE(8474+offset)})
  }
  return result
}
for(const [id,runs] of Object.entries(dams)){
  const cells=runs.flatMap(([row,start,end])=>Array.from({length:end-start+1},(_,index)=>[start+index,row]))
  const inside=new Set(cells.map(pair=>pair.join())),bank=[]
  const openings=new Set((passages[id]?.cells??[]).map(pair=>pair.join()))
  for(const [col,row] of cells)for(const [dx,dz] of [[0,1],[0,-1],[1,0],[-1,0]]){
    if(!inside.has([col+dx,row+dz].join()))for(const {water} of samples(col+dx,row+dz))if(water!==dry)bank.push(water)
  }
  if(!bank.length)continue
  const crest=Math.max(...bank)+3
  let changed=0
  for(const [col,row] of cells)for(const {chunk,offset,water} of samples(col,row)){
    if(openings.has([col,row].join()))continue
    if(water===dry)continue
    chunk.data.writeInt16LE(dry,8474+offset)
    for(const base of new Set([24,chunk.underlay]))chunk.data.writeInt16LE(Math.max(crest,chunk.data.readInt16LE(base+offset)),base+offset)
    chunk.changed=true;changed++
  }
  console.log(`${id}: ${changed} wet samples reclaimed`)
}
for(const [tile,{data,changed}] of cache)if(changed){
  const packed=gzipSync(data);writeFileSync(join(directory,tile.file),packed);tile.bytes=packed.length
}
writeFileSync(manifestFile,JSON.stringify(manifest)+'\n')
