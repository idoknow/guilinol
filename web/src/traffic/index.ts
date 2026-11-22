import * as THREE from 'three'
import {Traffic,type Graph} from './sim'

async function loadGraph(key:string){
  const response=await fetch(`/world/roads/${key}.json.gz`)
  if(!response.ok||!response.body)throw Error(`traffic graph: ${response.status}`)
  const bytes=await response.arrayBuffer()
  const signature=new Uint8Array(bytes,0,2)
  const body=signature[0]===31&&signature[1]===139?new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')):bytes
  const graph:Graph=await new Response(body).json()
  return new Traffic(graph)
}

export async function traffic(scene:THREE.Scene){
  const index=await fetch('/world/roads/cells.json')
  if(!index.ok)throw Error(`traffic cells: ${index.status}`)
  const cells=new Set<string>(await index.json()),object=new THREE.Object3D()
  let sim:Traffic|undefined,key=''
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshLambertMaterial({color:0x999999}),38)
  mesh.name='G2 traffic';mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh)
  let accumulator=0
  return (dt:number,camera:THREE.Vector3,vehicle?:THREE.Vector3)=>{
    const target=`${Math.floor(camera.x/512)}_${Math.floor(camera.z/512)}`
    if(target!==key){
      key=target
      if(cells.has(key))void loadGraph(key).then(next=>{
        if(key!==target)return
        if(sim)next.inherit(sim);sim=next
      }).catch(error=>console.warn('Traffic cell unavailable',error))
      else {sim=undefined;mesh.count=0}
    }
    if(!sim)return
    accumulator+=Math.min(dt,.2)
    if(accumulator<.05)return
    while(accumulator>=.05){sim.step(.05,camera,vehicle);accumulator-=.05}
    mesh.count=sim.actors.length
    sim.actors.forEach((actor,index)=>{
      if(actor.kind==='car')object.scale.set(1.75,1.3,4)
      else if(actor.kind==='scooter')object.scale.set(.6,1,1.65)
      else object.scale.set(.5,actor.down>0?.35:1.6,actor.down>0?1.6:.5)
      object.position.set(actor.x,actor.y+object.scale.y/2,actor.z);object.rotation.y=actor.yaw
      object.updateMatrix();mesh.setMatrixAt(index,object.matrix)
    })
    mesh.instanceMatrix.needsUpdate=true
  }
}
