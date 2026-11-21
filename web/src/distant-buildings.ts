import * as THREE from 'three'
import {fetchAsset, type Tile} from './world'
import {buildingColor} from './look/buildings'

const limit = 768
const range = 3600

export class DistantBuildings {
  private mesh:THREE.InstancedMesh
  private records?:Int16Array
  private pending=false
  private retry=0
  private tiles=new Map<number,Tile>()
  private buckets = new Map<Tile,{bounds:THREE.Box3; offsets:number[]}>()
  private view = new THREE.Matrix4()
  private lastView = new THREE.Matrix4()
  private frustum = new THREE.Frustum()
  private box = new THREE.Box3()
  private previousLoaded=-1
  private matrix=new THREE.Matrix4()
  private colors:THREE.Color[]=[]

  constructor(scene:THREE.Scene, private file:string, tiles:Tile[]){
    for(const tile of tiles)this.tiles.set(this.key(tile.x,tile.z),tile)
    for(let kind=0;kind<8;kind++){
      const rgb:number[]=[]
      buildingColor(kind,false,0,rgb,0)
      this.colors.push(new THREE.Color().fromArray(rgb))
    }
    this.mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial(),limit)
    this.mesh.frustumCulled=false
    this.mesh.count=0
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(this.mesh)
  }
  private key(x:number,z:number){return Math.floor(x/256)+65536*Math.floor(z/256)}
  private index(data:ArrayBuffer){
    const rows=new Int16Array(data)
    for(let i=0;i<rows.length;i+=7){
      const x=rows[i],z=rows[i+1]
      // The published centre already has its own landmark skyline.
      if(x>=-2304 && x<1280 && z>=-2560 && z<3328)continue
      const tile=this.tiles.get(this.key(x,z))
      if(!tile)continue
      let bucket=this.buckets.get(tile)
      if(!bucket)this.buckets.set(tile,bucket={bounds:new THREE.Box3(),offsets:[]})
      const w=rows[i+4]/2,d=rows[i+5]/2
      this.box.min.set(x-w,rows[i+2]/10,z-d)
      this.box.max.set(x+w,rows[i+3]/10,z+d)
      bucket.bounds.union(this.box);bucket.offsets.push(i)
    }
    this.records=rows
  }
  tick(camera:THREE.PerspectiveCamera, loaded:ReadonlyMap<Tile,unknown>,revision:number){
    const at=camera.position
    if(!this.records){
      if(!this.pending && performance.now()>=this.retry){
        this.pending=true
        void fetchAsset(this.file).then(data=>new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
          .then(data=>this.index(data))
          .catch(err=>{this.retry=performance.now()+10000;console.warn(this.file,err)})
          .finally(()=>{this.pending=false})
      }
      return
    }
    camera.updateMatrixWorld()
    this.view.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
    if(this.previousLoaded===revision && this.lastView.equals(this.view))return
    this.lastView.copy(this.view)
    this.frustum.setFromProjectionMatrix(this.view)
    this.previousLoaded=revision
    const rows=this.records, near:{offset:number;distance:number}[]=[]
    for(const [tile,bucket] of this.buckets){
      if(loaded.has(tile) || bucket.bounds.distanceToPoint(at)>range || !this.frustum.intersectsBox(bucket.bounds))continue
      for(const i of bucket.offsets){
        const distance=(at.x-rows[i])**2+(at.z-rows[i+1])**2
        if(distance<range**2)near.push({offset:i,distance})
      }
    }
    near.sort((a,b)=>a.distance-b.distance)
    this.mesh.count=Math.min(near.length,limit)
    this.mesh.visible=this.mesh.count>0
    for(let k=0;k<this.mesh.count;k++){
      const i=near[k].offset, base=rows[i+2]/10, roof=rows[i+3]/10
      this.matrix.makeScale(rows[i+4],roof-base,rows[i+5])
      this.matrix.setPosition(rows[i],(roof+base)/2,rows[i+1])
      this.mesh.setMatrixAt(k,this.matrix);this.mesh.setColorAt(k,this.colors[rows[i+6]]??this.colors[0])
    }
    this.mesh.instanceMatrix.needsUpdate=true
    if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true
  }
}
