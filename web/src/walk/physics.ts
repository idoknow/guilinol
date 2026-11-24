import {inRegion} from '../../../lib/play-region'
import R from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type {PeakColliderData, PeaksGroup} from '../peaks'
import type {Stream} from '../stream'
import {fetchAsset,type Manifest,type Tile} from '../world'
import {look} from '../look/config'
import {walkConfig as cfg} from './config'
import {probeCarDismount, probeCarMount} from './car'
import {probeLocalDismount, probeLocalMount} from './ride'
import {onOldSouthSlope,yueyaShoulderHeight} from '../yueya-slope'

type Outline = import('../buildings').Building
type Kind = 'ground'|'overview'|'road'|'deck'|'deckThin'|'building'|'peak'|'tree'|'rail'|'sidewalk'|'landmark'
type Region = {fine:boolean,colliders:R.Collider[],rings:Outline[]}
const identity = {x:0,y:0,z:0,w:1}, down = {x:0,y:-1,z:0}, up = {x:0,y:1,z:0}
const candidates = [{dx:0,dz:0}]
for(let dx=-cfg.search;dx<=cfg.search;dx+=2) for(let dz=-cfg.search;dz<=cfg.search;dz+=2)
  if((dx||dz)&&Math.hypot(dx,dz)<=cfg.search)candidates.push({dx,dz})
candidates.sort((first,second)=>Math.hypot(first.dx,first.dz)-Math.hypot(second.dx,second.dz))
// 复位（IDOK-234）在 cfg.search 之外再用 4 m 网格搜到 200 m：漓江江心离岸可能超过 64 m。
const unstuckCandidates=[...candidates]
for(let dx=-200;dx<=200;dx+=4) for(let dz=-200;dz<=200;dz+=4){const d=Math.hypot(dx,dz);if(d>cfg.search&&d<=200)unstuckCandidates.push({dx,dz})}
unstuckCandidates.sort((first,second)=>Math.hypot(first.dx,first.dz)-Math.hypot(second.dx,second.dz))

function field(cells:number,sample:(col:number,row:number)=>number){
  const heights = new Float32Array((cells+1)**2)
  for(let col=0;col<=cells;col++)for(let row=0;row<=cells;row++)
    heights[col*(cells+1)+row]=sample(col,row)
  return R.ColliderDesc.heightfield(cells,cells,heights,{x:256,y:1,z:256},R.HeightFieldFlags.FIX_INTERNAL_EDGES)
}
function fineField(data:Awaited<ReturnType<typeof import('../world').detail>>){
  const geometry=data.groundMesh.geometry, positions=geometry.getAttribute('position')
  const stride=geometry.parameters.widthSegments+1
  const tile=data.group.position
  const yueya=tile.x<=504&&tile.x+256>=167&&tile.z<=856&&tile.z+256>=536
  return field(64,(col,row)=>{
    const at=row*65+col, coarse=(row>>1)*stride+(col>>1)
    const visible=stride===65?positions.getY(at):(col%2&&row%2)?(positions.getY(coarse+1)+positions.getY(coarse+stride))/2:
      (positions.getY(coarse)+positions.getY(coarse+(col%2)+(row%2)*stride))/2
    if(yueya&&data.water[at]===-32768){
      const east=tile.x+col*4,south=tile.z+row*4
      if(onOldSouthSlope(east,south))return visible
      return Math.max(visible,yueyaShoulderHeight(east,data.terrain[at]/10,south))
    }
    return Math.max(visible,(data.water[at]===-32768?data.terrain[at]:data.water[at])/10)
  })
}
function weldedIndexed(vertices:Float32Array, rawIndices:number[]){
  const verts:number[]=[],idxList:number[]=[],seen=new Map<string,number>()
  const addVertex=(corner:number)=>{
    const i=3*corner
    const key=`${Math.round(vertices[i]*100)},${Math.round(vertices[i+1]*100)},${Math.round(vertices[i+2]*100)}`
    let idx=seen.get(key)
    if(idx===undefined){idx=verts.length/3;seen.set(key,idx);verts.push(vertices[i],vertices[i+1],vertices[i+2])}
    return idx
  }
  for(let t=0;t+2<rawIndices.length;t+=3){
    const a=addVertex(rawIndices[t]),b=addVertex(rawIndices[t+1]),c=addVertex(rawIndices[t+2])
    if(a!==b&&b!==c&&c!==a)idxList.push(a,b,c)
  }
  return idxList.length?R.ColliderDesc.trimesh(Float32Array.from(verts),Uint32Array.from(idxList),R.TriMeshFlags.FIX_INTERNAL_EDGES):null
}
function filterBridgeOverRoad(road: Float32Array, deck: Float32Array) {
  if (!road.length || !deck.length) return road
  const pad = cfg.radius + .06, cell = 8, dim = 32
  const buckets = new Map<number, number[]>()
  const dBounds: number[] = []
  for (let i = 0, tri = 0; i + 8 < deck.length; i += 9, tri++) {
    const minX = Math.min(deck[i], deck[i + 3], deck[i + 6]) - pad
    const maxX = Math.max(deck[i], deck[i + 3], deck[i + 6]) + pad
    const minZ = Math.min(deck[i + 2], deck[i + 5], deck[i + 8]) - pad
    const maxZ = Math.max(deck[i + 2], deck[i + 5], deck[i + 8]) + pad
    const minY = Math.min(deck[i + 1], deck[i + 4], deck[i + 7])
    const maxY = Math.max(deck[i + 1], deck[i + 4], deck[i + 7])
    dBounds.push(minX, maxX, minZ, maxZ, minY, maxY)
    const cx0 = Math.max(0, Math.min(dim - 1, Math.floor(minX / cell)))
    const cx1 = Math.max(0, Math.min(dim - 1, Math.floor(maxX / cell)))
    const cz0 = Math.max(0, Math.min(dim - 1, Math.floor(minZ / cell)))
    const cz1 = Math.max(0, Math.min(dim - 1, Math.floor(maxZ / cell)))
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const k = cz * dim + cx
      let arr = buckets.get(k)
      if (!arr) { arr = []; buckets.set(k, arr) }
      arr.push(tri)
    }
  }
  const kept: number[] = []
  for (let i = 0; i + 8 < road.length; i += 9) {
    const minX = Math.min(road[i], road[i + 3], road[i + 6])
    const maxX = Math.max(road[i], road[i + 3], road[i + 6])
    const minZ = Math.min(road[i + 2], road[i + 5], road[i + 8])
    const maxZ = Math.max(road[i + 2], road[i + 5], road[i + 8])
    const minY = Math.min(road[i + 1], road[i + 4], road[i + 7])
    const midY = (road[i + 1] + road[i + 4] + road[i + 7]) / 3
    const cx0 = Math.max(0, Math.min(dim - 1, Math.floor(minX / cell)))
    const cx1 = Math.max(0, Math.min(dim - 1, Math.floor(maxX / cell)))
    const cz0 = Math.max(0, Math.min(dim - 1, Math.floor(minZ / cell)))
    const cz1 = Math.max(0, Math.min(dim - 1, Math.floor(maxZ / cell)))
    let blockedByBridge = false
    outer: for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const list = buckets.get(cz * dim + cx)
      if (!list) continue
      for (const tri of list) {
        const b = tri * 6
        if (maxX >= dBounds[b] && minX <= dBounds[b + 1] && maxZ >= dBounds[b + 2] && minZ <= dBounds[b + 3]
          && midY > dBounds[b + 5] + .08 && minY < dBounds[b + 4] + 2.5) {
          blockedByBridge = true
          break outer
        }
      }
    }
    if (!blockedByBridge) {
      for (let j = 0; j < 9; j++) kept.push(road[i + j])
    }
  }
  return kept.length === road.length ? road : Float32Array.from(kept)
}

function weldedSurface(raw:Float32Array, corners:number[]|null, data:Awaited<ReturnType<typeof import('../world').detail>>, maxGap:number, minRun:number, maxRun:number, runScale:number){
  const verts:number[]=[],idxList:number[]=[],seen=new Map<string,number>()
  const addVertex=(corner:number)=>{
    const i=3*corner
    const key=`${Math.round(raw[i]*100)},${Math.round(raw[i+1]*100)},${Math.round(raw[i+2]*100)}`
    let idx=seen.get(key)
    if(idx===undefined){idx=verts.length/3;seen.set(key,idx);verts.push(raw[i],raw[i+1],raw[i+2])}
    return idx
  }
  if(corners){
    for(let t=0;t+2<corners.length;t+=3){
      const a=addVertex(corners[t]),b=addVertex(corners[t+1]),c=addVertex(corners[t+2])
      if(a!==b&&b!==c&&c!==a)idxList.push(a,b,c)
    }
  }else{
    for(let t=0;t+2<raw.length/3;t+=3){
      const a=addVertex(t),b=addVertex(t+1),c=addVertex(t+2)
      if(a!==b&&b!==c&&c!==a)idxList.push(a,b,c)
    }
  }
  if(!idxList.length)return null
  // Smooth low dry abutment/road-shoulder edges onto terrain so pedestrians and vehicles glide up without snagging.
  const edgeCount=new Map<string,number>(), edgeTri=new Map<string,[number,number,number]>()
  const addEdge=(u:number,v:number,w:number)=>{
    const k=u<v?`${u}:${v}`:`${v}:${u}`
    edgeCount.set(k,(edgeCount.get(k)??0)+1)
    edgeTri.set(k,[u,v,w])
  }
  for(let t=0;t<idxList.length;t+=3){
    const a=idxList[t],b=idxList[t+1],c=idxList[t+2]
    addEdge(a,b,c);addEdge(b,c,a);addEdge(c,a,b)
  }
  const pos=data.groundMesh.geometry.getAttribute('position')
  const stride=data.groundMesh.geometry.parameters.widthSegments+1, step=256/(stride-1)
  const groundAt=(lx:number,lz:number)=>{
    const c=Math.min(stride-2,Math.max(0,Math.floor(lx/step))), r=Math.min(stride-2,Math.max(0,Math.floor(lz/step)))
    const u=lx/step-c, v=lz/step-r, at=r*stride+c
    const a=pos.getY(at), b=pos.getY(at+1), cc=pos.getY(at+stride), d=pos.getY(at+stride+1)
    const vis=u+v<=1?a+(b-a)*u+(cc-a)*v:d+(cc-d)*(1-u)+(b-d)*(1-v)
    const gi=Math.min(64,Math.max(0,Math.round(lz/4)))*65+Math.min(64,Math.max(0,Math.round(lx/4)))
    return Math.max(vis,(data.water[gi]===-32768?data.terrain[gi]:data.water[gi])/10)
  }
  const dryAt=(lx:number,lz:number)=>data.water[Math.min(64,Math.max(0,Math.round(lz/4)))*65+Math.min(64,Math.max(0,Math.round(lx/4)))]===-32768
  for(const [k,cnt] of edgeCount){
    if(cnt!==1)continue
    const [u,v,w]=edgeTri.get(k)!
    const ax=verts[u*3],ay=verts[u*3+1],az=verts[u*3+2]
    const bx=verts[v*3],by=verts[v*3+1],bz=verts[v*3+2]
    if((ax<.15&&bx<.15)||(ax>255.85&&bx>255.85)||(az<.15&&bz<.15)||(az>255.85&&bz>255.85))continue
    const ex=bx-ax, ez=bz-az, elen=Math.hypot(ex,ez); if(elen<.2)continue
    const mx=(ax+bx)*.5, mz=(az+bz)*.5
    let nx=-ez/elen, nz=ex/elen
    if((verts[w*3]-mx)*nx+(verts[w*3+2]-mz)*nz>0){nx=-nx;nz=-nz}
    const gA=groundAt(ax,az), gB=groundAt(bx,bz), gap=Math.max(ay-gA,by-gB)
    if(gap<=.04||gap>maxGap)continue
    const run=Math.min(maxRun,Math.max(minRun,gap*runScale))
    const a2x=ax+nx*run, a2z=az+nz*run, b2x=bx+nx*run, b2z=bz+nz*run
    if(a2x<.1||a2x>255.9||b2x<.1||b2x>255.9||a2z<.1||a2z>255.9||b2z<.1||b2z>255.9)continue
    if(!dryAt(ax,az)||!dryAt(bx,bz)||!dryAt(mx,mz)||!dryAt(a2x,a2z)||!dryAt(b2x,b2z)||!dryAt(mx+nx*run,mz+nz*run))continue
    const gA2=groundAt(a2x,a2z), gB2=groundAt(b2x,b2z)
    if(Math.max(ay-gA2,by-gB2)>maxGap)continue
    const u2=verts.length/3; verts.push(a2x,Math.min(ay-.02,gA2-.04),a2z)
    const v2=verts.length/3; verts.push(b2x,Math.min(by-.02,gB2-.04),b2z)
    if((bz-az)*(a2x-ax)-(bx-ax)*(a2z-az)>=0)idxList.push(u,v,v2,u,v2,u2)
    else idxList.push(u,v2,v,u,u2,v2)
  }
  return R.ColliderDesc.trimesh(Float32Array.from(verts),Uint32Array.from(idxList),R.TriMeshFlags.FIX_INTERNAL_EDGES)
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
  const world=new R.World({x:0,y:cfg.gravity,z:0}), controller=world.createCharacterController(cfg.skin)
  controller.setMaxSlopeClimbAngle(cfg.slope);controller.setMinSlopeSlideAngle(cfg.slope)
  controller.enableAutostep(cfg.step,cfg.stepWidth,false);controller.enableSnapToGround(cfg.snap)
  const shape=new R.Capsule(cfg.height/2-cfg.radius,cfg.radius)
  const body=world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0,-500,0))
  const capsule=world.createCollider(new R.ColliderDesc(shape),body)
  const regions=new Map<Tile,Region>(), mountains=new Map<PeakColliderData,R.Collider>(), modelMountains=new Map<THREE.Object3D,R.Collider[]>(), kinds=new Map<number,Kind>()
  function add(desc:R.ColliderDesc,kind:Kind){const coll=world.createCollider(desc);kinds.set(coll.handle,kind);return coll}
  const thinDecks=new Set<number>()
  const sources=new Map<number,string>()
  function remove(coll:R.Collider){sources.delete(coll.handle);thinDecks.delete(coll.handle);kinds.delete(coll.handle);world.removeCollider(coll,false)}
  const trunks=new Map<import('../forest').Tree,R.Collider>()
  const landmarks=new Map<THREE.Group,R.Collider[]>()
  function sync(east:number,south:number){
    let changed=false
    const collisionRadius=Math.min(cfg.collisionRadius,Math.max(256,stream.radius))
    const nearLandmarks=new Set<THREE.Group>()
    for(const [entry,root] of stream.landmarks){
      if(entry.collision==='none'||Math.hypot(east-root.position.x,south-root.position.z)>collisionRadius+entry.sphere[3])continue
      nearLandmarks.add(root);if(landmarks.has(root))continue
      const colliders:R.Collider[]=[]
      if(entry.collision==='box'){
        const bounds=new THREE.Box3().setFromObject(root,true),center=bounds.getCenter(new THREE.Vector3()),half=bounds.getSize(new THREE.Vector3()).multiplyScalar(.5)
        colliders.push(add(R.ColliderDesc.cuboid(half.x,half.y,half.z).setTranslation(center.x,center.y,center.z),'landmark'))
      }else root.traverse(node=>{
        if(!(node instanceof THREE.Mesh))return
        let parent:THREE.Object3D|null=node;while(parent&&parent!==root&&!/^collision/i.test(parent.name))parent=parent.parent
        if(!parent||parent===root)return
        const pos=node.geometry.getAttribute('position'),rawIdx=node.geometry.index?node.geometry.index.array:null
        const vertices=new Float32Array(pos.count*3),point=new THREE.Vector3()
        for(let index=0;index<pos.count;index++)point.fromBufferAttribute(pos,index).applyMatrix4(node.matrixWorld).toArray(vertices,3*index)
        const triCount=rawIdx?rawIdx.length/3:pos.count/3,filtered:number[]=[],lowSlabs:number[]=[],slabCap=root.position.y+.22
        const keepLowSlab=parent.name==='collision_stairs'||/bridge|huaqiao|ronghu|mulong/.test(entry.id)
        for(let t=0;t<triCount;t++){
          const i0=rawIdx?rawIdx[t*3]:t*3,i1=rawIdx?rawIdx[t*3+1]:t*3+1,i2=rawIdx?rawIdx[t*3+2]:t*3+2
          const x0=vertices[i0*3],y0=vertices[i0*3+1],z0=vertices[i0*3+2]
          const x1=vertices[i1*3],y1=vertices[i1*3+1],z1=vertices[i1*3+2]
          const x2=vertices[i2*3],y2=vertices[i2*3+1],z2=vertices[i2*3+2]
          const hi=Math.max(y0,y1,y2)
          if(!keepLowSlab&&hi<=slabCap){
            const e1x=x1-x0,e1y=y1-y0,e1z=z1-z0,e2x=x2-x0,e2y=y2-y0,e2z=z2-z0
            const nx=e1y*e2z-e1z*e2y,ny=e1z*e2x-e1x*e2z,nz=e1x*e2y-e1y*e2x,len=Math.hypot(nx,ny,nz)
            if(len>1e-6&&ny/len>=.7)lowSlabs.push(i0,i1,i2)
            continue
          }
          filtered.push(i0,i1,i2)
        }
        const solidDesc=filtered.length?weldedIndexed(vertices,filtered):null
        if(solidDesc){const collider=add(solidDesc,'landmark');sources.set(collider.handle,`${entry.id}/${parent.name}/${node.name}`);colliders.push(collider)}
        const slabDesc=lowSlabs.length?weldedIndexed(vertices,lowSlabs):null
        if(slabDesc)colliders.push(add(slabDesc,'sidewalk'))
      })
      landmarks.set(root,colliders);changed=true
    }
    for(const [root,colliders] of landmarks)if(!nearLandmarks.has(root)){colliders.forEach(remove);landmarks.delete(root);changed=true}
    for(const [tree,collider] of trunks)if(Math.hypot(east-tree.x,south-tree.z)>48){remove(collider);trunks.delete(tree);changed=true}
    const inRange=(tile:Tile)=>Math.hypot(Math.max(0,Math.abs(east-tile.x-128)-128),Math.max(0,Math.abs(south-tile.z-128)-128))<=collisionRadius
    for(const [tile,region] of regions){
      if(inRange(tile))continue
      region.colliders.forEach(remove);regions.delete(tile);changed=true
    }
    for(const tile of stream.grid.near(east,south,collisionRadius+128)){
      const near=inRange(tile)
      const data=stream.loaded.get(tile), region=regions.get(tile)
      const trees=stream.forest.loaded.get(tile)
      if(trees&&Math.max(Math.abs(east-tile.x-128),Math.abs(south-tile.z-128))<168)for(const tree of trees){
        if(tree.kind!==5&&!trunks.has(tree)&&Math.hypot(east-tree.x,south-tree.z)<40){trunks.set(tree,add(R.ColliderDesc.cylinder(1.8,.42*tree.scale).setTranslation(tree.x,tree.y+1.8,tree.z),'tree'));changed=true}}
      if(region&&region.fine!==!!data){region.colliders.forEach(remove);regions.delete(tile);changed=true}
      if(!near||regions.has(tile))continue
      const spacing=manifest.overview.step,stride=width/spacing+1,start=(tile.z-top)/spacing*stride+(tile.x-left)/spacing
      const colliders:R.Collider[]=[]
      if(data?.tunnel){
        for(const [mesh,kind] of [[data.groundMesh,'ground'],[data.tunnel.fringe,'ground'],[data.tunnel.floor,'road'],[data.tunnel.portal,'rail'],[data.tunnel.interior,'rail']] as const){
          const geometry=mesh.geometry,positions=geometry.getAttribute('position');if(!positions.count)continue
          const indices=geometry.index?Array.from(geometry.index.array):Array.from({length:positions.count},(_,index)=>index)
          const desc=weldedIndexed(Float32Array.from(positions.array),indices)
          if(desc)colliders.push(add(desc.setTranslation(tile.x,0,tile.z),kind))
        }
      }else{
        const ground=data?fineField(data):field(256/spacing,(col,row)=>overview[start+row*stride+col]/10)
        colliders.push(add(ground.setTranslation(tile.x+128,0,tile.z+128),data?'ground':'overview'))
      }
      const rings=data?.rings??[]
      if(data){const {sidewalk,road,banks}=data.streets
        const swDesc=sidewalk.length?weldedSurface(sidewalk,null,data,.65,.38,1.4,2.4):null
        if(swDesc)colliders.push(add(swDesc.setTranslation(tile.x,0,tile.z),'sidewalk'))
        const filteredRoad=filterBridgeOverRoad(road,data.deck)
        const rdDesc=filteredRoad.length?weldedSurface(filteredRoad,null,data,.65,.8,1.8,4):null
        if(rdDesc){const collider=add(rdDesc.setTranslation(tile.x,0,tile.z),'road');sources.set(collider.handle,tile.file);colliders.push(collider)}
        for(const [ax,az,bx,bz,top,bottom,endTop=top] of banks){const angle=-Math.atan2(bz-az,bx-ax),height=((top+endTop)/2-bottom)/10+1.25
          colliders.push(add(R.ColliderDesc.cuboid(Math.hypot(bx-ax,bz-az)/20+.03,height/2,.09).setRotation({x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)}).setTranslation(tile.x+(ax+bx)/20,bottom/10+height/2,tile.z+(az+bz)/20),'rail'))}}
      if(rings.length)colliders.push(add(houses(rings).setTranslation(tile.x,0,tile.z),'building'))
      if(data?.deck.length){
        // Keep the rendered slab thickness on the collider. Rapier feature IDs
        // on a trimesh ray hit need not index the original GL04 triangles.
        const indices:[number[],number[]]=[[],[]]
        for(let face=0;face<data.deck.length/9;face++){
          indices[data.thin.has(face)?1:0].push(face*3,face*3+1,face*3+2)
        }
        for(const [thin,faces] of indices.entries()){
          if(!faces.length)continue
          const desc=weldedSurface(data.deck,faces,data,.80,1.2,2.8,5)
          if(!desc)continue
          const collider=add(desc.setTranslation(tile.x,0,tile.z),'deck')
          colliders.push(collider)
          if(thin)thinDecks.add(collider.handle)
        }
      }
      regions.set(tile,{colliders,rings,fine:!!data});changed=true
    }
    for(const [peak,collider] of mountains)if(!peaks.colliders.includes(peak)){remove(collider);mountains.delete(peak);changed=true}
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
        const meshes:THREE.Mesh[]=[]
        model.traverse(node=>{if(node instanceof THREE.Mesh)meshes.push(node)})
        const collision=meshes.filter(node=>{
          let parent:THREE.Object3D|null=node
          while(parent&&parent!==model){if(/^collision/i.test(parent.name))return true;parent=parent.parent}
          return /^collision/i.test(node.name)
        })
        for(const node of (collision.length?collision:meshes)){
          const pos=node.geometry.getAttribute('position'),verts=new Float32Array(pos.count*3)
          for(let i=0;i<pos.count;i++)pt.fromBufferAttribute(pos,i).applyMatrix4(node.matrixWorld).toArray(verts,i*3)
          const idx=node.geometry.index?Uint32Array.from(node.geometry.index.array):Uint32Array.from({length:pos.count},(_,i)=>i)
          list.push(add(R.ColliderDesc.trimesh(verts,idx),'peak'))
        }
        modelMountains.set(model,list);changed=true
      }
    }
    if(changed)world.step()
  }
  const tiles=new Map(manifest.chunks.map(tile=>[`${tile.x},${tile.z}`,tile]))
  const tileAt=(east:number,south:number)=>tiles.get(`${Math.floor(east/256)*256},${Math.floor(south/256)*256}`)
  const surfaceRay=new R.Ray({x:0,y:0,z:0},down)
  const upRay=new R.Ray({x:0,y:0,z:0},up)
  const segmentRay=new R.Ray({x:0,y:0,z:0},{x:1,y:0,z:0})
  const hullBoxes=new Map<string,R.Cuboid>()
  const deckFilter=(coll:R.Collider)=>{const k=kinds.get(coll.handle);return k==='deck'||k==='deckThin'}
  const spanFilter=(coll:R.Collider)=>{const k=kinds.get(coll.handle);return k==='landmark'||k==='peak'}
  const wallFilter=(coll:R.Collider)=>{const k=kinds.get(coll.handle);return k==='landmark'||k==='peak'||k==='building'}
  const hullFilter=(coll:R.Collider)=>{const k=kinds.get(coll.handle);return k==='landmark'||k==='peak'||k==='rail'||k==='building'}
  const carWallFilter=(coll:R.Collider)=>{const k=kinds.get(coll.handle);return k==='building'||k==='rail'||k==='peak'||k==='tree'}
  const bikeWallFilter=(coll:R.Collider)=>{const k=kinds.get(coll.handle);return k==='landmark'||k==='peak'||k==='rail'||k==='building'||k==='tree'}
  const landmarkFilter=(coll:R.Collider)=>kinds.get(coll.handle)==='landmark'
  const walkableFilter=(coll:R.Collider)=>{const k=kinds.get(coll.handle);return k==='deck'||k==='deckThin'||k==='sidewalk'||k==='road'||k==='ground'||k==='overview'||k==='landmark'}
  function surface(east:number,south:number,kind:Kind,origin=4000,reach=6000){
    surfaceRay.origin.x=east;surfaceRay.origin.y=origin;surfaceRay.origin.z=south
    const hit=world.castRayAndGetNormal(surfaceRay,reach,false,undefined,undefined,capsule,undefined,kind==='deck'?deckFilter:coll=>kinds.get(coll.handle)===kind)
    const thin=!!hit&&(thinDecks.has(hit.collider.handle)||kinds.get(hit.collider.handle)==='deckThin')
    return hit?{y:origin-hit.timeOfImpact,slope:Math.acos(Math.min(1,Math.abs(hit.normal.y))),thin}:null
  }
  function groundSurface(east:number,south:number,footY:number){
    const origin=footY+.18
    surfaceRay.origin.x=east;surfaceRay.origin.y=origin;surfaceRay.origin.z=south
    const hit=world.castRayAndGetNormal(surfaceRay,.5,false,undefined,undefined,capsule,undefined,walkableFilter)
    if(!hit)return null
    const slope=Math.acos(Math.min(1,Math.abs(hit.normal.y)))
    if(slope>cfg.slope+.18)return null
    return {y:origin-hit.timeOfImpact,slope,kind:kinds.get(hit.collider.handle)!}
  }
  function waterCeiling(east:number,south:number,waterY:number){
    let bottom=Infinity
    if(hasDeck(east,south)){
      upRay.origin.x=east;upRay.origin.y=waterY-.8;upRay.origin.z=south
      const deckHit=world.castRayAndGetNormal(upRay,16,false,undefined,undefined,capsule,undefined,deckFilter)
      if(deckHit){const thick=(thinDecks.has(deckHit.collider.handle)||kinds.get(deckHit.collider.handle)==='deckThin')?.6:look.bridgeDepth
        bottom=Math.min(bottom,waterY-.8+deckHit.timeOfImpact-thick)}
    }
    upRay.origin.x=east;upRay.origin.y=waterY+.15;upRay.origin.z=south
    const spanHit=world.castRayAndGetNormal(upRay,15,false,undefined,undefined,capsule,undefined,spanFilter)
    if(spanHit)bottom=Math.min(bottom,waterY+.15+spanHit.timeOfImpact)
    return bottom
  }
  function waterOverlap(x:number,y:number,z:number,heading:number,halfW:number,halfH:number,halfL:number){
    const key=`${halfW.toFixed(3)},${halfH.toFixed(3)},${halfL.toFixed(3)}`
    let box=hullBoxes.get(key)
    if(!box){box=new R.Cuboid(halfW,halfH,halfL);hullBoxes.set(key,box)}
    const half=heading*.5
    return !!world.intersectionWithShape({x,y,z},{x:0,y:Math.sin(half),z:0,w:Math.cos(half)},box,undefined,undefined,capsule,undefined,hullFilter)
  }
  function raycastObstacle(x:number,y:number,z:number,dx:number,dy:number,dz:number,maxDist:number){
    const len=Math.hypot(dx,dy,dz)
    if(len<1e-5||maxDist<=0)return null
    segmentRay.origin.x=x;segmentRay.origin.y=y;segmentRay.origin.z=z
    segmentRay.dir.x=dx/len;segmentRay.dir.y=dy/len;segmentRay.dir.z=dz/len
    const hit=world.castRayAndGetNormal(segmentRay,maxDist,true,undefined,undefined,capsule,undefined,bikeWallFilter)
    if(!hit)return null
    const kind=kinds.get(hit.collider.handle)
    if(!kind)return null
    return {
      distance:hit.timeOfImpact,
      kind,
      point:[x+segmentRay.dir.x*hit.timeOfImpact,y+segmentRay.dir.y*hit.timeOfImpact,z+segmentRay.dir.z*hit.timeOfImpact] as [number,number,number],
      normal:[hit.normal.x,hit.normal.y,hit.normal.z] as [number,number,number],
    }
  }
  function bikePathBlocked(x0:number,z0:number,x1:number,z1:number,y:number,maxSlope:number){
    const dx=x1-x0,dz=z1-z0,len=Math.hypot(dx,dz)
    if(len<1e-3)return '' as const
    const hit=raycastObstacle(x0,y,z0,dx,0,dz,len)
    if(!hit||hit.normal[1]>=Math.cos(maxSlope))return '' as const
    return hit.kind==='building'?'building' as const:'collision' as const
  }
  function pathBlocked(x0:number,z0:number,x1:number,z1:number,y:number){
    const dx=x1-x0,dz=z1-z0,len=Math.hypot(dx,dz)
    if(len<1e-3)return false
    segmentRay.origin.x=x0;segmentRay.origin.y=y;segmentRay.origin.z=z0
    segmentRay.dir.x=dx/len;segmentRay.dir.y=0;segmentRay.dir.z=dz/len
    return !!world.castRay(segmentRay,len,true,undefined,undefined,capsule,undefined,wallFilter)
  }
  function freeCapsule(x:number,y:number,z:number){
    return !world.intersectionWithShape({x,y,z},identity,shape,undefined,undefined,capsule)
  }
  function wet(east:number,south:number){const tile=tileAt(east,south),data=tile&&stream.loaded.get(tile);if(!tile||!data)return true
    const at=Math.round((south-tile.z)/4)*65+Math.round((east-tile.x)/4)
    return data.water[at]!==-32768&&data.water[at]-data.terrain[at]>5
  }
  const solidLandmarks=(manifest.landmarks??[]).flatMap(entry=>(entry.solid??[]).map(([bottom,top,loop])=>{
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity
    for(const [lx,lz] of loop){if(lx<minX)minX=lx;if(lx>maxX)maxX=lx;if(lz<minZ)minZ=lz;if(lz>maxZ)maxZ=lz}
    return {bottom,top,loop,minX,maxX,minZ,maxZ}
  }))
  function insideHouse(east:number,south:number,y?:number){const tile=tileAt(east,south);if(!tile)return false
    const px=(east-tile.x)*100,pz=(south-tile.z)*100
    const inRing=regions.get(tile)?.rings.some(ring=>{
      const [bottom,top,loops]=ring
      if(y===undefined && ring[9])return false
      if(y!==undefined&&(y<bottom/10||y>top/10))return false
      let inside=false
      for(const loop of loops)for(let at=0,prev=loop.length-1;at<loop.length;prev=at++){
        const [ax,az]=loop[at],[bx,bz]=loop[prev];if((az>pz)!==(bz>pz)&&px<(bx-ax)*(pz-az)/(bz-az)+ax)inside=!inside
      }return inside})??false
    if(inRing)return true
    for(const solid of solidLandmarks){
      if(east<solid.minX||east>solid.maxX||south<solid.minZ||south>solid.maxZ)continue
      if(y!==undefined&&(y<solid.bottom||y>solid.top))continue
      let inside=false
      const loop=solid.loop
      for(let at=0,prev=loop.length-1;at<loop.length;prev=at++){
        const [ax,az]=loop[at],[bx,bz]=loop[prev];if((az>south)!==(bz>south)&&east<(bx-ax)*(south-az)/(bz-az)+ax)inside=!inside
      }
      if(inside)return true
    }
    return false
  }
  function withinBounds(x:number,z:number){
    return inRegion(manifest,x,z)
  }
  function findWalkableSpawn(east:number,south:number,override=false){
    for(const {dx,dz} of override?[candidates[0]]:candidates){const x=east+dx,z=south+dz,tile=tileAt(x,z)
      if(!withinBounds(x,z)||!tile||!stream.loaded.has(tile)||insideHouse(x,z))continue
      const deck=surface(x,z,'deck'),support=deck??surface(x,z,'sidewalk')??surface(x,z,'road')??surface(x,z,'ground');if(!support||support.slope>cfg.slope||(!deck&&wet(x,z)))continue
      const peak=surface(x,z,'peak');if(peak&&peak.y>support.y+.05)continue
      const tread=surface(x,z,'landmark',support.y+cfg.step+.02,cfg.step+.04)
      const floor=tread&&tread.slope<=cfg.slope?Math.max(tread.y,support.y):support.y
      const y=floor+cfg.height/2+.055
      if(world.intersectionWithShape({x,y,z},identity,shape,undefined,undefined,capsule))continue
      return {x,y,z,rule:(dx||dz?'search-':'')+(deck?'bridge':'land')}
    }return null
  }
  // IDOK-234 复位：玩家卡进墙 / 掉进水里时，找最近的一块「平地」。
  // 不要原地（≥2 m，否则卡在死角里按了也没反应）；铺装路面 / 人行道 / 桥面优先（开阔、连通），
  // 草地、土坡只在近得多时才选（加 PAVED_BONUS 米的距离惩罚）；坡度 ≤ FLAT，找不到再放宽到能站的坡度。
  const FLAT=12*Math.PI/180, PAVED_BONUS=10
  function findFlatGround(east:number,south:number){
    type Spot={x:number,y:number,z:number,rule:string,score:number}
    let best:Spot|null=null,steep:Spot|null=null
    for(const {dx,dz} of unstuckCandidates){const d=Math.hypot(dx,dz);if(d<2)continue
      if(best&&d>=best.score)break
      const x=east+dx,z=south+dz,tile=tileAt(x,z)
      if(!withinBounds(x,z)||!tile||!stream.loaded.has(tile)||insideHouse(x,z))continue
      const deck=surface(x,z,'deck'),walk=deck??surface(x,z,'sidewalk'),paved=walk??surface(x,z,'road'),support=paved??surface(x,z,'ground')
      if(!support||support.slope>cfg.slope||(!deck&&wet(x,z)))continue
      const peak=surface(x,z,'peak');if(peak&&peak.y>support.y+.05)continue
      const tread=surface(x,z,'landmark',support.y+cfg.step+.02,cfg.step+.04)
      const floor=tread&&tread.slope<=cfg.slope?Math.max(tread.y,support.y):support.y
      const y=floor+cfg.height/2+.055
      if(world.intersectionWithShape({x,y,z},identity,shape,undefined,undefined,capsule))continue
      const spot={x,y,z,rule:'unstuck-'+(deck?'bridge':walk?'sidewalk':paved?'road':'ground'),score:d+(paved?0:PAVED_BONUS)}
      if(support.slope>FLAT){if(!steep||spot.score<steep.score)steep=spot;continue}
      if(!best||spot.score<best.score)best=spot
    }
    return best??steep
  }
  function hasDeck(east:number,south:number){const tile=tileAt(east,south);return !!(tile&&stream.loaded.get(tile)?.deck.length)}
  function overlaps(kind:Kind){return !!world.intersectionWithShape(body.translation(),identity,shape,undefined,undefined,capsule,undefined,kind==='deck'?deckFilter:coll=>kinds.get(coll.handle)===kind)}
  function clear(){for(const region of regions.values())region.colliders.forEach(remove);regions.clear();mountains.forEach(remove);mountains.clear();modelMountains.forEach(list=>list.forEach(remove));modelMountains.clear();trunks.forEach(remove);trunks.clear();landmarks.forEach(colliders=>colliders.forEach(remove));landmarks.clear()}
  function findLocalDismount(cx:number,cz:number,heading:number,bikeY:number){
    return probeLocalDismount({world,capsule,shape,kinds,stream,tileAt,surface,wet,insideHouse},cx,cz,heading,bikeY)
  }
  function findLocalMount(px:number,py:number,pz:number,bx:number,by:number,bz:number){
    return probeLocalMount({world,capsule,shape,kinds,stream,tileAt,surface,wet,insideHouse},px,py,pz,bx,by,bz)
  }
  function findCarDismount(cx:number,cz:number,heading:number,carY:number){
    return probeCarDismount({world,capsule,shape,kinds,stream,tileAt,surface,wet,insideHouse},cx,cz,heading,carY)
  }
  function findCarMount(px:number,py:number,pz:number,cx:number,cy:number,cz:number){
    return probeCarMount({world,capsule,shape,kinds,stream,tileAt,surface,wet,insideHouse},px,py,pz,cx,cy,cz)
  }
  function carOverlap(x:number,footY:number,z:number,heading:number,dirSign:-1|0|1=0){
    const fx=-Math.sin(heading),fz=-Math.cos(heading),rx=Math.cos(heading),rz=-Math.sin(heading)
    const halfL=dirSign===0?2.12:1.62,shift=dirSign*.52
    const key=`car:${halfL.toFixed(2)}`
    let box=hullBoxes.get(key)
    if(!box){box=new R.Cuboid(.86,.48,halfL);hullBoxes.set(key,box)}
    const half=heading*.5
    if(world.intersectionWithShape({x:x+fx*shift,y:footY+.82,z:z+fz*shift},{x:0,y:Math.sin(half),z:0,w:Math.cos(half)},box,undefined,undefined,capsule,undefined,carWallFilter))return true
    const dirs:[number,number,number][]=[]
    if(dirSign>=0)dirs.push([fx,fz,2.18],[fx*2.14-rx*.84,fz*2.14-rz*.84,1],[fx*2.14+rx*.84,fz*2.14+rz*.84,1])
    if(dirSign<=0)dirs.push([-fx,-fz,2.18],[-fx*2.14-rx*.84,-fz*2.14-rz*.84,1],[-fx*2.14+rx*.84,-fz*2.14+rz*.84,1])
    for(const oy of [.65,1.15]){
      segmentRay.origin.x=x;segmentRay.origin.y=footY+oy;segmentRay.origin.z=z
      for(const [dx,dz,scale] of dirs){
        const len=scale===1?Math.hypot(dx,dz):scale
        segmentRay.dir.x=dx/(scale===1?len:1);segmentRay.dir.y=0;segmentRay.dir.z=dz/(scale===1?len:1)
        if(world.castRay(segmentRay,len,true,undefined,undefined,capsule,undefined,landmarkFilter))return true
      }
    }
    return false
  }
  function isBlockedAt(x:number,y:number,z:number){
    return !!world.intersectionWithShape({x,y,z},identity,shape,undefined,undefined,capsule,undefined,coll=>{
      const k=kinds.get(coll.handle)
      return k==='building'||k==='rail'||k==='peak'||k==='tree'||k==='landmark'
    })
  }
  return {world,body,capsule,controller,kinds,sources,sync,clear,overlaps,tileAt,hasDeck,surface,groundSurface,waterCeiling,waterOverlap,carOverlap,raycastObstacle,bikePathBlocked,pathBlocked,freeCapsule,wet,insideHouse,withinBounds,findWalkableSpawn,findFlatGround,findLocalDismount,findLocalMount,findCarDismount,findCarMount,isBlockedAt}
}
