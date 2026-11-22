// 就绪判定：探针只读缓存，真正的 DB 检查在后台按 TTL 刷新，最多一个在途。
//
// 设计要点（对应 Sourcery 的两条意见）：
// - 探针不打库：kubelet 3 秒一次 + 公网可访问的 /api/ready，如果每次都查库，
//   5 连接的小池子会被探针和爬虫抢光，正常 API 反而变慢。这里改成读缓存。
// - 查表存在而不是 select 1：新装库时 select 1 能过但业务表还没建，
//   新 pod 会被判定"就绪"然后对外 500。查 public.users 才真正说明能干活。
// - 一旦就绪就保持就绪：DB 抖动不该把一个还能出静态页面的 pod 从端点里摘掉。
export const SCHEMA_SQL = "select to_regclass('public.users') as users"

export function createReadiness({ query, ttlMs = 5000, timeoutMs = 2000 }) {
  let ready = false
  let reason = 'not_checked'
  let checkedAt = 0
  let inflight = null

  const withTimeout = promise => {
    let timer
    const timeout = new Promise((_, reject) => {
      // 不能用 unref：没有别的句柄时事件循环会直接退出，await 永远不返回
      timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
  }

  async function probe() {
    try {
      const result = await withTimeout(query(SCHEMA_SQL))
      const present = Boolean(result?.rows?.[0]?.users)
      if (present) ready = true
      reason = present ? 'ok' : 'schema_missing'
    } catch (error) {
      reason = error instanceof Error && error.message === 'timeout' ? 'timeout' : 'database'
    }
    checkedAt = Date.now()
    return { ready, reason, checkedAt }
  }

  return {
    /** 探针入口：永不阻塞在 DB 上，最多触发一次后台刷新。 */
    status() {
      if (Date.now() - checkedAt > ttlMs && !inflight) {
        inflight = probe().finally(() => { inflight = null })
      }
      return { ready, reason, checkedAt }
    },
    /** 显式检查一次（部署脚本/测试用）。 */
    probe,
  }
}
