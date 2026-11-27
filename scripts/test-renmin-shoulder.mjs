import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync,writeFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {gradeRenminShoulder} from '../web/src/ground-repair.ts'
import {streetGeometry} from '../web/src/street-worker.ts'

const raw=gunzipSync(readFileSync(process.env.RENMIN_TILE??'public/world/102_40.glc'))
const start=16924+9*raw.readUInt32LE(4)+4*raw.readUInt32LE(8)
const [buildings,streets]=JSON.parse(raw.subarray(start,start+raw.readUInt32LE(12)))
const heights=new Int16Array(raw.buffer,raw.byteOffset+24,4225).slice(),water=new Int16Array(raw.buffer,raw.byteOffset+8474,4225)
const original=heights.slice(),visible=heights.slice(),originalPaths=structuredClone(streets)
const grade=gradeRenminShoulder(-768,256,heights,visible,water,streets[5],buildings)
function surface(field,east,south){
  const column=Math.floor(east/4),row=Math.floor(south/4),index=row*65+column,u=east/4-column,v=south/4-row
  const a=field[index],b=field[index+1],c=field[index+65],d=field[index+66]
  return (u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v))/10
}
test('actual baked trees meet the rendered shoulder and untouched roots keep their height',()=>{
  const trees=gunzipSync(readFileSync(process.env.RENMIN_TREES??'public/world/102_40.trees'))
  assert.equal(trees.length%12,0)
  let changed=0,maxError=0
  const known=[[119.9,103.7],[125.8,106.1],[124.8,149.5]],found=new Set()
  for(let offset=0;offset<trees.length;offset+=12){
    const east=trees.readUInt16LE(offset)/100,south=trees.readUInt16LE(offset+2)/100,baked=trees.readInt16LE(offset+4)/10
    const old=surface(original,east,south),revised=surface(visible,east,south),root=grade.rootHeight(east,south,baked)
    assert(Math.abs(grade.lowering(east,south)-(old-revised))<1e-8)
    if(old-revised<1e-8){assert.equal(root,baked);continue}
    changed++;maxError=Math.max(maxError,Math.abs(root-revised))
    known.forEach(([x,z],index)=>{if(Math.hypot(east-x,south-z)<.2)found.add(index)})
    assert(Math.abs(root-revised)<=.15,JSON.stringify({east,south,root,revised}))
  }
  assert.equal(found.size,known.length);console.log({trees:trees.length/12,changed,maxError})
})
test('actual shop bases and two metres around their exterior walls remain clear',()=>{
  assert.deepEqual(heights,visible);assert(heights.every((value,index)=>value<=original[index]))
  for(const [number,expected] of [[19,1508],[22,1510],[25,1512]]){
    const [base,,[ring]]=buildings[number];assert.equal(base,expected)
    let highest=-Infinity
    for(let edge=0;edge<ring.length;edge++){
      const [ax,az]=ring[edge],[bx,bz]=ring[(edge+1)%ring.length],steps=Math.max(1,Math.ceil(Math.hypot(bx-ax,bz-az)/50))
      for(let along=0;along<=steps;along++)for(let angle=0;angle<16;angle++)for(const radius of [0,1,2]){
        highest=Math.max(highest,surface(visible,(ax+(bx-ax)*along/steps)/100+radius*Math.cos(angle*Math.PI/8),(az+(bz-az)*along/steps)/100+radius*Math.sin(angle*Math.PI/8)))
      }
    }
    assert(highest<=base/10+.15,`shop ${number}: ${highest}`);console.log({shop:number,base:base/10,highest})
  }
})
function support(field,paths){
  const ground=(east,south)=>surface(field,east,south),{road}=streetGeometry(paths,ground)
  return (east,south)=>{
    let top=ground(east,south)
    for(let at=0;at<road.length;at+=9){
      const [ax,ay,az,bx,by,bz,cx,cy,cz]=road.subarray(at,at+9),den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz)
      if(Math.abs(den)<1e-8)continue
      const u=((bz-cz)*(east-cx)+(cx-bx)*(south-cz))/den,v=((cz-az)*(east-cx)+(ax-cx)*(south-cz))/den
      if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001)top=Math.max(top,cy+u*(ay-cy)+v*(by-cy))
    }
    return top
  }
}
test('one-metre samples from the carriageway to the shopfronts',()=>{
  const after=support(visible,streets),before=support(original,originalPaths),profiles=[]
  for(let east=-647;east<=-616;east++){
    const centre=373.851+(east+646.01)*14.496/35.20
    const samples=Array.from({length:9},(_,offset)=>({offset,after:after(east+768,centre+offset-256),before:before(east+768,centre+offset-256)}))
    profiles.push({east,samples});for(let index=1;index<samples.length;index++)assert(Math.abs(samples[index].after-samples[index-1].after)<=.15001,JSON.stringify({east,index,samples}))
  }
  if(process.env.RENMIN_PROFILE)writeFileSync(process.env.RENMIN_PROFILE,JSON.stringify(profiles))
  console.log('max 1m change',Math.max(...profiles.flatMap(({samples})=>samples.slice(1).map((point,index)=>Math.abs(point.after-samples[index].after)))))
})
