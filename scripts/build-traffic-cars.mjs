// IDOK-253: bake the street-traffic car meshes into public/models/traffic-cars.bin.
//
// Source OBJs (four arcade car models supplied on IDOK-253; Rock 11-24: modify so they only
// resemble the originals, no badges) are NOT kept in the repo. Usage:
//   node scripts/build-traffic-cars.mjs <dir with BMW.obj Mini.obj R35.obj r34.obj>
//
// Changes made to the sources: racing wings removed, non-uniform scale to real street proportions,
// front turned to +z, every material group simplified to ~40 %, materials reduced to our
// flat palette slots (no textures, no badges, no plates text).
//
// Output (little endian): "GLCR" u16 version u16 carCount, then per car:
//   u8 nameLen, name utf8, u16 groupCount, per group: u8 slot, u32 vertexCount, i16[3*n] positions (mm)
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {MeshoptSimplifier} from 'meshoptimizer'

const SLOTS=['body','body2','window','lens','head','tail','grille','tyre','rim','trim','chrome']
const MATERIAL={Body:'body','Body.01':'body2',Screens:'window',Glass:'lens',Light:'head',Front_light:'head',Red_light:'tail',Back_light:'tail',
  Grill:'grille',Tyre:'tyre',Wheels:'rim',Carbon:'trim',Exhaust:'chrome','(null)':'trim'}
const CARS=[
  {file:'BMW.obj',name:'saloon',size:[1.82,1.44,4.72],drop:[]},
  {file:'Mini.obj',name:'mini',size:[1.74,1.42,3.86],drop:[]},
  {file:'R35.obj',name:'coupe',size:[1.9,1.37,4.7],drop:['Wing']},
  {file:'r34.obj',name:'sport',size:[1.78,1.36,4.6],drop:['Wing']},
]
// Near-camera detail only: beyond 75 m the client swaps in its procedural stand-ins (models.ts far map).
const LODS=[{suffix:'',keep:.22,error:.03}]

function parse(text,drop){
  const v=[],groups=new Map();let object='',material='(null)'
  for(const line of text.split('\n')){
    if(line.startsWith('v ')){const [,x,y,z]=line.trim().split(/\s+/);v.push([+x,+y,+z])}
    else if(line.startsWith('o '))object=line.slice(2).trim()
    else if(line.startsWith('usemtl '))material=line.slice(7).trim()
    else if(line.startsWith('f ')){
      if(drop.some(prefix=>object.startsWith(prefix)))continue
      const ids=line.trim().split(/\s+/).slice(1).map(token=>{const i=parseInt(token.split('/')[0]);return i<0?v.length+i:i-1})
      const slot=MATERIAL[material]??'trim';if(!groups.has(slot))groups.set(slot,[])
      const list=groups.get(slot);for(let i=1;i+1<ids.length;i++)list.push(ids[0],ids[i],ids[i+1])
    }
  }
  return {v,groups}
}

await MeshoptSimplifier.ready
const chunks=[],header=Buffer.alloc(8);header.write('GLCR',0);header.writeUInt16LE(1,4);header.writeUInt16LE(CARS.length*LODS.length,6);chunks.push(header)
const report=[]
for(const lod of LODS)for(const car of CARS){
  const {v,groups}=parse(readFileSync(join(process.argv[2],car.file),'utf8'),car.drop)
  // Bounds of what we keep; front = side where the head lamps sit.
  const used=new Set([...groups.values()].flat()),pts=[...used].map(i=>v[i])
  const min=[0,1,2].map(a=>Math.min(...pts.map(p=>p[a]))),max=[0,1,2].map(a=>Math.max(...pts.map(p=>p[a])))
  const heads=(groups.get('head')??[]).map(i=>v[i][2]),frontSign=heads.reduce((s,z)=>s+z,0)/Math.max(1,heads.length)>(min[2]+max[2])/2?1:-1
  // Non-uniform scale to real street proportions (the sources are wide, squat arcade bodies).
  const scale=[0,1,2].map(a=>car.size[a]/(max[a]-min[a])),cx=(min[0]+max[0])/2,cz=(min[2]+max[2])/2
  const place=p=>[(p[0]-cx)*scale[0]*frontSign,(p[1]-min[1])*scale[1],(p[2]-cz)*scale[2]*frontSign]
  const positions=new Float32Array(v.flatMap(place))
  // Weld duplicate corners (the sources split UV seams / pieces) so the simplifier sees closed surfaces.
  const weld=new Map(),canonical=v.map((_,i)=>{const key=[0,1,2].map(a=>Math.round(positions[i*3+a]*1000)).join();if(!weld.has(key))weld.set(key,i);return weld.get(key)})
  const name=Buffer.from(car.name+lod.suffix),head=Buffer.alloc(3+name.length);head.writeUInt8(name.length,0);name.copy(head,1);head.writeUInt16LE(groups.size,1+name.length);chunks.push(head)
  let before=0,after=0
  const parts=[...groups].map(([slot,list])=>[slot,new Uint32Array(list.map(i=>canonical[i]))])
  head.writeUInt16LE(parts.length,1+name.length)
  for(const [slot,indices] of parts){
    const target=Math.max(3,Math.floor(indices.length*lod.keep/3)*3)
    const [simple]=MeshoptSimplifier.simplify(indices,positions,3,target,lod.error,['LockBorder'])
    const out=simple.length>=3?simple:indices
    before+=indices.length/3;after+=out.length/3
    const g=Buffer.alloc(5+out.length*6);g.writeUInt8(SLOTS.indexOf(slot),0);g.writeUInt32LE(out.length,1)
    out.forEach((index,k)=>{for(let a=0;a<3;a++)g.writeInt16LE(Math.round(positions[index*3+a]*1000),5+(k*3+a)*2)})
    chunks.push(g)
  }
  report.push({car:car.name+lod.suffix,size:car.size,front:frontSign,tris:[before,after]})
}
mkdirSync('public/models',{recursive:true})
const blob=Buffer.concat(chunks);writeFileSync('public/models/traffic-cars.bin',blob)
console.table(report);console.log('public/models/traffic-cars.bin',blob.length,'bytes')
