import {readFileSync} from 'node:fs'

const {version,routes}=JSON.parse(readFileSync(new URL('./flight-paths.json',import.meta.url)))
const pad=[-808,153.97,258]
const nearPad=(x,y,z)=>Math.hypot(x-pad[0],z-pad[2])<=8 && Math.abs(y-pad[1])<=3

function nearAircraft(path,elapsed,position){
  if(!Number.isFinite(elapsed))return false
  const end=path.length-1
  for(const lag of [0,.25,.5,.75,1,-.25]){
    const time=Math.max(0,Math.min(end,elapsed-lag)),index=Math.min(end-1,Math.floor(time)),fraction=time-index
    const expected=path[index].map((value,axis)=>value+(path[index+1][axis]-value)*fraction)
    if(Math.hypot(position.x-expected[0],position.y-expected[1],position.z-expected[2])<=5)return true
  }
  return false
}

export function watchFlight(pool){
  let flight=null,expires=0,reading=false
  async function refresh(){
    if(reading)return
    reading=true
    try{
      const {rows}=await pool.query(`SELECT users.uid,q.ticket,q.seat,q.mode,q.route_version,q.t0
        FROM helicopter_queue q JOIN users ON users.id=q.passenger
        WHERE q.offered_at IS NOT NULL AND q.t0 IS NOT NULL LIMIT 1`)
      flight=rows[0]??null;expires=Date.now()+2500
    }catch{expires=0}finally{reading=false}
  }
  if(pool){void refresh();setInterval(refresh,1000).unref()}
  return at=>!pool?null:at<expires?flight:undefined
}

export function passengerMove(flight,player,msg,at){
  const claimed=msg.passenger===true || msg.bike==='heli'
  const invalid={reject:true,kind:'teleport'}
  const padTransition=()=>nearPad(player.x,player.y,player.z)&&nearPad(msg.x,msg.y,msg.z)
  if(flight===undefined && (claimed || player.flightTicket))return padTransition()?null:{reject:true,kind:'flight_unverified'}
  if(!flight || Number(flight.uid)!==player.uid || flight.route_version!==version || ![1,2,3].includes(flight.seat) || !Object.hasOwn(routes,flight.mode)){
    player.flightTicket=null
    return claimed && !padTransition()?invalid:null
  }
  const path=routes[flight.mode],elapsed=(at-Number(flight.t0))/1000,end=path.length-1
  if(elapsed < -7 || elapsed>end+60)return claimed && !padTransition()?invalid:null
  if(player.flightTicket!==flight.ticket){
    const reconnect=claimed && elapsed>0 && elapsed<end && nearAircraft(path,(player.posAt-Number(flight.t0))/1000,player) && nearAircraft(path,elapsed,msg)
    if(!reconnect && !(elapsed<=0 && padTransition()))return claimed?invalid:null
    player.flightTicket=flight.ticket
  }
  if((elapsed<=0 || elapsed>=end) && padTransition())return {ok:true}
  if(elapsed>=end && !claimed)return null
  return nearAircraft(path,elapsed,msg)?{ok:true}:invalid
}
