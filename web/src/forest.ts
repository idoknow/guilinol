import {TileGrid, streamBudget, tileEdgeDistance} from './tile-grid'
import * as THREE from 'three'
import {applyTreeVariant, setTreeFar, sharedProxyAssets, TREE_SPECIES_COUNT, treeFar, treeNearAsset} from './look/trees'
import {look} from './look/config'
import {fetchAsset,type Tile} from './world'
import {treeBlocked} from './tunnels'
import {onOldSouthSlope,slopeStart,slopeRatio,yueyaShoulderHeight} from './yueya-slope'
import {freezeStatic} from './static-freeze'

type TileSphere = {cx:number; cy:number; cz:number; r:number}
const tileBounds = new WeakMap<Tree[], TileSphere>()

export type Tree={
  x:number; y:number; z:number; kind:number; scale:number; seed:number
  instances:Float32Array; offset:number; proxyGroup:0|1|2|3
}
export interface ForestRange {
  treeFar:number
  treeLoadRadius:number
  treeUnloadRadius:number
  treeNearLod:number
}
const defaultRange:ForestRange={
  treeFar,
  treeLoadRadius:1682,
  treeUnloadRadius:1750,
  treeNearLod:240,
}
const lean=new THREE.Quaternion(), slopeQ=new THREE.Quaternion()
export async function readTrees(tile:Tile,signal:AbortSignal){
  const raw=await fetchAsset(tile.file.replace('.glc','.trees'),signal)
  const data=new DataView(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  if(data.byteLength%12)throw Error('Invalid vegetation payload')
  const trees:Tree[]=[],up=new THREE.Vector3(0,1,0),nVec=new THREE.Vector3()
  // Two matrices and two RGB triples per tree, packed directly at GPU
  // precision. Physics keeps lightweight tree identities for trunk colliders.
  const instances=new Float32Array(data.byteLength/12*38)
  const matrix=new THREE.Matrix4(),midMatrix=new THREE.Matrix4()
  const tint=new THREE.Color(),proxyTint=new THREE.Color()
  let minY=Infinity, maxY=-Infinity
  for(let i=0;i<data.byteLength;i+=12){
    const x=tile.x+data.getUint16(i,true)/100
    let y=data.getInt16(i+4,true)/10
    let z=tile.z+data.getUint16(i+2,true)/100
    const slopeTree=data.getInt8(i+10)||data.getInt8(i+11)
    if(slopeTree)y=yueyaShoulderHeight(x,y,z)
    if(slopeTree&&onOldSouthSlope(x,z)){
      const start=slopeStart(x),distance=z-start
      z=start+distance*slopeRatio(distance)
    }
    if(treeBlocked(x,y,z))continue
    if(y<minY)minY=y
    if(y>maxY)maxY=y
    const rawKind=data.getUint8(i+6),kind=rawKind<TREE_SPECIES_COUNT?rawKind:0
    const scale=data.getUint8(i+7)/100,yaw=data.getUint8(i+8)*Math.PI/128,seed=data.getUint8(i+9)
    const nx=data.getInt8(i+10)/127,nz=data.getInt8(i+11)/127
    lean.setFromUnitVectors(up,nVec.set(nx,Math.sqrt(Math.max(0,1-nx*nx-nz*nz)),nz).normalize())
    // Trees grow towards the sky: keep at most look.treeLean of the slope normal.
    const angle=2*Math.acos(Math.min(1,Math.abs(lean.w)))
    slopeQ.identity().slerp(lean,angle>look.treeLean?look.treeLean/angle:1)
    const proxyGroup=applyTreeVariant(kind,seed,scale,yaw,slopeQ,x,y,z,matrix,midMatrix,tint,proxyTint)
    const offset=i/12*38
    matrix.toArray(instances,offset);midMatrix.toArray(instances,offset+16)
    tint.toArray(instances,offset+32);proxyTint.toArray(instances,offset+35)
    trees.push({x,y,z,kind,scale,seed,instances,offset,proxyGroup})
  }
  if(trees.length){
    const cy=(minY+maxY+8)*.5, halfH=Math.max(12,(maxY-minY+20)*.5)
    tileBounds.set(trees,{cx:tile.x+128,cy,cz:tile.z+128,r:Math.hypot(181.02,halfH)})
  }
  return trees
}

// Batch slots:
//   0 .. TREE_SPECIES_COUNT-1   : LOD0 near (species-exact detailed mesh, d < lodNear; capped to MAX_NEAR_BATCHES=4)
//   TREE_SPECIES_COUNT + 0..3   : LOD1 mid  (4 organic 3D crown archetypes, lodNear <= d < lodMid)
//   TREE_SPECIES_COUNT + 4..7   : LOD2 far  (4 organic low-poly 3D silhouette archetypes, lodMid <= d < 1500)
// Max active batches <= 4 + 4 + 4 = 12 (<= baseline 12).
const TOTAL_SLOTS=TREE_SPECIES_COUNT+8
const MAX_NEAR_BATCHES=4
// Keep the approved street view's species priority even though the detailed
// mesh now stops sooner. Otherwise a rare foreground tree can lose its slot.
const SPECIES_PRIORITY_RADIUS=140

export class Forest{
  loaded=new Map<Tile,Tree[]>()
  pending=new Map<Tile,AbortController>()
  private retry=new Map<Tile,number>()
  private assets:{geometry:THREE.BufferGeometry;material:THREE.Material}[]|null=null
  private batches:(THREE.InstancedMesh|undefined)[]=Array.from({length:TOTAL_SLOTS},()=>undefined)
  private groups:Tree[][]=Array.from({length:TOTAL_SLOTS},()=>[])
  private speciesFrequency=new Uint32Array(TREE_SPECIES_COUNT)
  private nearOrder:number[]=Array.from({length:TREE_SPECIES_COUNT},(_,i)=>i)
  private dirty=true
  private anchor=new THREE.Vector3(Infinity,0,0)
  private rotation=new THREE.Quaternion()
  private frustum=new THREE.Frustum()
  private matrix=new THREE.Matrix4()
  private point=new THREE.Vector3()
  private range:ForestRange={...defaultRange}
  constructor(private scene:THREE.Scene,private grid:TileGrid,private camera:THREE.PerspectiveCamera,initialRange?:ForestRange){
    if(initialRange)this.setRange(initialRange)
  }
  setRange(next:ForestRange){
    if(
      this.range.treeFar===next.treeFar &&
      this.range.treeLoadRadius===next.treeLoadRadius &&
      this.range.treeUnloadRadius===next.treeUnloadRadius &&
      this.range.treeNearLod===next.treeNearLod
    ) return
    this.range={...next}
    setTreeFar(next.treeFar)
    this.dirty=true
    this.queueDirty=true
  }
  private queue:Tile[]=[]
  private queueDirty=true
  private lastQueuePos=new THREE.Vector3(Infinity,0,0)
  private lastQueueLimit=NaN
  private lastDeferOuter=false
  private nextRetryAt=Infinity
  private requestLimit=1
  private pump(){
    while(this.pending.size<this.requestLimit && this.queue.length){
      const tile=this.queue.pop()!, control=new AbortController()
      this.pending.set(tile,control)
      readTrees(tile,control.signal).then(trees=>{
        if(!control.signal.aborted){this.loaded.set(tile,trees);this.dirty=true}
      }).catch(err=>{
        if(!control.signal.aborted){console.error(err);this.retry.set(tile,performance.now()+10000)}
      }).finally(()=>{this.pending.delete(tile);this.pump()})
    }
  }
  tick(position:THREE.Vector3, deferOuter=false){
    const distance=(tile:Tile)=>Math.hypot(tile.x+128-position.x,tile.z+128-position.z)
    for(const tile of this.loaded.keys()){
      if(distance(tile)>this.range.treeUnloadRadius){this.loaded.delete(tile);this.dirty=true;this.queueDirty=true}
    }
    for(const [tile,control] of this.pending)if(distance(tile)>this.range.treeUnloadRadius){control.abort();this.queueDirty=true}
    const limit=deferOuter?Math.min(this.range.treeLoadRadius,streamBudget.priorityTreeRadius+128):this.range.treeLoadRadius
    this.requestLimit=deferOuter?1:streamBudget.treeRequests
    const now=performance.now()
    if(this.queueDirty||position.distanceToSquared(this.lastQueuePos)>=16||limit!==this.lastQueueLimit||deferOuter!==this.lastDeferOuter||now>=this.nextRetryAt){
      this.queueDirty=false
      this.lastQueuePos.copy(position)
      this.lastQueueLimit=limit
      this.lastDeferOuter=deferOuter
      let nextRetry=Infinity
      this.queue=Array.from(this.grid.near(position.x,position.z,limit))
        .filter(tile=>!deferOuter || tileEdgeDistance(tile,position.x,position.z)<=streamBudget.priorityTreeRadius)
        .filter(tile=>{
          if(!(deferOuter || distance(tile)<=limit) || this.loaded.has(tile) || this.pending.has(tile))return false
          const retryAt=this.retry.get(tile)??0
          if(retryAt>now){if(retryAt<nextRetry)nextRetry=retryAt;return false}
          return true
        })
        .sort((a,b)=>distance(b)-distance(a))
      this.nextRetryAt=nextRetry
    }
    this.pump()
    if(!this.loaded.size)return
    if(!this.dirty&&this.camera.position.distanceToSquared(this.anchor)<4&&this.rotation.angleTo(this.camera.quaternion)<.016)return
    this.anchor.copy(this.camera.position);this.dirty=false
    this.rotation.copy(this.camera.quaternion);this.camera.updateMatrixWorld();this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse))
    const cam=this.camera.position, far=this.range.treeFar, farSq=far*far, nearBase=this.range.treeNearLod
    const [p0,p1,p2,p3,p4,p5]=this.frustum.planes
    const groups=this.groups
    for(let i=0;i<TOTAL_SLOTS;i++)groups[i].length=0
    this.speciesFrequency.fill(0)
    const lodScale=nearBase/defaultRange.treeNearLod
    const nearSq=(look.trees.lodNear*lodScale)**2, midSq=(look.trees.lodMid*lodScale)**2
    const pt=this.point
    for(const trees of this.loaded.values()){
      const sphere=tileBounds.get(trees)
      if(!trees.length)continue
      if(sphere){
        const dx=sphere.cx-cam.x, dy=sphere.cy-cam.y, dz=sphere.cz-cam.z
        if(dx*dx+dy*dy+dz*dz>=(far+sphere.r)**2)continue
        pt.set(sphere.cx,sphere.cy,sphere.cz)
        const margin=-40-sphere.r
        if(p0.distanceToPoint(pt)<=margin||p1.distanceToPoint(pt)<=margin||p2.distanceToPoint(pt)<=margin||p3.distanceToPoint(pt)<=margin||p4.distanceToPoint(pt)<=margin||p5.distanceToPoint(pt)<=margin)continue
      }
      for(let i=0;i<trees.length;i++){
        const tree=trees[i]
        const dx=tree.x-cam.x, dy=tree.y-cam.y, dz=tree.z-cam.z
        const d=dx*dx+dy*dy+dz*dz
        if(d>=farSq)continue
        // Never let a crown swallow the follow camera: drop trees whose canopy the camera is inside.
        const highCanopy=(tree.kind===0||tree.kind===1||tree.kind===6||tree.kind===7||tree.kind===9)&&cam.y-tree.y<2.9*tree.scale
        if(dx*dx+dz*dz<(highCanopy?2.2:look.treeCameraClear)**2&&cam.y-tree.y<14*tree.scale)continue
        pt.set(tree.x,tree.y+4,tree.z)
        if(p0.distanceToPoint(pt)<=-40||p1.distanceToPoint(pt)<=-40||p2.distanceToPoint(pt)<=-40||p3.distanceToPoint(pt)<=-40||p4.distanceToPoint(pt)<=-40||p5.distanceToPoint(pt)<=-40)continue
        if(d < SPECIES_PRIORITY_RADIUS**2) this.speciesFrequency[tree.kind]++
        const slot=d<nearSq?tree.kind:d<midSq?TREE_SPECIES_COUNT+tree.proxyGroup:TREE_SPECIES_COUNT+4+tree.proxyGroup
        groups[slot].push(tree)
      }
    }
    this.nearOrder.sort((a,b)=>this.speciesFrequency[b]-this.speciesFrequency[a])
    let activeNear=0
    for(const k of this.nearOrder){
      const overflow=groups[k]
      if(!overflow.length || ++activeNear<=MAX_NEAR_BATCHES)continue
      for(let j=0;j<overflow.length;j++)groups[TREE_SPECIES_COUNT+overflow[j].proxyGroup].push(overflow[j])
      overflow.length=0
    }
    if(!this.assets){
      const shared=sharedProxyAssets()
      this.assets=[
        ...Array.from({length:TREE_SPECIES_COUNT},(_,kind)=>treeNearAsset(kind)),
        ...shared.mid.map(geometry=>({geometry,material:shared.material})),
        ...shared.far,
      ]
    }
    for(let i=0;i<TOTAL_SLOTS;i++){
      const group=groups[i];let mesh=this.batches[i]
      if(group.length&&(!mesh||mesh.instanceMatrix.count<group.length)){
        if(mesh){this.scene.remove(mesh);mesh.dispose()}
        const cap=Math.max(16,2**Math.ceil(Math.log2(group.length)))
        const {geometry,material}=this.assets[i]
        mesh=new THREE.InstancedMesh(geometry,material,cap)
        mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(cap*3),3)
        mesh.raycast=()=>{}
        this.scene.add(mesh);this.batches[i]=freezeStatic(mesh);mesh.frustumCulled=false
      }
      if(mesh){
        mesh.count=group.length;mesh.visible=!!group.length
        if(group.length){
          const mArr=mesh.instanceMatrix.array as Float32Array,cArr=mesh.instanceColor!.array as Float32Array
          const near=i<TREE_SPECIES_COUNT
          for(let j=0;j<group.length;j++){
            const tree=group[j]
            const mat=tree.offset+(near?0:16), color=tree.offset+(near?32:35)
            for(let k=0;k<16;k++)mArr[j*16+k]=tree.instances[mat+k]
            for(let k=0;k<3;k++)cArr[j*3+k]=tree.instances[color+k]
          }
          mesh.instanceMatrix.clearUpdateRanges();mesh.instanceMatrix.addUpdateRange(0,group.length*16);mesh.instanceMatrix.needsUpdate=true
          mesh.instanceColor!.clearUpdateRanges();mesh.instanceColor!.addUpdateRange(0,group.length*3);mesh.instanceColor!.needsUpdate=true
        }
      }
    }
  }
}
