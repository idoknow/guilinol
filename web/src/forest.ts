import * as THREE from 'three'
import {treeGeometry, speciesCount, treeFar} from './look/trees'
import {look} from './look/config'
import {fetchAsset,type Tile} from './world'

export type Tree={x:number,y:number,z:number,kind:number,scale:number,seed:number,matrix:THREE.Matrix4,tint:THREE.Color}
const lean=new THREE.Quaternion()
export async function readTrees(tile:Tile,signal:AbortSignal){
  const raw=await fetchAsset(tile.file.replace('.glc','.trees'),signal)
  const data=new DataView(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  if(data.byteLength%12)throw Error('Invalid vegetation payload')
  const trees:Tree[]=[],up=new THREE.Vector3(0,1,0),object=new THREE.Object3D(),nVec=new THREE.Vector3()
  for(let i=0;i<data.byteLength;i+=12){
    const x=tile.x+data.getUint16(i,true)/100,z=tile.z+data.getUint16(i+2,true)/100,y=data.getInt16(i+4,true)/10
    const kind=data.getUint8(i+6),scale=data.getUint8(i+7)/100,seed=data.getUint8(i+9)
    const nx=data.getInt8(i+10)/127,nz=data.getInt8(i+11)/127
    object.position.set(x,y,z);object.scale.setScalar(scale)
    lean.setFromUnitVectors(up,nVec.set(nx,Math.sqrt(Math.max(0,1-nx*nx-nz*nz)),nz).normalize())
    // Trees grow towards the sky: keep at most look.treeLean of the slope normal.
    const angle=2*Math.acos(Math.min(1,Math.abs(lean.w)));object.quaternion.identity().slerp(lean,angle>look.treeLean?look.treeLean/angle:1)
    object.rotateY(data.getUint8(i+8)*Math.PI/128);object.updateMatrix()
    const j=look.trees.treeJitter,h=((seed*37)%256)/255-.5,v=((seed*101)%256)/255-.5
    const tint=new THREE.Color(1+v*j*2+h*j,1+v*j*2,1+v*j*2-h*j*1.5)
    trees.push({x,y,z,kind,scale,seed,matrix:object.matrix.clone(),tint})
  }return trees
}

export class Forest{
  loaded=new Map<Tile,Tree[]>()
  pending=new Map<Tile,AbortController>()
  private retry=new Map<Tile,number>()
  private assets:ReturnType<typeof treeGeometry>[]|null=null
  private batches:(THREE.InstancedMesh|undefined)[]=[]
  private groups:Tree[][]=Array.from({length:speciesCount*2},()=>[])
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
    if(!this.loaded.size){
      for(const mesh of this.batches)if(mesh){mesh.visible=false;mesh.count=0}
      return
    }
    if(!this.dirty&&this.camera.position.distanceToSquared(this.anchor)<4&&this.rotation.angleTo(this.camera.quaternion)<.016)return
    this.anchor.copy(this.camera.position);this.dirty=false
    this.rotation.copy(this.camera.quaternion);this.camera.updateMatrixWorld();this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse))
    const cam=this.camera.position
    const groups=this.groups
    for(let i=0;i<speciesCount*2;i++)groups[i].length=0
    for(const trees of this.loaded.values())for(const tree of trees){const d=(tree.x-cam.x)**2+(tree.y-cam.y)**2+(tree.z-cam.z)**2
      if(d>=treeFar**2)continue
      // Never let a crown swallow the follow camera: drop trees whose canopy the camera is inside.
      const underCamphor=tree.kind===0&&cam.y-tree.y<3.2*tree.scale
      if((tree.x-cam.x)**2+(tree.z-cam.z)**2<(underCamphor?2.5:look.treeCameraClear)**2&&cam.y-tree.y<14*tree.scale)continue
      this.point.set(tree.x,tree.y+4,tree.z)
      if(this.frustum.planes.every(plane=>plane.distanceToPoint(this.point)>-40))groups[(tree.kind<speciesCount?tree.kind:0)+(d<(240+tree.seed*.3)**2?0:speciesCount)].push(tree)}
    this.assets??=Array.from({length:speciesCount},(_,i)=>treeGeometry(i))
    const assets=this.assets
    for(let i=0;i<speciesCount*2;i++){
      const group=groups[i];let mesh=this.batches[i];const asset=assets[i%speciesCount]
      if(group.length&&(!mesh||mesh.instanceMatrix.count<group.length)){
        if(mesh){this.scene.remove(mesh);mesh.dispose()}
        const cap=2**Math.ceil(Math.log2(group.length))
        mesh=new THREE.InstancedMesh(i<speciesCount?asset.near:asset.far,asset.material,cap)
        mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(cap*3),3)
        this.scene.add(mesh);this.batches[i]=mesh;mesh.frustumCulled=false
      }
      if(mesh){
        mesh.count=group.length;mesh.visible=!!group.length
        if(group.length){
          const mArr=mesh.instanceMatrix.array as Float32Array,cArr=mesh.instanceColor!.array as Float32Array
          for(let j=0;j<group.length;j++){const tree=group[j];mArr.set(tree.matrix.elements,j*16);const c=tree.tint;cArr[j*3]=c.r;cArr[j*3+1]=c.g;cArr[j*3+2]=c.b}
          mesh.instanceMatrix.clearUpdateRanges();mesh.instanceMatrix.addUpdateRange(0,group.length*16);mesh.instanceMatrix.needsUpdate=true
          mesh.instanceColor!.clearUpdateRanges();mesh.instanceColor!.addUpdateRange(0,group.length*3);mesh.instanceColor!.needsUpdate=true
        }
      }
    }
  }
}
