import * as THREE from 'three'

export function helicopterModel(){
  const root=new THREE.Group(),lod=new THREE.LOD(),detail=new THREE.Group(),material=new THREE.MeshStandardMaterial({color:0x737b80})
  root.add(lod)
  function box(parent:THREE.Object3D,name:string,x:number,y:number,z:number,width:number,height:number,length:number){
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,height,length),material);mesh.name=name;mesh.position.set(x,y,z);parent.add(mesh);return mesh
  }
  function anchor(name:string,x:number,y:number,z:number){const node=new THREE.Group();node.name=name;node.position.set(x,y,z);detail.add(node);return node}
  function shell(target:THREE.Object3D){box(target,'floor',0,.54,0,1.9,.17,3.4);box(target,'roof',0,2.04,0,1.9,.14,3.2);box(target,'tail',0,1.27,-3.2,.28,.36,4.1)}
  shell(detail);box(detail,'nose',0,.98,1.35,1.8,.75,.65)
  for(const side of [-1,1]){
    const label=side<0?'L':'R',door=anchor('door_'+label,side*.96,.65,.62)
    box(door,'panel',0,.32,-.58,.07,.64,1.16);box(detail,'skid_'+label,side*.84,.08,0,.12,.16,3.35)
    box(detail,'step_'+label,side*1.18,.32,-.05,.4,.09,.95)
  }
  anchor('seat_pilot',0,.88,.85)
  for(let index=1;index<=3;index++){
    const east=index===1?-.48:.48,north=index===3?-1.05:-.25
    anchor('seat_pax_'+index,east,.96,north);box(detail,'cushion',east,.83,north,.55,.18,.55)
    for(const side of [-1,1])anchor(`hand_rest_pax_${index}_${side<0?'L':'R'}`,east+.29*side,1.16,north+.1)
  }
  anchor('cam_pax_1',-.48,1.69,-.23);anchor('skid_contact',0,0,0)
  const rotor=anchor('rotor_main',0,2.37,0);box(rotor,'blade',0,0,0,8.8,.04,.14);box(rotor,'blade',0,0,0,.14,.04,8.8)
  const tail=anchor('rotor_tail',.18,1.48,-5.16);box(tail,'blade',0,0,0,.06,1.35,.12)
  const blurMaterial=new THREE.MeshBasicMaterial({color:0x777777,transparent:true,opacity:.16,depthWrite:false,side:THREE.DoubleSide})
  function disk(name:string,radius:number,center:THREE.Vector3,tail=false){const mesh=new THREE.Mesh(new THREE.CircleGeometry(radius,32),blurMaterial);mesh.name=name;mesh.position.copy(center);if(tail)mesh.rotation.y=Math.PI/2;else mesh.rotation.x=-Math.PI/2;detail.add(mesh);return mesh}
  const mainDisk=disk('rotor_blur_main',4.4,rotor.position),tailDisk=disk('rotor_blur_tail',.67,tail.position,true)
  const medium=new THREE.Group(),far=new THREE.Group();shell(medium);box(medium,'rotor',0,2.37,0,8.8,.05,.16);box(far,'silhouette',0,1,-.9,1.7,1.4,4.9)
  lod.addLevel(detail,0);lod.addLevel(medium,60);lod.addLevel(far,250)
  const door=detail.getObjectByName('door_L')!
  return {root,anchor:(name:string)=>detail.getObjectByName(name)!,animate(dt:number,rpm:number,opening:number){door.rotation.y=opening*1.45;rotor.rotation.y+=dt*(2+rpm*37);tail.rotation.x+=dt*(5+rpm*57);mainDisk.visible=tailDisk.visible=rpm>.8;rotor.visible=tail.visible=!mainDisk.visible}}
}
