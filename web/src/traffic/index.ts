import * as THREE from 'three'
import {Traffic,type Graph} from './sim'
import {getState} from '../game/state'
import {onPlayMode} from '../game/play-mode'
import type {Pursuit} from './pursuit'

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
  mesh.name='G2 traffic';mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh)
  let pursuit:Pursuit|undefined,loadingPursuit=false
  const police=new THREE.InstancedMesh(mesh.geometry,mesh.material,5)
  police.name='G4 patrol';police.count=0;police.visible=false;police.frustumCulled=false;scene.add(police)
  onPlayMode(mode=>{if(mode==='tour'){pursuit?.end('tour');police.count=0;police.visible=false}})
  let accumulator=0,pursuitDt=0
  return (dt:number,vehicle?:THREE.Vector3,player?:THREE.Vector3,solo=false,trafficFlag=false)=>{
    mesh.visible=solo||trafficFlag
    if(!mesh.visible)return
    const target=`${Math.floor(camera.position.x/512)}_${Math.floor(camera.position.z/512)}`
    if(target!==key){
      key=target
      if(cells.has(key))void loadGraph(key).then(({sim:next,sample})=>{
        if(key!==target)return
        if(verify){mesh.userData.loads.push(sample);if(mesh.userData.loads.length>64)mesh.userData.loads.shift()}
        if(sim)next.inherit(sim);sim=next
      }).catch(error=>console.warn('Traffic cell unavailable',error))
      else {sim=undefined;mesh.count=0}
    }
    if(solo&&vehicle&&!pursuit&&!loadingPursuit){
      loadingPursuit=true
      void import('./pursuit').then(({Pursuit})=>{pursuit=new Pursuit()}).catch(error=>console.warn('Pursuit unavailable',error))
    }
    if(solo&&player&&pursuit){
      pursuitDt+=Math.min(dt,.2)
      if(pursuitDt>=.05){
        const state=getState()
        pursuit.step(pursuitDt,sim,player,vehicle&&state.mode!=='boat'?state.vehicle?.id:undefined)
        police.count=pursuit.officers.length
        police.visible=police.count>0
        pursuit.officers.forEach((officer,index)=>{
          object.position.set(officer.x,officer.y+.65,officer.z);object.rotation.y=officer.yaw
          object.scale.set(1.75,1.3,4);object.updateMatrix();police.setMatrixAt(index,object.matrix)
        })
        if(police.count)police.instanceMatrix.needsUpdate=true
        pursuitDt=0
      }
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
    })
    mesh.instanceMatrix.needsUpdate=true
    if(verify)Object.assign(mesh.userData,{motors,queued,redStops})
  }
}
