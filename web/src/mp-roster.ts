// 同城联机名册（IDOK-222）：net.ts 每 300 ms 写一次，地图 / 在线玩家面板只读这里，
// 不用碰 three 和 net-players（那两个是联机时才懒加载的大块）。
export interface RosterPlayer {id:string;uid?:number;name:string;x:number;z:number;yaw:number;v:number;bike:boolean;joinedAt?:number}
export interface Roster {me:{x:number;z:number;yaw:number}|null;players:RosterPlayer[];at:number}

let current:Roster = {me:null,players:[],at:0}
const listeners = new Set<(roster:Roster)=>void>()

export function roster(){return current}
export function setRoster(next:Roster){current = next; for(const fn of listeners) fn(next)}
export function clearRoster(){setRoster({me:null,players:[],at:performance.now()})}
export function onRoster(fn:(roster:Roster)=>void){listeners.add(fn); return ()=>{listeners.delete(fn)}}

/** 在地图上定位某个玩家：地图模块监听这个事件（地图没加载时什么也不发生）。 */
export function locatePlayer(id:string){dispatchEvent(new CustomEvent('glol:mp-locate',{detail:{id}}))}

const DIRS = ['北','东北','东','东南','南','西南','西','西北']
/** 方位 + 距离，比如「东南 320 m」。世界坐标 x 向东、z 向南。 */
export function bearing(from:{x:number;z:number}, to:{x:number;z:number}){
  const dx = to.x-from.x, dz = to.z-from.z, d = Math.hypot(dx,dz)
  if(d<8) return '就在身边'
  const angle = (Math.atan2(dx,-dz)*180/Math.PI+360)%360
  const dist = d<1000?`${Math.round(d/10)*10} m`:`${(d/1000).toFixed(d<10000?1:0)} km`
  return `${DIRS[Math.round(angle/45)%8]} ${dist}`
}
