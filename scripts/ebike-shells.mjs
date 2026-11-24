import * as THREE from 'three'
import assert from 'node:assert/strict'

function sampleLoft(surface, sides, spans) {
  const points=[], indices=[]
  for(let row=0;row<=spans;row++)for(let col=0;col<sides;col++)points.push(surface.point(col/sides,row/spans))
  for(let row=0;row<spans;row++)for(let col=0;col<sides;col++){
    const first=row*sides+col,next=row*sides+(col+1)%sides
    indices.push(first,next,first+sides,next,next+sides,first+sides)
  }
  for(let col=1;col<sides-1;col++)indices.push(0,col+1,col,spans*sides,spans*sides+col,spans*sides+col+1)
  const geom=new THREE.BufferGeometry()
  geom.setAttribute('position',new THREE.Float32BufferAttribute(points.flatMap(point=>point.toArray()),3));geom.setIndex(indices)
  return geom
}

export function bakeShells(bike,far){
  const bins=new Map(),vec=coords=>new THREE.Vector3(...coords)
  let triangles=0
  function add(joint,color,geom){
    const key=`${joint}:${color}`
    if(!bins.has(key))bins.set(key,{points:[],indices:[]})
    const bin=bins.get(key),base=bin.points.length/3,positions=geom.attributes.position
    const vertices=[],lookup=new Map(),remap=[]
    for(let index=0;index<positions.count;index++){
      const point=[-positions.getX(index),positions.getY(index),-positions.getZ(index)].map(value=>Math.round(value*1000)),hash=point.join(',')
      if(!lookup.has(hash)){lookup.set(hash,vertices.length);vertices.push(vec(point))}
      remap.push(lookup.get(hash))
    }
    const indices=Array.from(geom.index.array,index=>remap[index]),edges=new Map();let volume=0
    for(let offset=0;offset<indices.length;offset+=3){
      const face=indices.slice(offset,offset+3)
      const [first,second,third]=face.map(index=>vertices[index]);volume+=first.dot(second.clone().cross(third))
      assert(second.clone().sub(first).cross(third.clone().sub(first)).lengthSq()>0,'zero-area face')
      face.forEach((from,side)=>{const to=face[(side+1)%3],edge=[Math.min(from,to),Math.max(from,to)].join(':');edges.set(edge,(edges.get(edge)??0)+(from<to?1:-1))})
    }
    assert([...edges.values()].every(balance=>balance===0)&&volume!==0,'open or inconsistently wound solid')
    if(volume<0)indices.reverse()
    bin.points.push(...vertices.flatMap(point=>point.toArray()));bin.indices.push(...indices.map(index=>base+index));triangles+=indices.length/3
  }
  const box=(joint,color,size,center)=>add(joint,color,new THREE.BoxGeometry(...size).translate(...center))
  function rod(joint,color,start,end,radius,segments=far?4:6){
    const direction=vec(end).sub(vec(start)),center=vec(start).lerp(vec(end),.5)
    const geom=new THREE.CylinderGeometry(radius,radius,direction.length(),segments)
    geom.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()))
    add(joint,color,geom.translate(...center.toArray()))
  }
  const dark='303234',silver='a8b0b4',paint='paint'
  for(const [name,joint,color,spans] of [['shield',3,paint,6],['rearBody',3,paint,6],['deck',3,paint,3],['seat',3,dark,4],['cowl',2,paint,3]]){
    add(joint,color,sampleLoft(bike.parts[name],far?4:8,far?(name==='shield'||name==='rearBody'?2:1):spans))
  }
  for(const [joint,axle] of [[0,.660],[1,-.620]]){
    rod(joint,dark,[-.040,.228,axle],[.040,.228,axle],.228,far?8:16)
    if(!far)rod(joint,silver,[-.044,.228,axle],[.044,.228,axle],.148,16)
  }
  rod(2,dark,[0,.55,.57],[0,1.10,.3],.032)
  rod(2,dark,[-.318,1.128,.262],[.318,1.128,.262],.021)
  for(const side of [-1,1]){
    rod(2,silver,[side*.065,.228,.66],[side*.065,.61,.55],.021)
    rod(3,dark,[side*.072,.228,-.62],[side*.072,.26,-.22],.029)
    if(!far){
      rod(2,silver,[side*.213,1.128,.262],[side*.283,1.306,.302],.009)
      box(2,silver,[.112,.066,.027],[side*.285,1.322,.305])
      rod(3,silver,[side*.118,.288,-.548],[side*.112,.516,-.404],.018)
    }
  }
  if(!far){
    box(3,dark,[.255,.019,.48],[0,.272,.005]);box(2,'dce4e2',[.112,.048,.024],[0,1.106,.435])
    box(3,'dce4e2',[.13,.05,.026],[0,.612,.615]);box(3,'a31016',[.12,.035,.025],[0,.65,-.844])
    rod(2,dark,[0,.79,.74],[0,.89,.47],.025)
    box(2,paint,[.33,.018,.296],[0,.792,.742])
    for(const side of [-1,1]){
      for(const end of [-1,1])box(2,dark,[.016,.22,.016],[side*.156,.899,.742+end*.14])
      for(const height of [.856,.937,1.007]){
        box(2,paint,[.33,.018,.014],[0,height,.742+side*.14]);box(2,paint,[.014,.018,.29],[side*.156,height,.742])
      }
    }
  }
  console.log(far?'far':'near/rig',triangles)
  assert(far?triangles>=150&&triangles<=300:triangles<=1500)
  return [...bins].map(([key,bin])=>({key,positions:Buffer.from(new Int16Array(bin.points).buffer).toString('base64'),indices:Buffer.from(new Uint16Array(bin.indices).buffer).toString('base64')}))
}
