import {readFileSync} from 'node:fs'
import {Vector3} from 'three'
import {atlasTriangles} from '../lib/atlas-ground.mjs'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'

const bytes=readFileSync(process.argv[2]),length=bytes.readUInt32LE(12)
const model=JSON.parse(bytes.subarray(20,20+length).toString())
const materialFilter=process.argv[5]
if(materialFilter)for(const mesh of model.meshes)for(const primitive of mesh.primitives){
  const finish=model.materials?.[primitive.material]
  primitive.extras={...primitive.extras,seamMaterial:finish?.name??'',atlasTransform:finish?.pbrMetallicRoughness?.baseColorTexture?.extensions?.KHR_texture_transform??{}}
}
for(const key of ['textures','images','materials'])delete model[key]
for(const mesh of model.meshes)for(const primitive of mesh.primitives)delete primitive.material
for(const key of ['extensionsUsed','extensionsRequired'])model[key]=model[key].filter(name=>name!=='KHR_texture_basisu')
const text=Buffer.from(JSON.stringify(model)),padded=Math.ceil(text.length/4)*4
const header=Buffer.from(bytes.subarray(0,20));header.writeUInt32LE(bytes.length-length+padded,8);header.writeUInt32LE(padded,12)
const glb=Buffer.concat([header,text,Buffer.alloc(padded-text.length,32),bytes.subarray(20+length)])
const {scene}=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.length),'')
scene.updateMatrixWorld(true)
const coords=[],vertex=new Vector3(),meshName=process.argv[4]
scene.traverse(node=>{
  if(!node.isMesh)return
  if(meshName && node.name!==meshName && node.parent?.name!==meshName)return
  if(materialFilter && node.geometry.userData.seamMaterial!==materialFilter)return
  let high=false
  for(let parent=node;parent;parent=parent.parent)high ||= parent.name.startsWith('lod0')
  if(!high && (process.argv[3]!=='--visible' || scene.getObjectByName('lod0')))return
  if(!high){for(let parent=node;parent;parent=parent.parent)if(/^collision|^lod[12]/i.test(parent.name))return}
  const geometry=node.geometry,index=geometry.index,position=geometry.getAttribute('position')
  if(process.argv[6]){
    const {scale,offset}=geometry.userData.atlasTransform
    for(const at of atlasTriangles(geometry,JSON.parse(process.argv[6]),scale,offset).selected)coords.push(...vertex.fromBufferAttribute(position,at).applyMatrix4(node.matrixWorld).toArray())
    return
  }
  for(let at=0;at<(index?.count??position.count);at++)coords.push(...vertex.fromBufferAttribute(position,index?index.getX(at):at).applyMatrix4(node.matrixWorld).toArray())
})
if(!coords.length)throw Error('Missing LOD0 triangles')
process.stdout.write(Buffer.from(new Float32Array(coords).buffer))
