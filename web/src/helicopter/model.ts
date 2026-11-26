import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'

const cabinTone=new THREE.Color(0x46504b),cabinLift:Record<string,number>={ink:.55,leather:.5,alloy:.3,piping:.25}

export function helicopterModel(){
  const root=new THREE.Group(),loader=new GLTFLoader(),levels=[0,1,2].map(()=>new THREE.Group()),loading=new Set<number>(),ready=new Set<number>()
  const anchors=new Map<string,THREE.Object3D>(),actions=new Map<string,THREE.AnimationAction>()
  const nodes=levels.map(()=>new Map<string,THREE.Object3D>())
  const upholstery:THREE.Mesh[]=[]
  let mixer:THREE.AnimationMixer|undefined,action:THREE.AnimationAction|undefined
  root.add(...levels)
  function load(index:number){
    if(loading.has(index))return;loading.add(index)
    void loader.loadAsync(`/models/helicopter_tour${index?'_lod'+index:''}.glb`).then(asset=>{
      levels[index].add(asset.scene);ready.add(index)
      if(index===0)asset.scene.traverse(node=>{
        if(node instanceof THREE.Mesh&&['leather','piping'].includes(node.material.name))upholstery.push(node)
        // 座舱处在机身阴影里，深色框架/座椅会糊成死黑：给舱内材质一点自发光托底（设计定稿：IDOK-427）
        if(node instanceof THREE.Mesh&&node.material instanceof THREE.MeshStandardMaterial&&cabinLift[node.material.name]!==undefined&&!node.material.userData.cabinLift){
          const material=node.material;material.userData.cabinLift=true;material.emissive.copy(material.color).lerp(cabinTone,.5);material.emissiveIntensity=cabinLift[material.name]
        }
      })
      asset.scene.traverse(node=>{if(node.name){nodes[index].set(node.name,node);if(index===0)anchors.set(node.name,node)}if(node.name.startsWith('rotor_blur'))node.visible=false})
      if(index===0){mixer=new THREE.AnimationMixer(asset.scene);for(const clip of asset.animations)actions.set(clip.name,mixer.clipAction(clip))}
    }).catch(error=>console.warn('Helicopter LOD unavailable',index,error))
  }
  return {root,get loaded(){return ready.has(0)},anchor:(name:string)=>anchors.get(name)??root,
    animate(dt:number,rpm:number,opening:number,distance:number,pilot:string,exteriorCruise=false){
      const wanted=distance>250?2:distance>60?1:0;load(wanted)
      let visible=wanted;if(!ready.has(visible))visible=[...ready].sort((left,right)=>Math.abs(left-wanted)-Math.abs(right-wanted))[0]??wanted
      levels.forEach((level,index)=>{level.visible=index===visible});if(!ready.has(visible))return
      const parts=nodes[visible],door=parts.get('door_L');if(door)door.rotation.y=-1.38*opening
      if(visible===0)for(const mesh of upholstery)mesh.visible=!exteriorCruise
      for(const part of ['main','tail']){const rotor=parts.get('rotor_'+part),blur=parts.get('rotor_blur_'+part);if(rotor){rotor.rotation[part==='main'?'y':'x']+=dt*(2+rpm*38);rotor.visible=rpm<.8}if(blur)blur.visible=rpm>=.8}
      if(visible===0){const next=actions.get('pilot_'+pilot);if(next&&next!==action){action?.fadeOut(.25);next.reset().fadeIn(.25).play();action=next}mixer?.update(dt)}
    }}
}
