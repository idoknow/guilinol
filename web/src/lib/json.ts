/** 统一读取 JSON：CDN 502/504 或 SPA 兜底会返回 HTML，
 *  直接 response.json() 会抛 "Unexpected token '<'"，这里转成可读错误。 */
export class JsonError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function gatewayText(status: number) {
  if (status === 504) return '网关超时（504），请稍后重试'
  if (status === 502) return '网关错误（502），请稍后重试'
  if (status === 503) return '服务暂不可用（503），请稍后重试'
  if (status === 404) return '接口不存在（404），请刷新页面'
  return `服务返回了非 JSON 响应（${status || '网络错误'}）`
}

/** 解析失败时返回 null，不抛异常。 */
export async function readJsonOrNull<T = any>(response: Response): Promise<T | null> {
  const text = await response.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** 解析失败时抛出可读的 JsonError。 */
export async function readJson<T = any>(response: Response): Promise<T> {
  const body = await readJsonOrNull<T>(response)
  if (body === null) throw new JsonError(response.status, gatewayText(response.status))
  return body
}

/** 常见组合：先看状态，再取错误文案。 */
export async function jsonError(response: Response): Promise<string> {
  const body = await readJsonOrNull<{ error?: { message?: string } }>(response)
  return body?.error?.message ?? gatewayText(response.status)
}
