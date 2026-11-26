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

export const LIMITS = Object.freeze({
  walk: 9,          // m/s 跑步
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
})

/** 空中/载具：不限制向上速度，按载具上限放行（直升机刚上线，乘客的 foot 会被置 false） */
const airborne = (p) => p.foot === false || Boolean(p.bike) || p.activity === 'drone'
const AUTOBAN = process.env.RT_AC_AUTOBAN === '1'
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

  if (!airborne(p) && rise > LIMITS.upMax * dt + 0.5) return { ok: false, kind: 'fly', overflow: rise, reject: true }

  if (flat > LIMITS.jumpM) {
    const inCombat = at - (p.lastCombat ?? 0) < LIMITS.combatLockMs
    const tooSoon = at - (p.tpAt ?? -Infinity) < LIMITS.tpGapMs
    if (inCombat || tooSoon) return { ok: false, kind: 'teleport', overflow: flat, reject: true }
    p.tpAt = at
    p.punchLockUntil = at + LIMITS.tpLockMs
    return { ok: true, teleport: true }
  }

  // 容忍 1.6 倍瞬时速度 + 固定抖动余量：手机掉帧/网络排队会集中到一个包里，
  // 但持续作弊（20Hz 下 40 m/s）会稳定超限，会被拒。
  const cap = (airborne(p) ? LIMITS.car : speedCap(p, at)) * dt * LIMITS.tolerance + LIMITS.stepM
  if (flat > cap) return { ok: false, kind: 'speed', overflow: flat - cap, reject: true }
  return { ok: true }
}

/** 出拳/扶人前调用：过去 1 秒必须是走路速度，且不在瞬移后锁定里 */
export function canAct(p, at) {
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
    cells.set(keyOf(row.kind, row.value), { kind: row.kind, value: String(row.value), until, reason: row.reason ?? '', actor: row.actor ?? '', level: Number(row.level ?? 0) })
  }

  async function hydrate() {
    if (!pool) return
    try {
      const { rows } = await pool.query('select kind,value,until_ms,reason,actor,level from mp_bans')
      const now = Date.now()
      cells.clear()
      for (const row of rows) { if (row.until_ms == null || Number(row.until_ms) > now) put(row) }
      hydratedAt = now
    } catch (error) { log('ban hydrate failed', error.message) }
  }

  /** 每次 join 前调用；15 秒一次真查库，其余走缓存 */
  async function refresh() {
    if (!pool) return
    if (Date.now() - hydratedAt < 15000) return
    await hydrate()
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

  async function ban({ uid, fp, minutes = 0, reason = '', actor = '', level = 0 }) {
    const until = minutes > 0 ? Date.now() + minutes * 60000 : null
    const entries = []
    if (uid != null) entries.push({ kind: 'uid', value: String(uid) })
    if (fp) entries.push({ kind: 'fp', value: fp })
    if (!entries.length) throw Error('uid or fp required')
    for (const entry of entries) {
      put({ ...entry, until_ms: until, reason, actor, level })
      if (pool) {
        await pool.query(
          `insert into mp_bans(kind,value,until_ms,reason,actor,level,created_at) values($1,$2,$3,$4,$5,$6,$7)
           on conflict (kind,value) do update set until_ms=excluded.until_ms, reason=excluded.reason, actor=excluded.actor, level=excluded.level, created_at=excluded.created_at`,
          [entry.kind, entry.value, until, reason, actor, level, Date.now()],
        )
      }
    }
    return { uid: uid ?? null, fp: fp ?? null, until, minutes }
  }

  async function unban({ uid, fp, actor = '' }) {
    let removed = 0
    if (uid != null) { cells.delete(keyOf('uid', String(uid))); removed++ }
    if (fp) { cells.delete(keyOf('fp', fp)); removed++ }
    if (pool) {
      if (uid != null) await pool.query("delete from mp_bans where kind='uid' and value=$1", [String(uid)])
      if (fp) await pool.query("delete from mp_bans where kind='fp' and value=$1", [fp])
      if (actor) await pool.query('insert into admin_audit(actor_id,action,target,detail,created_at) values($1,$2,$3,$4,$5)', [actor, 'mp.unban', String(uid ?? fp ?? ''), JSON.stringify({ uid: uid ?? null, fp: fp ?? null }), Date.now()]).catch(() => {})
    }
    await hydrate()
    return { removed }
  }

  function list() {
    const now = Date.now()
    return [...cells.values()].filter((row) => row.until > now).map((row) => ({
      kind: row.kind, value: row.value, until: Number.isFinite(row.until) ? row.until : null,
      reason: row.reason, actor: row.actor, level: row.level,
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

  /** 记录一次违规；同一 uid 10 分钟内 ≥8 次自动封 10 分钟，≥20 次封 24 小时 */
  async function violation({ uid, fp, kind, detail = {}, ua = '' }) {
    if (pool) {
      await pool.query('insert into mp_cheat_events(uid,fp,kind,detail,at) values($1,$2,$3,$4,$5)', [uid, fp || null, kind, detail, Date.now()]).catch(() => {})
      if (fp) await pool.query(
        `insert into mp_devices(uid,fp,first,last,ua) values($1,$2,$3,$3,$4)
         on conflict (uid,fp) do update set last=excluded.last, ua=excluded.ua`,
        [uid, fp, Date.now(), ua],
      ).catch(() => {})
    }
    if (uid == null || !AUTOBAN) return null   // 首版只记录不自动封（默认关），用真实数据调参后再开
    // 滑动窗口（10 分钟）：只统计最近 10 分钟的违规次数
    const at = Date.now()
    const list = (recent.get(uid) ?? []).filter((t) => at - t < BAN.windowMs)
    list.push(at)
    recent.set(uid, list)
    if (recent.size > 500) for (const [id, times] of recent) if (!times.length || at - times[times.length - 1] > BAN.windowMs) recent.delete(id)

    if (check(uid, fp)) return null                  // 已经在封禁里，不重复封
    const hits = list.length
    const level = hits >= BAN.l3 ? 3 : hits >= BAN.l2 ? 2 : hits >= BAN.l1 ? 1 : 0
    if (!level) return null
    const minutes = level === 3 ? BAN.l3Min : level === 2 ? BAN.l2Min : BAN.l1Min
    const reason = `异常移动 ${hits} 次/10 分钟（自动·${level} 级）`
    // 轻罚只封号（可以申诉、换设备也认账）；2 级以上才连设备一起封
    await ban({ uid, fp: level >= 2 ? fp : '', minutes, reason, actor: 'auto', level })
    return { banned: minutes * 60, level, hits }
  }

  /** uid → 最近 10 分钟内的违规时间戳 */
  const recent = new Map()

  if (pool) void hydrate()
  return { pool, refresh, hydrate, check, ban, unban, list, violation, noteDevice, deviceAccounts }
}
