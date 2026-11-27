const lastLogin=`(select max(last_login_at) from social_identities where user_id=users.id) as "lastLogin"`

export async function searchBanUsers(pool,query){
  if(!query)return []
  const pattern='%'+query.replace(/[\\%_]/g,'\\$&')+'%'
  const {rows}=await pool.query(`select uid,nickname,${lastLogin} from users where nickname ilike $1
    order by (lower(nickname)=lower($2)) desc,nickname,uid limit 10`,[pattern,query])
  const devices=rows.length?(await pool.query(`select uid,model,browser,isp,city,ip24 from mp_devices
    where uid=any($1::bigint[]) order by last desc nulls last,fp`,[rows.map(row=>row.uid)])).rows:[]
  return rows.map(row=>({...row,devices:devices.filter(device=>String(device.uid)===String(row.uid))}))
}

export async function enrichBans(pool,bans){
  if(!bans.length)return bans
  const uids=bans.filter(row=>row.kind==='uid').map(row=>row.value)
  const fps=bans.filter(row=>row.kind==='fp').map(row=>row.value)
  const {rows:devices}=await pool.query(`select uid,fp,model,browser,screen,ip24,isp,city,first,last from mp_devices
    where fp=any($1::text[]) or fp in (select fp from mp_devices where uid=any($2::bigint[]))
    order by last desc nulls last,uid,fp`,[fps,uids])
  const accountIds=[...new Set([...uids,...devices.map(row=>row.uid)].map(String))]
  const {rows:accounts}=await pool.query(`select uid,nickname,${lastLogin} from users where uid=any($1::bigint[])`,[accountIds])
  const byUid=new Map(accounts.map(row=>[String(row.uid),row]))
  const byDevice=new Map(),byOwner=new Map()
  function append(map,key,row){if(!map.has(key))map.set(key,[]);map.get(key).push(row)}
  for(const row of devices){
    append(byDevice,row.fp,row)
    append(byOwner,String(row.uid),row)
  }
  const account=row=>byUid.get(String(row.uid))??{uid:row.uid,nickname:null,lastLogin:null}
  return bans.map(row=>{
    if(row.kind==='fp'){
      const observations=byDevice.get(row.value)??[]
      return {...row,devices:observations,accounts:observations.map(account)}
    }
    return {...row,nickname:byUid.get(String(row.value))?.nickname??null,
      devices:(byOwner.get(String(row.value))??[]).map(device=>({...device,accounts:byDevice.get(device.fp).map(account)}))}
  })
}
