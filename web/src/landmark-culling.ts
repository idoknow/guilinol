import * as THREE from 'three'
import {look} from './look/config'
import {wallShadows} from './wall-occlusion'
import type {Stream} from './stream'

const LOD_NAMES = ['lod0', 'lod1', 'lod2'] as const
const lodCache = new WeakMap<THREE.Object3D, Partial<Record<(typeof LOD_NAMES)[number], THREE.Object3D>>>()

/** Resolve and cache landmark LOD groups once per root instead of walking GLB trees each frame. */
export function getLodNodes(root: THREE.Object3D) {
  let cached = lodCache.get(root)
  if (!cached) {
    cached = {}
    for (const name of LOD_NAMES) cached[name] = root.getObjectByName(name)
    lodCache.set(root, cached)
  }
  return cached
}

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
  const boxes:THREE.Box3[]=[]
  const stride=3*256
  const interleaved=positions instanceof THREE.InterleavedBufferAttribute
  const posArr=interleaved?positions.data.array:positions.array
  const posStride=interleaved?positions.data.stride:positions.itemSize
  const posOffset=interleaved?positions.offset:0
  if(!positions.normalized&&positions.itemSize===3){
    const m=mesh.matrixWorld.elements
    const m0=m[0],m1=m[1],m2=m[2],m4=m[4],m5=m[5],m6=m[6],m8=m[8],m9=m[9],m10=m[10],m12=m[12],m13=m[13],m14=m[14]
    for(let start=0;start<original.length;start+=stride){
      const end=Math.min(start+stride,original.length)
      let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity
      for(let i=start;i<end;i++){
        const o=original[i]*posStride+posOffset
        const x=posArr[o],y=posArr[o+1],z=posArr[o+2]
        if(x<minX)minX=x;if(x>maxX)maxX=x
        if(y<minY)minY=y;if(y>maxY)maxY=y
        if(z<minZ)minZ=z;if(z>maxZ)maxZ=z
      }
      // Transform local AABB to world AABB without per-vertex matrix multiplies.
      const xa0=m0*minX,xb0=m0*maxX,ya0=m4*minY,yb0=m4*maxY,za0=m8*minZ,zb0=m8*maxZ
      const xa1=m1*minX,xb1=m1*maxX,ya1=m5*minY,yb1=m5*maxY,za1=m9*minZ,zb1=m9*maxZ
      const xa2=m2*minX,xb2=m2*maxX,ya2=m6*minY,yb2=m6*maxY,za2=m10*minZ,zb2=m10*maxZ
      boxes.push(new THREE.Box3(
        new THREE.Vector3(Math.min(xa0,xb0)+Math.min(ya0,yb0)+Math.min(za0,zb0)+m12,Math.min(xa1,xb1)+Math.min(ya1,yb1)+Math.min(za1,zb1)+m13,Math.min(xa2,xb2)+Math.min(ya2,yb2)+Math.min(za2,zb2)+m14),
        new THREE.Vector3(Math.max(xa0,xb0)+Math.max(ya0,yb0)+Math.max(za0,zb0)+m12,Math.max(xa1,xb1)+Math.max(ya1,yb1)+Math.max(za1,zb1)+m13,Math.max(xa2,xb2)+Math.max(ya2,yb2)+Math.max(za2,zb2)+m14),
      ))
    }
  }else{
    const point=new THREE.Vector3()
    for(let start=0;start<original.length;start+=stride){
      const box=new THREE.Box3()
      for(let i=start;i<Math.min(start+stride,original.length);i++)
        box.expandByPoint(point.fromBufferAttribute(positions,original[i]))
      boxes.push(box.applyMatrix4(mesh.matrixWorld))
    }
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

export function landmarkCulling(stream:Stream){
  const prepared=new WeakMap<THREE.Object3D,Draw[]>(), active=new WeakSet<THREE.Object3D>()
  const frustum=new THREE.Frustum(), reflection=new THREE.Frustum(), matrix=new THREE.Matrix4()
  // For translations up to this distance, the expanded planes still enclose
  // the current view (also after reflecting across a fixed water plane).
  const margin=2
  let tileRevision=-1,hidden:(box:THREE.Box3)=>boolean=()=>false
  const anchor=new THREE.Vector3(Infinity,0,0), rotation=new THREE.Quaternion()
  const shadowAnchor=anchor.clone()
  const projection=new THREE.Matrix4(), reflect=new THREE.Matrix4().makeScale(1,-1,1)
  let lastMirror=NaN, lastHorizon=NaN
  const layers:Draw[][]=[]
  function prepareRootLod(root:THREE.Group, lod:THREE.Object3D){
    let list=prepared.get(lod)
    if(list)return list
    const draws:Draw[]=[]
    const uses=new Map<THREE.BufferGeometry,number>()
    root.traverse(node=>{if(node instanceof THREE.Mesh)uses.set(node.geometry,1+(uses.get(node.geometry)??0))})
    lod.traverse(node=>{
      if(node instanceof THREE.Mesh&&!node.children.length&&!/^collision/i.test(node.name))draws.push(prepare(node,uses.get(node.geometry)===1))
    })
    prepared.set(lod,draws)
    return draws
  }
  return {
    warm(root:THREE.Group){
      const lods=getLodNodes(root)
      for(const name of LOD_NAMES){
        const lod=lods[name]
        if(lod)prepareRootLod(root,lod)
      }
    },
    update(roots:Iterable<THREE.Group>,camera:THREE.PerspectiveCamera,mirror:number,cullHorizon=look.fogHorizonTo){
      camera.updateMatrixWorld()
      const projectionChanged=!projection.equals(camera.projectionMatrix)
      const refreshShadows=tileRevision!==stream.tileRevision || projectionChanged ||
        shadowAnchor.distanceToSquared(camera.position)>=margin*margin
      const moved=refreshShadows || anchor.distanceToSquared(camera.position)>=margin*margin ||
        !rotation.equals(camera.quaternion) || mirror!==lastMirror || cullHorizon!==lastHorizon
      if(moved){
        if(refreshShadows){
          shadowAnchor.copy(camera.position)
          const m=camera.projectionMatrix.elements
          const nearRadius=camera.near*Math.hypot(1,(1+Math.abs(m[8]))/m[0],(1+Math.abs(m[9]))/m[5])
          hidden=wallShadows(stream,shadowAnchor,margin,nearRadius)
          tileRevision=stream.tileRevision
        }
        anchor.copy(camera.position);rotation.copy(camera.quaternion);projection.copy(camera.projectionMatrix);lastMirror=mirror;lastHorizon=cullHorizon
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
        if(box.distanceToPoint(anchor)>cullHorizon+margin)return 0
        return Number(frustum.intersectsBox(box)&&!hidden(box))+
          (Number.isFinite(mirror)&&box.max.y>=mirror&&reflection.intersectsBox(box)?2:0)
      }
      layers.length=0
      for(const root of roots){
        const lods=getLodNodes(root)
        if(!root.visible){
          for(const name of LOD_NAMES){const lod=lods[name];if(lod)active.delete(lod)}
          continue
        }
        for(const name of LOD_NAMES){
          const lod=lods[name]
          if(!lod)continue
          if(!lod.visible){active.delete(lod);continue}
          const list=prepareRootLod(root,lod)
          if(moved||!active.has(lod))for(const draw of list)draw.update(classify)
          active.add(lod);layers.push(list)
        }
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
