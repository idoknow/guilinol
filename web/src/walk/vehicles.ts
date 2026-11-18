import * as T from 'three'
import {fetchAsset} from '../world'
import {vehicleModel} from './vehicle-model'

type Position=[number,number,number]
type Route={kind:string,start:string,end:string,path:Position[]}
interface Data {bikes:[number,number,number,number,number][];docks:Record<string,Position>;routes:Route[];grid:number[];mask:string}
export async function vehicles(scene:T.Scene,file:string,land:(x:number,z:number)=>boolean){
  const buffer=await fetchAsset(file), data:Data=JSON.parse(await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text())
  const mask=atob(data.mask),[left,top,width,height,step]=data.grid,group=new T.Group();scene.add(group)
  const cells=new Map<string,T.Group>(),visibleCells=new Set<T.Group>(),cellSize=128
  function store(mesh:T.Mesh){const key=`${Math.floor(mesh.position.x/cellSize)},${Math.floor(mesh.position.z/cellSize)}`
    let cell=cells.get(key);if(!cell){cell=new T.Group();cells.set(key,cell)}cell.add(mesh)}
  for(const [x,y,z,angle,paint] of data.bikes){const mesh=vehicleModel('bike',paint);mesh.position.set(x,y,z);mesh.rotation.y=angle;store(mesh)}
  const vessels=data.routes.map(route=>{const mesh=vehicleModel(route.kind);mesh.position.fromArray(route.path[0]);group.add(mesh);return mesh})
  const piers=new Map<string,T.Mesh>(),pierShape=new T.BoxGeometry(1,1,1),pierMaterial=new T.MeshStandardMaterial({color:0x816a50})
  for(const leg of data.routes){if(piers.has(leg.start))continue
    const [x,,z]=data.docks[leg.start],[waterX,waterY,waterZ]=leg.path[0],dx=waterX-x,dz=waterZ-z,length=Math.hypot(dx,dz)
    const mesh=new T.Mesh(pierShape,pierMaterial);mesh.scale.set(1.4,.25,Math.max(1,length-1.4));mesh.rotation.y=Math.atan2(dx,dz)
    mesh.position.set(x+dx*.45,waterY+.24,z+dz*.45);group.add(mesh);piers.set(leg.start,mesh)
  }
  const departures=new Set<string>(),moored=data.routes.map(leg=>{const first=!departures.has(leg.start);departures.add(leg.start);return first})
  const button=document.createElement('button');button.className='vehicle-action';button.hidden=true;document.body.append(button)
  let bike:T.Mesh|null=null,route=-1,nearBike:T.Mesh|null=null,nearRoute=-1,segment=1,disembark=false,active=false,speed=0,heading=0,lean=0
  function reset(){if(route>=0)vessels[route].position.fromArray(data.routes[route].path[0]);if(bike){bike.rotation.z=0;store(bike)}bike=null;route=-1;disembark=false;segment=1;speed=0;lean=0}
  function interact(){if(!active)return
    if(bike){if(land(bike.position.x+Math.cos(heading),bike.position.z-Math.sin(heading))){bike.rotation.z=0;reset()}}
    else if(route>=0)disembark=true
    else if(nearBike){bike=nearBike;group.add(bike);heading=bike.rotation.y;speed=0}
    else if(nearRoute>=0){route=nearRoute;segment=1;disembark=false}
  }
  button.onclick=interact;window.addEventListener('keydown',event=>{if(event.code==='KeyE'&&!event.repeat)interact()})
  function nearby(x:number,z:number){nearBike=null;nearRoute=-1;let best=4.2
    const nextCells=new Set<T.Group>()
    for(let col=Math.floor((x-110)/cellSize);col<=Math.floor((x+110)/cellSize);col++)for(let row=Math.floor((z-110)/cellSize);row<=Math.floor((z+110)/cellSize);row++){
      const cell=cells.get(`${col},${row}`);if(!cell)continue;nextCells.add(cell);if(!visibleCells.has(cell)){visibleCells.add(cell);group.add(cell)}
      for(const child of cell.children){const mesh=child as T.Mesh,distance=Math.hypot(mesh.position.x-x,mesh.position.z-z);mesh.visible=distance<110;if(distance<best){nearBike=mesh;best=distance}}}
    for(const cell of visibleCells)if(!nextCells.has(cell)){group.remove(cell);visibleCells.delete(cell)}
    let nearestDock=9
    data.routes.forEach((leg,index)=>{const [dx,,dz]=data.docks[leg.start],distance=Math.hypot(dx-x,dz-z);vessels[index].visible=route===index||(moored[index]&&distance<200);piers.get(leg.start)!.visible=distance<200
      if(distance<nearestDock){nearRoute=index;nearestDock=distance}})
    const label=bike?'下车':route>=0?(disembark?'下一站下船':'下站下船'):nearBike?'骑行':nearRoute>=0?'上船 · '+data.routes[nearRoute].start:''
    document.body.toggleAttribute('data-aboard',!!bike||route>=0);button.hidden=!label;if(button.textContent!==label)button.textContent=label
  }
  function advance(dt:number){const leg=data.routes[route],mesh=vessels[route];let distance=2*dt
    while(segment<leg.path.length){const [x,y,z]=leg.path[segment],dx=x-mesh.position.x,dz=z-mesh.position.z,gap=Math.hypot(dx,dz)
      heading=Math.atan2(-dx,-dz);mesh.rotation.y=heading
      if(distance<gap){mesh.position.lerp(new T.Vector3(x,y,z),distance/gap);return}
      mesh.position.set(x,y,z);distance-=gap;segment++
    }
    const [x,,z]=data.docks[leg.end],departures=data.routes.filter(other=>other.start===leg.end&&other.kind===leg.kind)
    const next=data.routes.indexOf(departures.find(other=>other.end!==leg.start)??departures[0])
    if(disembark||next<0){if(land(x,z))reset();return}
    if(next>=0){mesh.position.fromArray(leg.path[0]);route=next;segment=1}
  }
  return {nearby,advance,get bike(){return bike},get boat(){return route>=0?vessels[route]:null},get heading(){return heading},get speed(){return speed},
    show(on:boolean){reset();document.body.removeAttribute('data-aboard');active=group.visible=on;button.hidden=true},stop(){speed=0},
    steer(forward:number,right:number,dt:number){speed=T.MathUtils.clamp(speed+(forward>0?2.6*forward:forward<0?5*forward:-1.2)*dt,0,25/3.6)
      heading-=right*Math.min(1,.5+speed/2)*1.6*dt;lean=T.MathUtils.damp(lean,right*speed*.018,6,dt);return speed},
    park(pos:T.Vector3){if(bike){bike.position.copy(pos);bike.rotation.set(0,heading,lean,'YXZ')}},
    pavement(x:number,z:number){const col=Math.round((x-left)/step),row=Math.round((z-top)/step),index=row*width+col
      return col>=0&&row>=0&&col<width&&row<height&&!!(mask.charCodeAt(index>>3)&(128>>(index&7)))} }
}
