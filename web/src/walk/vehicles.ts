import * as T from 'three'
import type {Stream} from '../stream'
import {fetchAsset} from '../world'
import {createFreeBoats,type MooringSlot} from './boat'
import type {createPhysics} from './physics'
import {createBikeControl,type RideKind} from './ride'
import {vehicleModel} from './vehicle-model'

type Position=[number,number,number]
type Route={kind:string,start:string,end:string,path:Position[]}
type BoardPos={x:number,y:number,z:number,bikeY:number}
type Physics=Awaited<ReturnType<typeof createPhysics>>
export type FreeDismountTarget={x:number,y:number,z:number,rule:string,heading:number}
export interface VehiclesEnv {
  sim: Physics
  stream: Stream
  landFree: (spot:FreeDismountTarget)=>boolean
}
interface Data {bikes:[number,number,number,number,number][];bicycles?:[number,number,number,number,number][];docks:Record<string,Position>;routes:Route[];grid:number[];mask:string}
export async function vehicles(scene:T.Scene,file:string,land:(x:number,z:number,bikeHeading?:number,bikeY?:number)=>boolean,board?:(bx:number,by:number,bz:number)=>BoardPos|null,env?:VehiclesEnv){
  const buffer=await fetchAsset(file), data:Data=JSON.parse(await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text())
  const mask=atob(data.mask),[left,top,width,height,step]=data.grid,group=new T.Group();scene.add(group)
  const cells=new Map<string,T.Group>(),visibleCells=new Set<T.Group>(),cellSize=128
  function store(mesh:T.Mesh){const key=`${Math.floor(mesh.position.x/cellSize)},${Math.floor(mesh.position.z/cellSize)}`
    let cell=cells.get(key);if(!cell){cell=new T.Group();cells.set(key,cell)}cell.add(mesh)}
  for(const [x,y,z,angle,paint] of data.bikes){const mesh=vehicleModel('bike',paint);mesh.position.set(x,y,z);mesh.rotation.y=angle;store(mesh)}
  for(const [x,y,z,angle,paint] of data.bicycles??[]){const mesh=vehicleModel('bicycle',paint);mesh.position.set(x,y,z);mesh.rotation.y=angle;store(mesh)}
  const vessels=data.routes.map(route=>{const pink=route.kind==='boat'&&[route.start,route.end].includes('桂湖');const mesh=vehicleModel(route.kind,pink?1:0);mesh.position.fromArray(route.path[0]);group.add(mesh);return mesh})
  const piers=new Map<string,T.Mesh>(),pierShape=new T.BoxGeometry(1,1,1),pierMaterial=new T.MeshStandardMaterial({color:0x816a50})
  for(const leg of data.routes){if(piers.has(leg.start))continue
    const [x,,z]=data.docks[leg.start],[waterX,waterY,waterZ]=leg.path[0],dx=waterX-x,dz=waterZ-z,length=Math.hypot(dx,dz)
    const mesh=new T.Mesh(pierShape,pierMaterial);mesh.scale.set(1.4,.25,Math.max(1,length-1.4));mesh.rotation.y=Math.atan2(dx,dz)
    mesh.position.set(x+dx*.45,waterY+.24,z+dz*.45);group.add(mesh);piers.set(leg.start,mesh)
  }
  const departures=new Set<string>(),moored=data.routes.map(leg=>{const first=!departures.has(leg.start);departures.add(leg.start);return first})
  const freeBoats=env?createFreeBoats({group,docks:data.docks,routes:data.routes,sim:env.sim,stream:env.stream}):null
  const button=document.createElement('button');button.className='vehicle-action';button.hidden=true;document.body.append(button)
  const bikeCtrl=createBikeControl()
  let bike:T.Mesh|null=null,lastBike:T.Mesh|null=null,route=-1,nearBike:T.Mesh|null=null,nearRoute=-1,nearRouteDist=Infinity,segment=1,disembark=false,active=false,heading=0
  let nearFree:{slot:MooringSlot|null,distance:number,atBank:boolean}={slot:null,distance:Infinity,atBank:false}
  function syncHud(){
    const preferFree=!!nearFree.slot&&(nearRoute<0||nearFree.distance+1<nearRouteDist)
    const freePrompt=nearFree.slot?(nearFree.slot.kind==='freeRaft'?'F 划竹筏 · ':'F 划小船 · ')+nearFree.slot.name:''
    const ridePrompt=nearBike?(nearBike.name==='bicycle'?'F 骑单车':'F 骑电动车'):''
    const label=bike?'F 下车':freeBoats?.active?'F 靠岸下船':route>=0?(disembark?'F 下一站下船':'F 下站下船'):ridePrompt||(preferFree?freePrompt:nearRoute>=0?'F 上船 · '+data.routes[nearRoute].start:'')
    document.body.toggleAttribute('data-aboard',!!bike||route>=0||!!freeBoats?.active);button.hidden=!label;if(button.textContent!==label)button.textContent=label
  }
  function reset(){if(route>=0)vessels[route].position.fromArray(data.routes[route].path[0]);freeBoats?.reset();if(bike){bike.rotation.set(bikeCtrl.pitch,bikeCtrl.heading,0,'YXZ');store(bike);if(active&&bike.parent&&!visibleCells.has(bike.parent as T.Group)){visibleCells.add(bike.parent as T.Group);group.add(bike.parent)}}bike=null;route=-1;nearFree={slot:null,distance:Infinity,atBank:false};disembark=false;segment=1;bikeCtrl.reset()}
  function interact(){if(!active)return
    if(bike){if(land(bike.position.x,bike.position.z,bikeCtrl.heading,bike.position.y))reset()}
    else if(freeBoats?.active){const spot=freeBoats.dismount(data.docks,s=>!!env?.landFree(s));if(spot){nearFree={slot:null,distance:Infinity,atBank:false};syncHud();return}}
    else if(route>=0)disembark=true
    else if(nearBike){
      const safePos=board?board(nearBike.position.x,nearBike.position.y,nearBike.position.z):{x:nearBike.position.x,y:nearBike.position.y,z:nearBike.position.z,bikeY:nearBike.position.y}
      if(!safePos)return
      nearBike.position.set(safePos.x,safePos.bikeY,safePos.z)
      const rideKind:RideKind=nearBike.name==='bicycle'?'bicycle':'bike'
      bike=lastBike=nearBike;group.add(bike);bikeCtrl.mount(bike.rotation.y,bike.rotation.x,rideKind)
    }
    else if(nearFree.slot&&(nearRoute<0||nearFree.distance+1<nearRouteDist)){freeBoats!.mount(nearFree.slot,nearFree.atBank);syncHud()}
    else if(nearRoute>=0){route=nearRoute;segment=1;disembark=false}
  }
  button.onclick=interact;window.addEventListener('keydown',event=>{if(event.code==='KeyF'&&!event.repeat&&(event.target as HTMLElement)?.tagName!=='INPUT')interact()})
  function nearby(x:number,z:number,footY?:number){nearBike=null;nearRoute=-1;nearRouteDist=Infinity;let best=4.2
    const nextCells=new Set<T.Group>()
    for(let col=Math.floor((x-110)/cellSize);col<=Math.floor((x+110)/cellSize);col++)for(let row=Math.floor((z-110)/cellSize);row<=Math.floor((z+110)/cellSize);row++){
      const cell=cells.get(`${col},${row}`);if(!cell)continue;nextCells.add(cell);if(!visibleCells.has(cell)){visibleCells.add(cell);group.add(cell)}
      for(const child of cell.children){const mesh=child as T.Mesh,distance=Math.hypot(mesh.position.x-x,mesh.position.z-z);mesh.visible=distance<110;if(distance<best&&(footY===undefined||Math.abs(mesh.position.y-footY)<=1.5)){nearBike=mesh;best=distance}}}
    for(const cell of visibleCells)if(!nextCells.has(cell)){group.remove(cell);visibleCells.delete(cell)}
    let nearestDock=9
    data.routes.forEach((leg,index)=>{const [dx,,dz]=data.docks[leg.start],distance=Math.hypot(dx-x,dz-z);vessels[index].visible=route===index||(moored[index]&&distance<200);piers.get(leg.start)!.visible=distance<200
      if(distance<nearestDock){nearRoute=index;nearestDock=distance}})
    nearRouteDist=nearRoute>=0?nearestDock:Infinity
    nearFree=freeBoats?freeBoats.nearby(x,z,footY):{slot:null,distance:Infinity,atBank:false}
    syncHud()
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
  return {nearby,advance,get bike(){return bike},get rideKind():RideKind|null{return bike?bikeCtrl.kind:null},get boat(){return freeBoats?.boat??(route>=0?vessels[route]:null)},get freeBoat(){return freeBoats?.boat??null},get freeKind(){return freeBoats?.boatKind??null},get boatSeatOffset(){return freeBoats?.active?freeBoats.seatOffset:(route>=0&&vessels[route].name==='raft'?-.44:-.18)},get heading(){return bike?bikeCtrl.heading:freeBoats?.active?freeBoats.heading:heading},get speed(){return bike?bikeCtrl.speed:freeBoats?.active?freeBoats.speed:0},
    get lean(){return bikeCtrl.lean},get pitch(){return bikeCtrl.pitch},get steerInput(){return bikeCtrl.steerInput},
    get bikePitch(){return lastBike?.rotation.x??0},get bikeY(){return lastBike?.position.y??0},
    show(on:boolean){reset();document.body.removeAttribute('data-aboard');active=group.visible=on;button.hidden=true;if(!on){button.textContent='';lastBike=null}},stop(){bikeCtrl.stop();freeBoats?.stop()},
    dampSpeed(step:number){return bikeCtrl.dampSpeed(step)},
    capSpeed(step:number,limit:number){return bikeCtrl.capSpeed(step,limit)},
    setPitch(frontY:number|undefined,backY:number|undefined,dt:number){bikeCtrl.setPitch(frontY,backY,dt)},
    resolveMove(ctx:Parameters<typeof bikeCtrl.resolveMove>[0]){return bikeCtrl.resolveMove(ctx)},
    steer(forward:number,right:number,dt:number,mounted=true){return bikeCtrl.steer(forward,right,dt,mounted)},
    steerBoat(forward:number,right:number,dt:number){freeBoats?.steer(forward,right,dt)},
    poseBoat(figure:T.Group,forward:number,right:number,dt:number){freeBoats?.pose(figure,forward,right,dt)},
    clearBoatPose(figure:T.Group){freeBoats?.clearPoseJoints(figure)},
    boatClearance(figure:T.Group,skinned?:T.SkinnedMesh){return freeBoats?.clearance(figure,skinned)??null},
    boatProbe(){return freeBoats?.probe()??null},
    freeMoorings(){return freeBoats?.moorings()??[]},
    park(pos:T.Vector3){if(bike){bike.position.copy(pos);bike.rotation.set(bikeCtrl.pitch,bikeCtrl.heading,bikeCtrl.lean,'YXZ')}},
    pavement(x:number,z:number){const col=Math.round((x-left)/step),row=Math.round((z-top)/step),index=row*width+col
      return col>=0&&row>=0&&col<width&&row<height&&!!(mask.charCodeAt(index>>3)&(128>>(index&7)))} }
}
