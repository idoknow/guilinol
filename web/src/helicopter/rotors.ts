import {MathUtils, Mesh, Object3D} from 'three'

function layer(node:Object3D){
  const materials=node.getObjectsByProperty('isMesh',true).flatMap(child=>{
    const mesh=child as Mesh
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(material=>material.clone()):mesh.material.clone()
    return [mesh.material].flat().map(material=>({material,opacity:material.opacity,transparent:material.transparent,depthWrite:material.depthWrite}))
  })
  return (weight:number)=>{
    node.visible=weight>.001
    for(const entry of materials){
      entry.material.opacity=entry.opacity*weight
      entry.material.transparent=entry.transparent||weight<1
      entry.material.depthWrite=entry.depthWrite&&weight===1
    }
  }
}

export function rotorVisual(solid:Object3D,disc:Object3D,tail:boolean){
  const blades=layer(solid),blur=layer(disc),axis=tail?'x':'y'
  return (angle:number,rpm:number)=>{
    const fade=MathUtils.smoothstep(rpm,.32,.76)
    solid.rotation[axis]=angle*(tail?4.5:1)
    disc.rotation[axis]=solid.rotation[axis]+Math.PI/(tail?4:8)
    blades(1-fade);blur(fade)
  }
}
