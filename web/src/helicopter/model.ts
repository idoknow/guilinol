import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'

export function helicopterModel(){
  const root=new THREE.Group(),loader=new GLTFLoader(),levels=[0,1,2].map(()=>new THREE.Group()),loading=new Set<number>(),ready=new Set<number>()
  const anchors=new Map<string,THREE.Object3D>(),actions=new Map<string,THREE.AnimationAction>()
  const nodes=levels.map(()=>new Map<string,THREE.Object3D>())
  let mixer:THREE.AnimationMixer|undefined,action:THREE.AnimationAction|undefined
  root.add(...levels)
  function load(index:number){
    if(loading.has(index))return;loading.add(index)
    void loader.loadAsync(`/models/helicopter_tour${index?'_lod'+index:''}.glb`).then(asset=>{
      levels[index].add(asset.scene);ready.add(index)
      asset.scene.traverse(node=>{if(node.name){nodes[index].set(node.name,node);if(index===0)anchors.set(node.name,node)}if(node.name.startsWith('rotor_blur'))node.visible=false})
      if(index===0){mixer=new THREE.AnimationMixer(asset.scene);for(const clip of asset.animations)actions.set(clip.name,mixer.clipAction(clip))}
    }).catch(error=>console.warn('Helicopter LOD unavailable',index,error))
  }
  return {root,get loaded(){return ready.has(0)},anchor:(name:string)=>anchors.get(name)??root,
    animate(dt:number,rpm:number,opening:number,distance:number,pilot:string){
      const wanted=distance>250?2:distance>60?1:0;load(wanted)
      let visible=wanted;if(!ready.has(visible))visible=[...ready].sort((left,right)=>Math.abs(left-wanted)-Math.abs(right-wanted))[0]??wanted
      levels.forEach((level,index)=>{level.visible=index===visible});if(!ready.has(visible))return
      const parts=nodes[visible],door=parts.get('door_L');if(door)door.rotation.y=-1.38*opening
      for(const part of ['main','tail']){const rotor=parts.get('rotor_'+part),blur=parts.get('rotor_blur_'+part);if(rotor){rotor.rotation[part==='main'?'y':'x']+=dt*(2+rpm*38);rotor.visible=rpm<.8}if(blur)blur.visible=rpm>=.8}
      if(visible===0){const next=actions.get('pilot_'+pilot);if(next&&next!==action){action?.fadeOut(.25);next.reset().fadeIn(.25).play();action=next}mixer?.update(dt)}
    }}
}
