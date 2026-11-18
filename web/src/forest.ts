import * as THREE from 'three'
import {treeGeometry} from './look/trees'
import {fetchAsset,type Tile} from './world'

export type Tree={x:number,y:number,z:number,kind:number,scale:number,seed:number,matrix:THREE.Matrix4}
export async function readTrees(tile:Tile,signal:AbortSignal){
  const raw=await fetchAsset(tile.file.replace('.glc','.trees'),signal)
  const data=new DataView(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  if(data.byteLength%12)throw Error('Invalid vegetation payload')
  const trees:Tree[]=[],up=new THREE.Vector3(0,1,0),object=new THREE.Object3D()
  for(let i=0;i<data.byteLength;i+=12){
    const x=tile.x+data.getUint16(i,true)/100,z=tile.z+data.getUint16(i+2,true)/100,y=data.getInt16(i+4,true)/10
    const kind=data.getUint8(i+6),scale=data.getUint8(i+7)/100,seed=data.getUint8(i+9)
    const nx=data.getInt8(i+10)/127,nz=data.getInt8(i+11)/127
    object.position.set(x,y,z);object.scale.setScalar(scale)
    object.quaternion.setFromUnitVectors(up,new THREE.Vector3(nx,Math.sqrt(Math.max(0,1-nx*nx-nz*nz)),nz).normalize())
    object.rotateY(data.getUint8(i+8)*Math.PI/128);object.updateMatrix()
    trees.push({x,y,z,kind,scale,seed,matrix:object.matrix.clone()})
  }return trees
}

export class Forest{
  loaded=new Map<Tile,Tree[]>()
  private pending=new Map<Tile,AbortController>()
  private retry=new Map<Tile,number>()
  private assets=Array.from({length:6},(_,i)=>treeGeometry(i))
  private batches:(THREE.InstancedMesh|undefined)[]=[]
  private dirty=true
  private anchor=new THREE.Vector3(Infinity,0,0)
  private rotation=new THREE.Quaternion()
  private frustum=new THREE.Frustum()
  private matrix=new THREE.Matrix4()
  private point=new THREE.Vector3()
  constructor(private scene:THREE.Scene,private tiles:Tile[],private camera:THREE.PerspectiveCamera){}
  tick(position:THREE.Vector3){
    const distance=(tile:Tile)=>Math.hypot(tile.x+128-position.x,tile.z+128-position.z)
    let best=1682,next:Tile|undefined
    for(const tile of this.tiles){const dist=distance(tile)
      if(dist>1750){if(this.loaded.delete(tile))this.dirty=true;this.pending.get(tile)?.abort();continue}
      if(dist<best&&!this.pending.has(tile)&&!this.loaded.has(tile)&&(this.retry.get(tile)??0)<performance.now()){best=dist;next=tile}
    }
    if(next&&this.pending.size<3){const tile=next,control=new AbortController();this.pending.set(tile,control)
      readTrees(tile,control.signal).then(trees=>{if(!control.signal.aborted){this.loaded.set(tile,trees);this.dirty=true}})
        .catch(err=>{if(!control.signal.aborted){console.error(err);this.retry.set(tile,performance.now()+10000)}}).finally(()=>this.pending.delete(tile))}
    if(!this.dirty&&position.distanceToSquared(this.anchor)<16&&this.rotation.angleTo(this.camera.quaternion)<.016)return
    this.anchor.copy(position);this.dirty=false
    this.rotation.copy(this.camera.quaternion);this.camera.updateMatrixWorld();this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse))
    const groups:Tree[][]=Array.from({length:12},()=>[])
    for(const trees of this.loaded.values())for(const tree of trees){const d=(tree.x-position.x)**2+(tree.y-position.y)**2+(tree.z-position.z)**2
      if(d>=1500**2)continue
      this.point.set(tree.x,tree.y+4,tree.z)
      if(this.frustum.planes.every(plane=>plane.distanceToPoint(this.point)>-40))groups[tree.kind+(d<600**2?0:6)].push(tree)}
    groups.forEach((group,i)=>{let mesh=this.batches[i];const asset=this.assets[i%6]
      if(group.length&&(!mesh||mesh.instanceMatrix.count<group.length)){
        if(mesh){this.scene.remove(mesh);mesh.dispose()}
        mesh=new THREE.InstancedMesh(i<6?asset.near:asset.far,asset.material,2**Math.ceil(Math.log2(group.length)))
        this.scene.add(mesh);this.batches[i]=mesh;mesh.frustumCulled=false
      }
      if(mesh){mesh.count=group.length;mesh.visible=!!group.length;group.forEach((tree,j)=>mesh!.setMatrixAt(j,tree.matrix));mesh.instanceMatrix.needsUpdate=true}
    })
  }
}
