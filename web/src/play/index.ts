import * as THREE from 'three'
import {inlineBusy} from '../ui/loading'
import './play.css'
import {spots, waterDocks, yawToward, type Spot, type WaterDock} from './spots'
import {mapLandmarks, type MapLandmark} from './map-landmarks'
import type {Host} from './host'
import {photoMode} from './photo'
import {mapView} from './map'
import {isGlobalHotkeyBlocked, shouldPhotoYieldKeyPFromDom} from '../walk/input-guard'
import {getPlayMode,soloServices,onPlayMode} from '../game/play-mode'
import {checkForUpdate} from '../ui/update-check'
import {type ShopTriggerDef} from '../game/shops'
import {getState, onState} from '../game/state'
import {mountLandscapeEntry} from '../ui/orientation'
import {mountSettingsEntry,mountViewEntry} from '../ui/settings'
import {bindRackGuard,isRackOpen,mountRackEntry} from '../ui/gear-rack'
import {hotbarSlot,mountHotbar,riding,showHotbar} from '../ui/hotbar'
import {setCameraShown} from '../gear/hand'
import {droneMode} from '../drone'
import {navigation} from './nav'
import {namedChild} from '../scene-named'

const KEY = 'glol.stamps', ARRIVE = 12, REARM = 40, MARK_LAYER = 2
const ease = (t:number)=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2

function sealTexture(text:string, done:boolean) {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = done?'#a9503c':'rgba(244,239,226,.92)'
  g.beginPath(); g.roundRect(14,14,100,100,16); g.fill()
  g.lineWidth = 5; g.strokeStyle = done?'#f4efe2':'#a9503c'; g.beginPath(); g.roundRect(24,24,80,80,9); g.stroke()
  g.fillStyle = done?'#f4efe2':'#a9503c'; g.font = '600 58px "Noto Serif SC","Source Han Serif SC","Songti SC",serif'
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text,64,68)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}

export function play(host:Host) {
  const stamps = new Set<string>(JSON.parse(localStorage.getItem(KEY)??'[]'))
  for(const foundId of getState().spotsFound) stamps.add(foundId)
  const save = ()=>localStorage.setItem(KEY,JSON.stringify([...stamps]))
  host.camera.layers.enable(MARK_LAYER)

  // --- Markers: a seal floating over each stand point + a soft vermilion ring on the ground.
  const ringGeometry = new THREE.RingGeometry(3.2,4.2,48).rotateX(-Math.PI/2)
  const marks = spots.map(spot=>{
    const material = new THREE.SpriteMaterial({map:sealTexture(spot.seal,stamps.has(spot.id)),sizeAttenuation:false,depthTest:false,fog:false,transparent:true})
    const sprite = new THREE.Sprite(material); sprite.renderOrder = 10; sprite.layers.set(MARK_LAYER)
    const ring = new THREE.Mesh(ringGeometry,new THREE.MeshBasicMaterial({color:0xd0694c,transparent:true,opacity:.55,depthWrite:false,fog:false}))
    ring.layers.set(MARK_LAYER); ring.renderOrder = 9
    const group = new THREE.Group(); group.add(sprite,ring); group.position.set(spot.x,0,spot.z); group.visible = false
    host.scene.add(group)
    return {spot,sprite,ring,group,ground:NaN,armed:true}
  })
  function restamp(id:string){const m = marks.find(m=>m.spot.id===id)!; m.sprite.material.map?.dispose()
    m.sprite.material.map = sealTexture(m.spot.seal,true); m.sprite.material.needsUpdate = true}
  const down = new THREE.Raycaster(undefined,new THREE.Vector3(0,-1,0))
  function groundAt(x:number,z:number) {
    const tile = host.manifest.chunks.find(t=>x>=t.x&&x<t.x+256&&z>=t.z&&z<t.z+256)
    const mesh = tile&&host.stream.loaded.get(tile)?.groundMesh
    if(!mesh) return NaN
    down.ray.origin.set(x,3000,z); mesh.updateWorldMatrix(true,false)
    return down.intersectObject(mesh,false)[0]?.point.y ?? NaN
  }
  function summitAt(x:number,z:number) {
    down.ray.origin.set(x,3000,z)
    return down.intersectObject(host.peaks,true)[0]?.point.y ?? NaN
  }

  // --- HUD dock (top right): minimap, then one 工具 menu for 景册 / 拍照 / 反馈 / 视角 / 设置 / 相机 / 无人机
  // (IDOK-468: eight always-on pills became one entry). The mode button (起飞, tour only) stays on the bar.
  const dock = document.createElement('nav'); dock.className = 'dock'; dock.setAttribute('aria-label','地图与工具')
  const book = button('景册','打开景册（J）','dock-book'), shutter = button('拍照','拍照模式（P）','dock-photo')
  const count = document.createElement('small'); book.append(count)
  const slot = document.createElement('div'); slot.className = 'dock-mini'
  const bar = document.createElement('div'); bar.className = 'dock-bar'
  const more = document.createElement('button'); more.type = 'button'; more.className = 'dock-more'; more.textContent = '工具'
  more.title = '工具：景册、拍照、相机、无人机、设置'
  const buttons = document.createElement('div'); buttons.className = 'dock-buttons'; buttons.id = 'dock-menu'; buttons.hidden = true
  buttons.setAttribute('role','group'); buttons.setAttribute('aria-label','工具')
  more.setAttribute('aria-controls',buttons.id); more.setAttribute('aria-expanded','false')
  const setMenu = (open:boolean)=>{
    // 收起时焦点若还在册页里，交还给「工具」按钮，键盘和读屏不会掉回页面开头
    if(!open&&buttons.contains(document.activeElement))more.focus()
    buttons.hidden = !open; more.setAttribute('aria-expanded',String(open)); dock.classList.toggle('open',open)
  }
  more.onclick = ()=>setMenu(buttons.hidden)
  // Picking an item closes the menu; so do a tap elsewhere and Esc (captured first so Esc doesn't also open 主菜单).
  buttons.addEventListener('click',event=>{if((event.target as Element).closest('button'))setMenu(false)})
  document.addEventListener('pointerdown',event=>{if(!buttons.hidden&&!dock.contains(event.target as Node))setMenu(false)})
  addEventListener('keydown',event=>{if(event.code==='Escape'&&!buttons.hidden){setMenu(false);event.preventDefault()}},true)
  bar.append(more,buttons); buttons.append(book,shutter); dock.append(slot,bar); document.body.append(dock)
  mountHotbar()
  const modeButton = document.querySelector<HTMLButtonElement>('.btn-mode')
  if(modeButton) bar.prepend(modeButton)
  function button(text:string,label:string,cls:string){const b = document.createElement('button'); b.className = cls; b.textContent = text
    b.setAttribute('aria-label',label); b.title = label; return b}
  const refreshCount = ()=>{count.textContent = `${stamps.size}/${spots.length}`}
  refreshCount()

  async function travel(go:()=>Promise<unknown>) {
    if(getPlayMode()==='tour')await go()
  }
  async function goTo(spot:Spot) {
    closeAll()
    await travel(async()=>{leaveSummit(false)
      if(await host.walkTo(spot.x,spot.z,yawToward(spot.x,spot.z,spot.at),'spot:'+spot.id,spot.name)) {
        host.walker()?.face(yawToward(spot.x,spot.z,spot.at),.16); arrive(marks.find(m=>m.spot===spot)!)}})
  }
  async function goDock(dock:WaterDock) {
    closeAll()
    const yaw = yawToward(dock.x,dock.z,dock.at)
    await travel(async()=>{leaveSummit(false)
      if(await host.walkTo(dock.x,dock.z,yaw,'dock:'+dock.id,dock.name)) {
        host.walker()?.face(yaw,.14)}})
  }
  async function goShop(shop:ShopTriggerDef) {
    closeAll()
    // Face directly toward the storefront sign and display showcase upon arrival.
    const yaw = Math.atan2(Math.sin(shop.facingYaw + Math.PI), Math.cos(shop.facingYaw + Math.PI))
    await travel(async()=>{leaveSummit(false)
      if(await host.walkTo(shop.triggerPos[0],shop.triggerPos[2],yaw,'shop:'+shop.shopId,shop.displayName)) {
        host.walker()?.face(yaw,.10)}})
  }
  // Stamp + card. Walking into the ring does it; so does travelling there (the spawn search may land a few metres off).
  function awardSpot(spot:Spot) {
    const commerce = soloServices()?.commerce
    if(!commerce)return
    const bounty = commerce.claimSpotBounty(spot.id)
    if(bounty.ok && bounty.code==='OK' && bounty.credited>0) {
      window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:`首次打卡「${spot.name}」+¥${bounty.credited}`,ms:2600}}))
    }
    return bounty
  }
  function arrive(m:typeof marks[number]) {
    m.armed = false; const fresh = !stamps.has(m.spot.id)
    if(fresh){stamps.add(m.spot.id); save(); soloServices()?.commerce.recordSpotFound(m.spot.id); restamp(m.spot.id); refreshCount()}
    awardSpot(m.spot)
    showCard(m.spot,fresh)
  }

  // Teleport to an arbitrary map point. Peaks, lakes and parks resolve to the nearest road vertex first,
  // because their centres are rarely walkable.
  async function goPoint(x:number,z:number,name:string) {
    if(map&&!map.contains(x,z))return
    closeAll()
    let tx = x, tz = z
    if(atlas&&!atlas.roadAt(x,z,30)) {let best = 320
      for(const r of atlas.roads) if(r.c<=2) for(let i=0;i<r.p.length;i+=2){const d = Math.hypot(r.p[i]-x,r.p[i+1]-z); if(d<best&&(!map||map.contains(r.p[i],r.p[i+1]))){best = d; tx = r.p[i]; tz = r.p[i+1]}}}
    const yaw = Math.atan2(-(x-tx),-(z-tz))
    await travel(async()=>{leaveSummit(); await host.walkTo(tx,tz,tx===x&&tz===z?(host.walker()?.yaw??0):yaw,'map',name)})
  }
  let atlas:import('../map/atlas').Atlas|undefined, map:ReturnType<typeof mapView>|undefined
  // Atlas loads only after the scene has been running a couple of seconds, never inside the first-frame budget.
  let mapLoading:Promise<ReturnType<typeof mapView>|undefined>|undefined
  const ensureMap = (background=false)=>{if(mapLoading)return mapLoading;const done=inlineBusy(slot,'载入地图',{quiet:background});return mapLoading = import('../map/atlas').then(m=>m.loadAtlas(host.manifest)).then(loaded=>{
    atlas = loaded; return map = mapView(host,loaded,{slot,buttons,stamps,goPoint:(x,z,n)=>void goPoint(x,z,n),goSpot:s=>void goTo(s),goDock:d=>void goDock(d),goShop:sh=>void goShop(sh),
      onNav:target=>nav.set(target),navPath:()=>nav.path()})
  }).catch(error=>{console.warn('atlas',error); mapLoading = undefined
    // IDOK-204: a failed load used to leave the minimap gone for the rest of the session. Retry with backoff, and
    // ask whether the site was redeployed under us (old chunks 404 after a release) so the player can refresh.
    mapRetryAt = pulse+Math.min(60,10*2**mapFailures++); mapRequested = false; checkForUpdate(true); return undefined}).finally(done)}
  let mapFailures = 0, mapRetryAt = 2.5
  const loadMap = ()=>void ensureMap(true)
  let mapRequested = !(host.manifest as {atlas?:unknown}).atlas
  const feedbackEntry=button('反馈','反馈','dock-feedback');buttons.append(feedbackEntry)
  window.addEventListener('glol:mp-ban',event=>{
    const detail=(event as CustomEvent).detail
    void import('../ui/mp-ban').then(module=>module.showMpBan(detail,recordId=>void import('../ui/feedback').then(feedback=>feedback.openFeedback(host,()=>{mapRequested=true;return ensureMap()},undefined,recordId))))
  })
  feedbackEntry.onclick=()=>void import('../ui/feedback').then(module=>module.openFeedback(host,()=>{mapRequested = true; return ensureMap()}))
  const feedbackId=new URLSearchParams(location.search).get('feedback');if(feedbackId&&/^[\w-]{1,128}$/.test(feedbackId))void import('../ui/feedback').then(module=>module.openFeedback(host,()=>{mapRequested=true;return ensureMap()},feedbackId))
  // IDOK-144: portrait phones can tap back into landscape after dismissing the gate (see ui/orientation.ts).
  mountLandscapeEntry(buttons)
  // IDOK-178: 第一/第三人称切换与设置面板，桌面和手机共用右上角这一列。
  mountViewEntry(buttons)
  mountSettingsEntry(buttons)
  // IDOK-182: 相机包（换机身），打开时冻住移动，跟拍照模式一样。
  mountRackEntry(buttons)
  bindRackGuard(on=>{const walker = host.walker(); if(!walker?.active) return; walker.hold(on); if(!on) walker.hold(false)})

  // --- Card
  const card = document.createElement('aside'); card.className = 'spot-card'; card.hidden = true; card.setAttribute('role','dialog')
  document.body.append(card)
  let shown:Spot|null = null
  function showCard(spot:Spot, fresh=false) {
    shown = spot; const done = stamps.has(spot.id)
    card.innerHTML = `<button class="card-close" aria-label="关闭">×</button>
      <div class="card-seal${done?' done':''}${fresh?' fresh':''}">${spot.seal}</div>
      <h2>${spot.name}</h2><p class="card-sub">${spot.sub}</p><p class="card-intro">${spot.intro}</p>
      <p class="card-best"><span>最佳时段</span><b>${spot.best.label}</b><button data-act="hour">换到此时</button></p>
      <div class="card-actions"><button data-act="aim">取景</button>${getPlayMode()==='tour'&&spot.summit?'<button data-act="summit">登顶</button>':''}<button data-act="photo">拍照</button></div>`
    card.hidden = false; requestAnimationFrame(()=>card.classList.add('show'))
    registerPageUI(card)
    card.querySelector<HTMLButtonElement>('.card-close')!.onclick = closeCard
    for(const b of Array.from(card.querySelectorAll<HTMLButtonElement>('[data-act]'))) b.onclick = ()=>act(spot,b.dataset.act!)
  }
  function closeCard(){card.classList.remove('show'); shown = null; setTimeout(()=>{if(!shown) card.hidden = true},260)}
  async function act(spot:Spot, what:string) {
    if(what==='hour') {host.clock.flowing = false; host.clock.goal = spot.best.hour}
    if(what==='aim') {const w = host.walker(); if(w?.active) w.face(yawToward(spot.x,spot.z,spot.at),.12); else await goTo(spot); closeCard()}
    if(what==='summit') {closeCard(); await climb(spot)}
    if(what==='photo') {closeCard(); photo.open()}
  }

  // --- Summit: lift the camera to the peak top (stairs are not walkable geometry), look out, come back down.
  const pill = document.createElement('div'); pill.className = 'summit-pill'; pill.hidden = true; document.body.append(pill)
  let summit:{spot:Spot,eye:THREE.Vector3}|null = null
  async function flyCamera(eye:THREE.Vector3, target:THREE.Vector3, ms:number) {
    const camera = host.camera, from = camera.position.clone(), q0 = camera.quaternion.clone()
    const probe = camera.clone(); probe.position.copy(eye); probe.lookAt(target); const q1 = probe.quaternion.clone()
    host.cinema = true; const start = performance.now()
    await new Promise<void>(resolve=>{const step = ()=>{if(getPlayMode()==='solo'){resolve();return}const t = Math.min(1,(performance.now()-start)/ms), k = ease(t)
      camera.position.lerpVectors(from,eye,k); camera.position.y += Math.sin(Math.PI*k)*Math.min(160,from.distanceTo(eye)*.25)
      camera.quaternion.slerpQuaternions(q0,q1,k)
      if(t<1) requestAnimationFrame(step); else resolve()}; step()})
    camera.rotation.setFromQuaternion(camera.quaternion,'YXZ'); host.cinema = false
  }
  async function climb(spot:Spot) {
    if(getPlayMode()==='solo')return
    const s = spot.summit!, top = summitAt(s.x,s.z)
    if(!Number.isFinite(top)) return
    const dir = new THREE.Vector2(s.at[0]-s.x,s.at[1]-s.z).normalize()
    const eye = new THREE.Vector3(s.x+dir.x*6,top+15,s.z+dir.y*6)  // above the summit canopy, pavilion-roof height
    const target = new THREE.Vector3(s.at[0],Math.max(150,top-120),s.at[1])
    host.fly(); host.refreshMode()
    await flyCamera(eye,target,2600)
    if(getPlayMode()==='solo')return
    summit = {spot,eye}; pill.hidden = false
    pill.innerHTML = `<span>${s.label}</span><button>下山</button>`
    pill.querySelector('button')!.onclick = ()=>void goTo(spot)
  }
  function leaveSummit(hide=true){summit = null; pill.hidden = true; if(hide) return}

  // --- 景册 (collection book)
  const sheet = document.createElement('section'); sheet.className = 'book'; sheet.hidden = true; document.body.append(sheet)
  function openBook() {
    closeCard()
    const commerce = soloServices()?.commerce
    const reward = commerce?.SPOT_BOUNTY_YUAN
    sheet.innerHTML = `<header><h2>景册</h2><p>已盖 <b>${stamps.size}</b> / ${spots.length} 枚印 · 走到地上的朱红圆圈处即可盖印${commerce ? `（首打卡/拍照 +¥${reward}）` : ''}</p><button class="card-close" aria-label="关闭">×</button></header>
      <ol>${spots.map(s=>{
        const stamped = stamps.has(s.id)
        const claimed = commerce?.hasClaimedSpotBounty(s.id)
        const claimBtn = commerce && stamped && !claimed ? `<button data-claim="${s.id}">领¥${reward}</button>` : ''
        const badge = !commerce ? '' : claimed ? ` · 已领¥${reward}` : stamped ? ' · 待领赏金' : ` · +¥${reward}`
        return `<li class="${stamped?'done':''}"><div class="card-seal${stamped?' done':''}">${s.seal}</div>
        <div><h3>${s.name}</h3><p>${s.sub}${badge}</p></div>${claimBtn}${commerce?'':`<button data-id="${s.id}">前往</button>`}</li>`
      }).join('')}</ol>
      <div class="book-docks" ${commerce?'hidden':''}><span>水边开船直达</span><div>${waterDocks.map(d=>`<button data-dock="${d.id}">${d.name} · ${d.badge}</button>`).join('')}</div></div>`
    sheet.hidden = false; requestAnimationFrame(()=>sheet.classList.add('show'))
    sheet.querySelector<HTMLButtonElement>('.card-close')!.onclick = closeBook
    for(const b of Array.from(sheet.querySelectorAll<HTMLButtonElement>('[data-claim]'))) b.onclick = ()=>{
      const sp = spots.find(s=>s.id===b.dataset.claim)
      if(sp){awardSpot(sp); openBook()}
    }
    for(const b of Array.from(sheet.querySelectorAll<HTMLButtonElement>('[data-id]'))) b.onclick = ()=>void goTo(spots.find(s=>s.id===b.dataset.id)!)
    for(const b of Array.from(sheet.querySelectorAll<HTMLButtonElement>('[data-dock]'))) b.onclick = ()=>void goDock(waterDocks.find(d=>d.id===b.dataset.dock)!)
  }
  function closeBook(){sheet.classList.remove('show'); setTimeout(()=>{if(!sheet.classList.contains('show')) sheet.hidden = true},260)}
  function closeAll(){closeCard(); closeBook()}
  onPlayMode(()=>{leaveSummit();closeCard();if(!sheet.hidden)openBook()})
  book.onclick = ()=>sheet.hidden?openBook():closeBook()
  onState(s=>{
    let changed = false
    for(const id of s.spotsFound) if(!stamps.has(id)){stamps.add(id); restamp(id); changed = true}
    if(changed){save(); refreshCount()}
  })

  const photo = photoMode(host,()=>nearestName(),()=>{
    const w = host.walker()
    if(!w?.active) return
    const p = w.position
    for(const m of marks) {
      if(Math.hypot(m.spot.x-p.x, m.spot.z-p.z)<=24) {
        if(!stamps.has(m.spot.id)){stamps.add(m.spot.id); save(); soloServices()?.commerce.recordSpotFound(m.spot.id); restamp(m.spot.id); refreshCount()}
        awardSpot(m.spot)
      }
    }
  })
  window.addEventListener('combat:down',()=>{if(photo.active)photo.close()})
  shutter.onclick = ()=>photo.open()
  // IDOK-215: 无人机 —— 机库/放置/起飞都在这个入口，遥控时整条 dock 让位给遥控器界面。
  const drone = droneMode(host,{
    groundAt:(x,z)=>{
      const hit = groundAt(x,z)
      if(Number.isFinite(hit)) return hit
      const walker = host.walker()
      const probe = walker?.probe?.() as {surfaceY?:number;foot?:number}|undefined
      return probe?.surfaceY ?? probe?.foot ?? 0
    },
    name:()=>nearestName(),
    // IDOK-527: 空中导航的景点目标来自景册清单（取名字 + 落地坐标）。
    spots:()=>(host.manifest.landmarks ?? [])
      .filter(spot => Number.isFinite(spot.position[0]) && Number.isFinite(spot.position[2]))
      .map(spot => ({label:spot.name ?? spot.id,x:spot.position[0],z:spot.position[2]})),
    // IDOK-529: 自动避障/撞击检测用同一套实体查询（建筑、棚子、牌楼都算实体）。
    blockedAt:(x,y,z)=>host.walker()?.blockedAt?.(x,y,z) ?? false,
    // IDOK-529: 天空面板设的天气就是机上的天气。
    raining:()=>host.clock.weather === 'rain',
    // IDOK-529: 落到水面上也算落水（openWater 没有水时返回 null）。
    waterY:(x,z)=>host.walker()?.waterAt?.(x,z) ?? null,
  })
  drone.mountEntry(buttons)
  // IDOK-350: 街景导航（路网寻路 + 场景路线 + 转向提示）；入口仍是地图面板的「标记导航」。
  const nav = navigation(host,{visible:()=>!photo.active&&!drone.active&&document.body.dataset.photo!=='on',onEnd:()=>map?.setNavTarget(null,false)})
  window.addEventListener('keydown',event=>{
    if(event.repeat) return
    if(drone.active) return
    if(event.code==='Escape') {if(photo.active) photo.close(); else if(!map?.active) closeAll(); return}
    if(isGlobalHotkeyBlocked(event.target,{allowPhoto:photo.active})) return
    if(event.code==='KeyJ'&&!photo.active) sheet.hidden?openBook():closeBook()
    if(event.code==='KeyP'){
      if(shouldPhotoYieldKeyPFromDom(event,photo.active)) return
      photo.active?photo.close():photo.open()
    }
  })

  function nearestName() {
    const p = host.walker()?.active?host.walker()!.position:host.camera.position
    if(summit&&p.distanceTo(summit.eye)<60) return summit.spot.summit!.label
    let best:Spot|null = null, dist = 450
    for(const s of spots){const d = Math.hypot(s.x-p.x,s.z-p.z); if(d<dist){dist = d; best = s}}
    if(best) return best.name
    let bestLm:MapLandmark|null = null, lmDist = 650
    for(const m of mapLandmarks){const d = Math.hypot(m.x-p.x,m.z-p.z); if(d<lmDist){lmDist = d; bestLm = m}}
    return bestLm?.name ?? map?.roadName() ?? ''
  }

  // --- Per-frame: marker placement/fade, arrival, summit pill.
  // Indoor & shop-building occlusion keeps distant scenic stamps (秀/街/巷/楼) from floating through walls.
  // Both shops are added straight under the scene by their own modules, and only once the player is near.
  const mifenShop = namedChild(host.scene,'tianyuan_mifen_shop'), drinksShop = namedChild(host.scene,'wangcheng_drinks_shop')
  const tmpLocalA = new THREE.Vector3(), tmpLocalB = new THREE.Vector3(), tmpMarkWorld = new THREE.Vector3()
  const shopObjs:{mifen:THREE.Object3D|null, drinks:THREE.Object3D|null} = {mifen: null, drinks: null}
  function resolveShopObjs() {
    shopObjs.mifen = mifenShop()
    shopObjs.drinks = drinksShop()
    return shopObjs
  }
  function pointInsideMifenShop(pos:THREE.Vector3, shop:THREE.Object3D) {
    shop.worldToLocal(tmpLocalA.copy(pos))
    if(Math.abs(tmpLocalA.x)>3.55||tmpLocalA.z<-7.3||tmpLocalA.z>7.15||tmpLocalA.y<-0.6||tmpLocalA.y>3.6) return false
    if(tmpLocalA.x<-1.4&&tmpLocalA.z>5.0&&Math.hypot(tmpLocalA.x+1.4,tmpLocalA.z-5.0)>2.2) return false
    return true
  }
  function pointInsideDrinksShop(pos:THREE.Vector3, shop:THREE.Object3D) {
    shop.worldToLocal(tmpLocalA.copy(pos))
    return Math.abs(tmpLocalA.x)<=6.0&&tmpLocalA.z>=-4.8&&tmpLocalA.z<=3.2&&tmpLocalA.y>=-0.5&&tmpLocalA.y<=4.6
  }
  function segmentHitsBox(camPos:THREE.Vector3, targetPos:THREE.Vector3, shop:THREE.Object3D, hx:number, yMin:number, yMax:number, zMin:number, zMax:number) {
    shop.worldToLocal(tmpLocalA.copy(camPos))
    shop.worldToLocal(tmpLocalB.copy(targetPos))
    const dx = tmpLocalB.x-tmpLocalA.x, dy = tmpLocalB.y-tmpLocalA.y, dz = tmpLocalB.z-tmpLocalA.z
    let tmin = 0, tmax = 1
    const clipAxis = (p0:number, d:number, lo:number, hi:number)=>{
      if(Math.abs(d)<1e-8) return p0>=lo&&p0<=hi
      let t1 = (lo-p0)/d, t2 = (hi-p0)/d
      if(t1>t2){const tmp = t1; t1 = t2; t2 = tmp}
      if(t1>tmin) tmin = t1
      if(t2<tmax) tmax = t2
      return tmin<=tmax
    }
    return clipAxis(tmpLocalA.x,dx,-hx,hx)&&clipAxis(tmpLocalA.y,dy,yMin,yMax)&&clipAxis(tmpLocalA.z,dz,zMin,zMax)&&tmax>0&&tmin<1
  }
  let pulse = 0
  function tick(dt:number) {
    pulse += dt
    if(!mapRequested&&pulse>mapRetryAt){mapRequested = true; loadMap()}
    const walker = host.walker(), walking = !!walker?.active, p = walking?walker!.position:host.camera.position
    // IDOK-238（Rock）：默认空手、手臂跟走路动画；底部物品栏切到「相机」才拿机身、抬到胸前。
    // 每帧都喂一次 setCameraShown：walker 是首帧之后才拿到的，只在状态翻转时调用会漏掉持机姿势。
    const onFoot = walking && !photo.active && !isRackOpen() && !riding()
    showHotbar(onFoot)
    setCameraShown(onFoot && hotbarSlot() === 'camera', walker)
    const shops = resolveShopObjs()
    const indoors = document.body.dataset.mifenIndoor==='1'
      || (!!shops.mifen&&(pointInsideMifenShop(host.camera.position,shops.mifen)||pointInsideMifenShop(p,shops.mifen)))
      || (!!shops.drinks&&(pointInsideDrinksShop(host.camera.position,shops.drinks)||pointInsideDrinksShop(p,shops.drinks)))
    const nearMifen = !!shops.mifen&&host.camera.position.distanceTo(shops.mifen.position)<55
    const nearDrinks = !!shops.drinks&&host.camera.position.distanceTo(shops.drinks.position)<55
    const nearShop = nearMifen || nearDrinks
    for(const m of marks) {
      const d = Math.hypot(m.spot.x-p.x,m.spot.z-p.z)
      if(Number.isNaN(m.ground)&&d<600) m.ground = groundAt(m.spot.x,m.spot.z)
      const baseShow = !indoors&&d<1400&&!photo.active&&!drone.active&&!Number.isNaN(m.ground)&&!(summit&&d>0)
      const spriteY = m.ground+9+Math.sin(pulse*1.6)*.35
      const occluded = baseShow&&(
        (nearMifen&&!!shops.mifen&&segmentHitsBox(host.camera.position,tmpMarkWorld.set(m.spot.x,spriteY,m.spot.z),shops.mifen,3.55,-0.5,10.6,-7.3,7.15))
        || (nearDrinks&&!!shops.drinks&&segmentHitsBox(host.camera.position,tmpMarkWorld.set(m.spot.x,spriteY,m.spot.z),shops.drinks,6.0,-0.5,5.0,-4.8,3.2))
      )
      const show = baseShow&&!occluded
      m.group.visible = show
      if(show) {
        m.sprite.material.depthTest = nearShop
        m.group.position.y = m.ground
        m.sprite.position.y = 9+Math.sin(pulse*1.6)*.35
        // Fixed screen size close up, shrinking to a dot in the distance; fades out at the edge of range.
        const s = THREE.MathUtils.clamp(.07-d/1400*.045,.024,.06); m.sprite.scale.set(s,s,1)
        m.sprite.material.opacity = THREE.MathUtils.clamp((1400-d)/400,0,1)*(d<ARRIVE*1.5?.35:1)
        m.ring.visible = d<260
        ;(m.ring.material as THREE.MeshBasicMaterial).opacity = .35+.25*Math.sin(pulse*2.4)
        m.ring.position.y = .18
      }
      if(walking&&d<ARRIVE&&m.armed&&!photo.active) arrive(m)
      if(d>REARM) {m.armed = true; if(shown===m.spot&&walking) closeCard()}
    }
    if(summit&&host.camera.position.distanceTo(summit.eye)>220) leaveSummit()
    photo.tick(); nav.tick(dt); map?.tick(dt); drone.tick(dt)
  }
  return {tick, spots, goTo, goPoint, openBook, photo, stamps, nav, get map(){return map}}
}
import {registerPageUI} from '../capture-page'
