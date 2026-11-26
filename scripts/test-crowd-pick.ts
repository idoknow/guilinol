import assert from 'node:assert/strict'
import {Bone,BoxGeometry,Float32BufferAttribute,Group,Raycaster,Scene,Skeleton,SkinnedMesh,Uint16BufferAttribute,Vector3} from 'three'
import {mainDetail} from '../web/src/look/mirror-layer'
import {dynamicPick} from '../web/src/play/pick-diagnostic'

const scene=new Scene(),root=new Group(),bone=new Bone(),geometry=new BoxGeometry()
const count=geometry.getAttribute('position').count
geometry.setAttribute('skinIndex',new Uint16BufferAttribute(new Uint16Array(count*4),4))
geometry.setAttribute('skinWeight',new Float32BufferAttribute(Array.from({length:count*4},(_,index)=>index%4===0?1:0),4))
const mesh=new SkinnedMesh(geometry)
mesh.add(bone);mesh.bind(new Skeleton([bone]))
root.name='G2 passer-by';root.add(mesh);scene.add(mainDetail(root));scene.updateMatrixWorld(true)
const ray=new Raycaster(new Vector3(0,0,3),new Vector3(0,0,-1))
assert.equal(ray.intersectObject(root).length,0)
assert.equal(dynamicPick(scene,ray)?.owner,`character:${mesh.id}`)
