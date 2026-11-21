import {sessionMetrics, visitor, vitals} from './session-metrics'
import type {WebGLRenderer} from 'three'

const enabled = typeof crypto.randomUUID==='function' && Math.random() < Number(import.meta.env.VITE_TELEMETRY_SAMPLE_RATE ?? 1)
const sid = enabled ? crypto.randomUUID() : ''
type Fields = Record<string, string | number>
const context: Fields = {}
const queue: Fields[] = []
const percentile = (sorted: number[], p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0
type State = {mode:string;x:number;z:number;chunks:number}
let currentState:(()=>State)|undefined
const session=enabled?sessionMetrics(()=>currentState?.()):undefined
export function fault(errorKind:string,filename='',line=0,reason?:unknown) {
  if(!enabled)return
  if(!filename && reason instanceof Error && typeof reason.stack==='string'){
    // Examine stack frames locally. Only the basename hash leaves the browser.
    const frame=reason.stack.split('\n').slice(1).join('\n').match(/(?:https?:\/\/[^\s)]+\/)([^/\s)]+?):(\d+):\d+(?:\)|$)/m)
    if(frame){filename=frame[1];line=Number(frame[2])}
  }
  const file=filename.split(/[?#]/)[0].split('/').pop()??''
  let hash=2166136261
  for(const c of file+':'+line) hash=Math.imul(hash^c.charCodeAt(0),16777619)
  record('error',{count:1,errorKind,signature:(hash>>>0).toString(16).padStart(8,'0')})
}
export function record(kind: string, fields: Fields) {
  if (!enabled || queue.length>=512)return
  const s=currentState?.()
  const grid=s?Math.floor(s.x/250)+','+Math.floor(s.z/250):''
  queue.push({kind,mode:s?.mode??'menu',grid,...fields})
}
export function operation(kind: string, start: number, completed=true) {
  if(kind==='teleport'&&completed)session?.teleport()
  if(kind==='mapOpen')session?.mapOpen()
  record(kind, {ms: Math.round(performance.now() - start)})
}

function flush() {
  while (queue.length) {
    const rows: Fields[] = []
    let blob = new Blob()
    for (const event of queue) {
      const next = new Blob([JSON.stringify({sid, context, rows:[...rows,event]})], {type:'application/json'})
      if (next.size > 3900) break
      rows.push(event)
      blob = next
    }
    if (!rows.length || !navigator.sendBeacon('/api/t', blob)) break
    queue.splice(0, rows.length)
  }
}

const cacheStatuses=new Map<string,string>()
export function cacheResponse(response:Response) {
  if(!enabled || cacheStatuses.size>=4096)return
  const status=response.headers.get('cf-cache-status')?.toUpperCase()
  if(status && /^(HIT|MISS|BYPASS|EXPIRED|STALE|UPDATING|REVALIDATED|DYNAMIC)$/.test(status))cacheStatuses.set(response.url,status)
}
const resources = new Map<string, PerformanceResourceTiming[]>()
function collect(entries: PerformanceEntry[]) {
  for (const entry of entries as PerformanceResourceTiming[]) {
    const url = new URL(entry.name)
    if (url.origin !== location.origin) continue
    const path = url.pathname
    if (path.startsWith('/api/') && path !== '/api/t') {
      record('api', {ms:entry.duration, api:path.startsWith('/api/feedback')?'feedback':path.includes('login')?'login':'other'})
    }
    if (!/^\/(world|landmarks|textures|basis)\//.test(path)) continue
    const category = /manifest\.json$/.test(path)?'manifest':/\.(glc|trees)$/.test(path)?'chunk':/\.glb$/.test(path)?'landmark':(/\.(basis|ktx2)$/.test(path)||path.startsWith('/basis/'))?'basis':'other'
    const key=category+' '+(cacheStatuses.get(entry.name)??'')
    cacheStatuses.delete(entry.name)
    const list = resources.get(key) ?? []
    if (list.length < 4096) list.push(entry)
    resources.set(key,list)
  }
}
let observer: PerformanceObserver | undefined
function report() {
  if (observer) collect(observer.takeRecords())
  for (const [key,list] of resources) {
    const [category,cfCache]=key.split(' ')
    const times = list.map(e=>e.duration).sort((a,b)=>a-b)
    record('resource',{category,cfCache,count:list.length,bytes:list.reduce((n,e)=>n+e.transferSize,0),
      cache:list.filter(e=>e.transferSize===0).length/list.length,p50:percentile(times,.5),p95:percentile(times,.95)})
  }
  resources.clear()
  flush()
}
if (enabled) {
  const ua = navigator.userAgent
  const nav = navigator as Navigator & {deviceMemory?:number;connection?:{effectiveType:string;rtt:number;downlink:number}}
  Object.assign(context,{device:/Mobile|Android/i.test(ua)?'mobile':'desktop',os:/Android|iPhone|iPad|Windows|Mac OS X|Linux/i.exec(ua)?.[0]??'other',
    browser:/Edg|Firefox|Chrome|Safari/.exec(ua.replace(/.*(Edg\/)/,'$1'))?.[0]??'other',
    cores:nav.hardwareConcurrency,memory:nav.deviceMemory,width:screen.width,height:screen.height,dpr:devicePixelRatio,
    effectiveType:nav.connection?.effectiveType,rtt:nav.connection?.rtt,downlink:Number.isFinite(nav.connection?.downlink)?nav.connection?.downlink:undefined,quality:'default'})
  void fetch('/version.json').then(r=>r.json()).then(v=>{context.build=String(v.sha).slice(0,64)}).catch(()=>{})
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('resource')) {
    observer = new PerformanceObserver(list=>collect(list.getEntries()))
    observer.observe({type:'resource',buffered:true})
  }
  const navigation = ()=>setTimeout(()=>{
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    if (n) record('navigation',{dns:n.domainLookupEnd-n.domainLookupStart,tcp:(n.secureConnectionStart||n.connectEnd)-n.connectStart,
      tls:n.secureConnectionStart?n.connectEnd-n.secureConnectionStart:0,ttfb:n.responseStart-n.requestStart,dcl:n.domContentLoadedEventEnd,load:n.loadEventEnd})
  },0)
  if (document.readyState==='complete') navigation()
  else addEventListener('load',navigation,{once:true})
  Object.assign(context,visitor())
  const getVitals=vitals()
  const checkpoint=()=>{record('session',session!.snapshot());const values=getVitals();if(Object.keys(values).length)record('vitals',values);report()}
  addEventListener('error',e=>fault('error',e.filename,e.lineno))
  addEventListener('unhandledrejection',e=>fault('rejection','',0,e.reason))
  setInterval(report,30000)
  addEventListener('pagehide',checkpoint)
  document.addEventListener('visibilitychange',()=>{if(document.hidden)checkpoint();else session?.sample()})
}
export function identifyWorld(bytes:ArrayBuffer) {
  if (enabled) void crypto.subtle.digest('SHA-256',bytes).then(hash=>{
    context.world=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')
  })
}
export function instrument(renderer: WebGLRenderer, state:()=>State) {
  if (!enabled) return ()=>{}
  currentState=state
  const gl=renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info')
  context.maxTextureSize=gl.getParameter(gl.MAX_TEXTURE_SIZE)
  context.webgl2=Number(renderer.capabilities.isWebGL2)
  if(ext) context.gpu=String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).replace(/[^\p{L}\p{N} (),.:_+/@\[\]-]/gu,' ').slice(0,160)
  renderer.domElement.addEventListener('webglcontextlost',()=>{record('contextLost',{count:1});fault('webgl')})
  let frames:number[]=[]
  setInterval(()=>{
    const s=state()
    const sum=frames.reduce((a,b)=>a+b,0)
    if(!frames.length && (document.hidden||s.mode==='menu'))return
    const heap=(performance as Performance & {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize
    record('window',{fps:sum?frames.length*1000/sum:0,frameP95:percentile(frames.sort((a,b)=>a-b),.95),
      longFrames:frames.filter(ms=>ms>50).length,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
      ...renderer.info.memory,chunks:s.chunks,...(heap===undefined?{}:{heap})})
    frames=[]
  },10000)
  return (ms:number)=>{if(ms>0&&!document.hidden&&frames.length<10000)frames.push(ms)}
}
