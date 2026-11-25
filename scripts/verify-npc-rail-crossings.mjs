import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {ll2xz} from '../lib/projection.ts'
import {Traffic} from '../web/src/traffic/sim.ts'

const root='public/world/',read=file=>JSON.parse(readFileSync(file))
const manifest=read(root+'manifest.json'),tileIndex=new Map(manifest.chunks.map(tile=>[`${tile.x},${tile.z}`,tile]))
const inventory=read('docs/railway-crossings.json').filter(row=>row.type==='level'&&row.status==='active')
const crossings=new Map(inventory.map(row=>[row.sharedNode,ll2xz(row.lat,row.lon)]))
assert.equal(crossings.size,119)
const tileCache=new Map()
function railsAt(x,z){
  const sections=[]
  for(let east=Math.floor((x-20)/256)*256;east<=x+20;east+=256)for(let south=Math.floor((z-20)/256)*256;south<=z+20;south+=256){
    const tile=tileIndex.get(`${east},${south}`);if(!tile)continue
    if(!tileCache.has(tile)){
      const data=gunzipSync(readFileSync(root+tile.file)),start=24+4*(manifest.chunkSize/manifest.grid+1)**2+9*data.readUInt32LE(4)+4*data.readUInt32LE(8)
      tileCache.set(tile,(JSON.parse(data.toString('utf8',start,start+data.readUInt32LE(12)))[4]??[]).filter(section=>section[7]&16).map(([ax,az,,bx,bz])=>[east+ax/100,south+az/100,east+bx/100,south+bz/100]))
    }
    sections.push(...tileCache.get(tile))
  }
  return sections
}
const failures=[];let majorSites=0,approaches=0,walkSamples=0,slowest=0
for(const [node,center] of crossings){
  const {x,z}=center,key=`${Math.floor(x/512)}_${Math.floor(z/512)}`
  const rails=railsAt(x,z)
  assert.ok(rails.length,`no level railway sections in tiles at ${node}`)
  const path=root+`roads/${key}.json.gz`
  if(!read(root+'roads/cells.json').includes(key))continue
  const graph=JSON.parse(gunzipSync(readFileSync(path)))
  const sim=new Traffic(graph,()=>.5,100,{classes:['primary','secondary','trunk'],carMin:0,carMax:0,personMin:0,personMax:0})
  const tracks=[...sim.allTracks()],incoming=tracks.filter(track=>!track.walk&&track.to===node)
  if(incoming.length)majorSites++
  for(const track of tracks.filter(track=>track.walk)){
    for(let index=0,count=Math.ceil(track.length/.5);index<=count;index++){
      const along=track.length*index/count,px=track.start.x+track.dx*along,pz=track.start.z+track.dz*along
      if(Math.hypot(px-x,pz-z)>20)continue
      walkSamples++
      for(const [ax,az,bx,bz] of rails){
        const dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz)
        if(!length||Math.abs(track.dx*dx+track.dz*dz)/length<Math.cos(Math.PI/12))continue
        const fraction=((px-ax)*dx+(pz-az)*dz)/(length*length)
        if(fraction>=0&&fraction<=1&&Math.hypot(px-ax-dx*fraction,pz-az-dz*fraction)<1.7)failures.push({node,walk:track.id,px,pz})
      }
    }
  }
  for(const track of incoming){
    const actor={track,dist:Math.max(0,track.length-8),kind:'car',speed:5,dodge:0,down:0,leaving:false,scale:1,halfWidth:.765,halfLength:1.802,height:1.5}
    sim.position(actor);sim.actors=[actor];let elapsed=0
    for(;elapsed<120;elapsed+=.05){sim.step(.05,{x,z,y:actor.y});if(actor.track!==track&&Math.hypot(actor.x-x,actor.z-z)>5)break}
    approaches++;slowest=Math.max(slowest,elapsed)
    if(elapsed>=120)failures.push({node,lane:track.id,elapsed})
  }
}
console.log(JSON.stringify({crossings:crossings.size,majorSites,approaches,walkSamples,slowest,failures},null,2))
assert.ok(majorSites&&approaches&&walkSamples&&failures.length===0)
