// 联机反外挂（P0）：移动合法性 + 设备指纹 + 持久封禁 + 人工解封
//
// 设计口径（sg claude 2026-11 复核后修正，勿随意改小）：
//   · 跑步实测 9 m/s；汽车运动挡 108 km/h ≈ 30 m/s；助力车取保守 7 m/s
//   · 只限制**向上**速度，12 m/s 的向下容忍，避免 5 米跳下误报
//   · 位移额度随时间累积（最多 2s），突发包不误判
//   · 车辆上限在切换后 1.5s 内线性放开，防止"谎称在开车"直接拿 30 m/s
//   · 瞬移按合法处理需同时满足：不在战斗（5s）、距上次瞬移 ≥3s；瞬移后 3s 不能出拳
//   · 溢出 ≤2m 的抖动直接接受（只记数），超过才拒包并拉回，避免手机网络抖动被拉回
import pg from 'pg'
import { randomUUID } from 'node:crypto'

export const LIMITS = Object.freeze({
  walk: 12,         // m/s 跑步（客户端 sprint 实测 9 m/s，留 33% 余量，避免按 Shift 就超限）
  bike: 7,          // m/s 助力车
  car: 45,          // m/s 汽车（150 km/h ≈ 41.7，留 8% 余量）
  stepM: 1.2,       // 单帧容忍
  upMax: 12,        // 向上速度上限 m/s
  bankMs: 2000,     // 额度最长累积
  rampMs: 1500,     // 车辆上限放开时间
  jumpM: 200,       // 单次位移超过它按瞬移处理
  tpGapMs: 3000,    // 两次合法瞬移最小间隔
  tpLockMs: 3000,   // 瞬移后禁拳时长
  combatLockMs: 5000, // 战斗中禁止瞬移
  walkGateMs: 1000, // 出拳要求过去 1 秒是走路速度
  tolerance: 1.6,   // 瞬时速度容忍倍数（掉帧/网络排队）
  winMs: 1200,      // 持续性判定窗口：只有整段都超速才算作弊
  winTol: 1.15,     // 窗口内平均速度容忍倍数
  spikeM: 3,        // 单包超限但少于该距离只记数、不拒包
  hardM: 25,        // 单包位移超过它才按硬作弊处理
})

/** 空中/载具：不限制向上速度，按载具上限放行（直升机刚上线，乘客的 foot 会被置 false） */
const airborne = (p) => p.foot === false || Boolean(p.bike) || p.activity === 'drone'
const attackKinds=new Set(['mount_player','foreign_position','oversize','invalid_packet','packet_rate'])
// 阈值按"合法玩家 0~5 次/10 分钟、脚本 150+ 次"的实测分布取，宁可漏也不误封：
// 40 次 → 3 分钟（强制下线冷静一下）；150 次 → 1 小时；300 次 → 24 小时
const num = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback)
const BAN = {
  windowMs: 600000,
  l1: num(process.env.RT_AC_BAN_1, 40),
  l1Min: num(process.env.RT_AC_BAN_1_MIN, 3),
  l2: num(process.env.RT_AC_BAN_2, 150),
  l2Min: num(process.env.RT_AC_BAN_2_MIN, 60),
  l3: num(process.env.RT_AC_BAN_3, 300),
  l3Min: num(process.env.RT_AC_BAN_3_MIN, 1440),
}

/** 1.2 秒滑动窗口内的平均速度（m/s）：持续超速才判定，避免单包抖动误伤。 */
function windowSpeed(p, at, flat, dt) {
  const win = p.moveWin ??= []
  win.push({ at, d: Number.isFinite(flat) ? flat : 0, v: flat / Math.max(dt, .01) })
  while (win.length && at - win[0].at > LIMITS.winMs) win.shift()
  const speeds = win.map(entry => entry.v).sort((a, b) => a - b)
  const median = speeds[Math.floor(speeds.length / 2)] ?? 0
  const span = Math.max(500, at - win[0].at) / 1000
  let total = 0
  for (const entry of win) total += entry.d
  return { median, avg: total / span }
}

/** 当前允许的速度（m/s）。客户端上报的 v 永不参与判定。 */
export function speedCap(p, at) {
  if (!p.bike) return LIMITS.walk
  const since = p.bikeAt ?? p.posAt ?? at
  const ramp = Math.min(1, Math.max(0, (at - since) / LIMITS.rampMs))
  return LIMITS.walk + (LIMITS.car - LIMITS.walk) * ramp
}

/**
 * 判定一次 pos 是否可接受。
 * @returns {{ok:boolean, kind?:string, overflow?:number, reject?:boolean, teleport?:boolean}}
 */
export function checkMove(p, nx, ny, nz, at) {
  const prevAt = p.posAt ?? at
  const dt = Math.min(Math.max((at - prevAt) / 1000, 0.02), LIMITS.bankMs / 1000)
  const flat = Math.hypot(nx - p.x, nz - p.z)
  const rise = ny - p.y

  if (flat > LIMITS.jumpM) {
    const inCombat = at - (p.lastCombat ?? 0) < LIMITS.combatLockMs
    const tooSoon = at - (p.tpAt ?? -Infinity) < LIMITS.tpGapMs
    const permit=p.travel
    p.travel=null
    if (!permit || permit.until<at || Math.hypot(nx-permit.x,nz-permit.z)>8 || inCombat || tooSoon) return { ok: false, kind: 'teleport', overflow: flat, reject: true }
    p.tpAt = at
    p.punchLockUntil = at + LIMITS.tpLockMs
    return { ok: true, teleport: true }
  }

  // 持续性判定（2026-11 误封后修正）：单包的瞬时速度在掉帧、网络排队、切模式、
  // 以及按 Shift 冲刺的瞬间都会被放大，拿单包判定会把正常玩家拉回并记违规。
  // 这里改成「1.2 秒窗口内的平均速度」超限才拒包；单包只记数不拒。
  const capSpeed = airborne(p) ? LIMITS.car : speedCap(p, at)
  const cap = capSpeed * dt * LIMITS.tolerance + LIMITS.stepM
  const sustained = windowSpeed(p, at, flat, dt)
  const sustainedCap = capSpeed * LIMITS.winTol
  if (flat > LIMITS.hardM && flat / Math.max(dt, .05) > capSpeed * 3)
    return { ok: false, kind: 'speed', overflow: flat - cap, reject: true }
  if (sustained.median > sustainedCap && sustained.avg > capSpeed)
    return { ok: false, kind: 'speed', overflow: flat - cap, reject: true }
  if (flat > cap && flat > LIMITS.spikeM) return { ok: true, observation: 'speed_spike' }
  const baseline=p.altitudeBaseline??={y:p.y,at}
  if (ny<baseline.y+1) { baseline.y=ny; baseline.at=at }
  const observation= !airborne(p) && (rise>LIMITS.upMax*dt+0.5 || (ny-baseline.y>4 && at-baseline.at>8000)) ? 'altitude_unverified' : ny < -10 ? 'ground_unverified' : null
  return { ok: true, observation }
}

/** 出拳/扶人前调用：过去 1 秒必须是走路速度，且不在瞬移后锁定里 */
export function canAct(p, at) {
  if (airborne(p)) return false
  if (at < (p.punchLockUntil ?? 0)) return false
  return at - (p.fastAt ?? -Infinity) > LIMITS.walkGateMs
}

const FP_RE = /^[0-9a-f]{16,64}$/
export const cleanFp = (value) => (typeof value === 'string' && FP_RE.test(value) ? value : '')

/**
 * 封禁存储：内存缓存 + Postgres 持久化。没有 DATABASE_URL 时退化为纯内存（测试用）。
 * 键：uid 或 指纹（fp）。人工解封 = 删对应行 + 立刻刷缓存。
 */
export function createBanStore(env = process.env, log = () => {}) {
  const pool = env.DATABASE_URL
    ? new pg.Pool({ connectionString: env.DATABASE_URL, max: 3, connectionTimeoutMillis: 1500 })
    : null
  pool?.on('error', () => {})

  const cells = new Map() // 'uid:9001' -> {kind,value,until,reason,level}
  const keyOf = (kind, value) => `${kind}:${value}`
  let hydratedAt = 0

  const put = (row) => {
    const until = row.until_ms == null ? Infinity : Number(row.until_ms)
    if (until <= Date.now()) { cells.delete(keyOf(row.kind, row.value)); return }
    cells.set(keyOf(row.kind, row.value), { kind: row.kind, value: String(row.value), recordId: row.record_id, until, reason: row.reason ?? '', actor: row.actor ?? '', level: Number(row.level ?? 0) })
  }

  async function hydrate() {
    if (!pool) return
    try {
      const { rows } = await pool.query("select kind,value,until_ms,reason,actor,level,coalesce(record_id,'legacy-'||id) as record_id from mp_bans")
      const now = Date.now()
      cells.clear()
      for (const row of rows) { if (row.until_ms == null || Number(row.until_ms) > now) put(row) }
      hydratedAt = now
    } catch (error) { log('ban hydrate failed', error.message); if (!hydratedAt) throw error }
  }

  /** 每次 join 前调用；15 秒一次真查库，其余走缓存 */
  let refreshing
  async function refresh() {
    if (!pool) return
    if (Date.now() - hydratedAt < 15000) return
    refreshing ??= hydrate().finally(()=>{refreshing=null})
    await refreshing
  }

  /** 返回命中的封禁（uid 或指纹任一命中） */
  function check(uid, fp) {
    const now = Date.now()
    const hit = uid != null ? cells.get(keyOf('uid', String(uid))) : null
    if (hit && hit.until > now) return hit
    const hitFp = fp ? cells.get(keyOf('fp', fp)) : null
    if (hitFp && hitFp.until > now) return hitFp
    return null
  }

  async function transaction(work) {
    if (!pool) return
    const db = await pool.connect()
    try { await db.query('BEGIN'); await work(db); await db.query('COMMIT') }
    catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
  }
  const audit = (db,actor,action,target,detail) => db.query('insert into admin_audit(actor_id,action,target_type,target_id,detail) values($1,$2,$3,$4,$5)',[actor,action,'mp',String(target),detail])
  async function ban({ uid, fp, minutes = 0, reason = '', actor = '', level = 0, reviewId }) {
    const recordId = randomUUID()
    const until = minutes > 0 ? Date.now() + minutes * 60000 : null
    const entries = []
    if (uid != null) entries.push({ kind: 'uid', value: String(uid) })
    if (fp) entries.push({ kind: 'fp', value: fp })
    if (!entries.length) throw Error('uid or fp required')
    if (!pool && reviewId && memoryReviews.get(uid)?.id !== reviewId) throw Error('待复核记录不匹配')
    await transaction(async db => {
      if (reviewId) {
        const result = await db.query('update mp_reviews set resolved_ms=$3,ban_id=$4 where id=$1 and uid=$2 and resolved_ms is null',[reviewId,uid,Date.now(),recordId])
        if (!result.rowCount) throw Error('待复核记录不匹配')
      }
      for (const entry of entries) {
        await db.query(
          `insert into mp_bans(kind,value,until_ms,reason,actor,level,created_at,record_id) values($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (kind,value) do update set until_ms=excluded.until_ms, reason=excluded.reason, actor=excluded.actor, level=excluded.level, created_at=excluded.created_at,record_id=excluded.record_id`,
          [entry.kind, entry.value, until, reason, actor, level, Date.now(),recordId],
        )
      }
      await audit(db,actor,'mp.ban',uid ?? fp,{uid,fp,reason,until,recordId,reviewId})
    })
    for (const entry of entries) put({...entry,until_ms:until,reason,actor,level,record_id:recordId})
    if (reviewId) memoryReviews.delete(uid)
    return { uid: uid ?? null, fp: fp ?? null, until, minutes, recordId, reason }
  }

  async function unban({ uid, fp, actor = '' }) {
    let removed = 0
    await transaction(async db => {
      const result = await db.query("delete from mp_bans where (kind='uid' and value=$1) or (kind='fp' and value=$2) returning record_id",[uid == null ? null : String(uid),fp || null])
      await audit(db,actor,'mp.unban',uid ?? fp,{uid,fp,records:result.rows})
    })
    if (uid != null && cells.delete(keyOf('uid', String(uid)))) removed++
    if (fp && cells.delete(keyOf('fp', fp))) removed++
    await hydrate()
    return { removed }
  }
  async function dismiss(uid,reviewId,actor) {
    if (!pool && memoryReviews.get(uid)?.id!==reviewId) throw Error('待复核记录不匹配')
    await transaction(async db=>{
      const result=await db.query('update mp_reviews set resolved_ms=$3 where id=$1 and uid=$2 and resolved_ms is null',[reviewId,uid,Date.now()])
      if(!result.rowCount) throw Error('待复核记录不匹配')
      await audit(db,actor,'mp.dismiss',uid,{reviewId})
    })
    memoryReviews.delete(uid);recent.delete(uid)
    return {dismissed:true}
  }

  function list() {
    const now = Date.now()
    return [...cells.values()].filter((row) => row.until > now).map((row) => ({
      kind: row.kind, value: row.value, until: Number.isFinite(row.until) ? row.until : null,
      reason: row.reason, actor: row.actor, level: row.level, recordId:row.recordId,
    }))
  }

  /**
   * 记录「这台设备」（uid ↔ 指纹 + 型号/浏览器/屏幕 + 网段/运营商/城市）。
   * 设备识别是组合口径：指纹（canvas/webgl/屏幕/时区/硬件）+ UA 解析 + IP 网段 + 运营商，
   * 单看任何一项都不够稳（移动网换 IP、UA 可改、指纹可伪造）。
   */
  async function noteDevice(uid, info) {
    if (!pool || uid == null || !info?.fp) return
    let isp = '', city = ''
    if (info.ip && /^\d+\.\d+\.\d+\.\d+$/.test(info.ip)) {
      try {
        const { rows } = await pool.query(
          'select isp,city from perf_network where prefix >>= $1::inet order by masklen(prefix) desc limit 1',
          [info.ip],
        )
        isp = rows[0]?.isp ?? ''; city = rows[0]?.city ?? ''
      } catch { /* 没有网络表就留空 */ }
    }
    await pool.query(
      `insert into mp_devices(uid,fp,first,last,ua,model,browser,screen,ip24,isp,city)
       values($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (uid,fp) do update set last=excluded.last, ua=excluded.ua, model=excluded.model,
         browser=excluded.browser, screen=excluded.screen, ip24=excluded.ip24, isp=excluded.isp, city=excluded.city`,
      [uid, info.fp, Date.now(), info.ua ?? '', info.model ?? '', info.browser ?? '', info.screen ?? '', info.ip24 ?? '', isp, city],
    ).catch(() => {})
  }

  /** 某台设备（指纹）上的所有账号：用于「换号但设备没换」的关联与封禁 */
  async function deviceAccounts(fp) {
    if (!pool || !fp) return []
    try {
      const { rows } = await pool.query(
        'select uid,model,browser,screen,ip24,isp,city,last from mp_devices where fp=$1 order by last desc limit 20',
        [fp],
      )
      return rows
    } catch { return [] }
  }

  async function violation({ uid, fp, kind, detail = {}, ua = '' }) {
    if (pool) {
      await pool.query('insert into mp_cheat_events(uid,fp,kind,detail,at) values($1,$2,$3,$4,$5)', [uid, fp || null, kind, detail, Date.now()]).catch(() => {})
      if (fp) await pool.query(
        `insert into mp_devices(uid,fp,first,last,ua) values($1,$2,$3,$3,$4)
         on conflict (uid,fp) do update set last=excluded.last, ua=excluded.ua`,
        [uid, fp, Date.now(), ua],
      ).catch(() => {})
    }
    if (uid == null || !attackKinds.has(kind) && !['speed','teleport'].includes(kind)) return null
    const now = Date.now()
    for (const [id, events] of recent) if (events.at(-1).at <= now-600000) recent.delete(id)
    const window = (recent.get(uid) || []).filter(event=>event.at>now-600000)
    const tail = window.slice(-Math.max(300,BAN.l3))
    const latestByKind = new Map(window.map(event=>[event.kind,event]))
    const events = [...latestByKind.values()].filter(event=>!tail.includes(event)).concat(tail)
    events.push({at:now,kind,fp,detail}); recent.set(uid,events)
    if (new Set(events.map(event=>event.kind)).size > 1) {
      latestByKind.set(kind,events.at(-1))
      const evidence = [...new Set([...latestByKind.values(),...events.slice(-32)])].sort((left,right)=>left.at-right.at)
      const review = {id:randomUUID(),uid,opened_ms:now,evidence}
      if (pool) await pool.query('insert into mp_reviews(id,uid,opened_ms,evidence) values($1,$2,$3,$4) on conflict (uid) where resolved_ms is null do nothing',[review.id,uid,now,JSON.stringify(review.evidence)])
      else if (!memoryReviews.has(uid)) memoryReviews.set(uid,review)
    }
    if (check(uid,fp)) return null
    if (attackKinds.has(kind) && (kind==='mount_player' || events.filter(event=>attackKinds.has(event.kind)).length>=3)) return ban({uid,minutes:10,reason:kind==='mount_player'?'试图骑乘其他在线玩家':'重复发送非法或越权的联机消息',actor:'protocol'})
    if (new Set(events.map(event=>event.kind)).size>1 || attackKinds.has(kind)) return null
    if (env.RT_AC_AUTOBAN !== '1') return null
    const hits=events.length, level=hits>=BAN.l3?3:hits>=BAN.l2?2:hits>=BAN.l1?1:0
    if (!level) return null
    return ban({uid,fp:level>=2?fp:'',minutes:[0,BAN.l1Min,BAN.l2Min,BAN.l3Min][level],reason:`异常移动 ${hits} 次/10 分钟（自动·${level} 级）`,actor:'auto',level})
  }

  const recent = new Map(), memoryReviews = new Map()
  const reviews = async () => pool ? (await pool.query('select id,uid,opened_ms,evidence from mp_reviews where resolved_ms is null order by opened_ms desc limit 100')).rows : [...memoryReviews.values()]

  return { pool, refresh, hydrate, check, ban, unban, dismiss,list, reviews, violation, noteDevice, deviceAccounts }
}
