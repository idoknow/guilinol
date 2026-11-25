import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js'
import {inventory} from './inventory'
import {species} from './config'

const models=new Map<string,Promise<THREE.Object3D>>()
function model(id:string){
  let pending=models.get(id)
  if(!pending){pending=new GLTFLoader().loadAsync(`./models/fish/${id}.glb`).then(asset=>asset.scene as THREE.Object3D).catch(()=>{
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(.5,12,8),new THREE.MeshNormalMaterial());mesh.scale.set(1.6,.65,.45);return mesh
  });models.set(id,pending)}return pending
}
export async function inspect(id:string){
  const save=inventory(),item=save.bag.find(row=>row.id===id),row=species.find(row=>row.id===(item?.speciesId??id))
  if(!row||!save.collected.includes(row.id))return null
  const info={species:row,catch:item}
  if(!['high','legendary'].includes(row.grade))return info
  const object=(await model(row.id)).clone(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.01,100)
  const dialog=document.createElement('dialog'),close=document.createElement('button'),label=document.createElement('p')
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(300,300);const controls=new OrbitControls(camera,renderer.domElement)
  scene.add(object,new THREE.HemisphereLight(0xffffff,0x888888,2));const bounds=new THREE.Box3().setFromObject(object)
  const center=bounds.getCenter(new THREE.Vector3());object.position.sub(center);camera.position.z=Math.max(1,bounds.getSize(new THREE.Vector3()).length()*1.7);controls.update()
  label.textContent=[row.name,row.rarity,row.size,item&&`${item.weight} kg · ${item.price} 币`].filter(Boolean).join(' · ')
  close.textContent='关闭';close.onclick=()=>dialog.close();dialog.className='fishing-inspect';dialog.append(renderer.domElement,label,close);document.body.append(dialog);dialog.showModal()
  renderer.setAnimationLoop(()=>renderer.render(scene,camera));dialog.addEventListener('close',()=>{renderer.setAnimationLoop(null);controls.dispose();renderer.dispose();dialog.remove()},{once:true});return info
}
