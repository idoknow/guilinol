import './loading.css'
import {loadingTips} from './loading-tips'

// Three loading tiers (IDOK-140):
//   1 · fullLoader      — full-screen card, only while entering the city
//   2 · veil            — blocking overlay over the live scene (landing, travel, mode switch)
//   3 · streamIndicator — non-blocking corner pill while streets stream in; inlineBusy for lazy panels
// Styling lives in loading.css only.

export type Stage = {id:string;label:string;weight:number}
export interface FullLoader {
  showBeforeBlockingWork():Promise<void>
  stage(id:string,done:number,total:number,detail?:string):void
  fail(reason:string,retry:()=>void):void
  finish():Promise<void>
}
export interface Veil {progress(fraction:number,detail?:string):void;done():Promise<void>}
type State = {level:number;stage:string;fraction:number}
declare global {interface Window {__loading?:State}}

const IDLE:State = {level:0,stage:'idle',fraction:1}
const states = new Map<symbol,State>()
const clamp = (value:number)=>Math.max(0,Math.min(1,value||0))
const wait = (ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))
const reducedMotion = ()=>matchMedia('(prefers-reduced-motion: reduce)').matches

function publish(key:symbol,state?:State){
  if(state)states.set(key,state)
  else states.delete(key)
  const top=[...states.values()].sort((left,right)=>left.level-right.level)[0]
  window.__loading=top??IDLE
}
function meter(el:Element,label:string,fraction:number){
  el.setAttribute('role','progressbar')
  el.setAttribute('aria-label',label)
  el.setAttribute('aria-valuenow',String(Math.round(clamp(fraction)*100)))
}

export function fullLoader(stages:Stage[]):FullLoader {
  const root=document.querySelector<HTMLElement>('#boot')!, key=Symbol(), values=new Map<string,number>()
  const bar=root.querySelector<HTMLElement>('.boot-bar')!, msg=root.querySelector<HTMLElement>('#boot-msg')!
  const detail=root.querySelector<HTMLElement>('.ld-detail')!, number=root.querySelector<HTMLElement>('.ld-percent')!
  const tip=root.querySelector<HTMLElement>('.ld-tip')!
  const skip=new URLSearchParams(location.search).get('loading')==='skip'
  const totalWeight=stages.reduce((sum,item)=>sum+item.weight,0)
  let index=Math.floor(Math.random()*loadingTips.length), idle=0, fade=0, closed=false, last=-1
  tip.textContent=loadingTips[index]
  const reveal=setTimeout(()=>{if(!skip)root.hidden=false},80)
  const rotate=setInterval(()=>{
    tip.classList.add('dim')
    fade=window.setTimeout(()=>{tip.textContent=loadingTips[++index%loadingTips.length];tip.classList.remove('dim')},400)
  },6000)
  const clean=()=>{clearTimeout(reveal);clearTimeout(idle);clearTimeout(fade);clearInterval(rotate)}
  function draw(id:string,label:string,fraction:number,text:string){
    msg.textContent=label
    detail.textContent=text
    number.textContent=String(Math.round(fraction*100))
    bar.style.setProperty('--fraction',fraction.toFixed(4))
    meter(bar,label,fraction)
    publish(key,{level:1,stage:id,fraction})
    if(last!==fraction){
      last=fraction
      clearTimeout(idle)
      bar.classList.remove('idle')
      idle=window.setTimeout(()=>bar.classList.add('idle'),2000)
    }
  }
  return {
    async showBeforeBlockingWork(){
      if(skip || !root.hidden)return
      root.hidden=false
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
    },
    stage(id,done,total,text=''){
      if(closed)return
      const stage=stages.find(item=>item.id===id)
      if(!stage)return
      values.set(id,Math.max(values.get(id)??0,clamp(done/Math.max(1,total))))
      draw(id,stage.label,stages.reduce((sum,item)=>sum+item.weight*(values.get(item.id)??0),0)/totalWeight,text)
    },
    fail(reason,retry){
      closed=true;clean()
      if(!root.isConnected)document.body.append(root)
      root.hidden=false
      root.classList.remove('out')
      root.classList.add('failed')
      bar.classList.remove('idle')
      msg.textContent='没能进入桂林'
      detail.textContent=reason
      root.querySelector<HTMLButtonElement>('.ld-cancel')!.hidden=true
      const actions=root.querySelector<HTMLElement>('.ld-actions')!
      actions.hidden=false
      actions.querySelector('button')!.onclick=retry
    },
    async finish(){
      if(closed)return
      closed=true
      draw('frame','即将抵达',1,'')
      clean()
      root.classList.add('out')
      if(!root.hidden)await wait(reducedMotion()?120:420)
      root.remove()
      publish(key)
    },
  }
}

/** Tier 2. With `destination`, the haze fades in at once and names the place (travel); the progress
 *  ring still only appears once the trip takes longer than `delayMs`. Without it the whole veil waits. */
export function veil(label:string,opts:{delayMs?:number;onCancel?:()=>void;destination?:string}={}):Veil {
  const key=Symbol(), root=document.createElement('div')
  root.className='ld-veil'
  root.innerHTML='<section><b class="ld-place"></b><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19"/><circle class="arc" cx="22" cy="22" r="19" pathLength="1"/></svg><p aria-live="polite"></p><small></small><button class="ld-btn ghost" hidden type="button">取消</button></section>'
  const place=root.querySelector<HTMLElement>('.ld-place')!, caption=root.querySelector('p')!, notes=root.querySelector('small')!
  const arc=root.querySelector('.arc')!, ring=root.querySelector('svg')!, button=root.querySelector('button')!
  caption.textContent=label
  if(opts.destination){place.textContent=opts.destination;root.classList.add('travel')}
  let shown=0, fraction=0, slow=false, closed=false
  const update=()=>{
    arc.setAttribute('stroke-dasharray',`${fraction} 1`)
    meter(ring,label,fraction)
    if(shown)publish(key,{level:2,stage:label,fraction})
  }
  const delay=opts.delayMs??300
  const mount=()=>{if(!root.isConnected){document.body.append(root);requestAnimationFrame(()=>root.classList.add('in'))}}
  if(opts.destination)mount()
  const timer=setTimeout(()=>{shown=performance.now();mount();root.classList.add('busy');update()},delay)
  const timeout=setTimeout(()=>{slow=true;notes.textContent='网络较慢，仍在加载…';button.hidden=!opts.onCancel},15000)
  button.onclick=()=>{button.disabled=true;opts.onCancel?.()}
  const guard=(event:Event)=>{if(!(event.target instanceof Node&&button.contains(event.target)))event.stopImmediatePropagation()}
  const events=['keydown','pointerdown','wheel','touchstart','click']
  events.forEach(type=>window.addEventListener(type,guard,true))
  return {
    progress(value,text=''){
      if(closed)return
      fraction=Math.max(fraction,clamp(value))
      if(!slow)notes.textContent=text
      update()
    },
    async done(){
      if(closed)return
      closed=true
      clearTimeout(timer);clearTimeout(timeout)
      button.disabled=true
      if(shown)await wait(Math.max(0,400-performance.now()+shown))
      if(root.isConnected){
        root.classList.remove('in')
        await wait(reducedMotion()?0:opts.destination?450:280)
      }
      root.remove()
      publish(key)
      events.forEach(type=>window.removeEventListener(type,guard,true))
    },
  }
}

/** Tier 3. Call the returned function whenever the pending count changes. Text updates are capped at 4 Hz. */
export function streamIndicator(source:()=>number){
  const label='载入街区', key=Symbol(), root=document.createElement('aside')
  root.className='ld-corner'
  root.setAttribute('aria-live','polite')
  root.hidden=true
  root.innerHTML='<i aria-hidden="true"></i><span></span>'
  const text=root.querySelector('span')!
  let show=0, hide=0, peak=0, paint=0, painted=0
  function draw(){
    paint=0
    const pending=source()
    if(!pending)return
    painted=performance.now()
    text.textContent=`${label} · ${pending}`
    root.hidden=false
    if(!root.isConnected)document.body.append(root)
    const fraction=1-pending/peak
    meter(root,label,fraction)
    publish(key,{level:3,stage:'stream',fraction})
  }
  return ()=>{
    const pending=source()
    if(pending){
      clearTimeout(hide);hide=0
      peak=Math.max(peak,pending)
      if(root.hidden){if(!show)show=window.setTimeout(()=>{show=0;draw()},600)}
      else if(!paint)paint=window.setTimeout(draw,Math.max(0,250-(performance.now()-painted)))
    }else{
      clearTimeout(show);show=0
      if(root.hidden)peak=0
      else if(!hide)hide=window.setTimeout(()=>{hide=0;clearTimeout(paint);paint=0;root.hidden=true;peak=0;publish(key)},800)
    }
  }
}

export function inline(el:HTMLElement,{label,progress}:{label:string;progress?:number}){
  el.classList.add('ld-inline')
  el.setAttribute('aria-live','polite')
  el.textContent=label
  meter(el,label,progress??0)
  if(progress!==undefined){
    const bar=document.createElement('progress')
    bar.max=1;bar.value=clamp(progress)
    el.append(bar)
  }
}

export function inlineBusy(el:HTMLElement,label='正在加载'){
  const key=Symbol(), skeleton=document.createElement('div')
  skeleton.className='ld-skeleton'
  skeleton.innerHTML='<i></i><i></i><i></i>'
  skeleton.setAttribute('aria-live','polite')
  meter(skeleton,label,0)
  const timer=setTimeout(()=>{
    el.setAttribute('aria-busy','true')
    el.classList.add('ld-inline')
    document.body.append(skeleton)
    publish(key,{level:3,stage:label,fraction:0})
  },200)
  return ()=>{
    clearTimeout(timer)
    el.removeAttribute('aria-busy')
    el.classList.remove('ld-inline')
    skeleton.remove()
    publish(key)
  }
}
