import type {Host} from './host'
import {label, type Weather} from '../look/time'

// 拍照模式: hides every HUD element (body[data-photo=on]), freezes the walker (camera still orbits),
// exposes hour / weather / filter / focal length, and saves a JPEG rendered at ≥2560 px on the long edge.
// Filters are CSS filter strings so the live preview (on the canvas) and the saved file (ctx.filter) match.
const filters:[string,string][] = [
  ['原片','none'],
  ['青绿','saturate(1.18) hue-rotate(-8deg) contrast(1.04)'],
  ['胶片','sepia(.2) contrast(1.08) saturate(.88) brightness(1.03)'],
  ['暮金','sepia(.32) saturate(1.3) hue-rotate(-12deg) brightness(1.02)'],
  ['水墨','grayscale(1) sepia(.12) contrast(1.18) brightness(1.06)'],
]
const skies:[string,Weather][] = [['晴','clear'],['雾','mist'],['雨','rain']]
const lenses:[string,number][] = [['广角',72],['标准',55],['人像',34],['长焦',18]]

export function photoMode(host:Host, place:()=>string) {
  const bar = document.createElement('section'); bar.className = 'photo-bar'; bar.hidden = true
  const exit = document.createElement('button'); exit.className = 'photo-exit'; exit.setAttribute('aria-label','退出拍照'); exit.textContent = '×'; exit.hidden = true
  bar.innerHTML = `<div class="photo-row"><label class="photo-hour"><span></span><input type="range" min="0" max="23.9" step=".1" aria-label="时辰"></label>
      <span class="chips" data-group="sky">${skies.map(([t,v])=>`<button data-v="${v}">${t}</button>`).join('')}</span></div>
    <div class="photo-row"><span class="chips" data-group="filter">${filters.map(([t],i)=>`<button data-v="${i}">${t}</button>`).join('')}</span>
      <span class="chips" data-group="lens">${lenses.map(([t,v])=>`<button data-v="${v}">${t}</button>`).join('')}</span>
      <span class="chips" data-group="opts"><button data-v="figure">人物</button><button data-v="sign">落款</button></span></div>
    <button class="photo-shutter" aria-label="按快门"><i></i></button>`
  const flash = document.createElement('div'); flash.className = 'photo-flash'
  const shot = document.createElement('figure'); shot.className = 'photo-shot'; shot.hidden = true
  document.body.append(bar,exit,flash,shot)
  const hour = bar.querySelector<HTMLInputElement>('input')!, hourText = bar.querySelector<HTMLElement>('.photo-hour span')!
  const state = {filter:0, fov:55, figure:true, sign:true}
  let active = false, saved = {fov:55, flowing:true}

  function chips(group:string, on:(v:string)=>boolean) {
    for(const b of Array.from(bar.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] button`))) b.classList.toggle('on',on(b.dataset.v!))
  }
  function refresh() {
    chips('sky',v=>host.clock.weather===v); chips('filter',v=>+v===state.filter); chips('lens',v=>+v===state.fov)
    chips('opts',v=>v==='figure'?state.figure:state.sign)
    host.renderer.domElement.style.filter = filters[state.filter][1]==='none'?'':filters[state.filter][1]
    host.camera.fov = state.fov; host.camera.updateProjectionMatrix()
    host.walker()?.showFigure(state.figure)
  }
  bar.addEventListener('click',event=>{
    const b = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-v]'); if(!b) return
    const group = b.parentElement!.dataset.group, v = b.dataset.v!
    if(group==='sky') host.clock.weather = v as Weather
    if(group==='filter') state.filter = +v
    if(group==='lens') state.fov = +v
    if(group==='opts') state[v as 'figure'|'sign'] = !state[v as 'figure'|'sign']
    refresh()
  })
  hour.oninput = ()=>{host.clock.goal = null; host.clock.set(+hour.value)}
  exit.onclick = close
  bar.querySelector<HTMLButtonElement>('.photo-shutter')!.onclick = capture

  function open() {
    if(active) return; active = true
    saved = {fov:host.camera.fov, flowing:host.clock.flowing}; state.fov = lenses.some(([,v])=>v===saved.fov)?saved.fov:55
    host.clock.flowing = false; host.walker()?.hold(true)
    document.body.dataset.photo = 'on'; bar.hidden = exit.hidden = false; refresh()
  }
  function close() {
    if(!active) return; active = false
    host.clock.flowing = saved.flowing; host.walker()?.hold(false); host.walker()?.showFigure(true)
    host.camera.fov = saved.fov; host.camera.updateProjectionMatrix(); host.renderer.domElement.style.filter = ''
    delete document.body.dataset.photo; bar.hidden = exit.hidden = true; shot.hidden = true
  }

  function signature(g:CanvasRenderingContext2D, w:number, h:number) {
    const unit = Math.max(w,h)/1600, x = 34*unit, y = h-34*unit, s = 38*unit
    g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 8*unit
    g.fillStyle = '#a9503c'; g.beginPath(); g.roundRect(x,y-s,s,s,5*unit); g.fill(); g.shadowBlur = 0
    g.strokeStyle = 'rgba(244,239,226,.9)'; g.lineWidth = 1.6*unit; g.beginPath(); g.roundRect(x+4*unit,y-s+4*unit,s-8*unit,s-8*unit,3*unit); g.stroke()
    g.fillStyle = '#f4efe2'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.font = `600 ${22*unit}px "Noto Serif SC","Source Han Serif SC","Songti SC",serif`; g.fillText('桂',x+s/2,y-s/2+unit)
    const where = place(), text = ['网上桂林',where,label(host.clock.hour)].filter(Boolean).join('  ·  ')
    g.textAlign = 'left'; g.font = `${17*unit}px "Noto Serif SC","Source Han Serif SC","Songti SC",serif`
    g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 6*unit; g.fillText(text,x+s+12*unit,y-s/2+unit); g.restore()
  }

  let url = ''
  function capture() {
    const r = host.renderer, ratio = r.getPixelRatio(), long = Math.max(innerWidth,innerHeight)
    const hi = Math.min(4096/long,Math.max(ratio,2560/long))
    r.setPixelRatio(hi); r.setSize(innerWidth,innerHeight,false); host.draw()
    const c = document.createElement('canvas'); c.width = r.domElement.width; c.height = r.domElement.height
    const g = c.getContext('2d')!; const css = filters[state.filter][1]
    if(css!=='none') g.filter = css
    g.drawImage(r.domElement,0,0); g.filter = 'none'
    r.setPixelRatio(ratio); r.setSize(innerWidth,innerHeight,false); host.draw()
    if(state.sign) signature(g,c.width,c.height)
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go')
    c.toBlob(blob=>{if(!blob) return; if(url) URL.revokeObjectURL(url); url = URL.createObjectURL(blob)
      const where = place()||'桂林', stamp = new Date(), name = `网上桂林-${where}-${String(stamp.getMonth()+1).padStart(2,'0')}${String(stamp.getDate()).padStart(2,'0')}-${String(stamp.getHours()).padStart(2,'0')}${String(stamp.getMinutes()).padStart(2,'0')}${String(stamp.getSeconds()).padStart(2,'0')}.jpg`
      const file = new File([blob],name,{type:'image/jpeg'})
      const share = navigator.canShare?.({files:[file]})&&matchMedia('(pointer:coarse)').matches
      shot.innerHTML = `<img alt="刚拍的照片"><figcaption><a download="${name}">保存</a>${share?'<button>分享</button>':''}<button class="shot-close" aria-label="收起">×</button></figcaption>`
      shot.querySelector('img')!.src = url; shot.querySelector('a')!.href = url
      shot.querySelector<HTMLButtonElement>('figcaption button:not(.shot-close)')?.addEventListener('click',()=>void navigator.share({files:[file],title:'网上桂林'}).catch(()=>{}))
      shot.querySelector<HTMLButtonElement>('.shot-close')!.onclick = ()=>{shot.hidden = true}
      shot.hidden = false; shot.classList.remove('in'); void shot.offsetWidth; shot.classList.add('in')
      Object.assign(window,{lastPhoto:{name,bytes:blob.size,width:c.width,height:c.height}})
    },'image/jpeg',.92)
  }

  let shown = ''
  return {open, close, capture, get active(){return active}, tick(){
    if(!active) return
    if(document.activeElement!==hour) hour.value = String(host.clock.hour)
    const text = label(host.clock.hour); if(text!==shown){shown = text; hourText.textContent = text}
  }}
}
