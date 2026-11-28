import {type Env,Problem,invalid,now,sessionAccount,sessionHash,unauthorized} from './auth'
import {FOG_MAX_CELLS,FOG_POST_LIMIT,FOG_VERSION,fogValidKey} from './fog'

// 地图迷雾（IDOK-588）：个人进度存服务器，换设备接着开图。
// 存的是「走过的格子号」，稀疏文本 —— 走一小时也就几百格，几十 KB 封顶。
// IDOK-605：格子口径从 32 m 收到 8 m，行里带 version；口径对不上就当作没开过图，
// 这样旧记录不会在细网格上被错认成一堆散落在别处的亮点。
const decode = (text:string|null|undefined):number[] =>
  text ? text.split(',').map(Number).filter(fogValidKey) : []
const encode = (cells:number[]) => cells.join(',')

export async function walkFog(request:Request, env:Env) {
  const method = request.method
  if (method !== 'GET' && method !== 'POST') throw new Problem(405,'method','不支持的请求方式')
  if (method === 'POST' && request.headers.get('Origin') !== new URL(request.url).origin) throw new Problem(403,'origin','请求来源不符')
  const user = await sessionAccount(env.DB, await sessionHash(request))
  if (!user) unauthorized()
  const reply = (data:unknown) => Response.json(data,{headers:{'Cache-Control':'no-store'}})
  // SELECT * 让「迁移还没跑、没有 version 列」的库也能安静退回空进度，而不是 500。
  const row = await env.DB.prepare('SELECT * FROM walk_fog WHERE user_id=?')
    .bind(user.id).first<{cells?:string;count?:number;updated_at?:number;version?:number}>()
  const known = new Set(row?.version === FOG_VERSION ? decode(row.cells) : [])
  if (method === 'GET') return reply({cells:[...known], count:known.size, version:FOG_VERSION, updatedAt:(row?.updated_at ?? 0) * 1000})
  const body = await request.json().catch(() => null) as {add?:unknown} | null
  const add = body?.add
  if (!Array.isArray(add) || add.length > FOG_POST_LIMIT || !add.every(fogValidKey)) invalid()
  let added = 0
  for (const key of add as number[]) if (!known.has(key)) { known.add(key); added++ }
  if (!added) return reply({count:known.size, added:0, version:FOG_VERSION, updatedAt:(row?.updated_at ?? 0) * 1000})
  const cells = [...known].sort((a,b) => a - b).slice(0,FOG_MAX_CELLS)
  const stamp = now()
  await env.DB.prepare(`INSERT INTO walk_fog(user_id,cells,count,updated_at,version) VALUES(?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET cells=excluded.cells,count=excluded.count,updated_at=excluded.updated_at,version=excluded.version`)
    .bind(user.id,encode(cells),cells.length,stamp,FOG_VERSION).run()
  return reply({count:cells.length, added, version:FOG_VERSION, updatedAt:stamp * 1000})
}
