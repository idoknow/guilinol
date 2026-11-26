export const markAlpha=.04
let currentUid=0, generation=0, timer=0, objectUrl=''
let image:HTMLImageElement|null=null, layer:HTMLDivElement|null=null
const listeners=new Set<(tile:HTMLImageElement|null)=>void>()
export function onMarkTile(listener:(tile:HTMLImageElement|null)=>void){listeners.add(listener);listener(image)}
function paint(){
  if(!image){layer?.remove();return}
  layer??=document.createElement('div');layer.setAttribute('aria-hidden','true')
  layer.style.cssText=`position:fixed;inset:0;z-index:2147483646;pointer-events:none;background:url(${objectUrl}) repeat 0 0/${512/devicePixelRatio}px auto;opacity:${markAlpha};image-rendering:pixelated`
  ;(document.fullscreenElement??document.body).append(layer)
}
function clearTile(){image=null;paint();listeners.forEach(listener=>listener(null));URL.revokeObjectURL(objectUrl);objectUrl=''}
export function setMarkUser(uid:number){
  if(currentUid===uid)return
  currentUid=uid;const epoch=++generation;clearTimeout(timer);clearTile();if(!uid)return
  async function refresh(){
    let pending=''
    try{
      const response=await fetch(`/api/trace/tile?seed=${Math.floor(Date.now()/300000)}`,{cache:'no-store'})
      if(epoch!==generation)return
      if(!response.ok){clearTile();if(response.status===401||response.status===403){setMarkUser(0);return}throw Error()}
      pending=URL.createObjectURL(await response.blob());const next=new Image();next.src=pending;await next.decode()
      if(epoch!==generation)return
      const previous=objectUrl;image=next;objectUrl=pending;pending='';paint();listeners.forEach(listener=>listener(next));URL.revokeObjectURL(previous)
    }catch{if(epoch===generation){clearTile();timer=window.setTimeout(refresh,60000)}return}finally{if(pending)URL.revokeObjectURL(pending)}
    timer=window.setTimeout(refresh,300000-Date.now()%300000)
  }
  void refresh()
}
addEventListener('resize',paint);document.addEventListener('fullscreenchange',paint)
