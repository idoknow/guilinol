import {readFileSync} from 'node:fs'
import {Matrix4,Vector3} from 'three'
import {atlasTriangles} from '../lib/atlas-ground.mjs'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'

const bytes=readFileSync(process.argv[2]),length=bytes.readUInt32LE(12)
const model=JSON.parse(bytes.subarray(20,20+length).toString())
const materialFilter=process.argv[5]
const inventory=process.argv[3]==='--inventory'
if(materialFilter||inventory)for(const mesh of model.meshes)for(const primitive of mesh.primitives){
  const finish=model.materials?.[primitive.material]
  primitive.extras={...primitive.extras,materialIndex:primitive.material??-1,seamMaterial:finish?.name??'',atlasTransform:finish?.pbrMetallicRoughness?.baseColorTexture?.extensions?.KHR_texture_transform??{}}
}
for(const key of ['textures','images','materials'])delete model[key]
for(const mesh of model.meshes)for(const primitive of mesh.primitives)delete primitive.material
for(const key of ['extensionsUsed','extensionsRequired'])if(model[key])model[key]=model[key].filter(name=>name!=='KHR_texture_basisu')
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
  if(!high && ((!inventory && process.argv[3]!=='--visible') || scene.getObjectByName('lod0')))return
  if(!high){for(let parent=node;parent;parent=parent.parent)if(/^collision|^lod[12]/i.test(parent.name))return}
  const geometry=node.geometry,index=geometry.index,position=geometry.getAttribute('position')
  if(inventory){
    const uv=geometry.getAttribute('uv'),meta=geometry.userData
    const {scale=[1,1],offset=[0,0]}=meta.atlasTransform
    const matrix=new Matrix4()
    for(let instance=0;instance<(node.isInstancedMesh?node.count:1);instance++){
      if(node.isInstancedMesh){node.getMatrixAt(instance,matrix);matrix.premultiply(node.matrixWorld)}
      else matrix.copy(node.matrixWorld)
      for(let at=0;at<(index?.count??position.count);at+=3){
        coords.push(meta.materialIndex)
        for(let corner=0;corner<3;corner++){
          const i=index?index.getX(at+corner):at+corner
          coords.push(...vertex.fromBufferAttribute(position,i).applyMatrix4(matrix).toArray(),
            uv?uv.getX(i)*scale[0]+offset[0]:NaN,uv?uv.getY(i)*scale[1]+offset[1]:NaN)
        }
      }
    }
    return
  }
  if(process.argv[6]){
    const {scale,offset}=geometry.userData.atlasTransform
    for(const at of atlasTriangles(geometry,JSON.parse(process.argv[6]),scale,offset).selected)coords.push(...vertex.fromBufferAttribute(position,at).applyMatrix4(node.matrixWorld).toArray())
    return
  }
  for(let at=0;at<(index?.count??position.count);at++)coords.push(...vertex.fromBufferAttribute(position,index?index.getX(at):at).applyMatrix4(node.matrixWorld).toArray())
})
if(!coords.length && !process.argv[6])throw Error('Missing LOD0 triangles')
process.stdout.write(Buffer.from(new Float32Array(coords).buffer))
