import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'
import {sharedKtx2Loader} from '../web/src/look/tiles.ts'
import {detail} from '../web/src/world.ts'
import {createPhysics} from '../web/src/walk/physics.ts'
import {playerSupport} from '../web/src/walk/support.ts'
import {previewCharacter} from '../web/src/walk/character.ts'
import {randomPasserby} from '../web/src/traffic/crowd.ts'
import {trafficModels,loadCarMeshes} from '../web/src/traffic/models.ts'
import {alignWheels} from '../web/src/traffic/wheel-pose.ts'
import {streetSurfaceMat} from '../web/src/streets.ts'
import {bridgeMaterial} from '../web/src/look/bridge.ts'

function contacts(mesh,kind) {
  const groups=new Map(), positions=mesh.attributes.position, color=mesh.attributes.color
  const expected=new THREE.Color(kind==='person'?mesh.userData.shoeColor:0x1d1f22)
  for(let index=0;index<positions.count;index++){
    if(Math.abs(color.getX(index)-expected.r)>1e-6||Math.abs(color.getY(index)-expected.g)>1e-6||Math.abs(color.getZ(index)-expected.b)>1e-6)continue
    const vertex=new THREE.Vector3().fromBufferAttribute(positions,index)
    if(kind==='car'&&(vertex.x===0||vertex.z===0))continue
    const key=kind==='person'?Math.sign(vertex.x):kind==='scooter'?Math.sign(vertex.z):`${Math.sign(vertex.x)},${Math.sign(vertex.z)}`
    if(!groups.has(key))groups.set(key,[])
    groups.get(key).push(vertex)
  }
  if(groups.size!==(kind==='car'?4:2))throw Error('Missing contact surface: '+kind)
  return [...groups.values()]
}

async function gait(body){
  const look={...randomPasserby(()=>.32),body}, {scene,animations}=await previewCharacter(look)
  scene.scale.set(look.girth*look.height,look.height,look.girth*look.height)
  const mixer=new THREE.AnimationMixer(scene),clip=animations.find(action=>action.name==='walk')
  mixer.clipAction(clip).play()
  const feet=[[],[]]
  scene.traverseVisible(mesh=>{
    if(!mesh.isSkinnedMesh)return
    const {position,skinIndex,skinWeight}=mesh.geometry.attributes
    for(let index=0;index<position.count;index++){
      let channel=0
      for(let other=1;other<4;other++)if(skinWeight.getComponent(index,other)>skinWeight.getComponent(index,channel))channel=other
      const match=/^(foot|ball)_([lr])$/.exec(mesh.skeleton.bones[skinIndex.getComponent(index,channel)].name)
      if(match)feet[Number(match[2]==='r')].push([mesh,index])
    }
  })
  const frames=Array.from({length:96},(_,frame)=>{
    mixer.setTime(frame*clip.duration/96); scene.updateMatrixWorld(true)
    return feet.map(vertices=>vertices.map(([mesh,index])=>mesh.localToWorld(mesh.getVertexPosition(index,new THREE.Vector3()))))
  })
  mixer.setTime(clip.duration*15/96);return {frames,model:scene}
}

function fixtures(bridge){
  const angle=THREE.MathUtils.degToRad(-bridge.rotation), cosine=Math.cos(angle),sine=Math.sin(angle)
  function local(name,along,across,height,heading){return [name,bridge.position[0]+along*cosine-across*sine,bridge.position[2]+along*sine+across*cosine,bridge.position[1]+height,heading-angle]}
  return [local('bridge',0,3,6.26,Math.PI/2),local('west-ramp',-198.73,-65.02,3.6,2.83),local('east-approach',143,3,6,Math.PI/2),
    ['zhongshan',-884.57,-135.29,150,-.357],['jiefang-tile-seam',-512,-80,150,1.32],['zhengyang-junction',-615,-95,150,1.32],
    ['shizijie-crosswalk-way258909993',-859.02,-162.7025,151,1.32]]
}

export async function audit(baseline=false){
  const manifest=await (await fetch('/world/manifest.json')).json(), bridge=manifest.landmarks.find(entry=>entry.id==='jiefang_bridge')
  const renderer=new THREE.WebGLRenderer(), loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(await sharedKtx2Loader(renderer))
  const {scene}=await loader.loadAsync('/'+bridge.file)
  scene.position.fromArray(bridge.position);scene.rotation.y=THREE.MathUtils.degToRad(bridge.rotation);scene.updateMatrixWorld(true)
  const stage=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,2,.02,550),light=new THREE.DirectionalLight(0xffffff,2)
  stage.background=new THREE.Color(0xb7c7d1);stage.add(scene,new THREE.HemisphereLight(0xffffff,0xb9bab0,1.8),light);light.position.set(-6,12,-4)
  scene.traverse(node=>{if(/^collision|^lod[12]/i.test(node.name))node.visible=false});renderer.setSize(640,320)
  const loaded=new Map(),landmarks=new Map([[bridge,scene]])
  for(const entry of manifest.landmarks.filter(entry=>['wangcheng_market','zhengyang','jingjiang','wangcheng_mall'].includes(entry.id))){
    const {scene:root}=await loader.loadAsync('/'+entry.file);root.position.fromArray(entry.position);root.rotation.y=THREE.MathUtils.degToRad(entry.rotation);root.updateMatrixWorld(true)
    root.traverse(node=>{if(/^collision|^lod[12]/i.test(node.name))node.visible=false});landmarks.set(entry,root);stage.add(root)
  }
  const physics=await createPhysics(manifest,{loaded,radius:256,landmarks,forest:{loaded:new Map()},grid:{near:()=>loaded.keys()}},{colliders:[],modelPeaks:[]})
  const supports=playerSupport(physics),models=trafficModels(await loadCarMeshes()),variants=[]
  for(const kind of ['car','scooter','person']){
    const ids=new Set(Array.from({length:1000},(_,index)=>models.variant(kind,index/1000,0).geometry))
    if(kind==='car')ids.add(models.police)
    for(const id of ids)variants.push({kind,name:models.geometries[id].name||`${kind}-${id}`,model:new THREE.Mesh(models.geometries[id],new THREE.MeshStandardMaterial({vertexColors:true})),wheels:models.geometries[id].userData.wheels,frames:[contacts(models.geometries[id],kind)]})
  }
  for(const body of ['m','f'])variants.push({kind:'animated',name:'walk-'+body,...await gait(body)})
  const result=[]
  for(const [site,x,z,ref,yaw] of fixtures(bridge)){
    for(const tile of manifest.chunks){
      if(loaded.has(tile)||x<tile.x-5||x>tile.x+261||z<tile.z-5||z>tile.z+261)continue
      const data=await detail(tile,new AbortController().signal,undefined,manifest.tunnels);loaded.set(tile,data)
      if(data.streets.surface)data.group.add(new THREE.Mesh(data.streets.surface,streetSurfaceMat))
      if(data.batch.bridge)data.group.add(new THREE.Mesh(data.batch.bridge,bridgeMaterial))
      stage.add(data.group)
    }
    physics.sync(x,z)
    for(const {kind,name,frames,wheels,model} of variants){
      const support=kind==='car'?supports.carSupportAt:supports.supportAt
      const ground=(east,south,reference)=>{const hit=support(east,south,reference);if(!hit)throw Error(`No support at ${site}: ${east},${south}`);return hit.y}
      const pose=new THREE.Object3D();pose.position.set(x,ground(x,z,ref),z);pose.rotation.y=yaw+(kind==='animated'?Math.PI:0)
      for(let pass=0;pass<3;pass++)pose.position.y=ground(x,z,pose.position.y)
      if(!baseline&&wheels?.length)alignWheels(pose,wheels,ground,kind==='car')
      pose.updateMatrix()
      const landed=frames[0].map(()=>Infinity),minimum=landed.slice();let insertion=0,suspension=0
      for(const groups of frames){
        const gaps=groups.map((vertices,index)=>{
          let low=null
          for(const vertex of vertices){const transformed=vertex.clone().applyMatrix4(pose.matrix);if(!low||transformed.y<low.y)low=transformed}
          const gap=low.y-ground(low.x,low.z,pose.position.y)
          minimum[index]=Math.min(minimum[index],gap);landed[index]=Math.min(landed[index],Math.abs(gap));return gap
        })
        insertion=Math.max(insertion,-Math.min(...gaps));suspension=Math.max(suspension,kind==='animated'?Math.min(...gaps):Math.max(...gaps))
      }
      if(window.saveContact){
        const distance=kind==='car'?5:kind==='scooter'?2.7:1.9
        stage.add(pose);pose.add(model);camera.position.set(x+Math.cos(yaw)*distance,pose.position.y+.28,z-Math.sin(yaw)*distance)
        camera.lookAt(x,pose.position.y+.49,z);renderer.render(stage,camera);await window.saveContact(site+'_'+name,renderer.domElement.toDataURL());stage.remove(pose)
      }
      result.push({site,name,x,z,y:pose.position.y,insertion,suspension,minima:minimum.join(','),pass:insertion<=.03&&suspension<=.05&&(kind!=='animated'||landed.every(value=>value<=.03))})
    }
  }
  physics.clear();for(const data of loaded.values())data.dispose();renderer.dispose();return result
}
