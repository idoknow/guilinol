export type Channel='near'|'world'
export type ChatMessage={t:'chat';ch:Channel;mid:string;id:string;uid:number;name:string;text:string;ts:number;sys?:'notice'|'mute'|'system'}
export type ChatAck={t:'chat_ack';cid:string;ok:boolean;mid?:string;code?:string;msg?:string}
type ChatEvent=ChatMessage|ChatAck|{t:'chat_hist';ch:Channel;msgs:ChatMessage[]}|{t:'chat_del';mid:string}|{t:'chat_mute';until:number;reason:string}|{t:'chat_reset'}
const listeners=new Set<(event:ChatEvent)=>void>()
const pending=new Map<string,(ack:ChatAck)=>void>()
let transport:((packet:object)=>void)|undefined
export function receiveChat(event:ChatEvent){
  if(event.t==='chat_ack')pending.get(event.cid)?.(event)
  for(const listener of listeners)listener(event)
}
export function bindChat(next?:typeof transport){
  if(!next){for(const [cid,resolve] of pending)resolve({t:'chat_ack',cid,ok:false,code:'error'});if(transport)receiveChat({t:'chat_reset'})}transport=next
}
export const chatStore={
  subscribe(listener:(event:ChatEvent)=>void){listeners.add(listener);return ()=>listeners.delete(listener)},
  history(ch:Channel){transport?.({t:'chat_hist',ch})},
  send(ch:Channel,text:string):Promise<ChatAck>{const cid=crypto.randomUUID();return new Promise(resolve=>{
    const error:ChatAck={t:'chat_ack',cid,ok:false,code:'error'}
    if(!transport){resolve(error);return}
    const timer=setTimeout(()=>{pending.delete(cid);resolve(error)},30000)
    pending.set(cid,ack=>{clearTimeout(timer);pending.delete(cid);resolve(ack)});transport({t:'chat',ch,text,cid})
  })},
}
