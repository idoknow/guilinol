import * as THREE from 'three'
import {look} from './look/config'

type Classify=(box:THREE.Box3)=>number
interface Draw {mesh:THREE.Mesh; main:number; mirror:number; mirrorStart:number; update:(classify:Classify)=>void}

// Cache-ordered triangles in a large packed mesh usually describe a small part
// of the site. Order the visible runs as [main only, both passes, mirror only].
// Both passes then use contiguous ranges in a single GPU index buffer.
function prepare(mesh:THREE.Mesh, unique:boolean):Draw {
  const geometry=mesh.geometry
  const instanced=mesh instanceof THREE.InstancedMesh
  if(instanced)mesh.computeBoundingBox()
  else if(!geometry.boundingBox)geometry.computeBoundingBox()
  const bounds=(instanced?mesh.boundingBox:geometry.boundingBox)!.clone().applyMatrix4(mesh.matrixWorld)
  const draw:Draw={mesh,main:0,mirror:0,mirrorStart:0,update(classify){
    const mask=classify(bounds)
    draw.main=mask&1?Infinity:0
    draw.mirror=mask&2?Infinity:0
  }}
  const source=geometry.index
  if(instanced||!unique||!source||source.count<12000||geometry.groups.length)return draw

  // glTF primitives with different vertex attributes may share an index accessor.
  geometry.userData.fullIndex=source.array
  const index=source.clone()
  geometry.setIndex(index)
  const original=source.array, positions=geometry.getAttribute('position')
  const point=new THREE.Vector3(), boxes:THREE.Box3[]=[]
  const stride=3*256
  for(let start=0;start<original.length;start+=stride){
    const box=new THREE.Box3()
    for(let i=start;i<Math.min(start+stride,original.length);i++)
      box.expandByPoint(point.fromBufferAttribute(positions,original[i]))
    boxes.push(box.applyMatrix4(mesh.matrixWorld))
  }
  index.setUsage(THREE.DynamicDrawUsage)
  const selected=new Uint8Array(boxes.length).fill(255)
  const sizes=[0,0,0,0], offsets=[0,0,0,0]
  draw.update=(classify)=>{
    const whole=classify(bounds)
    sizes.fill(0)
    let changed=false
    for(let i=0;i<boxes.length;i++){
      const next=whole && classify(boxes[i])
      sizes[next]+=Math.min(stride,index.count-i*stride)
      if(next!==selected[i]){selected[i]=next;changed=true}
    }
    if(!changed)return
    offsets[1]=0;offsets[3]=sizes[1];offsets[2]=sizes[1]+sizes[3]
    for(let i=0;i<boxes.length;i++)if(selected[i]){
      const slice=original.subarray(i*stride,(i+1)*stride), pass=selected[i]
      index.array.set(slice,offsets[pass])
      offsets[pass]+=slice.length
    }
    draw.main=sizes[1]+sizes[3];draw.mirror=sizes[2]+sizes[3];draw.mirrorStart=sizes[1]
    index.clearUpdateRanges()
    if(offsets[2]){index.addUpdateRange(0,offsets[2]);index.needsUpdate=true}
  }
  return draw
}

export function landmarkCulling(){
  const prepared=new WeakMap<THREE.Object3D,Draw[]>(), active=new WeakSet<THREE.Object3D>()
  const frustum=new THREE.Frustum(), reflection=new THREE.Frustum(), matrix=new THREE.Matrix4()
  // For translations up to this distance, the expanded planes still enclose
  // the current view (also after reflecting across a fixed water plane).
  const margin=8
  const anchor=new THREE.Vector3(Infinity,0,0), rotation=new THREE.Quaternion()
  const projection=new THREE.Matrix4(), reflect=new THREE.Matrix4().makeScale(1,-1,1)
  let lastMirror=NaN
  const layers:Draw[][]=[]
  return {
    update(roots:Iterable<THREE.Group>,camera:THREE.PerspectiveCamera,mirror:number){
      camera.updateMatrixWorld()
      const moved=anchor.distanceToSquared(camera.position)>=margin*margin ||
        !rotation.equals(camera.quaternion) || !projection.equals(camera.projectionMatrix) || mirror!==lastMirror
      if(moved){
        anchor.copy(camera.position);rotation.copy(camera.quaternion);projection.copy(camera.projectionMatrix);lastMirror=mirror
        matrix.multiplyMatrices(projection,camera.matrixWorldInverse)
        frustum.setFromProjectionMatrix(matrix)
        for(const plane of frustum.planes)plane.constant+=margin
        if(Number.isFinite(mirror)){
          reflect.elements[13]=2*mirror
          reflection.setFromProjectionMatrix(matrix.multiply(reflect))
          for(const plane of reflection.planes)plane.constant+=margin
        }
      }
      const classify=(box:THREE.Box3)=>{
        if(box.distanceToPoint(anchor)>look.fogHorizonTo+margin)return 0
        return Number(frustum.intersectsBox(box))+
          (Number.isFinite(mirror)&&box.max.y>=mirror&&reflection.intersectsBox(box)?2:0)
      }
      layers.length=0
      for(const root of roots)for(const name of ['lod0','lod1','lod2']){
        const lod=root.getObjectByName(name)
        if(!lod)continue
        if(!lod.visible){active.delete(lod);continue}
        let list=prepared.get(lod)
        if(!list){
          const draws:Draw[]=[]
          const uses=new Map<THREE.BufferGeometry,number>()
          root.traverse(node=>{if(node instanceof THREE.Mesh)uses.set(node.geometry,1+(uses.get(node.geometry)??0))})
          lod.traverseVisible(node=>{
            if(node instanceof THREE.Mesh&&!node.children.length)draws.push(prepare(node,uses.get(node.geometry)===1))
          })
          list=draws;prepared.set(lod,list)
        }
        if(moved||!active.has(lod))for(const draw of list)draw.update(classify)
        active.add(lod);layers.push(list)
      }
    },
    pass(mirror:boolean){
      for(const list of layers)for(const draw of list){
        const count=mirror?draw.mirror:draw.main
        draw.mesh.visible=count>0
        if(count && count!==Infinity)draw.mesh.geometry.setDrawRange(mirror?draw.mirrorStart:0,count)
      }
    }
  }
}
