import * as THREE from 'three'
import {hotbarSlot,selectSlot} from '../ui/hotbar'
import {FishingEngine} from './engine'
import {nearby,tabs,waters,type Method} from './config'
import {buy,certification,collect,consume,inventory,journal,removeCatch,shop} from './inventory'
import {bait} from './bait'

type Host={canUse:()=>boolean,position:()=>{x:number,z:number},face:(angle:number)=>void,
  teleport:(x:number,z:number,angle:number)=>Promise<boolean>,hand:()=>THREE.Object3D|undefined,scene:THREE.Scene,camera:THREE.PerspectiveCamera}
const textFocus=()=>document.activeElement?.matches('input,textarea,select,[contenteditable=true]')
const terminal=['equip','land','snap','escape','miss','junk']
export function createFishing(host:Host,verify:boolean){
  const panel=document.createElement('section');panel.className='fishing-panel';panel.hidden=true
  panel.style.cssText='position:fixed;top:12%;right:1%;z-index:8;max-width:min(24rem,90vw);max-height:55vh;overflow:auto'
  panel.innerHTML='<output></output> <button data-method>路亚</button><select aria-label="鱼饵"></select><button data-cast>抛竿</button><button data-strike>提竿</button><button data-hold="-1">左</button><button data-hold="1">右</button><button data-hold="reel">收线</button><button data-menu>渔利</button><button data-close>收竿</button><div class="fishing-menu" hidden></div>'
  document.body.append(panel);const output=panel.querySelector('output')!,menu=panel.querySelector<HTMLElement>('.fishing-menu')!,baitSelect=panel.querySelector('select')!
  const signal=(name:string,detail:unknown)=>window.dispatchEvent(new CustomEvent('fishing:'+name,{detail}))
  const engine=new FishingEngine((name,detail)=>{signal(name,detail);if(name==='state')output.textContent=String(detail)},collect)
  const rod=new THREE.Group(),tip=new THREE.Object3D();rod.name='fishing-grip';tip.name='fishing-tip';tip.position.set(0,1.5,-.7)
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.008,.018,tip.position.length(),6),new THREE.MeshStandardMaterial());shaft.position.copy(tip.position).multiplyScalar(.5);shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),tip.position.clone().normalize());rod.add(tip,shaft)
  const coords=new THREE.BufferAttribute(new Float32Array(6),3),geometry=new THREE.BufferGeometry().setAttribute('position',coords)
  const line=new THREE.Line(geometry,new THREE.LineBasicMaterial());line.name='fishing-line';line.frustumCulled=false;line.visible=false;host.scene.add(line)
  const float=new THREE.Mesh(new THREE.SphereGeometry(.085,8,6),new THREE.MeshNormalMaterial());float.name='fishing-float';float.visible=false;host.scene.add(float)
  const tipWorld=new THREE.Vector3();let method:Method='路亚',origin:ReturnType<typeof nearby>,previous:'hand'|'camera'='hand'
  function options(){baitSelect.replaceChildren(...bait.filter(row=>(row.kind.startsWith('台钓')?'台钓':'路亚')===method).map(row=>new Option(`${row.name} (${inventory().bait[row.id]??0})`,row.id)));panel.querySelector('[data-method]')!.textContent=method}
  function spot(){const pos=host.position();return nearby(pos.x,pos.z)}
  function active(){return hotbarSlot()==='fishing'&&host.canUse()}
  function toggle(){if(hotbarSlot()==='fishing'){selectSlot(previous);return}if(!host.canUse()||!spot())return
    previous=hotbarSlot()==='camera'?'camera':'hand';selectSlot('fishing');host.hand()?.add(rod);panel.hidden=false;engine.equip();options()}
  window.addEventListener('fishing:cancel',()=>{rod.removeFromParent();float.visible=line.visible=false;panel.hidden=menu.hidden=true;origin=undefined;engine.cancel()})
  function cast(){const water=spot();if(!active()||!water||!terminal.includes(engine.stage))return false
    const id=baitSelect.value;if(!consume(id)){output.textContent='饵料不足';return false}
    const save=inventory(),tier=(prefix:string)=>Math.max(...save.owned.filter(value=>value.startsWith(prefix)).map(value=>Number(value.slice(prefix.length))))
    host.face(water.spot.yaw);origin=water;signal('camera',{target:water.spot.target,zoom:method==='台钓'})
    const result=engine.cast({water,method,bait:id,line:tier('line'),rod:tier(method==='台钓'?'pole':'lure'),float:save.owned.includes('float'),drag:save.owned.includes('drag')});options();baitSelect.value=id;return result}
  const inspect=(id:string)=>import('./inspect').then(module=>module.inspect(id))
  function renderMenu(){menu.replaceChildren();const button=(text:string,action:()=>void)=>{const node=document.createElement('button');node.textContent=text;node.onclick=action;menu.append(node);return node}
    const list=(tab:string)=>{renderMenu();for(const item of shop(tab)){button(`${item.name} ${item.price}币${item.locked?' · '+item.unlock:''}`,()=>{output.textContent=buy(item.id).code;options();list(tab)}).disabled=item.locked}}
    for(const tab of tabs)button(tab,()=>list(tab));button('背包',()=>{renderMenu();const ids=inventory().bag.map(item=>item.id);const act=(selected:string[],sell:boolean)=>{output.textContent=removeCatch(selected,sell).code;renderMenu()};button('批量出售',()=>act(ids,true));button('批量丢弃',()=>act(ids,false));for(const item of inventory().bag){button(`${item.name} · ${item.weight} kg`,()=>void inspect(item.id));button(`卖 ${item.price}`,()=>act([item.id],true));button('丢弃',()=>act([item.id],false))}})
    button('图鉴',()=>{renderMenu();const book=journal();output.textContent=`${book.collected}/${book.total}`;for(const row of book.rows)button(row.number+' '+row.name,()=>void inspect(row.id))})}
  panel.addEventListener('click',event=>{const el=event.target as HTMLElement
    if(el.hasAttribute('data-close'))selectSlot(previous);if(el.hasAttribute('data-cast'))cast();if(el.hasAttribute('data-strike'))engine.strike()
    if(el.hasAttribute('data-method')&&terminal.includes(engine.stage)){method=method==='路亚'?'台钓':'路亚';options()}
    if(el.hasAttribute('data-menu')){menu.hidden=!menu.hidden;renderMenu()}})
  panel.addEventListener('pointerdown',event=>{const el=event.target as HTMLElement,action=el.dataset.hold;if(!action)return
    event.preventDefault();el.setPointerCapture(event.pointerId);if(action==='reel')engine.reel=true;else engine.pull=Number(action)})
  panel.addEventListener('lostpointercapture',event=>{if((event.target as HTMLElement).dataset.hold==='reel')engine.reel=false;else engine.pull=0})
  const mouse=(event:PointerEvent)=>active()&&!textFocus()&&event.pointerType==='mouse'&&(event.target as HTMLElement).tagName==='CANVAS'
  window.addEventListener('pointerdown',event=>{if(event.button===0&&mouse(event)){event.stopImmediatePropagation();event.preventDefault();if(terminal.includes(engine.stage))cast();else if(engine.stage==='bite')engine.strike();else engine.reel=true}},true)
  window.addEventListener('pointermove',event=>{if(mouse(event)&&engine.stage==='fight'&&event.movementX)engine.pull=Math.sign(event.movementX)},true)
  window.addEventListener('pointerup',event=>{if(event.pointerType==='mouse')engine.reel=false})
  const key=(event:KeyboardEvent)=>{if(!active()||textFocus()||!menu.hidden||!['KeyA','KeyD','Space'].includes(event.code))return
    event.stopImmediatePropagation();event.preventDefault();const down=event.type==='keydown';if(event.code==='Space'){if(down&&!event.repeat){if(engine.stage==='bite')engine.strike();else cast()}}else engine.pull=down?(event.code==='KeyA'?-1:1):0}
  window.addEventListener('keydown',key,true);window.addEventListener('keyup',key,true);window.addEventListener('blur',()=>{engine.reel=false;engine.pull=0})
  function tick(dt:number){if(hotbarSlot()!=='fishing')return;if(!active()||!spot()){selectSlot(previous);return}
    engine.tick(dt);line.visible=!!origin&&!terminal.includes(engine.stage);float.visible=line.visible&&method==='台钓'
    if(line.visible&&origin){tip.getWorldPosition(tipWorld);const [x,y,z]=origin.spot.target;coords.setXYZ(0,tipWorld.x,tipWorld.y,tipWorld.z);coords.setXYZ(1,x,y,z);coords.needsUpdate=true
      if(method==='台钓'){float.position.set(x,y+(engine.stage==='bite'?-.1:.07),z);host.camera.position.set((origin.spot.x+x)/2,y+2.2,(origin.spot.z+z)/2);host.camera.lookAt(x,y,z)}}
    if(engine.stage==='fight')output.textContent=`牵引 ${['左','中','右'][engine.direction+1]} · 拉力 ${Math.round(engine.tension*100)}% · 体力 ${Math.round(engine.stamina*100)}%`}
  const teleportToSpot=async(id:string)=>{const water=waters.find(row=>row.id===id);return !!water&&await host.teleport(water.spot.x,water.spot.z,water.spot.yaw)}
  Object.assign(window,{fishing:{waters,journal,profile:certification,inspect,state:()=>({stage:engine.stage,direction:engine.direction,tension:engine.tension,method,spot:spot()?.id,inventory:structuredClone(inventory())}),
    ...(verify?{teleportToSpot,forceBite:()=>engine.bite(true),setSeed:(seed:number)=>engine.setSeed(seed)}:{})}})
  return {toggle,tick,teleportToSpot}
}
