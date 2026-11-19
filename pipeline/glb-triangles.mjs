import {readFileSync} from 'node:fs'
import {Vector3} from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'

const bytes=readFileSync(process.argv[2]),length=bytes.readUInt32LE(12)
const model=JSON.parse(bytes.subarray(20,20+length).toString())
for(const key of ['textures','images','materials'])delete model[key]
for(const mesh of model.meshes)for(const primitive of mesh.primitives)delete primitive.material
for(const key of ['extensionsUsed','extensionsRequired'])model[key]=model[key].filter(name=>name!=='KHR_texture_basisu')
const text=Buffer.from(JSON.stringify(model)),padded=Math.ceil(text.length/4)*4
const header=Buffer.from(bytes.subarray(0,20));header.writeUInt32LE(bytes.length-length+padded,8);header.writeUInt32LE(padded,12)
const glb=Buffer.concat([header,text,Buffer.alloc(padded-text.length,32),bytes.subarray(20+length)])
const {scene}=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.length),'')
scene.updateMatrixWorld(true)
const coords=[],vertex=new Vector3()
scene.traverse(node=>{
  if(!node.isMesh)return
  let high=false
  for(let parent=node;parent;parent=parent.parent)high ||= parent.name.startsWith('lod0')
  if(!high && (process.argv[3]!=='--visible' || scene.getObjectByName('lod0')))return
  if(!high){for(let parent=node;parent;parent=parent.parent)if(/^collision|^lod[12]/i.test(parent.name))return}
  const geometry=node.geometry,index=geometry.index,position=geometry.getAttribute('position')
  for(let at=0;at<(index?.count??position.count);at++)coords.push(...vertex.fromBufferAttribute(position,index?index.getX(at):at).applyMatrix4(node.matrixWorld).toArray())
})
if(!coords.length)throw Error('Missing LOD0 triangles')
process.stdout.write(Buffer.from(new Float32Array(coords).buffer))
