import * as THREE from 'three'
import {MAX_ACTORS,MOBILE_ACTORS,Traffic,type Graph} from './sim'
import {curbside,staticSolids,useTrafficSolids,type Solid,contactSamples,sampleContacts} from './contact'
import {trafficModels,trafficMaterial,type Variant} from './models'

async function loadGraph(key:string){
  const start=performance.now()
  const response=await fetch(`/world/roads/${key}.json.gz`)
  if(!response.ok||!response.body)throw Error(`traffic graph: ${response.status}`)
  const bytes=await response.arrayBuffer()
  const downloaded=performance.now()
  const signature=new Uint8Array(bytes,0,2)
  const body=signature[0]===31&&signature[1]===139?new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')):bytes
  const decoded=await new Response(body).arrayBuffer()
  const graph:Graph=JSON.parse(new TextDecoder().decode(decoded)),sim=new Traffic(graph,Math.random,matchMedia('(pointer:coarse)').matches?MOBILE_ACTORS:MAX_ACTORS)
  const timing=performance.getEntriesByName(response.url).at(-1) as PerformanceResourceTiming|undefined
  return {sim,sample:{key,encodedBytes:timing?.encodedBodySize||bytes.byteLength,decodedBytes:decoded.byteLength,downloadMs:downloaded-start,parseAndIndexMs:performance.now()-downloaded}}
}

export async function traffic(scene:THREE.Scene,camera:THREE.Camera,verify:boolean){
  const index=await fetch('/world/roads/cells.json')
  if(!index.ok)throw Error(`traffic cells: ${index.status}`)
  const cells=new Set<string>(await index.json())
  let sim:Traffic|undefined,key=''
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshLambertMaterial({color:0x999999}),MAX_ACTORS)
  const frustum=new THREE.Frustum(),projection=new THREE.Matrix4(),point=new THREE.Vector3()
  const visible=(actor:{x:number,y:number,z:number})=>frustum.containsPoint(point.set(actor.x,actor.y+.7,actor.z))
  mesh.userData.loads=[]
  sampleContacts(verify);mesh.userData.contactMs=contactSamples;mesh.userData.stepMs=[];let sampleIndex=0
  const parts={spawn:[] as number[],grid:[] as number[],motion:[] as number[]};mesh.userData.stepParts=parts
  const profile=verify?(spawn:number,grid:number,motion:number)=>{const index=sampleIndex%256;parts.spawn[index]=spawn;parts.grid[index]=grid;parts.motion[index]=motion}:undefined
  if(verify)mesh.userData.motorIds=[]
  mesh.name='G2 traffic';mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh)
  const parkingIndex:Record<string,number>=await fetch('/world/roads/parking/index.json').then(r=>r.ok?r.json():{}).catch(()=>({}))
  const models=trafficModels(),STATIC=MAX_ACTORS,SLOTS=STATIC+9*Math.max(0,...Object.values(parkingIndex))
  const batch=new THREE.BatchedMesh(SLOTS,models.geometries.reduce((sum,g)=>sum+g.attributes.position.count,0),0,trafficMaterial())
  batch.name='G2 traffic visuals';batch.frustumCulled=false;batch.perObjectFrustumCulled=true;scene.add(batch)
  const geometryIds=models.geometries.map(g=>batch.addGeometry(g))
  const slotGeometry=new Int16Array(SLOTS).fill(-1),slotPaint:(THREE.Color|undefined)[]=[],slotShown=new Uint8Array(SLOTS)
  for(let slot=0;slot<SLOTS;slot++){batch.addInstance(geometryIds[0]);batch.setVisibleAt(slot,false)}
  const variants=new WeakMap<object,Variant>()
  const pose=new THREE.Object3D();pose.rotation.order='YXZ'
  const transforms=new Float64Array(SLOTS*6).fill(NaN)
  const show=(slot:number,variant:Variant,x:number,y:number,z:number,yaw:number,scale:number,down=false)=>{
    if(slotGeometry[slot]!==variant.geometry){batch.setGeometryIdAt(slot,geometryIds[variant.geometry]);slotGeometry[slot]=variant.geometry}
    if(slotPaint[slot]!==variant.paint){batch.setColorAt(slot,variant.paint);slotPaint[slot]=variant.paint}
    if(!slotShown[slot]){batch.setVisibleAt(slot,true);slotShown[slot]=1}
    const offset=slot*6
    if(transforms[offset]===x&&transforms[offset+1]===y&&transforms[offset+2]===z&&transforms[offset+3]===yaw&&transforms[offset+4]===scale&&transforms[offset+5]===Number(down))return
    transforms[offset]=x;transforms[offset+1]=y;transforms[offset+2]=z;transforms[offset+3]=yaw;transforms[offset+4]=scale;transforms[offset+5]=Number(down)
    pose.position.set(x,y+(down?.16:0),z);pose.rotation.set(down?-Math.PI/2:0,yaw,0);pose.scale.setScalar(Math.max(scale,.001))
    pose.updateMatrix();batch.setMatrixAt(slot,pose.matrix)
  }
  const hide=(from:number,to:number)=>{for(let slot=from;slot<to;slot++)if(slotShown[slot]){batch.setVisibleAt(slot,false);slotShown[slot]=0}}
  type Row=[number,number,number,number,number,string]
  let parkKey='',parkCount=0
  const cache=new Map<string,Promise<Row[]>>()
  const updateParking=(east:number,south:number)=>{
    const col=Math.floor(east/256),row=Math.floor(south/256),target=`${col}_${row}`
    if(target===parkKey)return
    parkKey=target
    const needed=new Set<string>()
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
      const cell=`${col+dx}_${row+dz}`;if(parkingIndex[cell])needed.add(cell)
    }
    for(const cell of cache.keys())if(!needed.has(cell))cache.delete(cell)
    for(const cell of needed)if(!cache.has(cell))cache.set(cell,fetch(`/world/roads/parking/${cell}.json.gz`).then(async response=>{
      if(!response.ok)throw Error(`parking ${cell}: ${response.status}`)
      const bytes=await response.arrayBuffer();const signature=new Uint8Array(bytes)
      return new Response(signature[0]===31&&signature[1]===139?new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')):bytes).json()
    }))
    void Promise.all([...needed].map(cell=>cache.get(cell)!)).then(groups=>{
      if(target!==parkKey)return
      curbside.clear();let count=0
      for(const rows of groups)for(const [x,y,z,yaw,seed] of rows){
        const variant=models.variant('parked',(seed%256)/256,(seed>>>8)/256),geometry=models.geometries[variant.geometry]
        if(!geometry.boundingBox)geometry.computeBoundingBox();const {min,max}=geometry.boundingBox!
        curbside.add({x,y,z,yaw,halfWidth:Math.max(-min.x,max.x),halfLength:Math.max(-min.z,max.z),height:max.y})
        show(STATIC+count++,variant,x,y,z,yaw,1)
      }
      hide(STATIC+count,STATIC+parkCount);parkCount=count;mesh.userData.parked=count
    }).catch(error=>{if(target===parkKey){parkKey='';cache.clear()}console.warn('Parking cell unavailable',error)})
  }
  const near=(x:number,z:number,visit:(solid:Solid)=>void)=>{sim?.nearSolids(x,z,visit);staticSolids(x,z,visit)}
  let accumulator=0
  return (dt:number,vehicle?:THREE.Vector3,_player?:THREE.Vector3,_solo=false,enabled=true)=>{
    useTrafficSolids(enabled?near:undefined)
    if(!enabled){mesh.count=0;hide(0,SLOTS);parkKey='';parkCount=0;curbside.clear();return}
    updateParking(camera.position.x,camera.position.z)
    if(verify&&mesh.userData.staticOnly){hide(0,STATIC);mesh.count=0;mesh.userData.allMotors=[];return}
    const target=`${Math.floor(camera.position.x/512)}_${Math.floor(camera.position.z/512)}`
    if(target!==key){
      key=target
      if(cells.has(key))void loadGraph(key).then(({sim:next,sample})=>{
        if(key!==target)return
        if(verify){mesh.userData.loads.push(sample);if(mesh.userData.loads.length>64)mesh.userData.loads.shift()}
        if(sim)next.inherit(sim);sim=next
      }).catch(error=>console.warn('Traffic cell unavailable',error))
      else {sim=undefined;mesh.count=0;hide(0,STATIC)}
    }
    if(!sim)return
    accumulator+=Math.min(dt,.2)
    if(accumulator<.05)return
    camera.updateMatrixWorld()
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))
    while(accumulator>=.05){
      const start=verify?performance.now():0;sim.step(.05,camera.position,vehicle,visible,profile);accumulator-=.05
      if(verify)mesh.userData.stepMs[sampleIndex++%256]=performance.now()-start
    }
    mesh.count=sim.actors.length
    let motors=0,queued=0,redStops=0
    if(verify){mesh.userData.motorIds.length=0;mesh.userData.approaches=[];mesh.userData.allMotors=[]}
    sim.actors.forEach((actor,index)=>{
      if(verify&&actor.kind!=='person'&&actor.scale>=.99)mesh.userData.allMotors.push(index)
      if(verify&&actor.kind!=='person'&&visible(actor)&&actor.scale>=.99){
        motors++;mesh.userData.motorIds.push(index)
        mesh.userData.approaches.push({index,x:actor.x,z:actor.z,yaw:actor.yaw,speed:actor.speed,
          gap:actor.track.length-actor.dist,green:sim!.green(actor.track)})
        if(actor.speed<.1){queued++;if(actor.track.length-actor.dist<5&&!sim!.green(actor.track))redStops++}
      }
      let variant=variants.get(actor)
      if(!variant){variant=models.variant(actor.kind,Math.random(),Math.random());variants.set(actor,variant)
        const geometry=models.geometries[variant.geometry];if(!geometry.boundingBox)geometry.computeBoundingBox()
        const {min,max}=geometry.boundingBox!;actor.halfWidth=Math.max(-min.x,max.x);actor.halfLength=Math.max(-min.z,max.z);actor.height=max.y
      }
      show(index,variant,actor.x,actor.y,actor.z,actor.yaw,actor.scale,actor.kind==='person'&&actor.down>0)
    })
    hide(sim.actors.length,STATIC)
    if(verify)Object.assign(mesh.userData,{motors,queued,redStops})
  }
}
