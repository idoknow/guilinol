import type {AnimationClip,Scene,Camera} from 'three'
import type {Avatar} from '../../lib/avatar'
import {players,type Pose} from './net-players'
import {onUser} from './ui/account'
import type {MpStatus} from './ui/mp-pref'

function publish(detail:MpStatus){window.dispatchEvent(new CustomEvent('glol:mp-status',{detail}))}

type State='connecting'|'online'|'offline'
export function attachNet(scene:Scene,clips:AnimationClip[],getPose:()=>Pose,getAvatar:()=>Avatar,camera:Camera) {
  const peers=players(scene,clips,camera)
  let socket:WebSocket|undefined,attempt=0,generation=0,timer=0,lastSent=-Infinity,disposed=false
  let state:State='offline',online=0
  const badge=new URLSearchParams(location.search).has('debug')?document.createElement('output'):null
  if(badge){badge.style.cssText='position:fixed;top:0;right:0;z-index:99;background:white;color:black';document.body.append(badge)}
  let sequence=0, desired=0, sent=-1
  let sentTimes:number[]=[]
  function flushEmote(){
    if(state!=='online'||desired===sent)return
    const now=performance.now()
    sentTimes=sentTimes.filter(t=>now-t<1010)
    if(desired && sentTimes.length>=2)return
    send({t:'emote',id:desired,s:++sequence});sent=desired;if(desired)sentTimes.push(now)
  }
  function emote(id:number){if(id===desired&&id)sent=-1;desired=id;flushEmote()}
  function status(){return {state,online}}
  function update(next:State,count=0){state=next;online=count;if(badge)badge.textContent=`${state} · ${online}`;publish({state,online})}
  function send(packet:object){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(packet))}
  function retry(){update('offline');if(attempt<6&&!disposed)timer=window.setTimeout(connect,Math.min(1000*2**attempt++,16000))}
  async function connect(){
    const version=++generation;update('connecting')
    try{
      const response=await fetch('/api/rt/ticket',{method:'POST',credentials:'same-origin'})
      if(version!==generation)return
      if(response.status===401||response.status===403){update('offline');return}
      if(!response.ok)throw Error('ticket unavailable')
      const {ticket}=await response.json();if(version!==generation)return
      const endpoint=localStorage.getItem('guiling.ws')||`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`
      const ws=new WebSocket(endpoint);socket=ws
      ws.onopen=()=>{if(version===generation)send({t:'join',ticket,avatar:getAvatar(),...getPose()})}
      ws.onmessage=event=>{
        if(version!==generation)return
        const msg=JSON.parse(event.data)
        switch(msg.t){
          case 'welcome': sent=0;sentTimes=[]
          case 'players':
            peers.clear();for(const player of msg.players)peers.add(player)
            attempt=0;update('online',msg.online);break
          case 'online':update('online',msg.online);break
          case 'join':peers.add(msg.player);break
          case 'leave':peers.remove(msg.id);break
          case 'pos':peers.move(msg.id,msg);break
          case 'emote':peers.emote(msg.from,msg.id,msg.s);break
          case 'avatar':peers.avatar(msg.id,msg.avatar);break
        }
      }
      ws.onclose=event=>{if(version!==generation)return;socket=undefined;peers.clear()
        if(event.code===4001||event.code===4003)update('offline');else retry()}
    }catch{if(version===generation)retry()}
  }
  function stop(){generation++;clearTimeout(timer);socket?.close();socket=undefined;peers.clear();update('offline')}
  function avatarChanged(){if(state==='online')send({t:'avatar',avatar:getAvatar()})}
  function tick(dt:number){if(state!=='online')return
    flushEmote();const pose=getPose(),now=performance.now();if(now-lastSent>=50){lastSent=now;send({t:'pos',...pose})}peers.tick(dt,pose)}
  let account:string|null|undefined
  const unsubscribe=onUser(user=>{const id=user?.id??null;if(id===account)return
    account=id;stop();if(id){attempt=0;void connect()}})
  window.addEventListener('glol:avatar-change',avatarChanged)
  const manual=()=>{if(!disposed){stop();attempt=0;void connect()}}
  window.addEventListener('glol:mp-reconnect',manual)
  return {emote,status,tick,who:()=>send({t:'who'}),probe:peers.probe,reconnect:manual,
    dispose(){disposed=true;unsubscribe();stop();badge?.remove();window.removeEventListener('glol:avatar-change',avatarChanged);window.removeEventListener('glol:mp-reconnect',manual);publish({state:'off',online:0})}}
}
