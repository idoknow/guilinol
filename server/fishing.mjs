import {waters,species,sizes,weightScale} from '../web/src/fishing/config.ts'

export function fishingStore(pool){
  const cache=new Map()
  async function record(user,body){
    const {clientCatchId,zoneId,speciesId,grade,weight,method}=body??{}
    const zone=waters.find(entry=>entry.id===zoneId), fish=species.find(entry=>entry.id===speciesId)
    if(typeof clientCatchId!=='string'||!/^([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i.test(clientCatchId)||
      !zone?.methods.includes(method)||!zone.fish.includes(speciesId)||!fish?.methods.includes(method)||grade!==fish.grade||
      !Number.isFinite(weight)||weight<=0||weight>Math.round(110*weightScale[sizes.indexOf(fish.size)])/100)return {status:'ignored'}
    const client=await pool.connect()
    try{
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(391,hashtext($1))',[user])
      const result=await client.query(`INSERT INTO fishing_catches(user_id,client_catch_id,zone_id,species_id,grade,weight,method)
        SELECT $1,$2,$3,$4,$5,$6,$7 WHERE NOT EXISTS (SELECT FROM fishing_catches WHERE user_id=$1 AND caught_at>statement_timestamp()-interval '8 seconds')
        AND (SELECT count(*) FROM fishing_catches WHERE user_id=$1 AND caught_at>=date_trunc('day',statement_timestamp(),'Asia/Shanghai'))<300
        ON CONFLICT(user_id,client_catch_id) DO NOTHING`,[user,clientCatchId,zoneId,speciesId,grade,weight,method])
      await client.query('COMMIT');return {status:result.rowCount?'recorded':'ignored'}
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  async function boards(zone){
    if(!waters.some(entry=>entry.id===zone))return null
    const hit=cache.get(zone);if(hit?.expires>Date.now())return hit.result
    const {rows}=await pool.query(`WITH totals AS (
      SELECT grouping(zone_id) AS global,user_id,count(*) AS total,count(*) FILTER(WHERE grade='legendary') AS legendary,zone_id
      FROM fishing_catches GROUP BY GROUPING SETS ((user_id),(zone_id,user_id))
      HAVING grouping(zone_id)=1 OR zone_id=$1
    ), ranked AS (SELECT global,nickname,total,legendary,
      row_number() OVER(PARTITION BY global ORDER BY total DESC,user_id COLLATE "C") AS pos,
      row_number() OVER(PARTITION BY global ORDER BY legendary DESC,user_id COLLATE "C") AS legend_pos
      FROM totals JOIN users ON users.id=user_id) SELECT * FROM ranked WHERE pos<=10 OR (legendary>0 AND legend_pos<=3)`,[zone])
    const section=global=>{const subset=rows.filter(row=>row.global===global)
      const list=(pos,key,limit)=>subset.filter(row=>row[pos]<=limit&&row[key]>0).sort((left,right)=>left[pos]-right[pos]).map(row=>({nickname:row.nickname,count:Number(row[key])}))
      return {topCount:list('pos','total',10),topLegendary:list('legend_pos','legendary',3)}}
    const result={zone:section(0),global:section(1)};cache.set(zone,{result,expires:Date.now()+60000});return result
  }
  return {record,boards}
}
