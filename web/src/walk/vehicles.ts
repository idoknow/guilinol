import * as T from 'three'
import type {Stream} from '../stream'
import {fetchAsset} from '../world'
import {createFreeBoats,type MooringSlot} from './boat'
import type {createPhysics} from './physics'
import {createCarControl, type CarDynamicTelemetry, type CarStepControl} from './car'
import type {CarDriveMode, EbikeHeadlightMode, EbikeTurnSignal} from './config'
import {env as skyEnv} from '../look/time'
import {
  resolveEbikeKind,
  type EbikeTier,
  type EbikeUpgradeMods,
  type EbikeVehicleType,
  type ResolvedEbikeProfile,
} from './tuning'
import {
  createBikeControl,
  type EbikeDynamicTelemetry,
  type EbikeStepControl,
  type RideKind,
} from './ride'
import {vehicleModel} from './vehicle-model'
import {isGlobalHotkeyBlocked} from './input-guard'
import {KICKSTAND_REST_ROLL_RAD} from './ebike-state-coupling'

type Position=[number,number,number]
type Route={kind:string,start:string,end:string,path:Position[]}
type BoardPos={x:number,y:number,z:number,bikeY:number}
type BikeInstanceState={vehicleType:EbikeVehicleType; batteryPct:number; mods:EbikeUpgradeMods|null; parkLocked?:boolean; kickstandDown?:boolean}
const bikeCoordKey=(x:number,z:number)=>`${Math.round(x*10)},${Math.round(z*10)}`
type Physics=Awaited<ReturnType<typeof createPhysics>>
export type FreeDismountTarget={x:number,y:number,z:number,rule:string,heading:number}
export interface VehiclesEnv {
  sim: Physics
  stream: Stream
  landFree: (spot:FreeDismountTarget)=>boolean
}
interface Data {bikes:[number,number,number,number,number][];sharedBikes?:[number,number,number,number,number][];bicycles?:[number,number,number,number,number][];cars?:[number,number,number,number,number][];docks:Record<string,Position>;routes:Route[];grid:number[];mask:string;motorGrid?:number[];motorMask?:string}
export async function vehicles(scene:T.Scene,file:string,land:(x:number,z:number,bikeHeading?:number,bikeY?:number,kind?:'car')=>boolean,board?:(bx:number,by:number,bz:number,kind?:'car')=>BoardPos|null,env?:VehiclesEnv){
  const buffer=await fetchAsset(file), data:Data=JSON.parse(await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text())
  const mask=atob(data.mask),[left,top,width,height,step]=data.grid,group=new T.Group();scene.add(group)
  const mMask=data.motorMask?atob(data.motorMask):mask,[mLeft,mTop,mWidth,mHeight,mStep]=data.motorGrid??data.grid
  const cells=new Map<string,T.Group>(),visibleCells=new Set<T.Group>(),cellSize=128
  const bikeStates=new WeakMap<T.Object3D,BikeInstanceState>()
  const bikeCoordStates=new Map<string,BikeInstanceState>()
  const makeVehicleMesh=vehicleModel as (kind:string,paint?:number,options?:{shared?:boolean})=>T.Mesh
  function store(mesh:T.Mesh){const key=`${Math.floor(mesh.position.x/cellSize)},${Math.floor(mesh.position.z/cellSize)}`
    let cell=cells.get(key);if(!cell){cell=new T.Group();cells.set(key,cell)}cell.add(mesh)}
  function addBike(x:number,y:number,z:number,angle:number,paint:number,explicitType?:EbikeVehicleType){
    const vehicleType=resolveEbikeKind(paint,explicitType)
    const isShared=vehicleType==='shared'
    const mesh=makeVehicleMesh('bike',paint,isShared?{shared:true}:undefined)
    mesh.position.set(x,y,z);mesh.rotation.y=angle
    mesh.userData.paint=paint
    mesh.userData.shared=isShared
    mesh.userData.vehicleType=vehicleType
    mesh.userData.ebikeTier=vehicleType
    mesh.userData.battery=100
    const coordKey=bikeCoordKey(x,z)
    mesh.userData.coordKey=coordKey
    const state:BikeInstanceState={vehicleType,batteryPct:100,mods:null}
    bikeStates.set(mesh,state)
    bikeCoordStates.set(coordKey,state)
    store(mesh)
  }
  for(const [x,y,z,angle,paint] of data.bikes)addBike(x,y,z,angle,paint)
  for(const [x,y,z,angle,paint] of data.sharedBikes??[])addBike(x,y,z,angle,paint,'shared')
  for(const [x,y,z,angle,paint] of data.bicycles??[]){const mesh=vehicleModel('bicycle',paint);mesh.position.set(x,y,z);mesh.rotation.y=angle;store(mesh)}
  for(const [x,y,z,angle,paint] of data.cars??[]){const mesh=vehicleModel('car',paint);mesh.position.set(x,y,z);mesh.rotation.y=angle;store(mesh)}
  const vessels=data.routes.map(route=>{const pink=route.kind==='boat'&&[route.start,route.end].includes('桂湖');const mesh=vehicleModel(route.kind,pink?1:0);mesh.position.fromArray(route.path[0]);group.add(mesh);return mesh})
  const piers=new Map<string,T.Mesh>(),pierShape=new T.BoxGeometry(1,1,1),pierMaterial=new T.MeshStandardMaterial({color:0x816a50})
  for(const leg of data.routes){if(piers.has(leg.start))continue
    const [x,,z]=data.docks[leg.start],[waterX,waterY,waterZ]=leg.path[0],dx=waterX-x,dz=waterZ-z,length=Math.hypot(dx,dz)
    const mesh=new T.Mesh(pierShape,pierMaterial);mesh.scale.set(1.4,.25,Math.max(1,length-1.4));mesh.rotation.y=Math.atan2(dx,dz)
    mesh.position.set(x+dx*.45,waterY+.24,z+dz*.45);group.add(mesh);piers.set(leg.start,mesh)
  }
  const departures=new Set<string>(),moored=data.routes.map(leg=>{const first=!departures.has(leg.start);departures.add(leg.start);return first})
  const freeBoats=env?createFreeBoats({group,docks:data.docks,routes:data.routes,sim:env.sim,stream:env.stream}):null
  const ringMat=new T.MeshBasicMaterial({color:0xd86b4a,transparent:true,opacity:.45,depthWrite:false,side:T.DoubleSide,fog:false})
  const interactRing=new T.Mesh(new T.RingGeometry(.86,1.08,32).rotateX(-Math.PI/2),ringMat)
  interactRing.renderOrder=4;interactRing.visible=false;group.add(interactRing)
  const button=document.createElement('button');button.className='vehicle-action';button.setAttribute('aria-keyshortcuts','F');button.hidden=true;document.body.append(button)
  const bikeCtrl=createBikeControl(),carCtrl=createCarControl()
  let bike:T.Mesh|null=null,lastBike:T.Mesh|null=null,car:T.Mesh|null=null,lastCar:T.Mesh|null=null,route=-1,nearBike:T.Mesh|null=null,nearRoute=-1,nearRouteDist=Infinity,segment=1,disembark=false,active=false,heading=0
  let nearFree:{slot:MooringSlot|null,distance:number,atBank:boolean}={slot:null,distance:Infinity,atBank:false}
  function syncHud(){
    const preferFree=!!nearFree.slot&&(nearRoute<0||nearFree.distance+1<nearRouteDist)
    const freePrompt=nearFree.slot?(nearFree.slot.kind==='freeRaft'?'划竹筏 · ':'划小船 · ')+nearFree.slot.name:''
    const ridePrompt=nearBike?(nearBike.name==='car'?'开车':nearBike.userData.downed?(nearBike.name==='bicycle'?'扶起单车':'扶起电动车'):(nearBike.name==='bicycle'?'骑单车':'骑电动车')):''
    const label=car?'下车':bike?'下车':freeBoats?.active?'靠岸下船':route>=0?(disembark?'下一站下船':'下站下船'):ridePrompt||(preferFree?freePrompt:nearRoute>=0?'上船 · '+data.routes[nearRoute].start:'')
    document.body.toggleAttribute('data-aboard',!!car||!!bike||route>=0||!!freeBoats?.active)
    if(bike&&bikeCtrl.kind==='bike'){
      document.body.dataset.ebikeTier=bikeCtrl.vehicleType
      document.body.dataset.rideType=bikeCtrl.vehicleType
    }else{
      delete document.body.dataset.ebikeTier
      if(bike?.name!=='bicycle')delete document.body.dataset.rideType
    }
    if(nearBike?.name==='bike')button.dataset.ebikeTier=(nearBike.userData.vehicleType as EbikeVehicleType|undefined)??resolveEbikeKind((nearBike.userData.paint as number|undefined)??0)
    else delete button.dataset.ebikeTier
    button.hidden=!label;if(button.textContent!==label)button.textContent=label
  }
  function saveBikeInstanceState(mesh:T.Mesh, parkOverride?:{parkLocked:boolean;kickstandDown:boolean}){
    if(mesh.name!=='bike')return
    const prev=bikeStates.get(mesh)
    const parkLocked=parkOverride?.parkLocked??prev?.parkLocked??true
    const kickstandDown=parkOverride?.kickstandDown??prev?.kickstandDown??true
    const state:BikeInstanceState={
      vehicleType:bikeCtrl.vehicleType,
      batteryPct:bikeCtrl.batteryPct,
      mods:bikeCtrl.vehicleType==='normal'?(bikeCtrl.mods??prev?.mods??null):null,
      parkLocked,
      kickstandDown,
    }
    bikeStates.set(mesh,state)
    mesh.userData.vehicleType=state.vehicleType
    mesh.userData.ebikeTier=state.vehicleType
    mesh.userData.shared=state.vehicleType==='shared'
    mesh.userData.battery=state.batteryPct
    mesh.userData.parkLocked=parkLocked
    mesh.userData.kickstandDown=kickstandDown
    const oldKey=mesh.userData.coordKey as string|undefined
    const newKey=bikeCoordKey(mesh.position.x,mesh.position.z)
    if(oldKey&&oldKey!==newKey)bikeCoordStates.delete(oldKey)
    mesh.userData.coordKey=newKey
    bikeCoordStates.set(newKey,state)
  }
  function attachMeshToCell(mesh:T.Mesh){
    store(mesh)
    if(active&&mesh.parent&&!visibleCells.has(mesh.parent as T.Group)){
      visibleCells.add(mesh.parent as T.Group)
      group.add(mesh.parent)
    }
  }
  function reset(){if(route>=0)vessels[route].position.fromArray(data.routes[route].path[0]);freeBoats?.reset();if(car){car.rotation.set(carCtrl.pitch,carCtrl.heading,0,'YXZ');attachMeshToCell(car)}if(bike){const isEbike=bikeCtrl.kind==='bike';saveBikeInstanceState(bike,{parkLocked:isEbike,kickstandDown:true});bike.rotation.set(bikeCtrl.pitch,bikeCtrl.heading,isEbike?KICKSTAND_REST_ROLL_RAD:0,'YXZ');attachMeshToCell(bike)}car=null;bike=null;route=-1;nearFree={slot:null,distance:Infinity,atBank:false};disembark=false;segment=1;delete document.body.dataset.ebikeTier;delete document.body.dataset.rideType;bikeCtrl.reset();carCtrl.reset()}
  function dismountDownedBike(x:number,y:number,z:number,yaw:number,roll:number,lift:number){
    if(!bike)return false
    const mesh=bike
    mesh.position.set(x,y+lift,z)
    mesh.rotation.set(0,yaw,roll,'YXZ')
    mesh.visible=true
    mesh.userData.downed=true
    saveBikeInstanceState(mesh,{parkLocked:false,kickstandDown:false})
    attachMeshToCell(mesh)
    bike=null
    delete document.body.dataset.ebikeTier
    delete document.body.dataset.rideType
    bikeCtrl.reset()
    syncHud()
    return true
  }
  function relocateParkedBike(mesh:T.Mesh,x:number,y:number,z:number,yaw:number,roll=0,parkState?:{parkLocked:boolean;kickstandDown:boolean}){
    mesh.position.set(x,y,z)
    mesh.rotation.set(0,yaw,roll,'YXZ')
    mesh.userData.downed=false
    if(mesh.name==='bike'){
      const prev=bikeStates.get(mesh)
      const nextState:BikeInstanceState={
        vehicleType:prev?.vehicleType??resolveEbikeKind((mesh.userData.paint as number|undefined)??0,mesh.userData.vehicleType??mesh.userData.ebikeTier),
        batteryPct:prev?.batteryPct??(mesh.userData.battery as number|undefined)??100,
        mods:prev?.mods??null,
        parkLocked:parkState?.parkLocked??prev?.parkLocked??true,
        kickstandDown:parkState?.kickstandDown??prev?.kickstandDown??true,
      }
      bikeStates.set(mesh,nextState)
      mesh.userData.parkLocked=nextState.parkLocked
      mesh.userData.kickstandDown=nextState.kickstandDown
      const oldKey=mesh.userData.coordKey as string|undefined
      const newKey=bikeCoordKey(x,z)
      if(oldKey&&oldKey!==newKey)bikeCoordStates.delete(oldKey)
      mesh.userData.coordKey=newKey
      bikeCoordStates.set(newKey,nextState)
    }else if(parkState){
      mesh.userData.parkLocked=parkState.parkLocked
      mesh.userData.kickstandDown=parkState.kickstandDown
    }
    attachMeshToCell(mesh)
    syncHud()
  }
  function interact(){if(!active)return
    if(car){if(land(car.position.x,car.position.z,carCtrl.heading,car.position.y,'car'))reset()}
    else if(bike){if(land(bike.position.x,bike.position.z,bikeCtrl.heading,bike.position.y))reset()}
    else if(freeBoats?.active){const spot=freeBoats.dismount(data.docks,s=>!!env?.landFree(s));if(spot){nearFree={slot:null,distance:Infinity,atBank:false};syncHud();return}}
    else if(route>=0)disembark=true
    else if(nearBike?.name==='car'){
      const safePos=board?board(nearBike.position.x,nearBike.position.y,nearBike.position.z,'car'):{x:nearBike.position.x,y:nearBike.position.y,z:nearBike.position.z,bikeY:nearBike.position.y}
      if(!safePos)return
      nearBike.position.set(safePos.x,safePos.bikeY,safePos.z)
      car=lastCar=nearBike;group.add(car);carCtrl.mount(car.rotation.y,car.rotation.x);syncHud()
    }
    else if(nearBike){
      const prevKey=(nearBike.userData.coordKey as string|undefined)??bikeCoordKey(nearBike.position.x,nearBike.position.z)
      const safePos=board?board(nearBike.position.x,nearBike.position.y,nearBike.position.z):{x:nearBike.position.x,y:nearBike.position.y,z:nearBike.position.z,bikeY:nearBike.position.y}
      if(!safePos)return
      nearBike.position.set(safePos.x,safePos.bikeY,safePos.z)
      const rideKind:RideKind=nearBike.name==='bicycle'?'bicycle':'bike'
      const saved=bikeStates.get(nearBike)??bikeCoordStates.get(prevKey)
      const vehicleType=saved?.vehicleType??resolveEbikeKind((nearBike.userData.paint as number|undefined)??0,nearBike.userData.vehicleType??nearBike.userData.ebikeTier)
      const savedBat=saved?.batteryPct??(nearBike.userData.battery as number|undefined)??100
      bike=lastBike=nearBike;group.add(bike)
      bikeCtrl.mount(bike.rotation.y,bike.rotation.x,rideKind,{
        vehicleType,
        batteryPct:savedBat,
        mods:vehicleType==='normal'?(saved?.mods??null):null,
        envHour:skyEnv.hour,
      })
      saveBikeInstanceState(bike,{parkLocked:bikeCtrl.parkLocked,kickstandDown:bikeCtrl.kickstandDown})
      syncHud()
    }
    else if(nearFree.slot&&(nearRoute<0||nearFree.distance+1<nearRouteDist)){freeBoats!.mount(nearFree.slot,nearFree.atBank);syncHud()}
    else if(nearRoute>=0){route=nearRoute;segment=1;disembark=false}
  }
  button.onclick=interact;window.addEventListener('keydown',event=>{if(event.code==='KeyF'&&!event.repeat&&!isGlobalHotkeyBlocked(event.target))interact()})
  function nearby(x:number,z:number,footY?:number){nearBike=null;nearRoute=-1;nearRouteDist=Infinity;let best=4.6
    let bestHint:{x:number;y:number;z:number;dist:number;reach:number;radius:number}|null=null
    const nextCells=new Set<T.Group>()
    for(let col=Math.floor((x-110)/cellSize);col<=Math.floor((x+110)/cellSize);col++)for(let row=Math.floor((z-110)/cellSize);row<=Math.floor((z+110)/cellSize);row++){
      const cell=cells.get(`${col},${row}`);if(!cell)continue;nextCells.add(cell);if(!visibleCells.has(cell)){visibleCells.add(cell);group.add(cell)}
      for(const child of cell.children){
        const mesh=child as T.Mesh,distance=Math.hypot(mesh.position.x-x,mesh.position.z-z),isCar=mesh.name==='car',reach=mesh.userData.downed?4.4:isCar?4.6:4.2
        mesh.visible=distance<110
        const vertOk=footY===undefined||Math.abs(mesh.position.y-footY)<=1.5
        if(distance<reach&&distance<best&&vertOk){nearBike=mesh;best=distance}
        const hintCap=isCar?28:24
        if(distance<hintCap&&vertOk&&(!bestHint||distance<bestHint.dist)){
          bestHint={x:mesh.position.x,y:mesh.position.y,z:mesh.position.z,dist:distance,reach,radius:isCar?2.35:1.15}
        }
      }
    }
    for(const cell of visibleCells)if(!nextCells.has(cell)){group.remove(cell);visibleCells.delete(cell)}
    let nearestDock=9
    data.routes.forEach((leg,index)=>{const [dx,,dz]=data.docks[leg.start],distance=Math.hypot(dx-x,dz-z);vessels[index].visible=route===index||(moored[index]&&distance<200);piers.get(leg.start)!.visible=distance<200
      if(distance<nearestDock){nearRoute=index;nearestDock=distance}})
    nearRouteDist=nearRoute>=0?nearestDock:Infinity
    nearFree=freeBoats?freeBoats.nearby(x,z,footY):{slot:null,distance:Infinity,atBank:false}
    if(freeBoats){
      for(const m of freeBoats.moorings()){
        if(!m.bank)continue
        const dist=Math.hypot(m.bank[0]-x,m.bank[2]-z)
        if(dist<28&&(!bestHint||dist<bestHint.dist)){
          bestHint={x:m.bank[0],y:m.bank[1],z:m.bank[2],dist,reach:5.5,radius:1.45}
        }
      }
    }
    const onFoot=active&&!car&&!bike&&route<0&&!freeBoats?.active
    if(onFoot&&bestHint){
      const inReach=bestHint.dist<bestHint.reach
      const wave=.5+.5*Math.sin(performance.now()*.005)
      interactRing.visible=true
      interactRing.position.set(bestHint.x,bestHint.y+.08,bestHint.z)
      interactRing.scale.setScalar(bestHint.radius*(inReach?1+.05*wave:1.06+.08*wave))
      ringMat.opacity=inReach?.72+.18*wave:.30+.16*wave
    }else{
      interactRing.visible=false
    }
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
  return {nearby,advance,get car(){return car},get bike(){return bike},get rideKind():RideKind|null{return bike?bikeCtrl.kind:null},get vehicleType():EbikeVehicleType|null{return bike&&bikeCtrl.kind==='bike'?bikeCtrl.vehicleType:null},get isShared(){return bike&&bikeCtrl.kind==='bike'?bikeCtrl.isShared:false},get ebikeTier():EbikeTier|null{return bike&&bikeCtrl.kind==='bike'?bikeCtrl.tier:null},get ebikeGear(){return bike?bikeCtrl.gear:2},get ebikeBattery(){return bike&&bikeCtrl.kind==='bike'?bikeCtrl.batteryPct:100},get ebikeTelemetry():EbikeDynamicTelemetry|null{return bike?bikeCtrl.telemetry():null},get carTelemetry():CarDynamicTelemetry|null{return car?carCtrl.telemetry():null},get carVelX(){return carCtrl.velX},get carVelZ(){return carCtrl.velZ},get carRoll(){return carCtrl.roll},get carDynPitch(){return carCtrl.dynPitch},get carDrift(){return carCtrl.driftIntensity},get carHandbrake(){return carCtrl.handbrake},get boat(){return freeBoats?.boat??(route>=0?vessels[route]:null)},get freeBoat(){return freeBoats?.boat??null},get freeKind(){return freeBoats?.boatKind??null},get boatSeatOffset(){return freeBoats?.active?freeBoats.seatOffset:(route>=0&&vessels[route].name==='raft'?-.44:-.18)},get heading(){return car?carCtrl.heading:bike?bikeCtrl.heading:freeBoats?.active?freeBoats.heading:heading},get speed(){return car?carCtrl.speed:bike?bikeCtrl.speed:freeBoats?.active?freeBoats.speed:0},
    get lean(){return bikeCtrl.lean},get pitch(){return car?carCtrl.pitch:bikeCtrl.pitch},get steerInput(){return car?carCtrl.steerInput:bikeCtrl.steerInput},
    get bikePitch(){return lastBike?.rotation.x??0},get bikeY(){return lastBike?.position.y??0},
    get carPitch(){return lastCar?.rotation.x??0},get carY(){return lastCar?.position.y??0},
    show(on:boolean){reset();interactRing.visible=false;document.body.removeAttribute('data-aboard');delete document.body.dataset.ebikeTier;delete document.body.dataset.rideType;delete button.dataset.ebikeTier;active=group.visible=on;button.hidden=true;if(!on){button.textContent='';lastBike=null;lastCar=null}},stop(){carCtrl.stop();bikeCtrl.stop();freeBoats?.stop()},
    dampSpeed(step:number){return bikeCtrl.dampSpeed(step)},
    dampCarSpeed(step:number){return carCtrl.dampSpeed(step)},
    capSpeed(step:number,limit:number){return bikeCtrl.capSpeed(step,limit)},
    setPitch(frontY:number|undefined,backY:number|undefined,dt:number){bikeCtrl.setPitch(frontY,backY,dt)},
    setCarPitch(frontY:number|undefined,backY:number|undefined,dt:number){carCtrl.setPitch(frontY,backY,dt)},
    setCarMode(mode:CarDriveMode){return carCtrl.setMode(mode)},
    setCarModeByIndex(idx:number){return carCtrl.setModeByIndex(idx)},
    shiftCarMode(delta:number){return carCtrl.shiftMode(delta)},
    setCarGtaPhysics(on:boolean){carCtrl.setGtaPhysics(on)},
    consumeCarImpact(){return carCtrl.consumeImpactPulse()},
    setEbikeGear(gear:number){return bike?bikeCtrl.setGear(gear):2},
    shiftEbikeGear(delta:number){return bike?bikeCtrl.shiftGear(delta):2},
    resetEbikeGearOnRecover(){return bike?bikeCtrl.resetGearToCompliant():2},
    setAutoCrash(on:boolean|undefined){bikeCtrl.setAutoCrash(on)},
    setEbikePark(on:boolean,silent=false){return bike?bikeCtrl.setPark(on,silent):false},
    toggleEbikePark(silent=false){return bike?bikeCtrl.togglePark(silent):false},
    setEbikeKickstand(on:boolean,silent=false){return bike?bikeCtrl.setKickstand(on,silent):false},
    toggleEbikeKickstand(silent=false){return bike?bikeCtrl.toggleKickstand(silent):false},
    setEbikeHeadlight(mode:EbikeHeadlightMode,manual=true){return bike?bikeCtrl.setHeadlight(mode,manual):'off'},
    cycleEbikeHeadlight(){return bike?bikeCtrl.cycleHeadlight():'off'},
    setEbikeEnvironmentHour(hour:number){if(bike)bikeCtrl.setEnvironmentHour(hour)},
    setEbikeTurnSignal(dir:EbikeTurnSignal){return bike?bikeCtrl.setTurnSignal(dir):'off'},
    toggleEbikeTurnSignal(dir:Exclude<EbikeTurnSignal,'off'>){return bike?bikeCtrl.toggleTurnSignal(dir):'off'},
    setEbikeHazard(on:boolean){return bike?bikeCtrl.setHazard(on):false},
    toggleEbikeHazard(){return bike?bikeCtrl.toggleHazard():false},
    setEbikeHorn(pressed:boolean){return bike?bikeCtrl.setHorn(pressed):false},
    pulseEbikeHorn(){return bike?bikeCtrl.pulseHorn():0},
    setEbikeCruise(on:boolean,silent=false){return bike?bikeCtrl.setCruise(on,silent):false},
    toggleEbikeCruise(silent=false){return bike?bikeCtrl.toggleCruise(silent):false},
    dismountDownedBike,
    relocateParkedBike,
    setEbikeVehicleType(nextType:EbikeVehicleType){
      if(!bike||bikeCtrl.kind!=='bike')return null
      const profile=bikeCtrl.setVehicleType(nextType)
      saveBikeInstanceState(bike)
      syncHud()
      return profile
    },
    setEbikeUpgrades(mods:EbikeUpgradeMods|null):ResolvedEbikeProfile|null{
      if(!bike||bikeCtrl.kind!=='bike')return null
      const next=bikeCtrl.setUpgrades(mods)
      saveBikeInstanceState(bike)
      return next
    },
    setEbikeBattery(pct:number){
      if(!bike||bikeCtrl.kind!=='bike')return 100
      const next=bikeCtrl.setBattery(pct)
      saveBikeInstanceState(bike)
      return next
    },
    rechargeEbike(pct=100){
      if(!bike||bikeCtrl.kind!=='bike')return 100
      const next=bikeCtrl.setBattery(pct)
      saveBikeInstanceState(bike)
      return next
    },
    resolveMove(ctx:Parameters<typeof bikeCtrl.resolveMove>[0]){return bikeCtrl.resolveMove(ctx)},
    resolveCarMove(ctx:Parameters<typeof carCtrl.resolveMove>[0]){return carCtrl.resolveMove(ctx)},
    steer(forward:number,right:number,dt:number,mounted=true,control?:EbikeStepControl){const spd=bikeCtrl.steer(forward,right,dt,mounted,control);if(bike&&bikeCtrl.kind==='bike')bike.userData.battery=bikeCtrl.batteryPct;return spd},
    steerCar(forward:number,right:number,dt:number,mounted=true,control?:CarStepControl){return carCtrl.steer(forward,right,dt,mounted,control)},
    steerBoat(forward:number,right:number,dt:number){freeBoats?.steer(forward,right,dt)},
    poseBoat(figure:T.Group,forward:number,right:number,dt:number){freeBoats?.pose(figure,forward,right,dt)},
    clearBoatPose(figure:T.Group){freeBoats?.clearPoseJoints(figure)},
    boatClearance(figure:T.Group,skinned?:T.SkinnedMesh){return freeBoats?.clearance(figure,skinned)??null},
    boatProbe(){return freeBoats?.probe()??null},
    freeMoorings(){return freeBoats?.moorings()??[]},
    parked(kind?:RideKind|'car'):Position[]{
      const out:Position[]=[]
      for(const cell of cells.values())for(const child of cell.children)if(!kind||child.name===kind)out.push([child.position.x,child.position.y,child.position.z])
      return out
    },
    parkedBikes(){
      const out:{x:number;y:number;z:number;paint:number;vehicleType:EbikeVehicleType;tier:EbikeTier;batteryPct:number}[]=[]
      for(const cell of cells.values())for(const child of cell.children){
        if(child.name!=='bike')continue
        const paint=(child.userData.paint as number|undefined)??0
        const saved=bikeStates.get(child)??bikeCoordStates.get(bikeCoordKey(child.position.x,child.position.z))
        const vehicleType=saved?.vehicleType??resolveEbikeKind(paint,child.userData.vehicleType??child.userData.ebikeTier)
        out.push({x:child.position.x,y:child.position.y,z:child.position.z,paint,vehicleType,tier:vehicleType,batteryPct:saved?.batteryPct??100})
      }
      return out
    },
    park(pos:T.Vector3){if(car){car.position.copy(pos);car.rotation.set(carCtrl.pitch,carCtrl.heading,carCtrl.roll,'YXZ')}if(bike){bike.position.copy(pos);bike.rotation.set(bikeCtrl.pitch,bikeCtrl.heading,bikeCtrl.lean,'YXZ')}},
    pavement(x:number,z:number){const col=Math.round((x-left)/step),row=Math.round((z-top)/step),index=row*width+col
      return col>=0&&row>=0&&col<width&&row<height&&!!(mask.charCodeAt(index>>3)&(128>>(index&7)))},
    motorPavement(x:number,z:number){const col=Math.round((x-mLeft)/mStep),row=Math.round((z-mTop)/mStep),index=row*mWidth+col
      return col>=0&&row>=0&&col<mWidth&&row<mHeight&&!!(mMask.charCodeAt(index>>3)&(128>>(index&7)))} }
}
