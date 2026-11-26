import {DoubleSide,Material,MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial,Object3D, Quaternion, Vector3} from 'three'

function layer(node:Object3D,isDisc=false){
  const materials=node.getObjectsByProperty('isMesh',true).flatMap(child=>{
    const mesh=child as Mesh
    const clone=(original:Material)=>{
      if(!isDisc||!(original instanceof MeshStandardMaterial))return original.clone()
      const material=new MeshBasicMaterial({name:original.name,color:original.color,map:original.map,opacity:original.opacity,transparent:true,depthWrite:false,side:DoubleSide,forceSinglePass:true})
      material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
        vec4 texel=texture2D(map,vMapUv);
        diffuseColor.rgb*=texel.rgb;
        diffuseColor.a*=smoothstep(0.0,0.04,texel.a)*(0.60+0.38*texel.a);
        #endif`)}
      return material
    }
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(clone):clone(mesh.material)
    if(isDisc){mesh.renderOrder=2;mesh.visible=true}
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
  const blades=layer(solid),blur=layer(disc,true),axis=tail?'x':'y'
  const hinges=solid.children.filter(node=>node.name.includes('_blade_')).map(node=>({node,rest:node.quaternion.clone()})),hingeAxis=new Vector3(0,0,1),offset=new Quaternion()
  return (angle:number,rpm:number,load:number)=>{
    const fade=MathUtils.smoothstep(rpm,.28,.78)
    solid.rotation[axis]=angle*(tail?4.5:1)
    disc.rotation[axis]=solid.rotation[axis]+Math.PI/(tail?4:8)
    for(const [index,hinge] of hinges.entries()){const flap=rpm*rpm*((tail?.015:.065)*load+.022*Math.cos(angle+index*2*Math.PI/hinges.length));hinge.node.quaternion.copy(hinge.rest).multiply(offset.setFromAxisAngle(hingeAxis,flap))}
    blades(1-fade);blur(fade)
  }
}
