import * as THREE from 'three'
import './play.css'
import {spots, yawToward, type Spot} from './spots'
import type {Host} from './host'
import {photoMode} from './photo'
import {mapView} from './map'

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

  // --- HUD dock (top right): mode button lives here too, so mobile has one column of controls.
  const dock = document.createElement('nav'); dock.className = 'dock'
  const book = button('景册','打开景册（J）','dock-book'), shutter = button('拍照','拍照模式（P）','dock-photo')
  const count = document.createElement('small'); book.append(count)
  const slot = document.createElement('div'); slot.className = 'dock-mini'
  const buttons = document.createElement('div'); buttons.className = 'dock-buttons'
  buttons.append(book,shutter); dock.append(slot,buttons); document.body.append(dock)
  const modeButton = document.querySelector<HTMLButtonElement>('.btn-mode')
  if(modeButton) buttons.prepend(modeButton)
  function button(text:string,label:string,cls:string){const b = document.createElement('button'); b.className = cls; b.textContent = text
    b.setAttribute('aria-label',label); b.title = label; return b}
  const refreshCount = ()=>{count.textContent = `${stamps.size}/${spots.length}`}
  refreshCount()

  // --- Veil: a haze-coloured fade with the destination name, used for every teleport.
  const veil = document.createElement('div'); veil.className = 'veil'; veil.innerHTML = '<span></span>'; document.body.append(veil)
  const wait = (ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
  async function travel(name:string, go:()=>Promise<unknown>) {
    veil.querySelector('span')!.textContent = name; veil.classList.add('show'); await wait(520)
    try {await go()} finally {await wait(200); veil.classList.remove('show')}
  }
  async function goTo(spot:Spot) {
    closeAll()
    await travel(spot.name,async()=>{leaveSummit(false)
      if(await host.walkTo(spot.x,spot.z,yawToward(spot.x,spot.z,spot.at),'spot:'+spot.id)) {
        host.walker()?.face(yawToward(spot.x,spot.z,spot.at),.16); arrive(marks.find(m=>m.spot===spot)!)}})
  }
  // Stamp + card. Walking into the ring does it; so does travelling there (the spawn search may land a few metres off).
  function arrive(m:typeof marks[number]) {
    m.armed = false; const fresh = !stamps.has(m.spot.id)
    if(fresh){stamps.add(m.spot.id); save(); restamp(m.spot.id); refreshCount()}
    showCard(m.spot,fresh)
  }

  // Teleport to an arbitrary map point. Peaks, lakes and parks resolve to the nearest road vertex first,
  // because their centres are rarely walkable.
  async function goPoint(x:number,z:number,name:string) {
    closeAll()
    let tx = x, tz = z
    if(atlas&&!atlas.roadAt(x,z,30)) {let best = 320
      for(const r of atlas.roads) if(r.c<=2) for(let i=0;i<r.p.length;i+=2){const d = Math.hypot(r.p[i]-x,r.p[i+1]-z); if(d<best){best = d; tx = r.p[i]; tz = r.p[i+1]}}}
    const yaw = Math.atan2(-(x-tx),-(z-tz))
    await travel(name,async()=>{leaveSummit(); await host.walkTo(tx,tz,tx===x&&tz===z?(host.walker()?.yaw??0):yaw,'map')})
  }
  let atlas:import('../map/atlas').Atlas|undefined, map:ReturnType<typeof mapView>|undefined
  // Atlas loads only after the scene has been running a couple of seconds, never inside the first-frame budget.
  const loadMap = ()=>void import('../map/atlas').then(m=>m.loadAtlas(host.manifest)).then(loaded=>{
    atlas = loaded; map = mapView(host,loaded,{slot,buttons,stamps,goPoint:(x,z,n)=>void goPoint(x,z,n),goSpot:s=>void goTo(s)})
  }).catch(error=>console.warn('atlas',error))
  let mapRequested = !(host.manifest as {atlas?:unknown}).atlas

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
      <div class="card-actions"><button data-act="aim">取景</button>${spot.summit?'<button data-act="summit">登顶</button>':''}<button data-act="photo">拍照</button></div>`
    card.hidden = false; requestAnimationFrame(()=>card.classList.add('show'))
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
    await new Promise<void>(resolve=>{const step = ()=>{const t = Math.min(1,(performance.now()-start)/ms), k = ease(t)
      camera.position.lerpVectors(from,eye,k); camera.position.y += Math.sin(Math.PI*k)*Math.min(160,from.distanceTo(eye)*.25)
      camera.quaternion.slerpQuaternions(q0,q1,k)
      if(t<1) requestAnimationFrame(step); else resolve()}; step()})
    camera.rotation.setFromQuaternion(camera.quaternion,'YXZ'); host.cinema = false
  }
  async function climb(spot:Spot) {
    const s = spot.summit!, top = summitAt(s.x,s.z)
    if(!Number.isFinite(top)) return
    const dir = new THREE.Vector2(s.at[0]-s.x,s.at[1]-s.z).normalize()
    const eye = new THREE.Vector3(s.x+dir.x*6,top+15,s.z+dir.y*6)  // above the summit canopy, pavilion-roof height
    const target = new THREE.Vector3(s.at[0],Math.max(150,top-120),s.at[1])
    host.fly(); host.refreshMode()
    await flyCamera(eye,target,2600)
    summit = {spot,eye}; pill.hidden = false
    pill.innerHTML = `<span>${s.label}</span><button>下山</button>`
    pill.querySelector('button')!.onclick = ()=>void goTo(spot)
  }
  function leaveSummit(hide=true){summit = null; pill.hidden = true; if(hide) return}

  // --- 景册 (collection book)
  const sheet = document.createElement('section'); sheet.className = 'book'; sheet.hidden = true; document.body.append(sheet)
  function openBook() {
    closeCard()
    sheet.innerHTML = `<header><h2>景册</h2><p>已盖 <b>${stamps.size}</b> / ${spots.length} 枚印 · 走到地上的朱红圆圈处即可盖印</p><button class="card-close" aria-label="关闭">×</button></header>
      <ol>${spots.map(s=>`<li class="${stamps.has(s.id)?'done':''}"><div class="card-seal${stamps.has(s.id)?' done':''}">${s.seal}</div>
        <div><h3>${s.name}</h3><p>${s.sub}</p></div><button data-id="${s.id}">前往</button></li>`).join('')}</ol>`
    sheet.hidden = false; requestAnimationFrame(()=>sheet.classList.add('show'))
    sheet.querySelector<HTMLButtonElement>('.card-close')!.onclick = closeBook
    for(const b of Array.from(sheet.querySelectorAll<HTMLButtonElement>('[data-id]'))) b.onclick = ()=>void goTo(spots.find(s=>s.id===b.dataset.id)!)
  }
  function closeBook(){sheet.classList.remove('show'); setTimeout(()=>{if(!sheet.classList.contains('show')) sheet.hidden = true},260)}
  function closeAll(){closeCard(); closeBook()}
  book.onclick = ()=>sheet.hidden?openBook():closeBook()

  const photo = photoMode(host,()=>nearestName())
  shutter.onclick = ()=>photo.open()
  window.addEventListener('keydown',event=>{
    if(event.repeat||(event.target as HTMLElement)?.tagName==='INPUT') return
    if(event.code==='KeyJ') sheet.hidden?openBook():closeBook()
    if(event.code==='KeyP') photo.active?photo.close():photo.open()
    if(event.code==='Escape') {if(photo.active) photo.close(); else if(!map?.active) closeAll()}
  })

  function nearestName() {
    const p = host.walker()?.active?host.walker()!.position:host.camera.position
    if(summit&&p.distanceTo(summit.eye)<60) return summit.spot.summit!.label
    let best:Spot|null = null, dist = 450
    for(const s of spots){const d = Math.hypot(s.x-p.x,s.z-p.z); if(d<dist){dist = d; best = s}}
    return best?.name ?? map?.roadName() ?? ''
  }

  // --- Per-frame: marker placement/fade, arrival, summit pill.
  let pulse = 0
  function tick(dt:number) {
    pulse += dt
    if(!mapRequested&&pulse>2.5){mapRequested = true; loadMap()}
    const walker = host.walker(), walking = !!walker?.active, p = walking?walker!.position:host.camera.position
    for(const m of marks) {
      const d = Math.hypot(m.spot.x-p.x,m.spot.z-p.z)
      if(Number.isNaN(m.ground)&&d<600) m.ground = groundAt(m.spot.x,m.spot.z)
      const show = d<1400&&!photo.active&&!Number.isNaN(m.ground)&&!(summit&&d>0)
      m.group.visible = show
      if(show) {
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
    photo.tick(); map?.tick(dt)
  }
  return {tick, spots, groundAt, goTo, goPoint, openBook, photo, stamps, get map(){return map}}
}
