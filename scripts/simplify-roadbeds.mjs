// Coalesce the interiors of individual pavement and roadbed sheets. Their
// exposed boundaries and steep retaining walls keep their original vertices.
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {gunzipSync,gzipSync} from 'node:zlib'
import {MeshoptSimplifier} from 'meshoptimizer'

// Terrain is sampled vertically. A small 3D simplifier cost at a steep rim
// does not bound the height of a wheel. Keep those faces and certify the
// remaining sheets over their entire projected triangle intersections.
function sheet(face){
  const [a,b,c]=face
  const dx=b[0]-a[0],dz=b[2]-a[2],ex=c[0]-a[0],ez=c[2]-a[2]
  const det=dx*ez-dz*ex
  if(Math.abs(det)<1e-9)return null
  const u=((b[1]-a[1])*ez-(c[1]-a[1])*dz)/det
  const v=(dx*(c[1]-a[1])-ex*(b[1]-a[1]))/det
  return {face,area:Math.abs(det)/2,sign:Math.sign(det),u,v,
    y:(x,z)=>a[1]+u*(x-a[0])+v*(z-a[2]),
    bounds:[Math.min(a[0],b[0],c[0]),Math.min(a[2],b[2],c[2]),Math.max(a[0],b[0],c[0]),Math.max(a[2],b[2],c[2])]}
}
function intersection(subject,clip){
  let poly=subject.face.map(([x,,z])=>[x,z])
  for(let j=0;j<3&&poly.length;j++){
    const a=clip.face[j],b=clip.face[(j+1)%3],edge=(p)=>clip.sign*((b[0]-a[0])*(p[1]-a[2])-(b[2]-a[2])*(p[0]-a[0]))
    const next=[]
    for(let i=0;i<poly.length;i++){
      const p=poly[i],q=poly[(i+1)%poly.length],ep=edge(p),eq=edge(q)
      if(ep>=0)next.push(p)
      if((ep<0)!==(eq<0)){
        const t=ep/(ep-eq)
        next.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])])
      }
    }
    poly=next
  }
  return poly
}
function certify(original,reduced){
  const bins=new Map(),covered=new Float64Array(original.length)
  function cells(bounds){
    const keys=[]
    for(let x=Math.floor(bounds[0]/8);x<=Math.floor(bounds[2]/8);x++)
      for(let z=Math.floor(bounds[1]/8);z<=Math.floor(bounds[3]/8);z++)keys.push(x*64+z)
    return keys
  }
  original.forEach((t,i)=>{for(const key of cells(t.bounds)){
    if(!bins.has(key))bins.set(key,[])
    bins.get(key).push(i)
  }})
  for(const t of reduced){
    if(!t||t.sign!==original[0].sign)return false
    let area=0
    for(const i of new Set(cells(t.bounds).flatMap(k=>bins.get(k)??[]))){
      const s=original[i],p=intersection(s,t)
      if(p.length<3)continue
      let twice=0
      for(let j=1;j+1<p.length;j++)twice+=(p[j][0]-p[0][0])*(p[j+1][1]-p[0][1])-(p[j][1]-p[0][1])*(p[j+1][0]-p[0][0])
      const overlap=Math.abs(twice)/2
      if(overlap<1e-11)continue
      if(p.some(([x,z])=>Math.abs(t.y(x,z)-s.y(x,z))>.003))return false
      area+=overlap
      covered[i]+=overlap
    }
    if(Math.abs(area-t.area)>1e-8)return false
  }
  return original.every((s,i)=>Math.abs(covered[i]-s.area)<=1e-8)
}
function simplifySheet(source){
  const ids=new Map(),xyz=[],indices=[],old=[]
  for(const face of source){
    old.push(sheet(face))
    for(const pt of face){
      const key=pt.join(',')
      if(!ids.has(key)){ids.set(key,xyz.length);xyz.push(pt)}
      indices.push(ids.get(key))
    }
  }
  const input=Uint32Array.from(indices),positions=Float32Array.from(xyz.flat())
  for(const budget of [.004,.0015,.0004]){
    const [result]=MeshoptSimplifier.simplify(input,positions,3,0,budget,['LockBorder','ErrorAbsolute'])
    if(result.length===indices.length)break
    const faces=[]
    for(let i=0;i<result.length;i+=3)faces.push([xyz[result[i]],xyz[result[i+1]],xyz[result[i+2]]])
    if(certify(old,faces.map(sheet)))return faces
  }
  return source
}

function packSheet(encoded,unit){
  const source=Buffer.from(encoded,'base64')
  const points=new Int32Array(source.buffer,source.byteOffset,source.length/4)
  const groups=new Map(),faces=[]
  for(let i=0;i<points.length;i+=9){
    const face=[0,3,6].map(j=>Array.from(points.subarray(i+j,i+j+3),n=>n*unit))
    const surface=sheet(face)
    if(!surface||Math.hypot(surface.u,surface.v)>.5){faces.push(face);continue}
    const key=(Math.floor(surface.bounds[0]/48)*8+Math.floor(surface.bounds[1]/48))*2+Number(surface.sign>0)
    if(!groups.has(key))groups.set(key,[])
    groups.get(key).push(face)
  }
  for(const group of groups.values())for(const face of simplifySheet(group))faces.push(face)
  if(faces.length*9===points.length)return encoded
  const packed=Buffer.alloc(faces.length*36)
  let cursor=0
  for(const face of faces)for(const vertex of face)for(const coordinate of vertex){
    packed.writeInt32LE(Math.round(coordinate/unit),cursor);cursor+=4
  }
  return packed.toString('base64')
}

await MeshoptSimplifier.ready
const [world,list]=process.argv.slice(2)
const sizes={}
for(const file of JSON.parse(readFileSync(list,'utf8'))){
  const path=join(world,file),raw=gunzipSync(readFileSync(path))
  const offset=24+16900+9*raw.readUInt32LE(4)+4*raw.readUInt32LE(8)
  const length=raw.readUInt32LE(12),collision=JSON.parse(raw.toString('utf8',offset,offset+length))
  const bed=collision[7]
  if(!bed?.packed)continue
  const survey=collision[1][12]
  let changed=false
  for(const [mesh,key,unit] of [[bed,'packed',.0001],[survey,'packed',.001],[survey,'sidewalk',.001]]){
    if(!mesh?.[key])continue
    const reduced=packSheet(mesh[key],unit)
    if(reduced!==mesh[key]){mesh[key]=reduced;changed=true}
  }
  if(!changed)continue
  const json=Buffer.from(JSON.stringify(collision))
  raw.writeUInt32LE(json.length,12)
  const result=gzipSync(Buffer.concat([raw.subarray(0,offset),json,raw.subarray(offset+length)]),{level:5})
  writeFileSync(path,result)
  sizes[file]=result.length
}
process.stdout.write(JSON.stringify(sizes))
