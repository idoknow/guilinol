import * as THREE from 'three'
import {Traffic,type Graph} from './sim'
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
  const graph:Graph=JSON.parse(new TextDecoder().decode(decoded)),sim=new Traffic(graph)
  const timing=performance.getEntriesByName(response.url).at(-1) as PerformanceResourceTiming|undefined
  return {sim,sample:{key,encodedBytes:timing?.encodedBodySize||bytes.byteLength,decodedBytes:decoded.byteLength,downloadMs:downloaded-start,parseAndIndexMs:performance.now()-downloaded}}
}

export async function traffic(scene:THREE.Scene,camera:THREE.Camera,verify:boolean){
  const index=await fetch('/world/roads/cells.json')
  if(!index.ok)throw Error(`traffic cells: ${index.status}`)
  const cells=new Set<string>(await index.json()),object=new THREE.Object3D()
  let sim:Traffic|undefined,key=''
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshLambertMaterial({color:0x999999}),80)
  const frustum=new THREE.Frustum(),projection=new THREE.Matrix4(),point=new THREE.Vector3()
  const visible=(actor:{x:number,y:number,z:number})=>frustum.containsPoint(point.set(actor.x,actor.y+.7,actor.z))
  mesh.userData.loads=[]
  if(verify)mesh.userData.motorIds=[]
  // 'G2 traffic' stays as an invisible box proxy: verify probes (counts, pixel ids) read it.
  // What players see is the BatchedMesh below: slots 0..79 = sim actors.
  // IDOK-153: the traffic-violation / police pursuit mechanic was removed at Rock's request.
  mesh.name='G2 traffic';mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh)
  const models=trafficModels(),SLOTS=80
  const batch=new THREE.BatchedMesh(SLOTS,models.geometries.reduce((sum,g)=>sum+g.attributes.position.count,0),0,trafficMaterial())
  batch.name='G2 traffic visuals';scene.add(batch)
  const geometryIds=models.geometries.map(g=>batch.addGeometry(g))
  const slotGeometry=new Int16Array(SLOTS).fill(-1),slotPaint:(THREE.Color|undefined)[]=[],slotShown=new Uint8Array(SLOTS)
  for(let slot=0;slot<SLOTS;slot++){batch.addInstance(geometryIds[0]);batch.setVisibleAt(slot,false)}
  const variants=new WeakMap<object,Variant>()
  const pose=new THREE.Object3D();pose.rotation.order='YXZ'
  const show=(slot:number,variant:Variant,x:number,y:number,z:number,yaw:number,scale:number,down=false)=>{
    if(slotGeometry[slot]!==variant.geometry){batch.setGeometryIdAt(slot,geometryIds[variant.geometry]);slotGeometry[slot]=variant.geometry}
    if(slotPaint[slot]!==variant.paint){batch.setColorAt(slot,variant.paint);slotPaint[slot]=variant.paint}
    if(!slotShown[slot]){batch.setVisibleAt(slot,true);slotShown[slot]=1}
    pose.position.set(x,y+(down?.16:0),z);pose.rotation.set(down?-Math.PI/2:0,yaw,0);pose.scale.setScalar(Math.max(scale,.001))
    pose.updateMatrix();batch.setMatrixAt(slot,pose.matrix)
  }
  const hide=(from:number,to:number)=>{for(let slot=from;slot<to;slot++)if(slotShown[slot]){batch.setVisibleAt(slot,false);slotShown[slot]=0}}
  let accumulator=0
  return (dt:number,vehicle?:THREE.Vector3,_player?:THREE.Vector3,_solo=false,enabled=true)=>{
    if(!enabled){mesh.count=0;hide(0,SLOTS);return}
    const target=`${Math.floor(camera.position.x/512)}_${Math.floor(camera.position.z/512)}`
    if(target!==key){
      key=target
      if(cells.has(key))void loadGraph(key).then(({sim:next,sample})=>{
        if(key!==target)return
        if(verify){mesh.userData.loads.push(sample);if(mesh.userData.loads.length>64)mesh.userData.loads.shift()}
        if(sim)next.inherit(sim);sim=next
      }).catch(error=>console.warn('Traffic cell unavailable',error))
      else {sim=undefined;mesh.count=0;hide(0,SLOTS)}
    }
    if(!sim)return
    accumulator+=Math.min(dt,.2)
    if(accumulator<.05)return
    camera.updateMatrixWorld()
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))
    while(accumulator>=.05){sim.step(.05,camera.position,vehicle,visible);accumulator-=.05}
    mesh.count=sim.actors.length
    let motors=0,queued=0,redStops=0
    if(verify){mesh.userData.motorIds.length=0;mesh.userData.approaches=[]}
    sim.actors.forEach((actor,index)=>{
      if(actor.kind==='car')object.scale.set(1.75,1.3,4)
      else if(actor.kind==='scooter')object.scale.set(.6,1,1.65)
      else object.scale.set(.5,actor.down>0?.35:1.6,actor.down>0?1.6:.5)
      object.scale.multiplyScalar(actor.scale)
      if(verify&&actor.kind!=='person'&&visible(actor)&&actor.scale>=.99){
        motors++;mesh.userData.motorIds.push(index)
        mesh.userData.approaches.push({index,x:actor.x,z:actor.z,yaw:actor.yaw,speed:actor.speed,
          gap:actor.track.length-actor.dist,green:sim!.green(actor.track)})
        if(actor.speed<.1){queued++;if(actor.track.length-actor.dist<5&&!sim!.green(actor.track))redStops++}
      }
      object.position.set(actor.x,actor.y+object.scale.y/2,actor.z);object.rotation.y=actor.yaw
      object.updateMatrix();mesh.setMatrixAt(index,object.matrix)
      let variant=variants.get(actor)
      if(!variant){variant=models.variant(actor.kind,Math.random(),Math.random());variants.set(actor,variant)}
      show(index,variant,actor.x,actor.y,actor.z,actor.yaw,actor.scale,actor.kind==='person'&&actor.down>0)
    })
    hide(sim.actors.length,SLOTS)
    mesh.instanceMatrix.needsUpdate=true
    if(verify)Object.assign(mesh.userData,{motors,queued,redStops})
  }
}
