import {operation} from '../telemetry'
import * as THREE from 'three'
import type {Host} from './host'
import type {Atlas, Place} from '../map/atlas'
import {spots, waterDocks, type Spot, type WaterDock} from './spots'
import {isGlobalHotkeyBlocked} from '../walk/input-guard'
import {builtBoundary,loadRegional,northwest,southeast} from '../map/regional'
import {getState} from '../game/state'
import {listShops, type ShopTriggerDef} from '../game/shops'

// 地图 (M4): one canvas painter shared by the minimap and the full map. North up, world z grows south.
// Look follows docs/style.md: rice-paper ground, jade water, pale-green parks, karst peaks as ink mounds,
// vermilion only for the player and the viewpoint seals.
const C = {paper:'#efe8d8', green:'#d3dcc0', water:'#a6c9c1', waterEdge:'#86ada5', building:'#e0d6c3', buildingEdge:'#cdc1aa',
  road:'#fcfaf3', casing:'#cbbea4', major:'#f8ebcb', majorCasing:'#c4a676', path:'#b7aa90', ink:'#2a302c', inkSoft:'#5d655f',
  peak:'#7f9a7b', peakDark:'#4f6b55', seal:'#a9503c', sealSoft:'rgba(169,80,60,.55)', paperText:'#f4efe2',
  halo:'rgba(239,232,216,.92)', roadHalo:'rgba(252,250,243,.95)'}
// Phase 2 街头 palette (docs/style.md 第二期 · 小地图): night-asphalt ground, grey roads, white arterials, jade water.
const STREET:typeof C = {paper:'#1b1f25', green:'#1f3329', water:'#17414c', waterEdge:'#245866', building:'#2a2f37', buildingEdge:'#353b45',
  road:'#7d838c', casing:'#14171b', major:'#e9e6de', majorCasing:'#0d0f12', path:'#4c525b', ink:'#f6f4ef', inkSoft:'#c9ccd2',
  peak:'#2d4a3a', peakDark:'#203629', seal:'#20d6c1', sealSoft:'rgba(32,214,193,.5)', paperText:'#101216',
  halo:'rgba(16,18,22,.9)', roadHalo:'rgba(16,18,22,.9)'}
export function setMapPalette(name:'ink'|'street'){if(name==='street')Object.assign(C,STREET)}
const SERIF = '"Noto Serif SC","Source Han Serif SC","Songti SC",serif'
const CELL = 256
const ROAD_PX:[number,number][] = [[7.5,5.4],[6,4.2],[3.8,2.6],[2,1.2]] // [casing,fill] px at zoom 1 by class

type Item = {path:Path2D; box:[number,number,number,number]}
type Road = Item & {c:number; n:string; label?:{x:number,z:number,angle:number,len:number}}

function index<T extends Item>(items:T[]) {
  const grid = new Map<string,T[]>()
  for(const item of items) {
    const [x0,z0,x1,z1] = item.box
    for(let gx=Math.floor(x0/CELL);gx<=Math.floor(x1/CELL);gx++) for(let gz=Math.floor(z0/CELL);gz<=Math.floor(z1/CELL);gz++) {
      const key = gx+','+gz; let list = grid.get(key); if(!list) grid.set(key,list = []); list.push(item)
    }
  }
  return (x0:number,z0:number,x1:number,z1:number)=>{
    const out = new Set<T>()
    for(let gx=Math.floor(x0/CELL);gx<=Math.floor(x1/CELL);gx++) for(let gz=Math.floor(z0/CELL);gz<=Math.floor(z1/CELL);gz++)
      for(const item of grid.get(gx+','+gz)??[]) out.add(item)
    return out
  }
}
function ring(path:Path2D, p:number[], close:boolean) {
  path.moveTo(p[0],p[1]); for(let i=2;i<p.length;i+=2) path.lineTo(p[i],p[i+1]); if(close) path.closePath()
}
function bounds(rings:number[][]):[number,number,number,number] {
  let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity
  for(const p of rings) for(let i=0;i<p.length;i+=2){x0=Math.min(x0,p[i]);x1=Math.max(x1,p[i]);z0=Math.min(z0,p[i+1]);z1=Math.max(z1,p[i+1])}
  return [x0,z0,x1,z1]
}

export function mapView(host:Host, atlas:Atlas, ui:{slot:HTMLElement; buttons:HTMLElement; stamps:Set<string>;
  goPoint(x:number,z:number,name:string):void; goSpot(spot:Spot):void; goDock(dock:WaterDock):void; goShop?:(shop:ShopTriggerDef)=>void}) {
  // --- Prepare paths once (world units), bucketed into 256 m cells for culling.
  const polys = (list:number[][][])=>list.map(rings=>{const path = new Path2D(); for(const p of rings) ring(path,p,true); return {path,box:bounds(rings)}})
  const water = index(polys(atlas.water)), green = index(polys(atlas.green))
  const buildings = index(atlas.buildings.map(p=>{const path = new Path2D(); ring(path,p,true); return {path,box:bounds([p])}}))
  const roadItems:Road[] = atlas.roads.map(r=>{const path = new Path2D(); ring(path,r.p,false)
    let best = 0, label
    for(let i=0;i+3<r.p.length;i+=2){const dx = r.p[i+2]-r.p[i], dz = r.p[i+3]-r.p[i+1], len = Math.hypot(dx,dz)
      if(len>best){best = len; let angle = Math.atan2(dz,dx); if(angle>Math.PI/2) angle -= Math.PI; if(angle<-Math.PI/2) angle += Math.PI
        label = {x:(r.p[i]+r.p[i+2])/2, z:(r.p[i+1]+r.p[i+3])/2, angle, len}}}
    return {path,box:bounds([r.p]),c:r.c,n:r.n,label}})
  const roads = index(roadItems)
  const peaks = host.manifest.peaks.entries.map(p=>({x:p.center[0],z:p.center[2],h:p.center[1]-((p as {baseHeight?:number}).baseHeight??150),name:/[一-鿿]/.test(p.name)&&!/^\d/.test(p.name)?p.name:''}))
  const placeLabels = atlas.places.filter(p=>p.k!=='road'&&p.k!=='peak'&&p.k!=='water')
  const built=builtBoundary(host.manifest), style=getComputedStyle(document.documentElement)
  const mask=new Path2D(built.path); mask.rect(-1e6,-1e6,2e6,2e6)
  let regional:Awaited<ReturnType<typeof loadRegional>>|undefined, edge:typeof regional
  const pending=new Set<string>()
  function requestMap(file:string){
    if(pending.has(file))return
    pending.add(file)
    loadRegional(file).then(map=>{if(file==='overview.bin')regional=map;else edge=map;redraw()}).catch(error=>{console.warn(error); setTimeout(()=>pending.delete(file),10000)})
  }

  function heading() {
    const w = host.walker()
    if(w?.active) return Math.atan2(-Math.sin(w.yaw),-Math.cos(w.yaw))
    const d = host.camera.getWorldDirection(new THREE.Vector3()); return Math.atan2(d.x,d.z)
  }
  const here = ()=>{const w = host.walker(); return w?.active?w.position:host.camera.position}

  // --- Painter
  function paint(g:CanvasRenderingContext2D, w:number, h:number, dpr:number, cx:number, cz:number, scale:number, mini:boolean) {
    g.setTransform(dpr,0,0,dpr,0,0); g.fillStyle = C.paper; g.fillRect(0,0,w,h)
    const x0 = cx-w/2/scale, x1 = cx+w/2/scale, z0 = cz-h/2/scale, z1 = cz+h/2/scale
    g.setTransform(scale*dpr,0,0,scale*dpr,(w/2-cx*scale)*dpr,(h/2-cz*scale)*dpr)
    const px = (v:number)=>v/scale
    const far=scale<.09
    if(mini&&!regional&&!edge&&(!built.contains(x0,z0)||!built.contains(x1,z1)))requestMap('overview-edge.bin')
    ;(regional??edge)?.paint(g,x0,z0,x1,z1,scale,style)
    const sx = (x:number)=>w/2+(x-cx)*scale, sz = (z:number)=>h/2+(z-cz)*scale
    const player = here(), hx = sx(player.x), hy = sz(player.z)
    if(!far){
    g.save();g.clip(built.path,'evenodd')
    g.fillStyle = C.green; for(const it of green(x0,z0,x1,z1)) g.fill(it.path,'evenodd')
    g.fillStyle = C.water; g.strokeStyle = C.waterEdge; g.lineWidth = px(1.1)
    for(const it of water(x0,z0,x1,z1)){g.fill(it.path,'evenodd'); g.stroke(it.path)}
    if(scale>.18) {g.fillStyle = C.building; g.strokeStyle = C.buildingEdge; g.lineWidth = px(.6)
      for(const it of buildings(x0,z0,x1,z1)){g.fill(it.path); if(scale>.5) g.stroke(it.path)}}
    const visible = [...roads(x0,z0,x1,z1)], zoom = Math.min(1.7,Math.max(.55,scale/.7))
    g.lineCap = g.lineJoin = 'round'
    for(const pass of [0,1]) for(const c of [3,2,1,0]) {
      if(c===3&&scale<.35) continue; if(c===2&&scale<.12) continue
      g.strokeStyle = c===3?(pass?C.road:C.path):c<=1?(pass?C.major:C.majorCasing):(pass?C.road:C.casing)
      if(c===3&&pass===0) continue
      g.lineWidth = px(ROAD_PX[c][pass]*zoom); g.setLineDash(c===3?[px(3),px(2.5)]:[])
      for(const r of visible) if(r.c===c) g.stroke(r.path)
    }
    g.setLineDash([])
    // Peaks: an ink mound per karst peak, darker ridge on the left; scaled by height.
    g.setTransform(dpr,0,0,dpr,0,0)
    const taken:[number,number,number,number][] = []
    const free = (x:number,y:number,bw:number,bh:number)=>{for(const [a,b,c,d] of taken) if(x<c&&x+bw>a&&y<d&&y+bh>b) return false; taken.push([x,y,x+bw,y+bh]); return true}
    for(const p of peaks) {
      const x = sx(p.x), y = sz(p.z); if(x<-70||y<-70||x>w+70||y>h+70) continue
      const r = Math.max(4,Math.min(60,p.h*.9*scale))  // footprint ≈ 0.8–1× relative height (karst aspect)
      g.fillStyle = C.peak; g.beginPath(); g.moveTo(x-r,y+r*.45); g.quadraticCurveTo(x-r*.7,y-r*1.15,x,y-r*1.1); g.quadraticCurveTo(x+r*.7,y-r*1.15,x+r,y+r*.45); g.closePath(); g.fill()
      g.fillStyle = C.peakDark; g.beginPath(); g.moveTo(x-r,y+r*.45); g.quadraticCurveTo(x-r*.7,y-r*1.15,x-r*.05,y-r*1.1); g.quadraticCurveTo(x-r*.45,y-r*.2,x-r*.1,y+r*.45); g.closePath(); g.fill()
    }
    const text = (s:string,x:number,y:number,size:number,color:string,weight='')=>{
      g.font = `${weight} ${size}px ${SERIF}`; const bw = g.measureText(s).width
      if(!free(x-bw/2-2,y-size/2-2,bw+4,size+4)) return false
      g.lineWidth = 3.2; g.strokeStyle = C.halo; g.strokeText(s,x,y); g.fillStyle = color; g.fillText(s,x,y); return true}
    g.textAlign = 'center'; g.textBaseline = 'middle'
    // Spots and the player go into `taken` first so labels never cover them.
    taken.push([hx-12,hy-12,hx+12,hy+12])
    const seals = spots.map(s=>({s,x:sx(s.x),y:sz(s.z)})).filter(o=>o.x>-20&&o.y>-20&&o.x<w+20&&o.y<h+20)
    const sealSize = mini?13:20
    for(const o of seals) taken.push([o.x-sealSize/2,o.y-sealSize/2,o.x+sealSize/2,o.y+sealSize/2])
    const shopPins = listShops().map(shop=>({shop,x:sx(shop.triggerPos[0]),y:sz(shop.triggerPos[2])})).filter(o=>o.x>-20&&o.y>-20&&o.x<w+20&&o.y<h+20)
    const shopSize = mini?14:21
    for(const o of shopPins) taken.push([o.x-shopSize/2,o.y-shopSize/2,o.x+shopSize/2,o.y+shopSize/2])
    if(!mini) {
      for(const o of shopPins) text(o.shop.mapMarker.label,o.x,o.y+shopSize*.5+10,12.5,o.shop.kind==='ebike'?'#20d6c1':'#ffc53d','700')
      for(const o of seals) text(o.s.name,o.x,o.y+sealSize*.5+10,13,C.seal,'600')
      for(const p of peaks) if(p.name&&scale>.12) text(p.name,sx(p.x),sz(p.z)+12,12,C.peakDark)
      if(scale>.22) for(const p of placeLabels) {const x = sx(p.x), y = sz(p.z); if(x>0&&y>0&&x<w&&y<h) text(p.n,x,y,11.5,C.inkSoft)}
    }
    // Road names along the longest segment.
    if(scale>(mini?.28:.25)) for(const r of visible) {
      if(!r.n||!r.label||(r.c>1&&scale<.6)||r.label.len*scale<r.n.length*12) continue
      const x = sx(r.label.x), y = sz(r.label.z); if(x<0||y<0||x>w||y>h) continue
      const size = mini?10:r.c<=1?12:11; g.font = `${size}px ${SERIF}`; const bw = g.measureText(r.n).width
      const ax = Math.abs(Math.cos(r.label.angle))*bw+Math.abs(Math.sin(r.label.angle))*size, ay = Math.abs(Math.sin(r.label.angle))*bw+Math.abs(Math.cos(r.label.angle))*size
      if(!free(x-ax/2,y-ay/2,ax,ay)) continue
      g.save(); g.translate(x,y); g.rotate(r.label.angle); g.lineWidth = 3; g.strokeStyle = C.roadHalo; g.strokeText(r.n,0,0)
      g.fillStyle = C.inkSoft; g.fillText(r.n,0,0); g.restore()
    }
    for(const o of seals) {
      const s = sealSize, done = ui.stamps.has(o.s.id)
      g.save(); g.translate(o.x,o.y); g.rotate(-.07)
      g.fillStyle = done?C.seal:'rgba(244,239,226,.95)'; g.strokeStyle = C.seal; g.lineWidth = done?1:1.4
      g.beginPath(); g.roundRect(-s/2,-s/2,s,s,s*.16); g.fill(); g.stroke()
      g.fillStyle = done?C.paperText:C.seal; g.font = `600 ${s*.62}px ${SERIF}`; g.fillText(o.s.seal,0,s*.04); g.restore()
    }
    for(const o of shopPins) {
      const s = shopSize, isEbike = o.shop.kind === 'ebike'
      g.save(); g.translate(o.x,o.y)
      g.fillStyle = isEbike ? '#20d6c1' : '#ffc53d'
      g.strokeStyle = '#101418'; g.lineWidth = mini ? 1.5 : 2
      g.beginPath(); g.roundRect(-s/2,-s/2,s,s,s*.24); g.fill(); g.stroke()
      g.fillStyle = '#101418'; g.font = `700 ${Math.round(s*.58)}px system-ui,sans-serif`
      g.fillText(isEbike ? '电' : '衣',0,s*.05)
      g.restore()
    }
    g.restore()
    }
    g.fillStyle=style.getPropertyValue('--region-mask');g.fill(mask,'evenodd')
    g.strokeStyle=style.getPropertyValue('--region-boundary');g.lineWidth=px(parseFloat(style.getPropertyValue('--region-boundary-width')));g.stroke(built.path)
    ;(regional??edge)?.labels(g,x0,z0,x1,z1,scale,style,(x,z)=>!far&&built.contains(x,z))
    g.setTransform(dpr,0,0,dpr,0,0)
    const missionTarget = getState().mission?.target
    if(missionTarget) {
      const tx = sx(missionTarget[0]), ty = sz(missionTarget[1])
      g.save()
      g.strokeStyle = '#20d6c1'; g.lineWidth = mini ? 2 : 2.5; g.setLineDash([5,4])
      g.beginPath(); g.moveTo(hx,hy); g.lineTo(tx,ty); g.stroke()
      g.setLineDash([])
      if(tx > -24 && ty > -24 && tx < w + 24 && ty < h + 24) {
        g.fillStyle = 'rgba(32,214,193,.28)'; g.beginPath(); g.arc(tx,ty,mini?10:15,0,Math.PI*2); g.fill()
        g.fillStyle = '#ffc53d'; g.strokeStyle = '#101216'; g.lineWidth = 2
        g.beginPath(); g.arc(tx,ty,mini?5:7,0,Math.PI*2); g.fill(); g.stroke()
      }
      g.restore()
    }
    // Player: vermilion arrow with a paper outline, pointing where the camera faces.
    const a = heading()
    g.save(); g.translate(hx,hy); g.rotate(Math.PI-a)
    g.fillStyle = C.sealSoft; g.globalAlpha = .35; g.beginPath(); g.arc(0,0,mini?11:16,0,Math.PI*2); g.fill(); g.globalAlpha = 1
    g.beginPath(); g.moveTo(0,-9); g.lineTo(6.5,7); g.lineTo(0,3.5); g.lineTo(-6.5,7); g.closePath()
    g.fillStyle = C.seal; g.strokeStyle = C.paperText; g.lineWidth = 1.8; g.stroke(); g.fill(); g.restore()
  }

  // --- Minimap + road name (dock slot)
  const mini = document.createElement('button'); mini.className = 'minimap'; mini.setAttribute('aria-label','打开地图（M）'); mini.title = '打开地图（M）'
  const miniCanvas = document.createElement('canvas'); mini.append(miniCanvas)
  const north = document.createElement('i'); north.textContent = '北'; mini.append(north)
  const road = document.createElement('div'); road.className = 'road-name'
  ui.slot.append(mini,road)
  const mapButton = document.createElement('button'); mapButton.className = 'dock-map'; mapButton.textContent = '地图'
  mapButton.setAttribute('aria-label','打开地图（M）'); mapButton.title = '打开地图（M）'; ui.buttons.append(mapButton)
  let lastRoad = ''
  function drawMini() {
    const size = mini.clientWidth; if(!size) return
    const dpr = Math.min(2,devicePixelRatio)
    if(miniCanvas.width!==Math.round(size*dpr)){miniCanvas.width = miniCanvas.height = Math.round(size*dpr)}
    const p = here(), altitude = host.walker()?.active?0:Math.max(0,p.y-200)
    paint(miniCanvas.getContext('2d')!,size,size,dpr,p.x,p.z,altitude>150?.1:altitude>40?.22:.42,true)
    const found = atlas.roadAt(p.x,p.z,host.walker()?.active?18:0)?.name ?? ''
    if(found!==lastRoad){lastRoad = found; road.textContent = found; road.hidden = !found}
  }

  // --- Full map
  const shops = listShops()
  const sheet = document.createElement('section'); sheet.className = 'atlas'; sheet.hidden = true
  sheet.innerHTML = `<canvas></canvas><div class="atlas-search"><input type="search" placeholder="搜地名、商铺、路名、码头、山名" aria-label="搜索地点" enterkeyhint="search"><div class="atlas-docks">${shops.map(sh=>`<button type="button" class="atlas-shop-btn" data-shop="${sh.shopId}">${sh.mapMarker.label} · ${sh.mapMarker.badge}</button>`).join('')}${waterDocks.map(d=>`<button type="button" data-dock="${d.id}">${d.name} · ${d.badge}</button>`).join('')}</div><ol></ol></div>
    <button class="atlas-close" aria-label="关闭地图">×</button><button class="atlas-here" aria-label="回到我的位置">◎</button>
    <div class="atlas-pop" hidden></div><p class="atlas-legend">朱印＝观景点 · 霓标＝商圈商铺 · 已开放区域可传送 · © OpenStreetMap contributors</p>`
  document.body.append(sheet)
  const canvas = sheet.querySelector('canvas')!, input = sheet.querySelector('input')!, results = sheet.querySelector('ol')!, pop = sheet.querySelector<HTMLElement>('.atlas-pop')!
  for(const b of Array.from(sheet.querySelectorAll<HTMLButtonElement>('.atlas-docks button[data-shop]'))) b.onclick = ()=>{const sh = listShops().find(x=>x.shopId===b.dataset.shop); if(sh){close(); if(ui.goShop) ui.goShop(sh); else ui.goPoint(sh.triggerPos[0],sh.triggerPos[2],sh.displayName)}}
  for(const b of Array.from(sheet.querySelectorAll<HTMLButtonElement>('.atlas-docks button[data-dock]'))) b.onclick = ()=>{const d = waterDocks.find(x=>x.id===b.dataset.dock); if(d){close(); ui.goDock(d)}}
  const view = {x:0,z:0,scale:.5}
  let pin:{x:number,z:number,name:string,spot?:Spot,dock?:WaterDock,shop?:ShopTriggerDef}|null = null
  function redraw() {
    if(sheet.hidden) return
    const w = sheet.clientWidth, h = sheet.clientHeight, dpr = Math.min(2,devicePixelRatio)
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr)}
    const g = canvas.getContext('2d')!; paint(g,w,h,dpr,view.x,view.z,view.scale,false)
    if(pin) {
      const x = w/2+(pin.x-view.x)*view.scale, y = h/2+(pin.z-view.z)*view.scale
      if(!pin.spot&&!pin.shop){g.setTransform(dpr,0,0,dpr,0,0); g.fillStyle = C.ink; g.beginPath(); g.arc(x,y-14,7,0,Math.PI*2); g.moveTo(x-5.5,y-10); g.lineTo(x,y); g.lineTo(x+5.5,y-10); g.fill()
        g.fillStyle = C.paper; g.beginPath(); g.arc(x,y-14,2.6,0,Math.PI*2); g.fill()}
      pop.style.transform = `translate(${Math.round(x)}px,${Math.round(y-(pin.spot||pin.shop?20:26))}px) translate(-50%,-100%)`
    }
  }
  function clampView(){view.scale = Math.min(3,Math.max(Math.min(sheet.clientWidth/(southeast.x-northwest.x),sheet.clientHeight/(southeast.z-northwest.z))*.9,view.scale))
    function axis(value:number,min:number,max:number,pixels:number){const half=pixels/(2*view.scale)
      return half*2>=max-min?(min+max)/2:Math.min(max-half,Math.max(min+half,value))}
    view.x=axis(view.x,northwest.x,southeast.x,sheet.clientWidth);view.z=axis(view.z,northwest.z,southeast.z,sheet.clientHeight)}
  function open() {
    const start=performance.now()
    requestMap('overview.bin')
    const p = here(); view.x = p.x; view.z = p.z; view.scale = innerWidth<700?.45:.6
    sheet.hidden = false; requestAnimationFrame(()=>{sheet.classList.add('show'); redraw();operation('mapOpen',start)})
    if(!matchMedia('(pointer:coarse)').matches) input.focus()
  }
  function close(){sheet.classList.remove('show'); setPin(null); input.value = ''; results.innerHTML = ''; input.blur()
    setTimeout(()=>{if(!sheet.classList.contains('show')) sheet.hidden = true},240)}
  function setPin(next:typeof pin) {
    pin = next; pop.hidden = !pin
    if(pin) {
      if(!built.contains(pin.x,pin.z)){pop.textContent='未开放'; redraw(); return}
      const sub = pin.shop?`商圈商铺 · ${pin.shop.mapMarker.badge}`:pin.spot?pin.spot.sub:pin.dock?pin.dock.sub:atlas.roadAt(pin.x,pin.z,40)?.name ?? ''
      pop.innerHTML = `<b>${pin.name}</b>${sub&&sub!==pin.name?`<span>${sub}</span>`:''}<button>前往</button>`
      pop.querySelector('button')!.onclick = ()=>{const target = pin!; close(); if(target.shop){if(ui.goShop) ui.goShop(target.shop); else ui.goPoint(target.x,target.z,target.name)} else if(target.spot) ui.goSpot(target.spot); else if(target.dock) ui.goDock(target.dock); else ui.goPoint(target.x,target.z,target.name)}
    }
    redraw()
  }
  function focus(x:number,z:number,scale=Math.max(view.scale,1.1)){view.x = x; view.z = z; view.scale = scale; clampView()}
  input.oninput = ()=>{
    const q = input.value.trim()
    const hits:{name:string,sub:string,x:number,z:number,spot?:Spot,dock?:WaterDock,shop?:ShopTriggerDef}[] = q?[
      ...listShops().filter(sh=>sh.displayName.includes(q)||sh.brandName.includes(q)||sh.mapMarker.label.includes(q)||sh.mapMarker.keywords.includes(q)).map(sh=>({name:sh.displayName,sub:'商圈商铺 · '+sh.mapMarker.badge,x:sh.triggerPos[0],z:sh.triggerPos[2],shop:sh})),
      ...waterDocks.filter(d=>d.name.includes(q)||d.sub.includes(q)||d.keywords.includes(q)).map(d=>({name:d.name,sub:'水边开船 · '+d.badge,x:d.x,z:d.z,dock:d})),
      ...spots.filter(s=>s.name.includes(q)||s.sub.includes(q)).map(s=>({name:s.name,sub:'观景点 · '+s.sub,x:s.x,z:s.z,spot:s})),
      ...atlas.search(q,8).map((p:Place)=>({name:p.n,sub:{peak:'山',scenic:'景点',gate:'城门',bridge:'桥',water:'水面',park:'公园',museum:'博物馆',memorial:'纪念地',road:'道路',school:'学校'}[p.k],x:p.x,z:p.z}))]:[]
    const seen = new Set<string>()
    results.innerHTML = ''
    for(const hit of hits) { if(!built.contains(hit.x,hit.z)||seen.has(hit.name)||seen.size>=8) continue; seen.add(hit.name)
      const li = document.createElement('li'); li.innerHTML = `<b>${hit.name}</b><span>${hit.sub}</span>`
      li.onclick = ()=>{focus(hit.x,hit.z); setPin({x:hit.x,z:hit.z,name:hit.name,spot:hit.spot,dock:hit.dock,shop:hit.shop}); results.innerHTML = ''; input.blur()}
      results.append(li)}
    if(q&&!seen.size) results.innerHTML = '<li class="none">没有找到</li>'
  }
  input.onkeydown = event=>{if(event.key==='Enter') results.querySelector<HTMLElement>('li:not(.none)')?.click(); if(event.key==='Escape'){event.stopPropagation(); close()}}
  sheet.querySelector<HTMLButtonElement>('.atlas-close')!.onclick = close
  sheet.querySelector<HTMLButtonElement>('.atlas-here')!.onclick = ()=>{const p = here(); focus(p.x,p.z,view.scale); redraw()}
  // Pan / zoom / tap
  const pointers = new Map<number,{x:number,y:number}>(); let moved = 0, pinch = 0
  canvas.onpointerdown = e=>{canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId,{x:e.clientX,y:e.clientY}); moved = 0
    if(pointers.size===2){const [a,b] = [...pointers.values()]; pinch = Math.hypot(a.x-b.x,a.y-b.y)}}
  canvas.onpointermove = e=>{const last = pointers.get(e.pointerId); if(!last) return
    if(pointers.size===1){view.x -= (e.clientX-last.x)/view.scale; view.z -= (e.clientY-last.y)/view.scale; moved += Math.abs(e.clientX-last.x)+Math.abs(e.clientY-last.y)}
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY})
    if(pointers.size===2){const [a,b] = [...pointers.values()], d = Math.hypot(a.x-b.x,a.y-b.y); if(pinch) view.scale *= d/pinch; pinch = d; moved = 99}
    clampView(); redraw()}
  canvas.onpointerup = e=>{pointers.delete(e.pointerId); pinch = 0
    if(moved<6&&pointers.size===0) {
      const r = canvas.getBoundingClientRect(), x = view.x+(e.clientX-r.left-r.width/2)/view.scale, z = view.z+(e.clientY-r.top-r.height/2)/view.scale
      const nearShop = built.contains(x,z)&&listShops().find(sh=>built.contains(sh.triggerPos[0],sh.triggerPos[2])&&Math.hypot(sh.triggerPos[0]-x,sh.triggerPos[2]-z)*view.scale<18)
      const near = built.contains(x,z)&&spots.find(s=>built.contains(s.x,s.z)&&Math.hypot(s.x-x,s.z-z)*view.scale<16)
      if(nearShop) setPin({x:nearShop.triggerPos[0],z:nearShop.triggerPos[2],name:nearShop.mapMarker.label,shop:nearShop})
      else if(near) setPin({x:near.x,z:near.z,name:near.name,spot:near})
      else setPin({x,z,name:atlas.roadAt(x,z,40)?.name ?? '这里'})
    }}
  canvas.onpointercancel = e=>{pointers.delete(e.pointerId); pinch = 0}
  canvas.onwheel = e=>{e.preventDefault(); const r = canvas.getBoundingClientRect(), ox = e.clientX-r.left-r.width/2, oy = e.clientY-r.top-r.height/2
    const before = {x:view.x+ox/view.scale,z:view.z+oy/view.scale}; view.scale *= Math.exp(-e.deltaY*.0015); clampView()
    view.x = before.x-ox/view.scale; view.z = before.z-oy/view.scale; clampView(); redraw()}
  addEventListener('resize',redraw)
  mini.onclick = mapButton.onclick = ()=>sheet.hidden?open():close()
  addEventListener('keydown',e=>{
    if(e.code==='Escape'&&!sheet.hidden){close();return}
    if(e.code==='KeyM'&&!e.repeat){
      if(!sheet.hidden){close();return}
      if(!isGlobalHotkeyBlocked(e.target)) open()
    }
  })

  let clock = 0
  return {paint, contains:built.contains, extent:atlas.extent, roadAt:atlas.roadAt.bind(atlas), open, close, get active(){return !sheet.hidden}, roadName:()=>lastRoad, search:(q:string)=>{input.value = q; input.oninput?.(new Event('input'))},
    tick(dt:number){clock += dt; if(clock<.2) return; clock = 0; if(document.body.dataset.photo!=='on') drawMini(); if(!sheet.hidden&&!pointers.size) redraw()}}
}
