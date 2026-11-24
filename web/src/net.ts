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
  // 不能像以前那样 6 次之后永久放弃：满员、同一出口 IP 挤爆、切后台被断，都是暂时的。
  // 一旦放弃，玩家只能刷新页面，表现出来就是「联机时好时坏」。
  function retry(fixed?:number){
    update('offline')
    if(disposed)return
    const backoff=fixed??Math.min(1000*2**Math.min(attempt++,5),16000)
    timer=window.setTimeout(connect,Math.round(backoff*(0.8+Math.random()*0.4)))
  }
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
        // 4001 = 同账号在别处在线（可能只是上次的旧连接还没被服务端回收）→ 等几秒再连
        if(event.code===4001){update('offline');retry(4000+Math.random()*2000)}
        // 4003 有两种：票据过期（立刻重新取票重连）和被封禁（停下）
        else if(event.code===4003){if(/banned/i.test(String(event.reason)))update('offline');else retry(1200)}
        else retry()}
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
