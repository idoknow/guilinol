// Simplify only the replacement terrain, in metres. The visible asphalt,
// skirts, tunnel clearances and source terrain grid retain their own meshes.
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {gunzipSync,gzipSync} from 'node:zlib'
import {MeshoptSimplifier} from 'meshoptimizer'

await MeshoptSimplifier.ready
const [world,list]=process.argv.slice(2)
const sizes={}
for(const file of JSON.parse(readFileSync(list,'utf8'))){
  const path=join(world,file),raw=gunzipSync(readFileSync(path))
  const offset=24+16900+9*raw.readUInt32LE(4)+4*raw.readUInt32LE(8)
  const length=raw.readUInt32LE(12),collision=JSON.parse(raw.toString('utf8',offset,offset+length))
  const bed=collision[7]
  if(!bed?.packed)continue
  const source=Buffer.from(bed.packed,'base64')
  const points=new Int32Array(source.buffer,source.byteOffset,source.length/4)
  const ids=new Map(),coordinates=[],indices=new Uint32Array(points.length/3)
  for(let i=0;i<indices.length;i++){
    const xyz=points.subarray(i*3,i*3+3),key=xyz.join(',')
    if(!ids.has(key)){ids.set(key,coordinates.length/3);coordinates.push(...xyz)}
    indices[i]=ids.get(key)
  }
  const metres=Float32Array.from(coordinates,n=>n*.0001)
  const [simplified]=MeshoptSimplifier.simplify(indices,metres,3,0,.003,['LockBorder','ErrorAbsolute'])
  if(simplified.length===indices.length)continue
  const packed=Buffer.alloc(simplified.length*12)
  for(let i=0;i<simplified.length;i++)for(let axis=0;axis<3;axis++)
    packed.writeInt32LE(coordinates[simplified[i]*3+axis],i*12+axis*4)
  bed.packed=packed.toString('base64')
  const json=Buffer.from(JSON.stringify(collision))
  raw.writeUInt32LE(json.length,12)
  const result=gzipSync(Buffer.concat([raw.subarray(0,offset),json,raw.subarray(offset+length)]),{level:5})
  writeFileSync(path,result)
  sizes[file]=result.length
}
process.stdout.write(JSON.stringify(sizes))
