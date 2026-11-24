// 就绪判定：探针只读缓存，真正的体检在后台按 TTL 刷新，同一时刻最多一个在途。
//
// 设计要点（对应两轮审查意见）：
// - 探针不打库：kubelet 3 秒一次 + 公网可访问，每次查库会把 5 连接的池子抢光。
// - 查的是"迁移有没有全部跑完"，不是 select 1：只建了 users 就放行，会让新 pod
//   在 002/003/004… 还没建表时对外 500。
// - 一旦就绪保持就绪：DB 抖动不该把还能出静态页面的 pod 从端点里摘掉。
// - 超时只是不再等结果，底层查询仍挂在 inflight 上，避免超时后反复叠加查询。
export const REQUIRED_TABLES = [
  'users', 'sessions', 'email_codes', 'rate_limits',
  'social_identities', 'social_states', 'social_pending',
  'player_saves', 'player_ledger_txns',
  'admin_audit',
  'chat_settings','chat_messages','chat_mutes','chat_words',
  'mp_online_minute','mp_online_hour','mp_sessions',
  'feedback', 'feedback_events', 'feedback_mail', 'feedback_messages', 'feedback_photos', 'feedback_upload_usage', 'mail_events',
  'perf_event', 'perf_session_day', 'perf_value_day', 'perf_summary_day', 'perf_network', 'perf_server',
  'perf_summary_hour', 'perf_session_hour', 'perf_value_hour',
]

const TABLE_LIST = REQUIRED_TABLES.map(name => `'${name}'`).join(',')
export const SCHEMA_SQL = `select ((select count(*) from unnest(array[${TABLE_LIST}]) as name where to_regclass('public.'||name) is null)
  + (select count(*) from unnest(array['signup_method','banned_at','ban_reason','banned_by']) as col
     where not exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name=col)))::int as missing`

export function createReadiness({ query, ttlMs = 5000, timeoutMs = 2000 }) {
  let ready = false
  let reason = 'not_checked'
  let checkedAt = 0
  let inflight = null

  function refresh() {
    if (inflight) return inflight
    const pending = Promise.resolve().then(() => query(SCHEMA_SQL))
    pending.catch(() => {})            // 挂着的查询不能变成 unhandledRejection
    inflight = pending
      .then(result => {
        const missing = Number(result?.rows?.[0]?.missing ?? 1)
        if (missing === 0) ready = true
        reason = missing === 0 ? 'ok' : 'schema_incomplete'
      })
      .catch(error => {
        reason = error instanceof Error && error.message === 'timeout' ? 'timeout' : 'database'
      })
      .finally(() => {
        checkedAt = Date.now()
        inflight = null
      })
    return inflight
  }

  const snapshot = () => ({ ready, reason, checkedAt })

  return {
    /** 探针入口：永不阻塞在 DB 上；缓存过期就触发一次后台刷新。 */
    status() {
      if (Date.now() - checkedAt > ttlMs && !inflight) void refresh()
      return snapshot()
    },
    /** 启动时立刻体检一次（同样走单在途保护）。 */
    kick() {
      return refresh()
    },
    /** 显式体检一次，最多等 timeoutMs；超时不再等，但查询仍记在 inflight 上。 */
    async probe() {
      const work = refresh()
      let timer
      const timeout = new Promise(resolve => { timer = setTimeout(resolve, timeoutMs) })
      const settled = await Promise.race([work.then(() => true), timeout.then(() => false)])
      clearTimeout(timer)
      if (!settled) reason = 'timeout'
      return snapshot()
    },
  }
}
