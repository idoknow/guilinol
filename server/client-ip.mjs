import { isIP } from 'node:net'

// 内网/回环/集群地址段：k3s Traefik、同 Pod nginx 及本地开发代理都落在这些网段里，
// 只有直连对端属于这些网段或显式配置的 TRUSTED_PROXIES 时才采信转发头。
const INTERNAL_CIDRS = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
]

const FORWARD_HEADERS = ['cf-connecting-ip', 'x-real-ip', 'x-client-ip', 'true-client-ip']

/** 校验并规范化 IP 字面量（剥掉 ::ffff: IPv4-mapped 前缀）；不合法返回空串。 */
export function normalizeIp(raw) {
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  if (!value) return ''
  const kind = isIP(value)
  if (kind === 4) return value
  if (kind === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value)
    if (mapped && isIP(mapped[1]) === 4) return mapped[1]
    return value.toLowerCase()
  }
  return ''
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number)
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0)
}

function ipv6ToBigInt(ip) {
  let addr = ip
  const lastColon = addr.lastIndexOf(':')
  if (addr.includes('.')) {
    const v4 = addr.slice(lastColon + 1)
    const v4Int = ipv4ToInt(v4)
    addr = `${addr.slice(0, lastColon)}:${(v4Int >>> 16).toString(16)}:${(v4Int & 0xffff).toString(16)}`
  }
  const halves = addr.split('::')
  if (halves.length > 2) return 0n
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0
  if (missing < 0) return 0n
  const groups = [...left, ...Array(missing).fill('0'), ...right]
  if (groups.length !== 8) return 0n
  let out = 0n
  for (const group of groups) out = (out << 16n) | BigInt(parseInt(group || '0', 16))
  return out
}

function parseCidr(entry) {
  if (typeof entry !== 'string') return null
  const trimmed = entry.trim()
  if (!trimmed) return null
  const slash = trimmed.indexOf('/')
  const rawIp = slash === -1 ? trimmed : trimmed.slice(0, slash)
  const ip = normalizeIp(rawIp)
  if (!ip) return null
  const kind = isIP(ip)
  const maxBits = kind === 4 ? 32 : 128
  const prefix = slash === -1 ? maxBits : Number(trimmed.slice(slash + 1))
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxBits) return null
  if (kind === 4) {
    const mask = prefix === 0 ? 0 : ((~0 << (32 - prefix)) >>> 0)
    return { kind: 4, net: (ipv4ToInt(ip) & mask) >>> 0, mask }
  }
  const full = (1n << 128n) - 1n
  const mask = prefix === 0 ? 0n : (full ^ ((1n << BigInt(128 - prefix)) - 1n))
  return { kind: 6, net: ipv6ToBigInt(ip) & mask, mask }
}

const INTERNAL_RULES = INTERNAL_CIDRS.map(parseCidr).filter(Boolean)

/** 解析逗号或空白分隔的可信代理 IP / CIDR 列表。 */
export function parseTrustedProxies(spec = process.env.TRUSTED_PROXIES || '') {
  if (Array.isArray(spec)) return spec.map(parseCidr).filter(Boolean)
  if (typeof spec !== 'string' || !spec.trim()) return []
  return spec.split(/[\s,]+/).map(parseCidr).filter(Boolean)
}

function matchesRules(ip, rules) {
  const normalized = normalizeIp(ip)
  if (!normalized || !rules.length) return false
  const kind = isIP(normalized)
  if (kind === 4) {
    const val = ipv4ToInt(normalized)
    return rules.some(rule => rule.kind === 4 && ((val & rule.mask) >>> 0) === rule.net)
  }
  if (kind === 6) {
    const val = ipv6ToBigInt(normalized)
    return rules.some(rule => rule.kind === 6 && (val & rule.mask) === rule.net)
  }
  return false
}

export function isInternalIp(ip) {
  return matchesRules(ip, INTERNAL_RULES)
}

export function isTrustedProxy(ip, extraRules = parseTrustedProxies()) {
  const rules = typeof extraRules === 'string' ? parseTrustedProxies(extraRules) : extraRules
  return isInternalIp(ip) || matchesRules(ip, rules)
}

function readHeader(headers, name) {
  if (!headers) return ''
  const raw = typeof headers.get === 'function' ? headers.get(name) : headers[name]
  if (Array.isArray(raw)) return raw.join(',')
  return typeof raw === 'string' ? raw : ''
}

/**
 * 解析真实客户端 IP 与 CDN 节点 IP：
 * - 只有直连 remote_addr 属于可信代理（源站 nginx/Traefik 或 TRUSTED_PROXIES）时才采信转发头；
 * - 转发头优先级：cf-connecting-ip → x-real-ip → x-client-ip → true-client-ip → x-forwarded-for 最左；
 * - 转发头必须通过合法 IP 字面量校验，不合法则回退到 remote_addr；
 * - 当 remote_addr 为集群内网代理时，优先取 x-forwarded-for 最右侧首个非内网跳作为 nodeIp，否则回退到非内网的 x-real-ip（不要求与 clientIp 不同）。
 */
export function resolveClientIp(headers, remoteAddr, options = {}) {
  const remote = normalizeIp(remoteAddr || '')
  const extraRules = options.trustedProxies !== undefined ? parseTrustedProxies(options.trustedProxies) : parseTrustedProxies()
  const trustInternal = options.trustInternal !== false
  const trusted = Boolean(remote && ((trustInternal && isInternalIp(remote)) || matchesRules(remote, extraRules)))

  if (!trusted) {
    return {
      clientIp: remote || 'unknown',
      nodeIp: remote || null,
      trusted: false,
    }
  }

  let clientIp = ''
  for (const name of FORWARD_HEADERS) {
    const first = readHeader(headers, name).split(',')[0]
    const candidate = normalizeIp(first)
    if (candidate) {
      clientIp = candidate
      break
    }
  }

  const xffParts = readHeader(headers, 'x-forwarded-for')
    .split(',')
    .map(part => normalizeIp(part))

  if (!clientIp && xffParts.length > 0 && xffParts[0]) {
    clientIp = xffParts[0]
  }
  if (!clientIp) clientIp = remote

  let nodeIp = remote
  if (isInternalIp(remote)) {
    let foundNode = false
    for (let i = xffParts.length - 1; i >= 0; i--) {
      const hop = xffParts[i]
      if (!hop || isInternalIp(hop)) continue
      nodeIp = hop
      foundNode = true
      break
    }
    if (!foundNode) {
      const realIp = normalizeIp(readHeader(headers, 'x-real-ip').split(',')[0])
      if (realIp && !isInternalIp(realIp)) nodeIp = realIp
    }
  }

  return { clientIp, nodeIp, trusted: true }
}
