import * as THREE from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {nightLit} from './look/night'
import {fetchAsset} from './world'

type Row = [number,number,number,number,number,number,number,number?]
const silver=0xd0d5d6, tire=0x364046, glass=0x598696, white=0xe2e5e2, teal=0x248e92

function shape(kind:string, far=false){
  const parts:THREE.BufferGeometry[]=[]
  function add(source:THREE.BufferGeometry,color:number,x:number,y:number,z:number){
    const geo=source.index?source.toNonIndexed():source
    geo.deleteAttribute('uv'); geo.translate(x,y,z)
    const tint=new THREE.Color(color), colors=new Float32Array(geo.attributes.position.count*3)
    for(let index=0;index<colors.length;index+=3)tint.toArray(colors,index)
    geo.setAttribute('color',new THREE.BufferAttribute(colors,3));parts.push(geo)
    if(geo!==source)source.dispose()
  }
  function box(color:number,x:number,y:number,z:number,w:number,h:number,d:number){add(new THREE.BoxGeometry(w,h,d),color,x,y,z)}
  function oval(color:number,x:number,y:number,z:number,w:number,h:number,d:number){
    add(new THREE.SphereGeometry(1,far?8:12,far?4:8).scale(w,h,d),color,x,y,z)
  }
  function wing(stations:number[][],color:number){
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(stations.flat(),3))
    geo.setIndex([0,1,2,0,2,3]);geo.computeVertexNormals();add(geo,color,0,0,0)
  }
  if(kind==='airliner'){
    oval(white,0,3.6,0,2,2,17); oval(teal,0,3.4,0,2.02,.3,15.8)
    for(const side of [-1,1]){
      wing([[side,3,4],[side*17,3.9,-5],[side*17,4,-7],[side,3,-3]],silver)
      wing([[side,4,-10],[side*6,4.4,-15],[side*6,4.4,-16],[side,4,-14]],white)
      if(!far){oval(silver,side*6,2,-.4,.95,.95,2.1);oval(tire,side*1.8,.59,-2,.35,.59,.59)
        for(let station=-11;station<=11;station+=1.2)oval(glass,side*1.95,4,station,.13,.19,.24)}
    }
    wing([[0,4,-15],[0,10,-16],[0,10,-14],[0,4,-7]],teal)
    oval(tire,0,.45,11,.36,.45,.5);box(silver,0,1.35,11,.21,1.8,.21)
  }else if(kind.startsWith('bridge')){
    if(kind==='bridgeFixed'||kind==='bridgeMobile'){
      box(silver,0,5.2,0,3.1,2.6,1);box(glass,0,5.55,0,3.13,.55,.93)
      for(const along of [-.3,-.1,.1,.3])box(silver,0,5.55,along,3.14,.62,.018)
    }else if(kind==='bridgePivot'){
      oval(silver,0,5.2,0,2,1.6,2);box(silver,0,2.3,0,.65,3.3,.65)
      for(const side of [-1,1])oval(tire,side*.8,.58,0,.35,.58,.58)
    }else{box(tire,0,5.2,0,3,2.4,1.1)}
  }else if(kind==='mast'){
    box(silver,0,14.7,0,.42,29.4,.42);oval(silver,0,29.4,0,2.4,.25,2.4)
  }else if(kind==='fence'){
    box(silver,0,1.28,-.5,.08,2.56,.018)
    for(const level of [.16,.64,1.12,1.60,2.08,2.48])box(silver,0,level,0,.035,.025,1)
    for(const station of [-.34,-.16,.02,.20,.38])box(silver,0,1.15,station,.025,2.3,.006)
  }else if(kind==='standSign'){
    box(tire,0,1.6,0,1.7,.8,.16);box(silver,0,.6,0,.12,1.2,.12)
  }else if(kind==='windsock'){
    box(silver,0,2.5,0,.12,5,.12);oval(0xdf7543,0,4.8,.9,.4,.35,1.35)
  }else if(['taxiLight','approachLight','edgeLight','papi','beacon','mastLight'].includes(kind)){
    const color=kind==='taxiLight'?0x5284e8:kind==='papi'?0xef5942:white
    oval(color,0,kind==='mastLight'?29:.38,0,kind==='mastLight'?2.4:.36,.22,kind==='mastLight'?2.4:.36)
    if(kind==='approachLight')box(tire,0,.11,0,.12,.22,.12)
  }else{
    const long=kind==='bus'?9:kind==='fuel'?7:kind==='cart'?3:4.2
    box(silver,0,.95,0,2,1,long);box(kind==='cart'?silver:glass,0,1.85,long*.27,1.96,.98,long*.34)
    if(kind==='fuel')oval(white,0,2,-1,1.1,1,2.4)
    if(kind==='stairs')for(let idx=0;idx<7;idx++)box(white,0,1.5+idx*.27,1-idx*.48,1.5,.26,.55)
    if(kind==='bus')box(glass,0,1.92,0,2.02,.76,long*.93)
    for(const side of [-1,1])for(const along of [-.3,.3])oval(tire,side,.43,long*along,.23,.43,.43)
  }
  const merged=mergeGeometries(parts)!;parts.forEach(part=>part.dispose());return merged
}

export async function mountAirport(scene:THREE.Scene,file:string){
  const rows=JSON.parse(new TextDecoder().decode(await fetchAsset(file))) as Record<string,Row[]>
  const root=new THREE.Group(), pose=new THREE.Object3D(), planes:THREE.InstancedMesh[]=[]
  if(rows.mast)rows.mastLight=rows.mast
  const labels:THREE.BufferGeometry[]=[]
  const segments=['abcdef','bc','abdeg','abcdg','bcfg','acdfg','acdefg','abc','abcdefg','abcdfg']
  rows.standSign?.forEach(([east,height,south,yaw],index)=>{
    const digits=String(index+1).padStart(2,'0')
    const bars=[['a',0,.22],['b',.13,.11],['c',.13,-.11],['d',0,-.22],['e',-.13,-.11],['f',-.13,.11],['g',0,0]] as const
    for(const [pos,digit] of [...digits].entries())for(const [name,dx,dy] of bars){
      if(!segments[Number(digit)].includes(name))continue
      const horiz='adg'.includes(name)
      labels.push(new THREE.PlaneGeometry(horiz?.24:.045,horiz?.045:.18)
        .translate((pos-.5)*.44+dx,1.6+dy,.086).rotateY(yaw).translate(east,height,south))
    }
  })
  if(labels.length){
    const geometry=mergeGeometries(labels)!;labels.forEach(part=>part.dispose())
    root.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({name:'airport_stand_digits',color:0xffce4f})))
  }
  for(const [kind,instances] of Object.entries(rows)){
    const lit=['mastLight','taxiLight','edgeLight','approachLight','papi','beacon'].includes(kind)
    const material=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.85,emissive:lit?0x888977:0})
    material.name=kind==='fence'?'airport_fence':kind==='airliner'?'aircraft_livery_teal':`airport_${kind}${lit?'_lit':''}`
    if(lit)nightLit(material)
    for(const far of kind==='airliner'?[false,true]:[false]){
      const mesh=new THREE.InstancedMesh(shape(kind,far),material,instances.length)
      instances.forEach(([x,y,z,yaw,w,h,d,rise],index)=>{
        pose.position.set(x,y,z);pose.rotation.y=yaw;pose.scale.set(w,h,d);pose.updateMatrix()
        if(rise!==undefined)pose.matrix.elements[9]=rise
        mesh.setMatrixAt(index,pose.matrix)
      });mesh.computeBoundingSphere();root.add(mesh)
      if(kind==='airliner')planes.push(mesh)
    }
  }
  scene.add(root)
  return (distance:number)=>{root.visible=distance<4200;if(planes.length){planes[0].visible=distance<1150;planes[1].visible=distance>=1150}}
}
