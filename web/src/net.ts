import type {AnimationClip,Scene,Camera} from 'three'
import type {Avatar} from '../../lib/avatar'
import {players,type Pose} from './net-players'
import {onUser} from './ui/account'
import type {MpStatus} from './ui/mp-pref'
import {setRoster,clearRoster} from './mp-roster'

function publish(detail:MpStatus){window.dispatchEvent(new CustomEvent('glol:mp-status',{detail}))}

type State='connecting'|'online'|'offline'|'replaced'
export function attachNet(scene:Scene,clips:AnimationClip[],getPose:()=>Pose,getAvatar:()=>Avatar,camera:Camera) {
  const peers=players(scene,clips,camera)
  let socket:WebSocket|undefined,attempt=0,generation=0,timer=0,lastSent=-Infinity,disposed=false
  // 全服低频名册（5s 一条）：视野外的人只在这里出现，用来画地图点 / 名册面板；
  // 场景里的 3D 人物仍然只来自 AOI 的 join/pos/leave。
  const rosterOnly=new Map<string,{id:string;name:string;x:number;z:number;joinedAt?:number}>()
  let lastRoster=0
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
  function update(next:State,count=0){state=next;online=count;if(next!=='online')clearRoster();if(badge)badge.textContent=`${state} · ${online}`;publish({state,online})}
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
    // 复用在用的连接：切偏好、重复触发、取票竞态都不能再建第二条（一条 tab 只许一条 socket）
    if(socket&&(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING))return
    clearTimeout(timer)
    const version=++generation;update('connecting')
    try{
      const response=await fetch('/api/rt/ticket',{method:'POST',credentials:'same-origin'})
      if(version!==generation)return
      if(response.status===401||response.status===403){update('offline');return}
      if(!response.ok)throw Error('ticket unavailable')
      const {ticket}=await response.json();if(version!==generation)return
      const endpoint=localStorage.getItem('guiling.ws')||`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`
      const previous=socket
      if(previous){previous.onopen=previous.onmessage=previous.onclose=previous.onerror=null;try{previous.close(1000,'replace')}catch{}}
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
          case 'roster':
            rosterOnly.clear()
            for(const row of msg.players||[]){
              const [id,name,x,z,jt]=row as [string,string,number,number,number?]
              if(id)rosterOnly.set(id,{id,name,x,z,joinedAt:jt})
            }
            break
        }
      }
      ws.onclose=event=>{if(version!==generation)return;socket=undefined;peers.clear()
        // 4001 = 同账号在别处在线（可能只是上次的旧连接还没被服务端回收）→ 等几秒再连
        // 另一台设备/标签页一直在线时会持续 4001，所以从 4s 起照常指数退避，不按固定间隔轮询
        // replaced = 另一台设备接管了同一个账号：这不是故障，别自动重连（否则两台设备会互相顶）
        if(event.code===4001&&/replaced/i.test(String(event.reason)))update('replaced')
        else if(event.code===4001){attempt=Math.max(attempt,2);retry()}
        // 4003 有两种：票据过期（第一次 1.2s 后重新取票，之后指数退避，免得票据一直被拒时每秒打一次）和被封禁（停下）
        else if(event.code===4003){if(/banned/i.test(String(event.reason)))update('offline');else retry(attempt++===0?1200:undefined)}
        else retry()}
    }catch{if(version===generation)retry()}
  }
  function stop(){generation++;clearTimeout(timer);socket?.close();socket=undefined;peers.clear();rosterOnly.clear();update('offline')}
  function avatarChanged(){if(state==='online')send({t:'avatar',avatar:getAvatar()})}
  function tick(dt:number){if(state!=='online')return
    flushEmote();const pose=getPose(),now=performance.now();if(now-lastSent>=50){lastSent=now;send({t:'pos',...pose})}peers.tick(dt,pose)
    if(now-lastRoster>=300){lastRoster=now
      const live=peers.list().map(p=>({id:p.id,uid:p.uid,name:p.name,x:p.x,z:p.z,yaw:p.yaw,v:p.v,bike:!!p.bike,joinedAt:p.jt}))
      const seen=new Set(live.map(p=>p.id))
      const far=[...rosterOnly.values()].filter(p=>!seen.has(p.id)).map(p=>({id:p.id,name:p.name,x:p.x,z:p.z,yaw:0,v:0,bike:false,joinedAt:p.joinedAt}))
      setRoster({me:{x:pose.x,z:pose.z,yaw:pose.yaw},at:now,players:[...live,...far]})}}
  let account:string|null|undefined
  const unsubscribe=onUser(user=>{const id=user?.id??null;if(id===account)return
    account=id;stop();if(id){attempt=0;void connect()}})
  window.addEventListener('glol:avatar-change',avatarChanged)
  // 切后台/关页面时干净收尾：手机浏览器经常直接冻结 WebSocket，主动关掉能立刻把服务端名额还回去，
  // 不用等心跳超时——这也是「同一账号第二次连不上」的常见来源。
  const pageHide=()=>{
    clearTimeout(timer);generation++
    const ws=socket;socket=undefined
    if(ws){ws.onopen=ws.onmessage=ws.onclose=ws.onerror=null;try{ws.close(1000,'pagehide')}catch{}}
  }
  const pageShow=()=>{if(!disposed&&!socket&&account&&state!=='replaced')retry(500)}
  window.addEventListener('pagehide',pageHide)
  window.addEventListener('pageshow',pageShow)
  const manual=()=>{if(!disposed){stop();attempt=0;void connect()}}
  window.addEventListener('glol:mp-reconnect',manual)
  return {emote,status,tick,who:()=>send({t:'who'}),probe:peers.probe,reconnect:manual,
    dispose(){disposed=true;unsubscribe();stop();clearTimeout(timer)
      if(socket){const ws=socket;socket=undefined;ws.onopen=ws.onmessage=ws.onclose=ws.onerror=null;try{ws.close(1000,'dispose')}catch{}}
      badge?.remove();window.removeEventListener('glol:avatar-change',avatarChanged);window.removeEventListener('glol:mp-reconnect',manual)
      window.removeEventListener('pagehide',pageHide);window.removeEventListener('pageshow',pageShow);publish({state:'off',online:0})}}
}
