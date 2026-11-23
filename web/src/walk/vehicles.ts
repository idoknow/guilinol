import * as T from 'three'
import {fetchAsset} from '../world'
import {vehicleModel} from './vehicle-model'
import {createBike, parkedBikes, type BikeInstance, type ParkedRecord} from './qingju-bike'

type Position=[number,number,number]
type Route={kind:string,start:string,end:string,path:Position[]}
interface Data {bikes:[number,number,number,number,number][];docks:Record<string,Position>;routes:Route[];grid:number[];mask:string}
export async function vehicles(scene:T.Scene,file:string,land:(x:number,z:number)=>boolean,renderer?:T.WebGLRenderer,groundAt?:(x:number,z:number)=>number|undefined){
  const buffer=await fetchAsset(file), data:Data=JSON.parse(await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text())
  const mask=atob(data.mask),[left,top,width,height,step]=data.grid,group=new T.Group();scene.add(group)
  const cells=new Map<string,T.Group>(),visibleCells=new Set<T.Group>(),cellSize=128
  function store(unit:T.Object3D){const key=`${Math.floor(unit.position.x/cellSize)},${Math.floor(unit.position.z/cellSize)}`
    let cell=cells.get(key);if(!cell){cell=new T.Group();cells.set(key,cell)}cell.add(unit)}
  // —— 全城 964 个停车点换成「青桂出行」电车：停放的车烘焙成单 draw call 的网格，
  //    只有真正骑上去的那一辆才实例化完整模型（大灯 / 转向 / 轮子动画）。
  // 停车点数据是按旧模型标的：有的停在马路上、有的比路面低一截。
  // 这里两步修正：① XZ 向最近的「人行道/便道」格吸附；② 高度等玩家靠近时用真实地面高度重贴。
  const cell=(x:number,z:number)=>[Math.round((x-left)/step),Math.round((z-top)/step)] as const
  const paved=(col:number,row:number)=>{const index=row*width+col;return col>=0&&row>=0&&col<width&&row<height&&!!(mask.charCodeAt(index>>3)&(128>>(index&7)))}
  const nearestPaved=(x:number,z:number)=>{
    const [c0,r0]=cell(x,z)
    let best:[number,number]|null=null,bestD=1e9
    for(let radius=0;radius<=9;radius++){
      for(let dc=-radius;dc<=radius;dc++)for(let dr=-radius;dr<=radius;dr++){
        if(Math.max(Math.abs(dc),Math.abs(dr))!==radius)continue
        const col=c0+dc,row=r0+dr
        if(!paved(col,row))continue
        const px=left+col*step,pz=top+row*step,d=Math.hypot(px-x,pz-z)
        if(d<bestD){bestD=d;best=[px,pz]}
      }
      if(best)break
    }
    return best
  }
  // 停车点：按 128 m 单元做实例化批（每辆车保留原材质/贴图/「青桂出行」字样），
  // 走近才把对应单元加进场景。
  const parkedAll:ParkedRecord[]=[]
  const cellRecords=new Map<string,Park[]>()
  type Park={record:ParkedRecord}
  for(const [x,y,z,angle,paint] of data.bikes){
    const spot=nearestPaved(x,z)
    const record:ParkedRecord={x:spot?spot[0]:x,y:y+0.02,z:spot?spot[1]:z,angle,paint,slots:[],hidden:false}
    parkedAll.push(record)
    const key=`${Math.floor(record.x/cellSize)},${Math.floor(record.z/cellSize)}`
    const list=cellRecords.get(key)??[]
    list.push({record});cellRecords.set(key,list)
  }
  const cellBatches=new Map<T.Group,T.InstancedMesh[]>()
  function buildCell(key:string){
    let cell=cells.get(key)
    if(cell)return cell
    cell=new T.Group();cells.set(key,cell)
    const list=cellRecords.get(key)??[]
    if(!list.length)return cell
    const built=parkedBikes(list.map(item=>({x:item.record.x,y:item.record.y,z:item.record.z,angle:item.record.angle,paint:item.record.paint})))
    cell.add(built.group)
    // 远距离 LOD：色系合并版（4 组、无贴图），40 m 外替代高细节实例
    const far=parkedBikes(list.map(item=>({x:item.record.x,y:item.record.y,z:item.record.z,angle:item.record.angle,paint:item.record.paint})),{bucketed:true})
    far.group.visible=false
    far.group.name='qingju-bikes-far'
    cell.add(far.group)
    cell.userData.farGroup=far.group
    const anchor=list[0].record
    cell.userData.anchor=anchor
    // 把实例化记录和几何记录对应起来（坐标一致，顺序一致）
    built.records.forEach((instance,i)=>{const target=list[i]?.record;if(target){target.slots=instance.slots;target.hidden=false}})
    cellBatches.set(cell,built.meshes)
    return cell
  }
  /** 让某个停车点暂时消失（骑走时） */
  function setParkedVisible(record:ParkedRecord,visible:boolean){
    if(record.hidden===!visible)return
    record.hidden=!visible
    const m=new T.Matrix4()
    for(const slot of record.slots){
      slot.mesh.getMatrixAt(slot.index,m)
      const scale=visible?1:0
      m.scale(new T.Vector3(scale||1e-6,scale||1e-6,scale||1e-6))
      if(!visible)m.makeScale(1e-6,1e-6,1e-6)
      slot.mesh.setMatrixAt(slot.index,m)
      slot.mesh.instanceMatrix.needsUpdate=true
    }
  }  const vessels=data.routes.map(route=>{const pink=route.kind==='boat'&&[route.start,route.end].includes('桂湖');const mesh=vehicleModel(route.kind,pink?1:0);mesh.position.fromArray(route.path[0]);group.add(mesh);return mesh})
  const piers=new Map<string,T.Mesh>(),pierShape=new T.BoxGeometry(1,1,1),pierMaterial=new T.MeshStandardMaterial({color:0x816a50})
  for(const leg of data.routes){if(piers.has(leg.start))continue
    const [x,,z]=data.docks[leg.start],[waterX,waterY,waterZ]=leg.path[0],dx=waterX-x,dz=waterZ-z,length=Math.hypot(dx,dz)
    const mesh=new T.Mesh(pierShape,pierMaterial);mesh.scale.set(1.4,.25,Math.max(1,length-1.4));mesh.rotation.y=Math.atan2(dx,dz)
    mesh.position.set(x+dx*.45,waterY+.24,z+dz*.45);group.add(mesh);piers.set(leg.start,mesh)
  }
  const departures=new Set<string>(),moored=data.routes.map(leg=>{const first=!departures.has(leg.start);departures.add(leg.start);return first})
  const button=document.createElement('button');button.className='vehicle-action';button.hidden=true;document.body.append(button)
  let bike:T.Object3D|null=null,ridden:BikeInstance|null=null,parkedOf:ParkedRecord|null=null
  /** 摔倒在地的车：留着模型在原地，可以走过去按 F 扶起来 */
  let fallen:Array<{root:T.Object3D;record:ParkedRecord}>=[]
  /** 已经扶正、还立在原地的车（骑走的时候要收掉这个模型，避免和骑行模型重叠） */
  let recovered:T.Object3D[]=[], _unused=0
  let lastX=0,lastZ=0,fallId=0
  let route=-1,nearBike:ParkedRecord|null=null,nearRoute=-1,segment=1,disembark=false,active=false,speed=0,heading=0,lean=0
  let wheelTravel=0,travelled=0
  /** 手机叫来的那辆车（独立模型，不挂在停车格上） */
  let placed:{root:T.Object3D;record:ParkedRecord}|null=null
  /** 把某个停车点挪到新位置（下车时把车留在下车点旁边） */
  function moveParked(record:ParkedRecord,x:number,y:number,z:number,angle:number){
    const m=new T.Matrix4(),q=new T.Quaternion(),s=new T.Vector3(1,1,1),p=new T.Vector3()
    q.setFromAxisAngle(new T.Vector3(0,1,0),angle)
    for(const slot of record.slots){
      p.set(x,y,z)
      m.compose(p,q,s)
      slot.mesh.setMatrixAt(slot.index,m)
      slot.mesh.instanceMatrix.needsUpdate=true
    }
    record.x=x;record.y=y;record.z=z;record.angle=angle
  }
  function releaseBike(){
    if(ridden){
      // 从叫来的车上下车：车留在原地，转成静态模型
      if(placed&&parkedOf===placed.record){
        placed.root=ridden.root
        placed.record.x=placed.root.position.x;placed.record.y=placed.root.position.y;placed.record.z=placed.root.position.z
        placed.record.angle=placed.root.rotation.y
        // 下车后它就是一輛正常的「停在路边」的车：进停车池，这样别人也能看见（联机同步按停车池找）
        if(!parkedAll.includes(placed.record))parkedAll.push(placed.record)
        // mount() 里把它标成 hidden（实例被藏起来、换成独立模型骑走），下车后独立模型就是它的显形，
        // 这里必须把 hidden 改回来，否则联机同步会把它当成「看不见的车」跳过
        placed.record.hidden=false
        ridden=null;parkedOf=null;bike=null;speed=0;lean=0;wheelTravel=0
        nearBike=placed.record
        return
      }
      const where=bike
      if(parkedOf&&where){
        // 车留在下车点侧后方 0.9 m，而不是跳回原来的停车位
        const px=where.position.x+Math.cos(heading)*0.9
        const pz=where.position.z-Math.sin(heading)*0.9
        const ground=groundAt?.(px,pz)
        moveParked(parkedOf,px,(ground??where.position.y)+0.02,pz,where.rotation.y)
        setParkedVisible(parkedOf,true)
        parkedOf=null
      }
      group.remove(ridden.root)
      ridden.root.traverse(object=>{const mesh=object as T.Mesh;if(mesh.isMesh)mesh.geometry.dispose()})
      ridden=null
    }
    if(parkedOf){setParkedVisible(parkedOf,true);parkedOf=null}
    bike=null;speed=0;lean=0;wheelTravel=0
  }
  /** 扶起最近倒地的车：只保留一辆（旧的倒地模型删掉，由停放实例代表这一辆） */
  function recoverNear(x=lastX,z=lastZ){
    const hit=fallen.find(item=>Math.hypot(item.root.position.x-x,item.root.position.z-z)<2.8)
    if(!hit)return false
    // 上一版把倒地模型留在原地、又让停放实例出现 → 同一位置两辆车。
    // 按你的要求：要「刷一辆」就把旧的删干净。
    const px=hit.root.position.x,py=hit.root.position.y,pz=hit.root.position.z,pa=hit.root.rotation.y
    group.remove(hit.root)
    hit.record.x=px;hit.record.y=py;hit.record.z=pz;hit.record.angle=pa;hit.record.hidden=false
    setParkedVisible(hit.record,true)
    if(!parkedAll.includes(hit.record))parkedAll.push(hit.record)
    fallen=fallen.filter(item=>item!==hit)
    nearBike=hit.record
    return true
  }
  function reset(){if(route>=0)vessels[route].position.fromArray(data.routes[route].path[0]);releaseBike();route=-1;disembark=false;segment=1}
  function interact(){if(!active)return
    if(bike){if(land(bike.position.x+Math.cos(heading),bike.position.z-Math.sin(heading))){reset()}}
    else if(route>=0)disembark=true
    else if(nearBike){mount(nearBike)}
    else if(nearRoute>=0){route=nearRoute;segment=1;disembark=false}
  }
  /** 扫到哪辆就把那辆换成完整模型骑走（停放中的实例先隐藏） */
  function mount(target:ParkedRecord){if(!active)return false
    // 骑走扶正过的车：收掉它立在原地的那份模型（几何体属于骑行实例，别 dispose）
    for(const prop of recovered){if(Math.hypot(prop.position.x-target.x,prop.position.z-target.z)<3)group.remove(prop)}
    recovered=recovered.filter(prop=>!!prop.parent)
    if(bike)releaseBike()
    const isPlaced=!!placed&&placed.record===target
    if(isPlaced)group.remove(placed!.root)
    const instance=createBike(target.paint,renderer)
    instance.root.position.set(target.x,target.y,target.z)
    instance.root.rotation.y=target.angle
    instance.setLights(true)
    group.add(instance.root)
    setParkedVisible(target,false)
    parkedOf=target;ridden=instance;bike=instance.root
    // 车头方向 = 模型 +Z 在世界里的方向；游戏行进用 -Z，所以加 π
    heading=target.angle+Math.PI;speed=0;wheelTravel=0;travelled=0
    return true}
  button.onclick=interact;window.addEventListener('keydown',event=>{if(event.code==='KeyF'&&!event.repeat)interact()})
  function nearby(x:number,z:number){lastX=x;lastZ=z;nearBike=null;nearRoute=-1;let best=4.2
    const nextCells=new Set<T.Group>()
    for(let col=Math.floor((x-64)/cellSize);col<=Math.floor((x+64)/cellSize);col++)for(let row=Math.floor((z-64)/cellSize);row<=Math.floor((z+64)/cellSize);row++){
      const key=`${col},${row}`
      if(!cellRecords.has(key))continue
      const cell=buildCell(key);nextCells.add(cell)
      if(!visibleCells.has(cell)){visibleCells.add(cell);group.add(cell)}
      // 距离 LOD：40 m 内用带贴图的高细节实例，之外换成 4 组色系合并版
      const anchor=cell.userData.anchor as {x:number;z:number}|undefined
      const farGroup=cell.userData.farGroup as T.Group|undefined
      if(anchor&&farGroup){
        const far=Math.hypot(anchor.x-x,anchor.z-z)>40
        farGroup.visible=far
        for(const mesh of cell.children)if(mesh!==farGroup)mesh.visible=!far
      }
      // 单元第一次进场景时，用真实地面高度把车贴到路面上
      if(!cell.userData.grounded){
        cell.userData.grounded=true
        for(const {record} of cellRecords.get(key)??[]){
          const ground=groundAt?.(record.x,record.z)
          if(ground!==undefined&&Number.isFinite(ground))record.y=ground+0.02
        }
      }
      for(const {record} of cellRecords.get(key)??[]){
        if(record===parkedOf)continue
        const distance=Math.hypot(record.x-x,record.z-z)
        if(distance<best){nearBike=record;best=distance}
      }
    }
    if(placed&&!bike){const d=Math.hypot(placed.record.x-x,placed.record.z-z);if(d<best){nearBike=placed.record;best=d}}
    for(const cell of visibleCells)if(!nextCells.has(cell)){group.remove(cell);visibleCells.delete(cell)}
    let nearestDock=9
    data.routes.forEach((leg,index)=>{const [dx,,dz]=data.docks[leg.start],distance=Math.hypot(dx-x,dz-z);vessels[index].visible=route===index||(moored[index]&&distance<200);piers.get(leg.start)!.visible=distance<200
      if(distance<nearestDock){nearRoute=index;nearestDock=distance}})
    const label=bike?'下车（F）':route>=0?(disembark?'下一站下船':'下站下船'):nearBike?'扫码骑行（F）':nearRoute>=0?'上船 · '+data.routes[nearRoute].start:''
    document.body.toggleAttribute('data-aboard',!!bike||route>=0);button.hidden=!label;if(button.textContent!==label)button.textContent=label
  }
  let visualSteer=0
  function animate(dt:number,steerInput=0){
    // 车把视觉角：符号跟转弯方向一致（原来是反的），并用阻尼平滑，避免一下打死
    const target=-steerInput*0.55
    visualSteer+=(target-visualSteer)*Math.min(1,dt*9)
    if(ridden)ridden.update(dt,{speed,wheelTravel,steer:visualSteer,lean,riding:true})
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
  return {summon(record:ParkedRecord,x:number,z:number){
      const g=groundAt?.(x,z), y=(g??record.y)+0.02
      // 原停车点的实例所在的格子可能根本没加载，直接移动矩阵是看不见的；
      // 所以这里把原实例藏掉，另建一辆独立模型放到玩家面前。
      setParkedVisible(record,false)
      const root=createBike(record.paint,renderer).root
      root.position.set(x,y,z); root.rotation.y=record.angle
      group.add(root)
      const synthetic:ParkedRecord={...record,x,y,z,slots:[],hidden:false}
      placed={root,record:synthetic}
      nearBike=synthetic
      return synthetic
    },nearby,advance,animate,mount,recoverNear,get nearest(){return nearBike},get bikes(){return parkedAll},get placedBike(){return placed?.record??null},get bike(){return bike},get bikeParts(){return ridden?.parts??null},get wheelTravel(){return wheelTravel},get boat(){return route>=0?vessels[route]:null},get heading(){return heading},get speed(){return speed},get lean(){return lean},get distance(){return travelled},
    /** 车头随坡度俯仰：用前后轮下方的地面高度差算，返回值直接加到 rotation.x（负=抬前轮） */
    slopePitch(x:number,z:number){
      if(!groundAt)return 0
      const half=.66,fx=-Math.sin(heading),fz=-Math.cos(heading)
      const front=groundAt(x+fx*half,z+fz*half),rear=groundAt(x-fx*half,z-fz*half)
      if(front==null||rear==null)return 0
      return -Math.atan2(front-rear,half*2)
    },
    show(on:boolean){reset();document.body.removeAttribute('data-aboard');active=group.visible=on;button.hidden=true},stop(){speed=0},
    /** 摔车用：把人从车上弄下来，车留在原地（不重置人的位置） */
    eject(){releaseBike();nearBike=null},
    /** 摔车：车留在原地侧倒（不进停车池、不销毁几何体，否则车会凭空消失） */
    crashDown(){
      if(!ridden)return false
      const root=ridden.root
      root.rotation.z=1.05
      group.add(root)
      if(parkedOf)setParkedVisible(parkedOf,false)
      // 记下来，之后可以走过去按 F 扶起
      const record=(parkedOf ?? {id:'fallen'+fallId++,brand:0,cigarettes:0,slots:[],hidden:false}) as unknown as ParkedRecord
      record.x=root.position.x;record.y=root.position.y;record.z=root.position.z;record.angle=root.rotation.y
      fallen.push({root,record})
      ridden=null;parkedOf=null;bike=null;speed=0;lean=0;wheelTravel=0;nearBike=null
      return true
    },
    steer(forward:number,right:number,dt:number){const drag=speed>0?-1.6:speed<0?1.6:0;speed=T.MathUtils.clamp(speed+(forward>0?4.2*forward:forward<0?7*forward:drag)*dt,-5/3.6,32/3.6)
      heading-=right*Math.min(1,.5+speed/2)*1.6*dt;lean=T.MathUtils.damp(lean,right*speed*.018,6,dt)
      wheelTravel+=speed*dt;travelled+=speed*dt;return speed},
    park(pos:T.Vector3){if(bike){bike.position.copy(pos);bike.rotation.set(0,heading+Math.PI,0,'YXZ')}},
    pavement(x:number,z:number){const col=Math.round((x-left)/step),row=Math.round((z-top)/step),index=row*width+col
      return col>=0&&row>=0&&col<width&&row<height&&!!(mask.charCodeAt(index>>3)&(128>>(index&7)))} }
}
