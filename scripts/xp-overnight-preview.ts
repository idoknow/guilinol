import {execFileSync} from 'node:child_process'
import {createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import {homedir} from 'node:os'
import {dirname, extname, join, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {defaultAvatar, sanitizeAvatar, type Avatar} from '../lib/avatar.ts'
import {npcDefaults} from '../lib/npc.ts'
import {smokeDefaults} from '../lib/smoke.ts'

/**
 * Standalone production bundle (`dist/`) local preview server for GuilinOL XP Overnight build.
 *
 * Features:
 *  - Serves built static assets from `dist/` (loopback `127.0.0.1` only, default port `5176`)
 *  - Built-in local no-login account API (`/api/me`, `/api/me/avatar`, `/api/me/save`) returning `local-test` JSON
 *  - Built-in telemetry sink (`/api/t` -> 204) + `/api/npc`, `/api/live`, `/api/health`, etc.
 *  - Zero auto-open browser calls; works natively under Node 22+ (`node scripts/xp-overnight-preview.ts`) or `npx tsx`
 */

interface LocalState {
  id: string
  email: string
  nickname: string
  notify_email: boolean
  avatar: Avatar
  revision: number
  save: unknown
}

export interface PreviewServerOptions {
  port?: number
  distDir?: string
  stateDir?: string
  repoDir?: string
  quiet?: boolean
}

export interface PreviewServerHandle {
  readonly server: Server
  readonly host: '127.0.0.1'
  readonly port: number
  readonly distDir: string
  readonly stateDir: string
  readonly url: string
  close(): Promise<void>
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_DIR = resolve(SCRIPT_DIR, '..')
const DEFAULT_HOST = '127.0.0.1' as const
const DEFAULT_PORT = 5176
const MAX_BODY_BYTES = 1024 * 1024
const MAX_BACKUPS = 15

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2',
  '.bin': 'application/octet-stream',
  '.glc': 'application/octet-stream',
  '.gz': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
})

function defaultState(): LocalState {
  return {
    id: 'local-test',
    email: 'test@local.guilinol',
    nickname: 'test',
    notify_email: false,
    avatar: defaultAvatar(1700000000000),
    revision: 1,
    save: null,
  }
}

function createStateStore(stateDir: string) {
  const backupDir = join(stateDir, 'backups')
  const stateFile = join(stateDir, 'account.json')

  function load(): LocalState {
    const base = defaultState()
    if (!existsSync(stateFile)) return base
    try {
      const raw = JSON.parse(readFileSync(stateFile, 'utf8')) as Partial<LocalState>
      const avatar = sanitizeAvatar(raw.avatar) ?? base.avatar
      return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : base.id,
        email: typeof raw.email === 'string' && raw.email ? raw.email : base.email,
        nickname: typeof raw.nickname === 'string' && raw.nickname.trim() ? raw.nickname.trim().slice(0, 32) : base.nickname,
        notify_email: Boolean(raw.notify_email),
        avatar,
        revision: typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision >= 1 ? raw.revision : 1,
        save: raw.save ?? null,
      }
    } catch {
      return base
    }
  }

  function pruneBackups(): void {
    if (!existsSync(backupDir)) return
    const files = readdirSync(backupDir)
      .filter(name => /^account-.*\.json$/.test(name))
      .sort()
      .reverse()
    for (const stale of files.slice(MAX_BACKUPS)) {
      try {
        rmSync(join(backupDir, stale), {force: true})
      } catch {
        // ignore cleanup error
      }
    }
  }

  function save(state: LocalState, backupReason?: string): void {
    mkdirSync(stateDir, {recursive: true})
    const payload = JSON.stringify(state, null, 2) + '\n'
    const tmp = `${stateFile}.tmp.${process.pid}.${Date.now()}`
    writeFileSync(tmp, payload)
    renameSync(tmp, stateFile)
    if (backupReason) {
      try {
        mkdirSync(backupDir, {recursive: true})
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const safeReason = backupReason.replace(/[^a-z0-9_-]/gi, '').slice(0, 16) || 'save'
        writeFileSync(join(backupDir, `account-${stamp}-${safeReason}.json`), payload)
        pruneBackups()
      } catch {
        // non-fatal backup error
      }
    }
  }

  function backupCount(): number {
    if (!existsSync(backupDir)) return 0
    return readdirSync(backupDir).filter(name => /^account-.*\.json$/.test(name)).length
  }

  const state = load()
  if (!existsSync(stateFile)) save(state, 'init')
  return {state, save, backupCount}
}

function readGitHead(repoDir: string): string {
  try {
    return execFileSync('git', ['-C', repoDir, 'rev-parse', '--short', 'HEAD'], {encoding: 'utf8'}).trim()
  } catch {
    return 'unknown'
  }
}

function readWorldSha(file: string): string {
  try {
    return readFileSync(file, 'utf8').trim().split(/\s+/)[0] || ''
  } catch {
    return ''
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = []
    let bytes = 0
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_BODY_BYTES) {
        rejectBody(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) {
        resolveBody({})
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolveBody(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {})
      } catch (err) {
        rejectBody(err)
      }
    })
    req.on('error', rejectBody)
  })
}

function cacheHeaderFor(relPath: string): string {
  if (relPath.startsWith('assets/')) return 'public, max-age=31536000, immutable'
  if (relPath === 'version.json' || relPath.endsWith('.html')) return 'no-store'
  return 'no-cache'
}

function resolveStaticFile(distDir: string, pathname: string): {status: 200; filePath: string; relPath: string} | {status: 400 | 403 | 404} {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return {status: 400}
  }
  if (decoded.includes('\0')) return {status: 400}

  const trimmed = decoded.replace(/^\/+/, '')
  const candidate = resolve(distDir, trimmed)
  if (candidate !== distDir && !candidate.startsWith(distDir + sep)) {
    return {status: 403}
  }

  const probes: string[] = []
  if (!trimmed) {
    probes.push(join(distDir, 'index.html'))
  } else {
    probes.push(candidate)
    if (!extname(candidate)) {
      probes.push(`${candidate}.html`)
      probes.push(join(candidate, 'index.html'))
    }
  }

  for (const probe of probes) {
    if (probe !== distDir && !probe.startsWith(distDir + sep)) continue
    try {
      const st = statSync(probe)
      if (st.isFile()) {
        return {status: 200, filePath: probe, relPath: probe.slice(distDir.length + 1).replace(/\\/g, '/')}
      }
      if (st.isDirectory()) {
        const idx = join(probe, 'index.html')
        if (existsSync(idx) && statSync(idx).isFile()) {
          return {status: 200, filePath: idx, relPath: idx.slice(distDir.length + 1).replace(/\\/g, '/')}
        }
      }
    } catch {
      // try next probe
    }
  }
  return {status: 404}
}

export async function startPreviewServer(opts: PreviewServerOptions = {}): Promise<PreviewServerHandle> {
  const repoDir = resolve(opts.repoDir ?? DEFAULT_REPO_DIR)
  const distDir = resolve(opts.distDir ?? process.env.PREVIEW_DIST_DIR ?? join(repoDir, 'dist'))
  const stateDir = resolve(opts.stateDir ?? process.env.GUILINOL_LOCAL_STATE_DIR ?? join(homedir(), '.local/state/guilinol-xp-overnight'))
  const requestedPort = opts.port ?? Number(process.env.PORT ?? DEFAULT_PORT)

  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new Error(`Invalid preview port: ${requestedPort}`)
  }
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error(`Missing production bundle (${join(distDir, 'index.html')}). Run "npm run build" first.`)
  }

  const store = createStateStore(stateDir)
  let boundPort = requestedPort

  const server = createServer(async (req, res) => {
    const rawUrl = req.url || '/'
    const qIdx = rawUrl.indexOf('?')
    const pathname = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl
    const method = (req.method || 'GET').toUpperCase()

    if (pathname.startsWith('/api/')) {
      try {
        if (pathname === '/api/me' && method === 'GET') {
          return sendJson(res, 200, {
            id: store.state.id,
            email: store.state.email,
            nickname: store.state.nickname,
            notify_email: store.state.notify_email,
            social: [],
          })
        }
        if (pathname === '/api/me' && method === 'PATCH') {
          const body = await readJsonBody(req)
          if (typeof body.nickname === 'string' && body.nickname.trim()) {
            store.state.nickname = body.nickname.trim().slice(0, 32)
          }
          if ('notify_email' in body) store.state.notify_email = Boolean(body.notify_email)
          store.save(store.state, 'profile')
          return sendJson(res, 200, {
            id: store.state.id,
            email: store.state.email,
            nickname: store.state.nickname,
            notify_email: store.state.notify_email,
            social: [],
          })
        }
        if (pathname === '/api/me/avatar' && method === 'GET') {
          return sendJson(res, 200, {avatar: store.state.avatar})
        }
        if (pathname === '/api/me/avatar' && method === 'PUT') {
          const body = await readJsonBody(req)
          const nextAvatar = sanitizeAvatar(body.avatar)
          if (!nextAvatar) return sendJson(res, 400, {error: {code: 'invalid_input', message: '无效的角色数据'}})
          store.state.avatar = nextAvatar
          store.save(store.state, 'avatar')
          return sendJson(res, 200, {avatar: store.state.avatar})
        }
        if (pathname === '/api/me/save' && method === 'GET') {
          return sendJson(res, 200, {revision: String(store.state.revision), save: store.state.save})
        }
        if (pathname === '/api/me/save' && method === 'PUT') {
          const body = await readJsonBody(req)
          const prevJson = JSON.stringify(store.state.save)
          const nextJson = JSON.stringify(body)
          store.state.save = body
          store.state.revision += 1
          store.save(store.state, prevJson !== nextJson ? 'save' : undefined)
          return sendJson(res, 200, {revision: String(store.state.revision), save: store.state.save})
        }
        if (pathname === '/api/t' && (method === 'POST' || method === 'GET' || method === 'HEAD' || method === 'OPTIONS')) {
          req.resume()
          res.writeHead(204, {'Cache-Control': 'no-store'})
          res.end()
          return
        }
        if (pathname === '/api/npc' && method === 'GET') {
          return sendJson(res, 200, npcDefaults)
        }
        if (pathname === '/api/smoke' && method === 'GET') {
          return sendJson(res, 200, smokeDefaults)
        }
        if (pathname === '/api/live' && method === 'GET') {
          return sendJson(res, 200, {online: 1})
        }
        if (pathname === '/api/auth/social/config' && method === 'GET') {
          return sendJson(res, 200, {enabled: []})
        }
        if (pathname === '/api/auth/social/pending' && method === 'GET') {
          return sendJson(res, 200, null)
        }
        if (pathname === '/api/auth/logout' && method === 'POST') {
          req.resume()
          return sendJson(res, 200, {ok: true})
        }
        if (pathname === '/api/contributors' && method === 'GET') {
          return sendJson(res, 200, [])
        }
        if (pathname === '/api/feedback' && method === 'GET') {
          return sendJson(res, 200, {items: []})
        }
        if (pathname === '/api/gfx' && method === 'GET') {
          return sendJson(res, 200, null)
        }
        if (pathname === '/api/updates/unseen' && method === 'GET') {
          return sendJson(res, 200, [])
        }
        if (pathname.startsWith('/api/updates/') && pathname.endsWith('/seen') && method === 'POST') {
          req.resume()
          return sendJson(res, 200, {ok: true})
        }
        if (pathname === '/api/fishing/boards' && method === 'GET') {
          return sendJson(res, 200, {zone: [], global: []})
        }
        if (pathname === '/api/fishing/catch' && method === 'POST') {
          req.resume()
          return sendJson(res, 200, {status: 'recorded'})
        }
        if (pathname === '/api/rt/ticket' && method === 'POST') {
          req.resume()
          // 403 instructs web/src/net.ts to transition cleanly to offline mode without retry spam
          return sendJson(res, 403, {error: {code: 'offline_preview', message: '本地预览未启用实时联机'}})
        }
        if (pathname === '/api/health' && method === 'GET') {
          return sendJson(res, 200, {
            ok: true,
            mode: 'xp-overnight-preview',
            host: DEFAULT_HOST,
            port: boundPort,
            distDir,
            id: store.state.id,
            nickname: store.state.nickname,
            revision: store.state.revision,
            head: readGitHead(repoDir),
            world_local: readWorldSha(join(distDir, 'world/.world.sha256')).slice(0, 12),
            world_expected: readWorldSha(join(repoDir, 'deploy/world.sha256')).slice(0, 12),
            backups: store.backupCount(),
          })
        }
        return sendJson(res, 404, {error: {code: 'not_found', message: '本地预览未启用该接口'}})
      } catch {
        return sendJson(res, 400, {error: {code: 'invalid_input', message: '请求格式错误'}})
      }
    }

    if (method !== 'GET' && method !== 'HEAD') {
      return sendText(res, 405, 'Method Not Allowed')
    }

    const hit = resolveStaticFile(distDir, pathname)
    if (hit.status !== 200) {
      return sendText(res, hit.status, hit.status === 403 ? 'Forbidden' : hit.status === 400 ? 'Bad Request' : 'Not Found')
    }

    const st = statSync(hit.filePath)
    const ext = extname(hit.filePath).toLowerCase()
    const mime = MIME_TYPES[ext] ?? 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': st.size,
      'Cache-Control': cacheHeaderFor(hit.relPath),
      'X-Content-Type-Options': 'nosniff',
    })
    if (method === 'HEAD') {
      res.end()
      return
    }
    const stream = createReadStream(hit.filePath)
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
    stream.pipe(res)
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(requestedPort, DEFAULT_HOST, () => {
      server.off('error', rejectListen)
      const addr = server.address()
      boundPort = typeof addr === 'object' && addr ? addr.port : requestedPort
      resolveListen()
    })
  })

  const url = `http://${DEFAULT_HOST}:${boundPort}/`
  if (!opts.quiet) {
    console.log(`[xp-overnight-preview] listening on ${url} (dist=${distDir}, api=/api/me local-test)`)
  }

  return {
    server,
    host: DEFAULT_HOST,
    port: boundPort,
    distDir,
    stateDir,
    url,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close(err => (err ? rejectClose(err) : resolveClose()))
      }),
  }
}

function parseCliArgs(argv: readonly string[]): PreviewServerOptions {
  const opts: PreviewServerOptions = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if ((arg === '--port' || arg === '-p') && argv[i + 1]) {
      opts.port = Number(argv[++i])
    } else if (arg.startsWith('--port=')) {
      opts.port = Number(arg.slice('--port='.length))
    } else if (arg === '--dist' && argv[i + 1]) {
      opts.distDir = argv[++i]
    } else if (arg.startsWith('--dist=')) {
      opts.distDir = arg.slice('--dist='.length)
    } else if (arg === '--state-dir' && argv[i + 1]) {
      opts.stateDir = argv[++i]
    } else if (arg.startsWith('--state-dir=')) {
      opts.stateDir = arg.slice('--state-dir='.length)
    } else if (arg === '--quiet') {
      opts.quiet = true
    }
  }
  return opts
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const selfPath = resolve(fileURLToPath(import.meta.url))
if (invokedPath === selfPath) {
  const handle = await startPreviewServer(parseCliArgs(process.argv.slice(2)))
  const shutdown = () => {
    void handle.close().finally(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
