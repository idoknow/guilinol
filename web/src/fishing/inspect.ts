import * as THREE from 'three'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js'
import {inventory} from './inventory'
import {species} from './config'
import {buildFish,looks} from './fish-model'
import './fishing.css'

const intro:Record<string,string>={
  high:'稀有渔获。轻转查看鳍形与斑纹，背包里可随时出售。',
  legendary:'典藏渔获。整片水域难得一见，值得多看两眼。',
}

/** 检视：高级 / 传说渔获打开可旋转、缩放的 3D 展示；常见鱼只返回资料。 */
export async function inspect(id:string){
  const save=inventory(),item=save.bag.find(row=>row.id===id),row=species.find(row=>row.id===(item?.speciesId??id))
  if(!row||!save.collected.includes(row.id))return null
  const info={species:row,catch:item}
  if(!['high','legendary'].includes(row.grade))return info
  const dialog=document.createElement('dialog');dialog.className=`fishing-inspect grade-${row.grade}`
  const look=looks[row.id]
  dialog.innerHTML=`<div class="fi-stage"></div><div class="fi-side">
    <p class="fi-no">${row.number}</p><h2>${row.name}</h2>
    <p class="fi-tags"><b class="fi-rarity">${row.rarity}</b><span>${row.size}</span><span>${row.methods.join(' · ')}</span></p>
    <dl>${item?`<dt>重量</dt><dd>${item.weight} kg</dd><dt>出售</dt><dd>¥${item.price}</dd>`:''}<dt>参考体长</dt><dd>${Math.round((look?.len??.5)*100)} cm</dd></dl>
    <p class="fi-intro">${intro[row.grade]}</p>
    <button type="button" class="fi-close">关闭</button></div>`
  document.body.append(dialog)
  const stage=dialog.querySelector<HTMLElement>('.fi-stage')!
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.outputColorSpace=THREE.SRGBColorSpace
  renderer.setPixelRatio(Math.min(2,devicePixelRatio));stage.append(renderer.domElement)
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(30,1,.01,20),fish=buildFish(row.id)
  scene.add(fish,new THREE.HemisphereLight(0xfff6e6,0x2a3a36,2));const key=new THREE.DirectionalLight(0xffffff,2);key.position.set(1,2,2.5);scene.add(key)
  const rim=new THREE.DirectionalLight(0x9fe0d0,1.2);rim.position.set(-2,.5,-2);scene.add(rim)
  const box=new THREE.Box3().setFromObject(fish);fish.position.sub(box.getCenter(new THREE.Vector3()))
  camera.position.set(.35,.12,1.9);const controls=new OrbitControls(camera,renderer.domElement)
  controls.enablePan=false;controls.minDistance=.7;controls.maxDistance=3.2;controls.enableDamping=true;controls.autoRotate=true;controls.autoRotateSpeed=1.2
  controls.addEventListener('start',()=>{controls.autoRotate=false})
  const fit=()=>{const w=stage.clientWidth||300,h=stage.clientHeight||300;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
  const observer=new ResizeObserver(fit);observer.observe(stage);fit()
  dialog.querySelector('.fi-close')!.addEventListener('click',()=>dialog.close())
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()})
  dialog.showModal()
  renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera)})
  dialog.addEventListener('close',()=>{renderer.setAnimationLoop(null);observer.disconnect();controls.dispose();renderer.dispose();renderer.forceContextLoss();dialog.remove()},{once:true})
  return info
}
