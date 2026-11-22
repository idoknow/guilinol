import './loading.css'
import {loadingTips} from './loading-tips'

export type Stage = {id:string;label:string;weight:number}
export interface FullLoader {
  stage(id:string,done:number,total:number,detail?:string):void
  fail(reason:string,retry:()=>void):void
  finish():Promise<void>
}
export interface Veil {progress(fraction:number,detail?:string):void;done():Promise<void>}
type State = {level:number;stage:string;fraction:number}
declare global {interface Window {__loading?:State}}
const states = new Map<symbol,State>()
const clamp = (value:number)=>Math.max(0,Math.min(1,value||0))
const wait = (ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))
function publish(key:symbol,state?:State){
  if(state)states.set(key,state);else states.delete(key)
  const top=[...states.values()].sort((left,right)=>left.level-right.level)[0]
  if(top)window.__loading=top
}
function meter(el:Element,label:string,fraction:number){
  el.setAttribute('role','progressbar');el.setAttribute('aria-label',label)
  el.setAttribute('aria-valuenow',String(Math.round(clamp(fraction)*100)))
}
export function fullLoader(stages:Stage[]):FullLoader {
  const root=document.querySelector<HTMLElement>('#boot')!, key=Symbol(), values=new Map<string,number>()
  const bar=root.querySelector<HTMLElement>('.boot-bar')!, msg=root.querySelector<HTMLElement>('#boot-msg')!
  const detail=root.querySelector<HTMLElement>('.ld-detail')!, number=root.querySelector<HTMLElement>('.ld-percent')!
  const tip=root.querySelector<HTMLElement>('.ld-tip')!, skip=new URLSearchParams(location.search).get('loading')==='skip'
  let index=0, idle=0, fade=0, closed=false, last=-1
  tip.textContent=loadingTips[index]
  const reveal=setTimeout(()=>{if(!skip)root.hidden=false},80)
  const rotate=setInterval(()=>{tip.classList.add('dim');fade=window.setTimeout(()=>{tip.textContent=loadingTips[++index%loadingTips.length];tip.classList.remove('dim')},400)},6000)
  const clean=()=>{clearTimeout(reveal);clearTimeout(idle);clearTimeout(fade);clearInterval(rotate)}
  function draw(id:string,label:string,fraction:number,text:string){
    msg.textContent=label;detail.textContent=text;number.textContent=`${Math.round(fraction*100)}%`
    bar.style.setProperty('--fraction',String(fraction));meter(bar,label,fraction);publish(key,{level:1,stage:id,fraction})
    if(last!==fraction){last=fraction;clearTimeout(idle);bar.classList.remove('idle');idle=window.setTimeout(()=>bar.classList.add('idle'),2000)}
  }
  return {stage(id,done,total,text=''){
    if(closed)return
    const stage=stages.find(item=>item.id===id);if(!stage)return
    values.set(id,Math.max(values.get(id)??0,clamp(done/Math.max(1,total))))
    draw(id,stage.label,stages.reduce((sum,item)=>sum+item.weight*(values.get(item.id)??0),0)/stages.reduce((sum,item)=>sum+item.weight,0),text)
  },fail(reason,retry){
    closed=true;clean();if(!root.isConnected)document.body.append(root);root.hidden=false;root.classList.remove('out');root.classList.add('failed');msg.textContent='没能进入桂林';detail.textContent=reason
    root.querySelector<HTMLButtonElement>('.ld-cancel')!.hidden=true
    const actions=root.querySelector<HTMLElement>('.ld-actions')!;actions.hidden=false
    actions.querySelector('button')!.onclick=retry
  },async finish(){if(closed)return;closed=true;draw('frame','即将抵达',1,'');clean();root.classList.add('out')
    if(!root.hidden)await wait(matchMedia('(prefers-reduced-motion: reduce)').matches?120:420)
    root.remove();publish(key)
  }}
}
export function veil(label:string,opts:{delayMs?:number;onCancel?:()=>void}={}):Veil {
  const key=Symbol(), root=document.createElement('div');root.className='ld-veil';root.innerHTML='<section><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><circle class="arc" cx="20" cy="20" r="17" pathLength="1"/></svg><p aria-live="polite"></p><small></small><button hidden type="button">取消</button></section>'
  const caption=root.querySelector('p')!, notes=root.querySelector('small')!, arc=root.querySelector('.arc')!, button=root.querySelector('button')!
  caption.textContent=label;let shown=0,fraction=0,slow=false,closed=false
  const update=()=>{arc.setAttribute('stroke-dasharray',`${fraction} 1`);meter(root.querySelector('svg')!,label,fraction);if(shown)publish(key,{level:2,stage:label,fraction})}
  const timer=setTimeout(()=>{shown=performance.now();document.body.append(root);update()},opts.delayMs??300)
  const timeout=setTimeout(()=>{slow=true;notes.textContent='网络较慢，仍在加载…';button.hidden=!opts.onCancel},15000)
  button.onclick=()=>{button.disabled=true;opts.onCancel?.()}
  const guard=(event:Event)=>{if(!(event.target instanceof Node&&button.contains(event.target)))event.stopImmediatePropagation()}
  const events=['keydown','pointerdown','wheel','touchstart','click'];events.forEach(type=>window.addEventListener(type,guard,true))
  return {progress(value,text=''){if(closed)return;fraction=Math.max(fraction,clamp(value));if(!slow)notes.textContent=text;update()},async done(){if(closed)return;closed=true;clearTimeout(timer);clearTimeout(timeout)
    button.disabled=true;if(shown)await wait(Math.max(0,400-performance.now()+shown));root.remove();publish(key);events.forEach(type=>window.removeEventListener(type,guard,true))
  }}
}
export function streamIndicator(source:()=>{pending:number;label?:string}){
  const root=document.createElement('aside'),key=Symbol();root.className='ld-corner';root.setAttribute('aria-live','polite');root.hidden=true
  let since=0,empty=0,peak=0,last=''
  const timer=setInterval(()=>{const {pending,label='载入街区'}=source(),now=performance.now()
    if(pending){empty=0;since||=now;if(now-since<600&&root.hidden)return;peak=Math.max(peak,pending)
      const text=`${label} · ${pending}`;if(text===last&&!root.hidden)return;last=text;root.textContent=text;root.hidden=false
      if(!root.isConnected)document.body.append(root);const fraction=1-pending/peak;meter(root,label,fraction);publish(key,{level:3,stage:'stream',fraction})
    }else{since=0;if(root.hidden)return;empty||=now;if(now-empty>=800){root.hidden=true;peak=0;publish(key)}}
  },250);return ()=>{clearInterval(timer);root.remove();publish(key)}
}
export function inline(el:HTMLElement,{label,progress}:{label:string;progress?:number}){
  el.classList.add('ld-inline');el.setAttribute('aria-live','polite');el.textContent=label;meter(el,label,progress??0)
  if(progress!==undefined){const bar=document.createElement('progress');bar.max=1;bar.value=clamp(progress);el.append(bar)}
}
export function inlineBusy(el:HTMLElement,label='正在加载'){
  const key=Symbol(),skeleton=document.createElement('div');skeleton.className='ld-skeleton';skeleton.innerHTML='<i></i><i></i><i></i>';skeleton.setAttribute('aria-live','polite');meter(skeleton,label,0)
  const timer=setTimeout(()=>{el.setAttribute('aria-busy','true');el.classList.add('ld-inline');document.body.append(skeleton);publish(key,{level:3,stage:label,fraction:0})},200)
  return ()=>{clearTimeout(timer);el.removeAttribute('aria-busy');el.classList.remove('ld-inline');skeleton.remove();publish(key)}
}
