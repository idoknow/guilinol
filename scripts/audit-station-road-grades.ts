import fs from 'node:fs'
import path from 'node:path'
import {vehicleSurface} from './vehicle-surface'
import {ll2xz} from '../lib/projection.ts'

const [main, candidate, output]=process.argv.slice(2)
if(!output)throw Error('Expected main world, candidate world and report path')
const load=(file:string)=>JSON.parse(fs.readFileSync(file,'utf8'))
const surfaces=[main,candidate].map(dir=>vehicleSurface(dir,load(path.join(dir,'manifest.json'))))
const design=load('pipeline/station-road-profiles.json')
const violations=[]
let samples=0
for(const way of load('raw/osm-2026-11.json').elements){
  if(way.type!=='way'||!design[way.id]||['pedestrian','footway','steps'].includes(way.tags.highway))continue
  const kind=way.tags.highway.replace(/_link$/,'')
  const cap=['service','residential','unclassified','living_street'].includes(kind)?.08:.05
  const structure=way.tags.tunnel==='yes'?'tunnel':'surface'
  const lane={way:way.id,nodes:new Set(way.nodes),structure}
  const points=way.geometry.map(({lat,lon})=>ll2xz(lat,lon))
  let chain=0
  for(let i=1;i<points.length;i++){
    const {x,z}=points[i-1],{x:endX,z:endZ}=points[i],dx=endX-x,dz=endZ-z,length=Math.hypot(dx,dz)
    if(length<.001)continue
    const count=Math.ceil(length/2),step=length/count
    let previous=surfaces.map(sample=>sample(x,z,lane))
    for(let j=1;j<=count;j++){
      const at=j/count
      const heights=surfaces.map(sample=>sample(x+at*dx,z+at*dz,lane))
      const [base,grade]=heights.map((h,k)=>Math.abs(h-previous[k])/step)
      if(grade>cap+.000001&&grade>base+.000001)violations.push({way:way.id,at:chain+(j-1)*step,step,base,grade,cap})
      previous=heights
      samples++
    }
    chain+=length
  }
}
fs.writeFileSync(output,JSON.stringify({samples,ways:new Set(violations.map(r=>r.way)).size,violations},null,2))
console.log(samples,'intervals;',violations.length,'grade regressions')
process.exitCode=Number(violations.length>0)
