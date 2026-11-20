import * as THREE from 'three'
import {applyTreeVariant, sharedProxyAssets, TREE_SPECIES_COUNT, treeGeometry} from './look/trees'
import {look} from './look/config'
import {fetchAsset,type Tile} from './world'

export type Tree={
  x:number; y:number; z:number; kind:number; scale:number; seed:number
  matrix:THREE.Matrix4; midMatrix:THREE.Matrix4; farMatrix:THREE.Matrix4
  tint:THREE.Color; proxyTint:THREE.Color; proxyGroup:0|1|2|3
}
const lean=new THREE.Quaternion(), slopeQ=new THREE.Quaternion()
export async function readTrees(tile:Tile,signal:AbortSignal){
  const raw=await fetchAsset(tile.file.replace('.glc','.trees'),signal)
  const data=new DataView(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  if(data.byteLength%12)throw Error('Invalid vegetation payload')
  const trees:Tree[]=[],up=new THREE.Vector3(0,1,0),nVec=new THREE.Vector3()
  for(let i=0;i<data.byteLength;i+=12){
    const x=tile.x+data.getUint16(i,true)/100,z=tile.z+data.getUint16(i+2,true)/100,y=data.getInt16(i+4,true)/10
    const rawKind=data.getUint8(i+6),kind=rawKind<TREE_SPECIES_COUNT?rawKind:0
    const scale=data.getUint8(i+7)/100,yaw=data.getUint8(i+8)*Math.PI/128,seed=data.getUint8(i+9)
    const nx=data.getInt8(i+10)/127,nz=data.getInt8(i+11)/127
    lean.setFromUnitVectors(up,nVec.set(nx,Math.sqrt(Math.max(0,1-nx*nx-nz*nz)),nz).normalize())
    // Trees grow towards the sky: keep at most look.treeLean of the slope normal.
    const angle=2*Math.acos(Math.min(1,Math.abs(lean.w)))
    slopeQ.identity().slerp(lean,angle>look.treeLean?look.treeLean/angle:1)
    const matrix=new THREE.Matrix4(),midMatrix=new THREE.Matrix4(),farMatrix=new THREE.Matrix4()
    const tint=new THREE.Color(),proxyTint=new THREE.Color()
    const proxyGroup=applyTreeVariant(kind,seed,scale,yaw,slopeQ,x,y,z,matrix,midMatrix,farMatrix,tint,proxyTint)
    trees.push({x,y,z,kind,scale,seed,matrix,midMatrix,farMatrix,tint,proxyTint,proxyGroup})
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

export class Forest{
  loaded=new Map<Tile,Tree[]>()
  pending=new Map<Tile,AbortController>()
  private retry=new Map<Tile,number>()
  private nearAssets:ReturnType<typeof treeGeometry>[]|null=null
  private batches:(THREE.InstancedMesh|undefined)[]=Array.from({length:TOTAL_SLOTS},()=>undefined)
  private groups:Tree[][]=Array.from({length:TOTAL_SLOTS},()=>[])
  private nearOrder:number[]=Array.from({length:TREE_SPECIES_COUNT},(_,i)=>i)
  private dirty=true
  private anchor=new THREE.Vector3(Infinity,0,0)
  private rotation=new THREE.Quaternion()
  private frustum=new THREE.Frustum()
  private matrix=new THREE.Matrix4()
  private point=new THREE.Vector3()
  constructor(private scene:THREE.Scene,private tiles:Tile[],private camera:THREE.PerspectiveCamera){}
  tick(position:THREE.Vector3){
    const distance=(tile:Tile)=>Math.hypot(tile.x+128-position.x,tile.z+128-position.z)
    for(const tile of this.tiles){
      if(distance(tile)>1750){if(this.loaded.delete(tile))this.dirty=true;this.pending.get(tile)?.abort()}
    }
    const now=performance.now()
    while(this.pending.size<3){
      let best=1682,next:Tile|undefined
      for(const tile of this.tiles){
        if(this.loaded.has(tile)||this.pending.has(tile)||(this.retry.get(tile)??0)>=now)continue
        const dist=distance(tile)
        if(dist<best){best=dist;next=tile}
      }
      if(!next)break
      const tile=next,control=new AbortController();this.pending.set(tile,control)
      readTrees(tile,control.signal).then(trees=>{if(!control.signal.aborted){this.loaded.set(tile,trees);this.dirty=true}})
        .catch(err=>{if(!control.signal.aborted){console.error(err);this.retry.set(tile,performance.now()+10000)}}).finally(()=>this.pending.delete(tile))
    }
    if(!this.loaded.size)return
    if(!this.dirty&&this.camera.position.distanceToSquared(this.anchor)<4&&this.rotation.angleTo(this.camera.quaternion)<.016)return
    this.anchor.copy(this.camera.position);this.dirty=false
    this.rotation.copy(this.camera.quaternion);this.camera.updateMatrixWorld();this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse))
    const cam=this.camera.position
    const groups=this.groups
    for(let i=0;i<TOTAL_SLOTS;i++)groups[i].length=0
    const nearSq=look.trees.lodNear**2, midSq=look.trees.lodMid**2
    for(const trees of this.loaded.values())for(const tree of trees){
      const d=(tree.x-position.x)**2+(tree.y-position.y)**2+(tree.z-position.z)**2
      if(d>=1500**2)continue
      const highCanopy=(tree.kind===0||tree.kind===1||tree.kind===6||tree.kind===7||tree.kind===9)&&cam.y-tree.y<2.9*tree.scale
      if((tree.x-cam.x)**2+(tree.z-cam.z)**2<(highCanopy?2.2:look.treeCameraClear)**2&&cam.y-tree.y<14*tree.scale)continue
      this.point.set(tree.x,tree.y+4,tree.z)
      if(!this.frustum.planes.every(plane=>plane.distanceToPoint(this.point)>-40))continue
      const slot=d<nearSq?tree.kind:d<midSq?TREE_SPECIES_COUNT+tree.proxyGroup:TREE_SPECIES_COUNT+4+tree.proxyGroup
      groups[slot].push(tree)
    }
    this.nearOrder.sort((a,b)=>groups[b].length-groups[a].length)
    for(let rank=MAX_NEAR_BATCHES;rank<TREE_SPECIES_COUNT;rank++){
      const k=this.nearOrder[rank], overflow=groups[k]
      if(!overflow.length)break
      for(let j=0;j<overflow.length;j++)groups[TREE_SPECIES_COUNT+overflow[j].proxyGroup].push(overflow[j])
      overflow.length=0
    }
    this.nearAssets??=Array.from({length:TREE_SPECIES_COUNT},(_,i)=>treeGeometry(i))
    const nearAssets=this.nearAssets, shared=sharedProxyAssets()
    for(let i=0;i<TOTAL_SLOTS;i++){
      const group=groups[i];let mesh=this.batches[i]
      if(group.length&&(!mesh||mesh.instanceMatrix.count<group.length)){
        if(mesh){this.scene.remove(mesh);mesh.dispose()}
        const cap=Math.max(16,2**Math.ceil(Math.log2(group.length)))
        const geom=i<TREE_SPECIES_COUNT?nearAssets[i].near:i<TREE_SPECIES_COUNT+4?shared.mid[i-TREE_SPECIES_COUNT]:shared.far[i-TREE_SPECIES_COUNT-4]
        const mat=i<TREE_SPECIES_COUNT?nearAssets[i].material:shared.material
        mesh=new THREE.InstancedMesh(geom,mat,cap)
        mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(cap*3),3)
        mesh.raycast=()=>{}
        this.scene.add(mesh);this.batches[i]=mesh;mesh.frustumCulled=false
      }
      if(mesh){
        mesh.count=group.length;mesh.visible=!!group.length
        if(group.length){
          const mArr=mesh.instanceMatrix.array as Float32Array,cArr=mesh.instanceColor!.array as Float32Array
          const mode=i<TREE_SPECIES_COUNT?0:i<TREE_SPECIES_COUNT+4?1:2
          for(let j=0;j<group.length;j++){
            const tree=group[j]
            const mat=mode===0?tree.matrix:mode===1?tree.midMatrix:tree.farMatrix
            const c=mode===0?tree.tint:tree.proxyTint
            mArr.set(mat.elements,j*16)
            cArr[j*3]=c.r;cArr[j*3+1]=c.g;cArr[j*3+2]=c.b
          }
          mesh.instanceMatrix.clearUpdateRanges();mesh.instanceMatrix.addUpdateRange(0,group.length*16);mesh.instanceMatrix.needsUpdate=true
          mesh.instanceColor!.clearUpdateRanges();mesh.instanceColor!.addUpdateRange(0,group.length*3);mesh.instanceColor!.needsUpdate=true
        }
      }
    }
  }
}
