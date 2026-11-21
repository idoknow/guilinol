const modes=['walk','drive','fly','map','menu'] as const
type Point={mode:string;x:number;z:number}
export function sessionMetrics(state:()=>Point|undefined) {
  const started=performance.now(), grids=new Set<string>()
  const totals:Record<string,number>={visible:0,teleports:0,mapOpens:0}
  for(const mode of modes){totals[mode+'Seconds']=0; totals[mode+'Meters']=0}
  let last=started, previous:Point|undefined, visible=!document.hidden
  function sample() {
    const now=performance.now(), point=state(), elapsed=(now-last)/1000
    if(visible){
      totals.visible+=elapsed
      const mode=previous?.mode??'menu'
      totals[mode+'Seconds']+=elapsed
      if(point){
        grids.add(Math.floor(point.x/250)+','+Math.floor(point.z/250))
        if(previous && mode===point.mode) totals[mode+'Meters']+=Math.hypot(point.x-previous.x,point.z-previous.z)
      }
    }
    previous=point
    visible=!document.hidden
    last=now
  }
  setInterval(sample,1000)
  return {sample,teleport(){previous=undefined;totals.teleports++},mapOpen(){totals.mapOpens++},
    snapshot(){sample();return {...totals,total:(last-started)/1000,grids:grids.size}}}
}

export function visitor():Record<string,string|number> {
  const today=new Date().toISOString().slice(0,10)
  const language=navigator.language.split('-')[0].toLowerCase()
  let referrer='direct'
  if(document.referrer){
    const url=new URL(document.referrer)
    referrer=url.origin===location.origin?'internal':/(^|\.)(google|bing|baidu|duckduckgo)\./.test(url.hostname)?'search':
      /(^|\.)(weibo|facebook|reddit|twitter|x|t|zhihu)\./.test(url.hostname)?'social':'other'
  }
  const meta:Record<string,string>={referrer,language:/^[a-z]{2,8}$/.test(language)?language:'und'}
  try{
    const saved=localStorage.getItem('glol-visitor')?.split('|')
    if(saved && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(saved[0]) && /^\d{4}-\d\d-\d\d$/.test(saved[1])){
      return {...meta,vid:saved[0],firstDay:saved[1],returnVisit:1}
    }
    const vid=crypto.randomUUID()
    localStorage.setItem('glol-visitor',vid+'|'+today)
    return {...meta,vid,firstDay:today,returnVisit:0}
  }catch{return meta}
}

export function vitals() {
  const values:Record<string,number>={}
  let start=0,last=0,shift=0
  const interactions=new Map<number,number>()
  let minId=Infinity,maxId=0
  const observers:PerformanceObserver[]=[]
  const consume=(entry:PerformanceEntry)=>{
    const e=entry as PerformanceEntry & {hadRecentInput:boolean;value:number;interactionId:number}
    if(e.entryType==='largest-contentful-paint')values.lcp=e.startTime
    if(e.name==='first-contentful-paint')values.fcp=e.startTime
    if(e.entryType==='layout-shift'&&!e.hadRecentInput){
      if(e.startTime-last>=1000||e.startTime-start>=5000){start=e.startTime;shift=0}
      shift+=e.value;last=e.startTime;values.cls=Math.max(values.cls??0,shift)
    }
    if(e.entryType==='event'&&e.interactionId){
      minId=Math.min(minId,e.interactionId); maxId=Math.max(maxId,e.interactionId)
      interactions.set(e.interactionId,Math.max(interactions.get(e.interactionId)??0,e.duration))
      if(interactions.size>50){
        const shortest=[...interactions].reduce((a,b)=>a[1]<=b[1]?a:b)
        interactions.delete(shortest[0])
      }
    }
  }
  for(const type of ['paint','largest-contentful-paint','layout-shift','event']){
    if(typeof PerformanceObserver==='undefined'||!PerformanceObserver.supportedEntryTypes.includes(type))continue
    if(type==='layout-shift')values.cls=0
    const ob=new PerformanceObserver(list=>list.getEntries().forEach(consume))
    ob.observe({type,buffered:true,...(type==='event'?{durationThreshold:16}:{})});observers.push(ob)
  }
  return ()=>{
    for(const ob of observers)ob.takeRecords().forEach(consume)
    const times=[...interactions.values()].sort((a,b)=>b-a)
    const count=(performance as Performance & {interactionCount?:number}).interactionCount??(1+(maxId-minId)/7)
    if(times.length)values.inp=times[Math.min(times.length-1,Math.floor(count/50))]
    return values
  }
}
