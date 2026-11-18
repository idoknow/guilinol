import R from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type {PeakColliderData, PeaksGroup} from '../peaks'
import type {Stream} from '../stream'
import {fetchAsset,type Manifest,type Tile} from '../world'
import {walkConfig as cfg} from './config'

type Outline = import('../buildings').Building
type Kind = 'ground'|'overview'|'deck'|'building'|'peak'|'tree'|'rail'|'sidewalk'|'landmark'
type Region = {fine:boolean,colliders:R.Collider[],rings:Outline[]}
const identity = {x:0,y:0,z:0,w:1}, down = {x:0,y:-1,z:0}
const candidates = [{dx:0,dz:0}]
for(let dx=-cfg.search;dx<=cfg.search;dx+=2) for(let dz=-cfg.search;dz<=cfg.search;dz+=2)
  if((dx||dz)&&Math.hypot(dx,dz)<=cfg.search)candidates.push({dx,dz})
candidates.sort((first,second)=>Math.hypot(first.dx,first.dz)-Math.hypot(second.dx,second.dz))

function field(cells:number,sample:(col:number,row:number)=>number){
  const heights = new Float32Array((cells+1)**2)
  for(let col=0;col<=cells;col++)for(let row=0;row<=cells;row++)
    heights[col*(cells+1)+row]=sample(col,row)
  return R.ColliderDesc.heightfield(cells,cells,heights,{x:256,y:1,z:256},R.HeightFieldFlags.FIX_INTERNAL_EDGES)
}
function fineField(data:Awaited<ReturnType<typeof import('../world').detail>>){
  const geometry=data.groundMesh.geometry, positions=geometry.getAttribute('position')
  const stride=geometry.parameters.widthSegments+1
  return field(64,(col,row)=>{
    const at=row*65+col, coarse=(row>>1)*stride+(col>>1)
    const visible=(col%2&&row%2)?(positions.getY(coarse+1)+positions.getY(coarse+stride))/2:
      (positions.getY(coarse)+positions.getY(coarse+(col%2)+(row%2)*stride))/2
    return Math.max(visible,(data.water[at]===-32768?data.terrain[at]:data.water[at])/10)
  })
}
function houses(rings:Outline[]){
  const verts:number[]=[], indices:number[]=[]
  for(const [bottom,top,loops] of rings){
    const shape=loops.map(loop=>loop.map(([east,south])=>new THREE.Vector2(east/100,south/100)))
    const faces=THREE.ShapeUtils.triangulateShape(shape[0],shape.slice(1)),start=verts.length/3,size=shape.flat().length
    for(const level of [bottom,top])for(const loop of shape)for(const pt of loop)verts.push(pt.x,level/10,pt.y)
    for(const [first,second,third] of faces)indices.push(start+first,start+second,start+third,start+size+third,start+size+second,start+size+first)
    let offset=start
    for(const loop of shape){for(let at=0;at<loop.length;at++){
      const curr=offset+at,next=offset+(at+1)%loop.length
      indices.push(curr,curr+size,next+size,curr,next+size,next)
    }offset+=loop.length}
  }
  return R.ColliderDesc.trimesh(Float32Array.from(verts),Uint32Array.from(indices))
}

export async function createPhysics(manifest:Manifest,stream:Stream,peaks:PeaksGroup,rapierInit?:Promise<void>){
  const [,buffer]=await Promise.all([rapierInit??R.init(),fetchAsset(manifest.overview.heights.file)])
  const overview=new Int16Array(buffer), [left,top,width]=manifest.extent
  const world=new R.World({x:0,y:cfg.gravity,z:0}), controller=world.createCharacterController(.025)
  controller.setMaxSlopeClimbAngle(cfg.slope);controller.setMinSlopeSlideAngle(cfg.slope)
  controller.enableAutostep(cfg.step,.18,false);controller.enableSnapToGround(cfg.snap)
  const shape=new R.Capsule(cfg.height/2-cfg.radius,cfg.radius)
  const body=world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0,-500,0))
  const capsule=world.createCollider(new R.ColliderDesc(shape),body)
  const regions=new Map<Tile,Region>(), mountains=new Map<PeakColliderData,R.Collider>(), modelMountains=new Map<THREE.Object3D,R.Collider[]>(), kinds=new Map<number,Kind>()
  function add(desc:R.ColliderDesc,kind:Kind){const coll=world.createCollider(desc);kinds.set(coll.handle,kind);return coll}
  function remove(coll:R.Collider){kinds.delete(coll.handle);world.removeCollider(coll,false)}
  const trunks=new Map<import('../forest').Tree,R.Collider>()
  const landmarks=new Map<THREE.Group,R.Collider[]>()
  function sync(east:number,south:number){
    let changed=false
    const nearLandmarks=new Set<THREE.Group>()
    for(const [entry,root] of stream.landmarks){
      if(entry.collision==='none'||Math.hypot(east-root.position.x,south-root.position.z)>cfg.collisionRadius+entry.sphere[3])continue
      nearLandmarks.add(root);if(landmarks.has(root))continue
      const colliders:R.Collider[]=[]
      if(entry.collision==='box'){
        const bounds=new THREE.Box3().setFromObject(root,true),center=bounds.getCenter(new THREE.Vector3()),half=bounds.getSize(new THREE.Vector3()).multiplyScalar(.5)
        colliders.push(add(R.ColliderDesc.cuboid(half.x,half.y,half.z).setTranslation(center.x,center.y,center.z),'landmark'))
      }else root.traverse(node=>{
        if(!(node instanceof THREE.Mesh))return
        let parent:THREE.Object3D|null=node;while(parent&&parent!==root&&!/^collision/i.test(parent.name))parent=parent.parent
        if(!parent||parent===root)return
        const pos=node.geometry.getAttribute('position'),vertices=new Float32Array(pos.count*3),point=new THREE.Vector3()
        for(let index=0;index<pos.count;index++)point.fromBufferAttribute(pos,index).applyMatrix4(node.matrixWorld).toArray(vertices,3*index)
        colliders.push(add(R.ColliderDesc.trimesh(vertices,node.geometry.index?Uint32Array.from(node.geometry.index.array):Uint32Array.from({length:pos.count},(_,index)=>index)),'landmark'))
      })
      landmarks.set(root,colliders);changed=true
    }
    for(const [root,colliders] of landmarks)if(!nearLandmarks.has(root)){colliders.forEach(remove);landmarks.delete(root);changed=true}
    for(const [tree,collider] of trunks)if(Math.hypot(east-tree.x,south-tree.z)>48){remove(collider);trunks.delete(tree);changed=true}
    for(const tile of manifest.chunks){
      const near=Math.hypot(Math.max(0,Math.abs(east-tile.x-128)-128),Math.max(0,Math.abs(south-tile.z-128)-128))<=cfg.collisionRadius
      const data=stream.loaded.get(tile), region=regions.get(tile)
      const trees=stream.forest.loaded.get(tile)
      if(trees&&Math.max(Math.abs(east-tile.x-128),Math.abs(south-tile.z-128))<168)for(const tree of trees){
        if(tree.kind!==5&&!trunks.has(tree)&&Math.hypot(east-tree.x,south-tree.z)<40){trunks.set(tree,add(R.ColliderDesc.cylinder(1.8,.42*tree.scale).setTranslation(tree.x,tree.y+1.8,tree.z),'tree'));changed=true}}
      if(region&&(!near||region.fine!==!!data)){region.colliders.forEach(remove);regions.delete(tile);changed=true}
      if(!near||regions.has(tile))continue
      const stride=width/32+1,start=(tile.z-top)/32*stride+(tile.x-left)/32
      const ground=data?fineField(data):field(8,(col,row)=>overview[start+row*stride+col]/10)
      const colliders=[add(ground.setTranslation(tile.x+128,0,tile.z+128),data?'ground':'overview')]
      const rings=data?.rings??[]
      if(data){const {sidewalk,banks}=data.streets
        if(sidewalk.length)colliders.push(add(R.ColliderDesc.trimesh(sidewalk,Uint32Array.from({length:sidewalk.length/3},(_,i)=>i)).setTranslation(tile.x,0,tile.z),'sidewalk'))
        for(const [ax,az,bx,bz,top,bottom] of banks){const angle=-Math.atan2(bz-az,bx-ax),height=(top-bottom)/10+1.25
          colliders.push(add(R.ColliderDesc.cuboid(Math.hypot(bx-ax,bz-az)/20+.03,height/2,.09).setRotation({x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)}).setTranslation(tile.x+(ax+bx)/20,bottom/10+height/2,tile.z+(az+bz)/20),'rail'))}}
      if(rings.length)colliders.push(add(houses(rings).setTranslation(tile.x,0,tile.z),'building'))
      if(data?.deck.length){const count=data.deck.length/3
        colliders.push(add(R.ColliderDesc.trimesh(data.deck,Uint32Array.from({length:count},(_,at)=>at)).setTranslation(tile.x,0,tile.z),'deck'))}
      regions.set(tile,{colliders,rings,fine:!!data});changed=true
    }
    for(const peak of peaks.colliders){
      const near=Math.hypot(east-peak.center[0],south-peak.center[2])<=cfg.peakRadius
      if(!near&&mountains.has(peak)){remove(mountains.get(peak)!);mountains.delete(peak);changed=true}
      if(near&&!mountains.has(peak)){
        mountains.set(peak,add(R.ColliderDesc.trimesh(peak.vertices,peak.indices),'peak'));changed=true
      }
    }
    for(const model of peaks.modelPeaks){
      const near=Math.hypot(east-model.position.x,south-model.position.z)<=cfg.peakRadius
      if(!near&&modelMountains.has(model)){modelMountains.get(model)!.forEach(remove);modelMountains.delete(model);changed=true}
      if(near&&!modelMountains.has(model)){
        const list:R.Collider[]=[],pt=new THREE.Vector3()
        model.updateWorldMatrix(true,true)
        model.traverse(node=>{
          if(!(node instanceof THREE.Mesh))return
          const pos=node.geometry.getAttribute('position'),verts=new Float32Array(pos.count*3)
          for(let i=0;i<pos.count;i++)pt.fromBufferAttribute(pos,i).applyMatrix4(node.matrixWorld).toArray(verts,i*3)
          const idx=node.geometry.index?Uint32Array.from(node.geometry.index.array):Uint32Array.from({length:pos.count},(_,i)=>i)
          list.push(add(R.ColliderDesc.trimesh(verts,idx),'peak'))
        })
        modelMountains.set(model,list);changed=true
      }
    }
    if(changed)world.step()
  }
  const tiles=new Map(manifest.chunks.map(tile=>[`${tile.x},${tile.z}`,tile]))
  const tileAt=(east:number,south:number)=>tiles.get(`${Math.floor(east/256)*256},${Math.floor(south/256)*256}`)
  function surface(east:number,south:number,kind:Kind){
    const hit=world.castRayAndGetNormal(new R.Ray({x:east,y:4000,z:south},down),6000,false,undefined,undefined,capsule,undefined,coll=>kinds.get(coll.handle)===kind)
    return hit?{y:4000-hit.timeOfImpact,slope:Math.acos(Math.min(1,Math.abs(hit.normal.y)))}:null
  }
  function wet(east:number,south:number){const tile=tileAt(east,south),data=tile&&stream.loaded.get(tile);if(!tile||!data)return true
    const at=Math.round((south-tile.z)/4)*65+Math.round((east-tile.x)/4)
    return data.water[at]!==-32768&&data.water[at]-data.terrain[at]>5
  }
  function insideHouse(east:number,south:number){const tile=tileAt(east,south);if(!tile)return false
    const px=(east-tile.x)*100,pz=(south-tile.z)*100
    return regions.get(tile)?.rings.some(([, ,loops])=>{let inside=false
      for(const loop of loops)for(let at=0,prev=loop.length-1;at<loop.length;prev=at++){
        const [ax,az]=loop[at],[bx,bz]=loop[prev];if((az>pz)!==(bz>pz)&&px<(bx-ax)*(pz-az)/(bz-az)+ax)inside=!inside
      }return inside})??false
  }
  function findWalkableSpawn(east:number,south:number,override=false){
    for(const {dx,dz} of override?[candidates[0]]:candidates){const x=east+dx,z=south+dz,tile=tileAt(x,z)
      if(!tile||!stream.loaded.has(tile)||insideHouse(x,z))continue
      const deck=surface(x,z,'deck'),support=deck??surface(x,z,'sidewalk')??surface(x,z,'ground');if(!support||support.slope>cfg.slope||(!deck&&wet(x,z)))continue
      const peak=surface(x,z,'peak');if(peak&&peak.y>support.y+.05)continue
      const y=support.y+cfg.height/2+.055
      if(world.intersectionWithShape({x,y,z},identity,shape,undefined,undefined,capsule))continue
      return {x,y,z,rule:(dx||dz?'search-':'')+(deck?'bridge':'land')}
    }return null
  }
  function overlaps(kind:Kind){return !!world.intersectionWithShape(body.translation(),identity,shape,undefined,undefined,capsule,undefined,coll=>kinds.get(coll.handle)===kind)}
  function clear(){for(const region of regions.values())region.colliders.forEach(remove);regions.clear();mountains.forEach(remove);mountains.clear();modelMountains.forEach(list=>list.forEach(remove));modelMountains.clear();trunks.forEach(remove);trunks.clear();landmarks.forEach(colliders=>colliders.forEach(remove));landmarks.clear()}
  return {world,body,capsule,controller,kinds,sync,clear,overlaps,tileAt,surface,wet,insideHouse,findWalkableSpawn}
}
