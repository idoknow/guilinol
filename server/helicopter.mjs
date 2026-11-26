import {cruiseSeconds,fareForTour,flightClock,routeVersion} from '../lib/helicopter-clock.ts'

function phaseOf(row,now){
  if(!row)return 'idle'
  if(row.t0==null)return 'boarding'
  const {phase}=flightClock(now,Number(row.t0),row.mode)
  if(phase==='landed')return 'unloading'
  if(phase==='descend'||phase==='stop')return 'landing'
  if(phase==='start'||phase==='board')return 'boarding'
  return phase==='ended'?'idle':'flying'
}

export function helicopterStore(pool,clock=Date.now){
  return async function command(user,action,body={}){
    const client=await pool.connect()
    try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(425,427)')
      const now=clock(),one=async(sql,args=[]) => (await client.query(sql,args)).rows[0]
      const remove=ticket=>client.query('DELETE FROM helicopter_queue WHERE ticket=$1',[ticket])
      async function advance(){
        await client.query('DELETE FROM helicopter_queue WHERE t0 IS NULL AND (last_seen < $1 OR offered_at <= $2)',[now-30000,now-60000])
        let active=await one('SELECT * FROM helicopter_queue WHERE offered_at IS NOT NULL')
        if(active&&phaseOf(active,now)==='idle'){await remove(active.ticket);active=null}
        while(!active){
          const next=await one('SELECT * FROM helicopter_queue ORDER BY ticket LIMIT 1');if(!next)return null
          const billing=await bill(next)
          if(billing==='OK')active=await one('UPDATE helicopter_queue SET offered_at=$1 WHERE ticket=$2 RETURNING *',[now,next.ticket])
          else{await remove(next.ticket);await client.query('INSERT INTO helicopter_notice(passenger,code) VALUES($1,$2) ON CONFLICT(passenger) DO UPDATE SET code=excluded.code',[next.passenger,billing])}
        }
        return active
      }
      let active=await advance(),code='OK'
      if(action==='join'){
        if(!Object.hasOwn(cruiseSeconds,body?.mode))code='INVALID_MODE'
        else if(!await one('INSERT INTO helicopter_queue(passenger,mode,last_seen,route_version) VALUES ($1,$2,$3,$4) ON CONFLICT(passenger) DO NOTHING RETURNING ticket',[user,body.mode,now,routeVersion]))code='ALREADY_QUEUED'
      }else if(action==='ping')await client.query('UPDATE helicopter_queue SET last_seen=$2 WHERE passenger=$1 AND t0 IS NULL',[user,now])
      else if(action==='leave')await client.query('DELETE FROM helicopter_queue WHERE passenger=$1 AND ticket=$2 AND t0 IS NULL',[user,body.ticket])
      else if(action==='confirm'||action==='unload'){
        if(!active||active.passenger!==user||String(active.ticket)!==String(body?.ticket))code='NOT_YOUR_TURN'
        else if(action==='unload'){
          if(phaseOf(active,now)==='unloading')await remove(active.ticket);else code='IN_FLIGHT'
        }else if(active.t0===null)await client.query('UPDATE helicopter_queue SET t0=$2 WHERE ticket=$1',[active.ticket,now+7000])
      }
      async function bill(active){
          const user=active.passenger
          await client.query('SELECT pg_advisory_xact_lock(907071)')
          const row=await one('SELECT payload_json FROM player_saves WHERE user_id=$1 FOR UPDATE',[user]),save=row&&JSON.parse(row.payload_json)
          if(!Number.isSafeInteger(save?.money))return 'SAVE_NOT_READY'
          else{
            const count=save.economy?.helicopterTours??0,fare=fareForTour(count)
            if(save.money<fare)return 'INSUFFICIENT_FUNDS'
            else{
              const receipt=`heli:${active.ticket}`,balance=save.money-fare
              await client.query(`INSERT INTO player_ledger_txns(tx_id,user_id,idempotency_key,kind,delta,balance_after,ref_id,created_at) VALUES($1,$2,$1,'purchase',$3,$4,'helicopter_tour:ticket',$5)`,[receipt,user,-fare,balance,Math.floor(now/1000)])
              save.money=balance;save.updatedAt=Math.max(save.updatedAt+1,now);save.economy??={};save.economy.helicopterTours=count+1
              save.economy.txHistoryRing=[...(save.economy.txHistoryRing??[]),{txId:receipt,idempotencyKey:receipt,kind:'purchase',delta:-fare,balanceAfter:balance,refId:'helicopter_tour:ticket',at:now}].slice(-32)
              await client.query('UPDATE player_saves SET revision=revision+1,payload_json=$2,client_updated_at=$3,updated_at=$3 WHERE user_id=$1',[user,JSON.stringify(save),Math.floor(now/1000)])
              return 'OK'
            }
          }
      }
      active=await advance();const mine=await one('SELECT ticket,offered_at,mode FROM helicopter_queue WHERE passenger=$1',[user])
      const notice=await one('DELETE FROM helicopter_notice WHERE passenger=$1 RETURNING code',[user]);if(notice)code=notice.code
      const ahead=mine?await one('SELECT count(*) AS count, array_agg(mode) AS modes FROM helicopter_queue WHERE offered_at IS NULL AND ticket<$1',[mine.ticket]):null
      const remaining=!active||active.passenger===user?0:Math.max(0,((active.t0===null?Number(active.offered_at)+67000:Number(active.t0))+(cruiseSeconds[active.mode]+26)*1000-now)/1000)
      const result={code,now,state:phaseOf(active,now),mine:mine?{ticket:String(mine.ticket),offered:mine.offered_at!==null,mode:mine.mode}:null,ahead:Number(ahead?.count??0),eta:Math.ceil(remaining+(ahead?.modes??[]).reduce((sum,mode)=>sum+93+cruiseSeconds[mode],0)),flight:active?.t0!=null?{mode:active.mode,t0:Number(active.t0),version:active.route_version}:null}
      if(result.flight)result.flight.passengerUid=Number((await one('SELECT uid FROM users WHERE id=$1',[active.passenger])).uid)
      await client.query('COMMIT');return result
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
}
