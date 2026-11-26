export function ipGate(clock=Date.now) {
  const entries=new Map(), windowMs=60000, holdMs=120000
  let sweepAt=0
  return (ip,kind)=>{
    if(!ip || ip==='unknown')return true
    const now=clock()
    if(now>=sweepAt){sweepAt=now+windowMs;for(const [key,row] of entries)if(now>=Math.max(row.start+windowMs,row.until))entries.delete(key)}
    let row=entries.get(ip)
    if(row && row.until>now)return false
    if(!row || now-row.start>=windowMs){if(!row && entries.size>=8192)return false;row={start:now,connection:0,ticket:0,until:0};entries.set(ip,row)}
    if(++row[kind]>(kind==='ticket'?16:240)){row.until=now+holdMs;return false}
    return true
  }
}
export function tooFast(socket,at){
  if(socket.rateStart==null || at-socket.rateStart>=1000){socket.rateStart=at;socket.rateCount=0}
  return ++socket.rateCount>100
}
