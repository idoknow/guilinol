import * as T from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'

const material=new T.MeshStandardMaterial({vertexColors:true,flatShading:true})
const cache=new Map<string,T.BufferGeometry>()
export function vehicleModel(kind:string,paint=0){
  const key=kind+paint
  if(!cache.has(key)){
    const parts:T.BufferGeometry[]=[]
    function part(shape:T.BufferGeometry,color:number,x:number,y:number,z:number){
      shape.translate(x,y,z);const tint=new T.Color(color),colors=[]
      for(let vertex=0;vertex<shape.attributes.position.count;vertex++)colors.push(tint.r,tint.g,tint.b)
      shape.setAttribute('color',new T.Float32BufferAttribute(colors,3));parts.push(shape)
    }
    function box(width:number,height:number,depth:number,x:number,y:number,z:number,color:number){part(new T.BoxGeometry(width,height,depth),color,x,y,z)}
    if(kind==='bike'){
      const color=[0xf3f1e9,0x99c9de,0xe4afbb,0x383c40][paint]
      for(const z of [-.53,.53])part(new T.CylinderGeometry(.24,.24,.12,10).rotateZ(Math.PI/2),0x303234,0,.24,z)
      box(.38,.24,1,0,.37,0,color);box(.36,.32,.38,0,.58,.3,color);box(.4,.11,.48,0,.8,.27,0x443e3b)
      box(.18,.56,.14,0,.79,-.45,color);box(.68,.065,.09,0,1.04,-.43,0x474b4b)
      for(const side of [-1,1]){box(.025,.19,.025,side*.29,1.14,-.46,0x535858);box(.13,.08,.04,side*.29,1.25,-.46,0xa8b9bf)}
      for(const side of [-1,1]){box(.03,.2,.28,side*.18,.92,-.65,0x858883);box(.38,.2,.025,0,.92,-.65+side*.14,0x858883)}
    }else if(kind==='raft'){
      for(let pole=-3;pole<=3;pole++)part(new T.CylinderGeometry(.1,.12,4.3,8).rotateX(Math.PI/2),0xae905b,pole*.19,.1,0)
      box(1.1,.26,.46,0,.33,0,0x72573e)
    }else{
      box(2.2,.38,5.8,0,.13,0,0xe9e6dd);box(1.95,.12,5.4,0,.37,0,0x95724e)
      box(1.4,.28,.42,0,.58,0,0x72573e)
      for(const side of [-1,1])for(const z of [-1.9,0,1.9])box(.11,1.19,.11,side*.88,1.01,z,0xa54032)
      for(const side of [-1,1])part(new T.BoxGeometry(1.25,.12,4.8).rotateZ(-side*.22),0x61666a,side*.58,1.7,0)
    }
    cache.set(key,mergeGeometries(parts));for(const part of parts)part.dispose()
  }
  const mesh=new T.Mesh(cache.get(key),material);mesh.name=kind;return mesh
}
