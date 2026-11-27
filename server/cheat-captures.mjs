import {createHmac, timingSafeEqual} from 'node:crypto'
import sharp from 'sharp'

const TOKEN_PREFIX = 'cheat-capture:v1.'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_KINDS = new Set([
  'speed', 'teleport', 'head_overlap', 'altitude_unverified', 'ground_unverified',
  'mount_player', 'foreign_position', 'oversize', 'invalid_packet', 'packet_rate',
])
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
const MIN_UPLOAD_BYTES = 64
const DAILY_UID_LIMIT = 120

const json = (value, status = 200) => Response.json(value, {status, headers: {'cache-control': 'private, no-store'}})
const clampText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const finiteNum = (value, min, max) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}
const finitePos = (value) => {
  if (!Array.isArray(value) || value.length < 3) return null
  const x = finiteNum(value[0], -1e5, 1e5)
  const y = finiteNum(value[1], -1000, 8000)
  const z = finiteNum(value[2], -1e5, 1e5)
  return x !== null && y !== null && z !== null ? [x, y, z] : null
}

const schemaReady = new WeakMap()

export async function ensureCheatCaptureSchema(pool) {
  if (!pool || typeof pool !== 'object') return
  let job = schemaReady.get(pool)
  if (!job) {
    job = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS mp_cheat_captures (
          id              uuid PRIMARY KEY,
          uid             bigint NOT NULL,
          nickname        text NOT NULL DEFAULT '',
          fp              text NOT NULL DEFAULT '',
          kind            text NOT NULL,
          captured_at     bigint NOT NULL,
          uploaded_at     bigint NOT NULL,
          state_label     text NOT NULL DEFAULT '',
          server_state    text NOT NULL DEFAULT '',
          speed_ms        real NOT NULL DEFAULT 0,
          client_speed_ms real,
          pos_x           real NOT NULL DEFAULT 0,
          pos_y           real NOT NULL DEFAULT 0,
          pos_z           real NOT NULL DEFAULT 0,
          attempt_x       real,
          attempt_y       real,
          attempt_z       real,
          landmark        text NOT NULL DEFAULT '',
          landmark_dist   integer,
          meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
          image_key       text NOT NULL,
          image_bytes     integer NOT NULL,
          width           integer,
          height          integer
        )
      `)
      await pool.query('CREATE INDEX IF NOT EXISTS mp_cheat_captures_at ON mp_cheat_captures (captured_at DESC)')
      await pool.query('CREATE INDEX IF NOT EXISTS mp_cheat_captures_uid_at ON mp_cheat_captures (uid, captured_at DESC)')
    })().catch((error) => { schemaReady.delete(pool); throw error })
    schemaReady.set(pool, job)
  }
  await job
}

export function signCheatCaptureToken(payload, secret) {
  if (!secret) return ''
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', secret).update(TOKEN_PREFIX + body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyCheatCaptureToken(token, secret, nowMs = Date.now()) {
  if (!secret || typeof token !== 'string') return null
  const match = /^([\w-]{1,2048})\.([\w-]{43})$/.exec(token.trim())
  if (!match) return null
  const expected = createHmac('sha256', secret).update(TOKEN_PREFIX + match[1]).digest('base64url')
  const left = Buffer.from(expected), right = Buffer.from(match[2])
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    const claims = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'))
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null
    const nowSec = Math.floor(nowMs / 1000)
    if (typeof claims.id !== 'string' || !UUID_RE.test(claims.id)) return null
    if (!Number.isSafeInteger(claims.uid) || claims.uid < 100000) return null
    if (!VALID_KINDS.has(claims.kind)) return null
    if (!Number.isSafeInteger(claims.exp) || claims.exp < nowSec || claims.exp > nowSec + 300) return null
    if (!Number.isFinite(claims.at) || Math.abs(nowMs - claims.at) > 600000) return null
    const pos = finitePos(claims.pos)
    if (!pos) return null
    const attemptPos = finitePos(claims.attemptPos)
    return {
      id: claims.id.toLowerCase(),
      uid: Number(claims.uid),
      name: clampText(claims.name, 32),
      fp: typeof claims.fp === 'string' && /^[0-9a-f]{16,64}$/.test(claims.fp) ? claims.fp : '',
      kind: claims.kind,
      at: Math.round(claims.at),
      exp: claims.exp,
      state: clampText(claims.state, 64),
      activity: clampText(claims.activity, 32),
      activityDetail: clampText(claims.activityDetail, 64),
      foot: claims.foot !== false,
      bike: clampText(claims.bike, 32),
      speed: finiteNum(claims.speed, 0, 5000) ?? 0,
      flatSpeed: finiteNum(claims.flatSpeed, 0, 5000),
      vspeed: finiteNum(claims.vspeed, -5000, 5000),
      reportedSpeed: finiteNum(claims.reportedSpeed, 0, 5000),
      overflow: finiteNum(claims.overflow, 0, 1e6),
      pos,
      attemptPos,
    }
  } catch {
    return null
  }
}

function parseClientMeta(rawHeader) {
  if (typeof rawHeader !== 'string' || !rawHeader.trim() || rawHeader.length > 4096) return {}
  try {
    const decoded = Buffer.from(rawHeader.trim(), 'base64url').toString('utf8')
    const parsed = JSON.parse(decoded)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const pos = finitePos(parsed.pos)
    return {
      stateLabel: clampText(parsed.stateLabel, 96),
      activity: clampText(parsed.activity, 32),
      activityDetail: clampText(parsed.activityDetail, 64),
      speedMs: finiteNum(parsed.speedMs, 0, 5000),
      verticalSpeedMs: finiteNum(parsed.verticalSpeedMs, -5000, 5000),
      grounded: typeof parsed.grounded === 'boolean' ? parsed.grounded : null,
      pos,
      landmark: clampText(parsed.landmark, 64),
      landmarkDist: finiteNum(parsed.landmarkDist, 0, 1e6),
      fallback: parsed.fallback === true,
    }
  } catch {
    return {}
  }
}

async function readBounded(request, maximum) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximum) return null
  const reader = request.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.length
      if (length > maximum) {
        await reader.cancel()
        return null
      }
      chunks.push(next.value)
    }
    return Buffer.concat(chunks, length)
  } finally {
    reader.releaseLock()
  }
}

export function createCheatCaptureService(pool, env, {bucket, resolvePlace} = {}) {
  async function upload(request, account) {
    if (request.method !== 'POST') return json({error: {code: 'method', message: '只支持 POST'}}, 405)
    const secret = env.RT_JOIN_SECRET
    if (!secret || !bucket) return json({error: {code: 'disabled', message: '取证上传未启用'}}, 503)

    const tokenRaw = request.headers.get('X-Cheat-Capture-Token')
    const claims = verifyCheatCaptureToken(tokenRaw, secret)
    if (!claims) return json({error: {code: 'invalid_token', message: '取证凭据无效或已过期'}}, 403)
    if (Number(account.uid) !== claims.uid) {
      return json({error: {code: 'uid_mismatch', message: '账号与取证凭据不匹配'}}, 403)
    }

    const contentType = (request.headers.get('content-type') || '').toLowerCase()
    if (!contentType.startsWith('image/jpeg')) {
      return json({error: {code: 'invalid_content_type', message: '仅支持 JPEG 图像'}}, 400)
    }

    const bytes = await readBounded(request, MAX_UPLOAD_BYTES)
    if (!bytes) return json({error: {code: 'too_large', message: '截图体积超过 2 MiB 限制'}}, 413)
    if (bytes.length < MIN_UPLOAD_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      return json({error: {code: 'invalid_image', message: '无效的 JPEG 图像'}}, 400)
    }

    let imgMeta
    try {
      imgMeta = await sharp(bytes, {limitInputPixels: 4096 ** 2}).metadata()
      if (imgMeta.format !== 'jpeg' || !imgMeta.width || !imgMeta.height) {
        return json({error: {code: 'invalid_image', message: '图像格式校验失败'}}, 400)
      }
    } catch {
      return json({error: {code: 'invalid_image', message: '图像解析失败'}}, 400)
    }

    await ensureCheatCaptureSchema(pool)

    const nowMs = Date.now()
    const {rows: [quota]} = await pool.query(
      'SELECT count(*)::int AS total FROM mp_cheat_captures WHERE uid=$1 AND uploaded_at>$2',
      [claims.uid, nowMs - 86400000],
    )
    if ((quota?.total ?? 0) >= DAILY_UID_LIMIT) {
      return json({error: {code: 'rate_limited', message: '24 小时取证上限已满'}}, 429)
    }

    const existing = await pool.query('SELECT 1 FROM mp_cheat_captures WHERE id=$1', [claims.id])
    if (existing.rowCount) {
      return json({error: {code: 'duplicate', message: '该取证记录已上传'}}, 409)
    }

    const clientMeta = parseClientMeta(request.headers.get('X-Cheat-Capture-Meta'))
    const place = resolvePlace ? await resolvePlace(claims.pos[0], claims.pos[2]).catch(() => null) : null
    const landmark = place?.name || clientMeta.landmark || ''
    const landmarkDist = place?.dist ?? (clientMeta.landmarkDist != null ? Math.round(clientMeta.landmarkDist) : null)
    const imageKey = `mp/cheat-captures/${claims.id}.jpg`
    const stateLabel = clientMeta.stateLabel || claims.state || claims.activity || '未知'
    const serverState = claims.state || claims.activity || ''
    const storedMeta = {
      activity: claims.activity,
      activityDetail: claims.activityDetail,
      foot: claims.foot,
      bike: claims.bike,
      flatSpeed: claims.flatSpeed,
      vspeed: claims.vspeed,
      reportedSpeed: claims.reportedSpeed,
      overflow: claims.overflow,
      client: clientMeta,
    }

    await bucket.put(imageKey, bytes)
    try {
      const insert = await pool.query(
        `INSERT INTO mp_cheat_captures (
          id, uid, nickname, fp, kind, captured_at, uploaded_at,
          state_label, server_state, speed_ms, client_speed_ms,
          pos_x, pos_y, pos_z, attempt_x, attempt_y, attempt_z,
          landmark, landmark_dist, meta, image_key, image_bytes, width, height
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,
          $12,$13,$14,$15,$16,$17,
          $18,$19,$20,$21,$22,$23,$24
        ) ON CONFLICT (id) DO NOTHING`,
        [
          claims.id, claims.uid, account.nickname || claims.name || '', claims.fp, claims.kind, claims.at, nowMs,
          stateLabel, serverState, claims.speed, clientMeta.speedMs ?? claims.reportedSpeed ?? null,
          claims.pos[0], claims.pos[1], claims.pos[2],
          claims.attemptPos?.[0] ?? null, claims.attemptPos?.[1] ?? null, claims.attemptPos?.[2] ?? null,
          landmark, landmarkDist, JSON.stringify(storedMeta), imageKey, bytes.length, imgMeta.width, imgMeta.height,
        ],
      )
      if (!insert.rowCount) {
        await bucket.delete(imageKey).catch(() => {})
        return json({error: {code: 'duplicate', message: '该取证记录已上传'}}, 409)
      }
    } catch (error) {
      await bucket.delete(imageKey).catch(() => {})
      throw error
    }

    return json({ok: true, id: claims.id, width: imgMeta.width, height: imgMeta.height, landmark})
  }

  async function list(params) {
    await ensureCheatCaptureSchema(pool)
    const rawUid = (params.get('uid') ?? '').trim()
    const fp = params.get('fp') || null
    if(fp && !/^[a-f\d]{16,64}$/.test(fp))return json({error:'bad fp filter'},400)
    const kind = (params.get('kind') ?? '').trim()
    const rawLimit = Number(params.get('limit') ?? 40)
    const rawBefore = params.get('before')
    const limit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 100 ? rawLimit : 40
    if (rawUid && (!/^\d+$/.test(rawUid) || !Number.isSafeInteger(Number(rawUid)))) {
      return json({error: 'bad uid filter'}, 400)
    }
    if (kind && !VALID_KINDS.has(kind)) {
      return json({error: 'bad kind filter'}, 400)
    }
    const before = rawBefore != null && rawBefore !== '' ? Number(rawBefore) : null
    if (before !== null && (!Number.isFinite(before) || before <= 0)) {
      return json({error: 'bad before cursor'}, 400)
    }
    const uid = rawUid ? Number(rawUid) : null
    const [{rows}, {rows: [countRow]}] = await Promise.all([
      pool.query(
        `SELECT c.id, c.uid::float8 AS uid, COALESCE(u.nickname, c.nickname, '') AS nickname,
                u.id AS "accountId", c.fp, c.kind,
                c.captured_at::float8 AS "capturedAt", c.uploaded_at::float8 AS "uploadedAt",
                c.state_label AS "stateLabel", c.server_state AS "serverState",
                c.speed_ms::float8 AS "speedMs", c.client_speed_ms::float8 AS "clientSpeedMs",
                c.pos_x::float8 AS "posX", c.pos_y::float8 AS "posY", c.pos_z::float8 AS "posZ",
                c.attempt_x::float8 AS "attemptX", c.attempt_y::float8 AS "attemptY", c.attempt_z::float8 AS "attemptZ",
                c.landmark, c.landmark_dist AS "landmarkDist", c.meta,
                c.image_bytes AS "imageBytes", c.width, c.height
         FROM mp_cheat_captures c
         LEFT JOIN users u ON u.uid = c.uid
         WHERE ($1::bigint IS NULL OR c.uid = $1)
           AND ($2::text IS NULL OR c.kind = $2)
           AND ($3::bigint IS NULL OR c.captured_at < $3)
           AND ($5::text IS NULL OR c.fp = $5)
         ORDER BY c.captured_at DESC, c.id DESC
         LIMIT $4`,
        [uid, kind || null, before, limit, fp],
      ),
      pool.query(
        `SELECT count(*)::int AS total FROM mp_cheat_captures
         WHERE ($1::bigint IS NULL OR uid = $1) AND ($2::text IS NULL OR kind = $2) AND ($3::text IS NULL OR fp = $3)`,
        [uid, kind || null, fp],
      ),
    ])

    const captures = rows.map((row) => ({
      id: row.id,
      uid: row.uid,
      nickname: row.nickname,
      accountId: row.accountId ?? null,
      fp: row.fp,
      kind: row.kind,
      capturedAt: row.capturedAt,
      uploadedAt: row.uploadedAt,
      stateLabel: row.stateLabel,
      serverState: row.serverState,
      speedMs: row.speedMs,
      clientSpeedMs: row.clientSpeedMs,
      pos: [row.posX, row.posY, row.posZ],
      attemptPos: row.attemptX != null && row.attemptY != null && row.attemptZ != null
        ? [row.attemptX, row.attemptY, row.attemptZ]
        : null,
      landmark: row.landmark,
      landmarkDist: row.landmarkDist,
      meta: row.meta ?? {},
      imageBytes: row.imageBytes,
      width: row.width,
      height: row.height,
      imageUrl: `/api/admin/mp/cheat-captures/${encodeURIComponent(row.id)}/image`,
    }))
    return json({captures, total: countRow?.total ?? captures.length})
  }

  async function image(id) {
    if (!UUID_RE.test(id)) return json({error: 'not found'}, 404)
    if (!bucket) return json({error: 'storage unavailable'}, 503)
    await ensureCheatCaptureSchema(pool)
    const {rows: [row]} = await pool.query('SELECT image_key FROM mp_cheat_captures WHERE id=$1', [id.toLowerCase()])
    if (!row?.image_key) return json({error: 'not found'}, 404)
    const object = await bucket.get(row.image_key)
    if (!object) return json({error: 'not found'}, 404)
    return new Response(object.body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  }

  async function remove(id, actor) {
    if (!UUID_RE.test(id)) return json({error: 'not found'}, 404)
    await ensureCheatCaptureSchema(pool)
    const {rows: [deleted]} = await pool.query(
      'DELETE FROM mp_cheat_captures WHERE id=$1 RETURNING id, uid, kind, image_key',
      [id.toLowerCase()],
    )
    if (!deleted) return json({error: 'not found'}, 404)
    if (bucket && deleted.image_key) await bucket.delete(deleted.image_key).catch(() => {})
    await pool.query(
      "INSERT INTO admin_audit(actor_id,action,target_type,target_id,detail) VALUES($1,'mp.cheat_capture.delete','mp',$2,$3)",
      [actor, String(deleted.uid), {captureId: deleted.id, kind: deleted.kind}],
    ).catch(() => {})
    return json({ok: true, id: deleted.id})
  }

  async function adminRoute(path, request, actor) {
    if (path === 'admin/mp/cheat-captures' && request.method === 'GET') {
      return list(new URL(request.url).searchParams)
    }
    const imgMatch = /^admin\/mp\/cheat-captures\/([^/]+)\/image$/.exec(path)
    if (imgMatch && request.method === 'GET') return image(imgMatch[1])
    const delMatch = /^admin\/mp\/cheat-captures\/([^/]+)$/.exec(path)
    if (delMatch && request.method === 'DELETE') return remove(delMatch[1], actor)
    return null
  }

  return {upload, list, image, remove, adminRoute}
}
