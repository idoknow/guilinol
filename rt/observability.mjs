import {monitorEventLoopDelay} from 'node:perf_hooks'

const startedAt=Date.now(), delay=monitorEventLoopDelay({resolution:20})
delay.enable()
const slots=[], events=[], chat=[]
const known=new Set('join pos avatar who chat emote hit revive welcome leave online banned error players roster'.split(' '))
const rejects={ticket:0,full:0,uidOnline:0,banned:0,ipLimit:0}
let peak=0,peakAt=startedAt,skips=0,slowCloses=0
function append(list,item,max){list.push(item);if(list.length>max)list.shift()}
export function packet(ws,direction,type,bytes){
  const sec=Math.floor(Date.now()/1000), index=sec%60
  if(slots[index]?.sec!==sec)slots[index]={sec,in:{},out:{}}
  const counts=slots[index][direction][known.has(type)?type:'other']??={packets:0,bytes:0}
  counts.packets++;counts.bytes+=bytes
  ws[direction+'Bytes']=(ws[direction+'Bytes']??0)+bytes
  if(direction==='out'){winOut++;winOutBytes+=bytes}
}
export function event(type,player={},extra={}){
  const {id,uid=null,name='',joinedAt,ip}=player,ts=Date.now()
  append(events,{ts,type,id,uid,name,joinedAt,ip,durationSec:joinedAt?Math.floor((ts-joinedAt)/1000):null,...extra},300)
}
export function reject(reason,player){rejects[reason]++;event('reject',player,{reason})}
export function joined(player,online){event('join',player);if(online>peak){peak=online;peakAt=Date.now()}}
export function skipped(ws,closing){ws.skipped=(ws.skipped??0)+1;skips++;winSkips++;if(closing)slowCloses++}
export function chatted(player,text){player.chats++;append(chat,{ts:Date.now(),uid:player.uid,name:player.name,text},100)}
export function position(player,at){player.positions=player.positions.filter(ts=>ts>at-10000);player.positions.push(at)}
export function state(players,sockets,bans,proto,maxPlayers){
  const now=Date.now(), sec=Math.floor(now/1000),traffic={in:{},out:{}}
  for(const slot of slots)if(slot&&slot.sec>sec-60)for(const dir of ['in','out'])for(const [type,value] of Object.entries(slot[dir])){
    const sum=traffic[dir][type]??={packets:0,bytes:0};sum.packets+=value.packets;sum.bytes+=value.bytes
  }
  const {rss,heapUsed}=process.memoryUsage()
  return {server:{startedAt,uptimeSec:Math.floor((now-startedAt)/1000),proto,maxPlayers,online:players.size,connections:sockets.size,
    peak,peakAt,rssMb:rss/1048576,heapMb:heapUsed/1048576,loopP50Ms:delay.percentile(50)/1e6,loopP99Ms:delay.percentile(99)/1e6,traffic,skips,slowCloses,rejects},
    players:[...players.values()].map(({id,uid,name,x,y,z,yaw,bike,hb,v,hp,dn,sc,em,emoteUntil,joinedAt,lastPos,positions,ws,chats,ip,ua})=>({
      id,uid,name,x,y,z,yaw,mode:bike||hb?'bike':'walk',v,hp,dn,sc,em:now<emoteUntil?em:0,joinedAt,lastPosAt:lastPos||null,posHz:positions.filter(ts=>ts>now-10000).length/10,
      inBytes:ws.inBytes??0,outBytes:ws.outBytes??0,bufferedAmount:ws.bufferedAmount,skips:ws.skipped??0,rttMs:ws.rtt??null,avgRttMs:ws.meanRtt??null,chats,ip,ua})),
    bans:[...bans].map(([uid,ban])=>({uid,...ban})),events,chat}
}

// rt-stats 窗口：自上次调用以来的事件循环延迟、发送量、慢客户端跳过数；调用后清零重新统计
// 直方图记录的是采样间隔（含 resolution 本身），减掉 resolution 才是「事件循环晚了多少」
const RES=10,win=monitorEventLoopDelay({resolution:RES});win.enable()
const lag=v=>Math.max(0,v/1e6-RES)
let winAt=Date.now(),winSkips=0,winOut=0,winOutBytes=0
export function loopP99(){return lag(win.percentile(99))}
export function window(){
  const now=Date.now(),sec=(now-winAt)/1000
  const out={loopP50Ms:+lag(win.percentile(50)).toFixed(1),loopP99Ms:+lag(win.percentile(99)).toFixed(1),loopMaxMs:+lag(win.max).toFixed(1),
    outPerSec:Math.round(winOut/sec),outKBps:Math.round(winOutBytes/sec/1024),slowSkips:winSkips,cpuPct:cpuPct(now)}
  win.reset();winAt=now;winSkips=0;winOut=0;winOutBytes=0
  return out
}
let cpuPrev=process.cpuUsage(),cpuAt=Date.now()
function cpuPct(now){const cur=process.cpuUsage(cpuPrev);const pct=(cur.user+cur.system)/1000/Math.max(1,now-cpuAt)*100;cpuPrev=process.cpuUsage();cpuAt=now;return Math.round(pct)}
