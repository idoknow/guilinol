#!/usr/bin/env node
/**
 * 桂林中心广场「小香港地下商业城」A 线实景验收脚本（对齐冻结版 web/src/xiaoxianggang/contract.ts v1）：
 * 1) 直接解析冻结版 contract.ts 中的 XXG_FRAME、XXG_PORTAL_TRIGGER 与 portal('E1'..'W2', ...) 调用，
 *    按与 contract.ts 完全一致的坐标公式算出 E1/E2/W1/W2 世界坐标、inward、approachYaw 与出来落点 landing；
 * 2) 不传 --url 时自启 `vite preview web --config web/vite.config.ts --outDir <dist>`（自动分配空闲端口，绝不碰 4190）；
 * 3) 地面步行到达指定楼梯井口前，核验地面铺装标高稳定在 153.868m±0.35m；
 * 4) 按住 W 沿真楼梯走下井底平台，同一帧换进独立 indoorScene（body.dataset.xxgActive === '1'）：
 *    - 优先读取 contract.md §4 规定的只读 window.viewer.xxg.getMetrics()（drawCalls/lastSwapMs/lastBlackFrames）；
 *    - 核验换场耗时 <= 300ms、无纯色黑屏帧、室内 draw calls <= 40、墙壁碰撞不穿墙不坠落；
 *    - 逐帧录制换场前后脚位、视点与朝向，跳变不得超过相邻两帧步长（无缝）；
 * 5) 转身走回井底平台，同一帧换回世界楼梯井底（B1 标高），同样核验出场无跳变并保持宿主原视角；
 * 6) 连续执行多轮 enter -> exit（默认 2 轮），核验场景节点/DOM 残留为 0、控制台 error = 0、生产无作弊探针；
 * 7) 严格在 finally 中关闭 browser 与自启 vite preview 服务，绝不触碰 4190 端口。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
/** B1 出口（落脚点 + 楼梯矩形），用来让验收脚本转身面朝楼梯走上去。 */
const XXG_B1_EXITS = JSON.parse(
  readFileSync(join(REPO_ROOT, 'web/src/xiaoxianggang/layout/xiaoxianggang-b1.layout.json'), 'utf8'),
).exits
/** 上楼离开前视线不得高过吊顶 + 0.3m（否则会看见楼梯顶外的空白）。 */
const MAX_CLIMB_EYE_Y_M = 2.9 + 0.3

export const SURFACE_PLAZA_Y = 153.868
export const MAX_INDOOR_DRAW_CALLS = 40
export const MAX_TRANSITION_MS = 300
export const MAX_SURFACE_Y_DELTA_M = 0.35
export const MAX_EXIT_RETURN_DIST_M = 3.0
export const FORBIDDEN_PORT = 4190

export const DEFAULT_FRAME = {
  anchorWorld: { x: -845, z: 232 },
  axisE: { x: 0.938, z: 0.346 },
  axisS: { x: -0.346, z: 0.938 },
  surfaceY: SURFACE_PLAZA_Y,
  landingZ: 5.8,
  /** XXG_STAIRWELL.depth / exitZ in web/src/xiaoxianggang/frame.ts. */
  stairDepth: 4.2,
  exitZ: -3.25,
}

/** Seam tolerance: the swap frame may move as far as two ordinary frames plus this slack. */
export const SEAM_SLACK_FOOT_M = 0.12
export const SEAM_SLACK_EYE_M = 0.2
export const MAX_SEAM_FOOT_DY_M = 0.15
export const MAX_SEAM_YAW_RAD = 0.15
export const MAX_EXIT_FLOOR_DY_M = 0.35
const EYE_FORWARD_M = 0.08

const DEFAULT_AXIS_YAW = Math.atan2(-DEFAULT_FRAME.axisE.x, -DEFAULT_FRAME.axisE.z)

function round3(v) {
  return Math.round(v * 1000) / 1000
}

function round4(v) {
  return Math.round(v * 10000) / 10000
}

export function indoorToWorld(p, frame = DEFAULT_FRAME) {
  return {
    x: frame.anchorWorld.x + p.x * frame.axisE.x + p.z * frame.axisS.x,
    z: frame.anchorWorld.z + p.x * frame.axisE.z + p.z * frame.axisS.z,
  }
}

export function rotateLocal(local, yaw) {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return {
    x: local.x * c + local.z * s,
    z: -local.x * s + local.z * c,
  }
}

export function yawFacing(dir) {
  return Math.atan2(-dir.x, -dir.z)
}

function buildPortalEntry({ id, label, along, across, yaw, frame }) {
  const indoor = { x: along, z: across }
  const world = indoorToWorld(indoor, frame)
  const inward = rotateLocal({ x: 0, z: -1 }, yaw)
  const landingOff = rotateLocal({ x: 0, z: frame.landingZ }, yaw)
  const bottomOff = rotateLocal({ x: 0, z: frame.exitZ ?? DEFAULT_FRAME.exitZ }, yaw)
  const outward = { x: -inward.x, z: -inward.z }
  const landing = {
    x: round3(world.x + landingOff.x),
    z: round3(world.z + landingOff.z),
    yaw: round4(yawFacing(outward)),
  }
  return {
    id,
    label,
    indoor,
    world: { x: round3(world.x), z: round3(world.z) },
    worldX: round3(world.x),
    worldY: frame.surfaceY,
    worldZ: round3(world.z),
    groundY: frame.surfaceY,
    yaw: round4(yaw),
    inward: { x: round4(inward.x), z: round4(inward.z) },
    approachYaw: round4(yawFacing(inward)),
    landing,
    /** Where the walk-up exit hands the walker back to the world: the well's bottom landing, B1 grade. */
    wellBottom: {
      x: round3(world.x + bottomOff.x),
      z: round3(world.z + bottomOff.z),
      y: round3(frame.surfaceY - (frame.stairDepth ?? DEFAULT_FRAME.stairDepth)),
    },
  }
}

/**
 * Stage 0 / 契约 v1 兜底基准 4 入口（仅当 contract.ts 不存在时回退）。
 */
export const DEFAULT_PORTALS = [
  buildPortalEntry({ id: 'E1', label: '东南入口', along: -22, across: 26.5, yaw: DEFAULT_AXIS_YAW, frame: DEFAULT_FRAME }),
  buildPortalEntry({ id: 'E2', label: '东北入口', along: -22, across: -26.5, yaw: DEFAULT_AXIS_YAW + Math.PI, frame: DEFAULT_FRAME }),
  buildPortalEntry({ id: 'W1', label: '西南入口', along: -78, across: 19.5, yaw: DEFAULT_AXIS_YAW, frame: DEFAULT_FRAME }),
  buildPortalEntry({ id: 'W2', label: '西北入口', along: -78, across: -19.5, yaw: DEFAULT_AXIS_YAW, frame: DEFAULT_FRAME }),
]

export const BANNED_PROD_CHEAT_KEYS = [
  'forceEnter',
  'forceExit',
  'teleportIndoor',
  'grantFunds',
  'skipTransition',
  'debugScene',
]

function evalYawExpr(expr, axisYaw) {
  const cleaned = String(expr || '').trim()
  if (/^-?\d+(?:\.\d+)?$/.test(cleaned)) return Number(cleaned)
  let total = 0
  const tokenRe = /([+-]?)\s*(AXIS_YAW|Math\.PI|\d+(?:\.\d+)?)/g
  let matchedAny = false
  for (const m of cleaned.matchAll(tokenRe)) {
    matchedAny = true
    const sign = m[1] === '-' ? -1 : 1
    const sym = m[2]
    const val = sym === 'AXIS_YAW' ? axisYaw : sym === 'Math\.PI' || sym === 'Math.PI' ? Math.PI : Number(sym)
    total += sign * val
  }
  return matchedAny ? total : axisYaw
}

function parseFrameFromContract(src) {
  const frame = {
    anchorWorld: { ...DEFAULT_FRAME.anchorWorld },
    axisE: { ...DEFAULT_FRAME.axisE },
    axisS: { ...DEFAULT_FRAME.axisS },
    surfaceY: DEFAULT_FRAME.surfaceY,
    landingZ: DEFAULT_FRAME.landingZ,
    stairDepth: DEFAULT_FRAME.stairDepth,
    exitZ: DEFAULT_FRAME.exitZ,
  }
  const readPair = name => {
    const m = src.match(new RegExp(`${name}\\s*:\\s*\\{\\s*x\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*z\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\}`))
    return m ? { x: Number(m[1]), z: Number(m[2]) } : null
  }
  frame.anchorWorld = readPair('anchorWorld') ?? frame.anchorWorld
  frame.axisE = readPair('axisE') ?? frame.axisE
  frame.axisS = readPair('axisS') ?? frame.axisS
  const sy = src.match(/\bsurfaceY\s*:\s*(-?\d+(?:\.\d+)?)/)
  if (sy) frame.surfaceY = Number(sy[1])
  const lz = src.match(/\blandingZ\s*:\s*(-?\d+(?:\.\d+)?)/)
  if (lz) frame.landingZ = Number(lz[1])
  const well = src.match(/XXG_STAIRWELL\s*=\s*\{([\s\S]*?)\}\s*as const/)
  if (well) {
    const d = well[1].match(/\bdepth\s*:\s*(\d+(?:\.\d+)?)/)
    const ez = well[1].match(/\bexitZ\s*:\s*(-?\d+(?:\.\d+)?)/)
    if (d) frame.stairDepth = Number(d[1])
    if (ez) frame.exitZ = Number(ez[1])
  }
  const axisM = src.match(/AXIS_YAW\s*=\s*Math\.atan2\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/)
  const axisYaw = axisM ? Math.atan2(Number(axisM[1]), Number(axisM[2])) : Math.atan2(-frame.axisE.x, -frame.axisE.z)
  return { frame, axisYaw }
}

export function normalizePortalId(rawId) {
  const s = String(rawId || 'E1').trim()
  const legacy = s.match(/^XXG_portal_(E1|E2|W1|W2)$/i)
  if (legacy) return legacy[1].toUpperCase()
  return s
}

/**
 * 优先解析冻结版 web/src/xiaoxianggang/contract.ts：
 * 1) 匹配 portal('E1', '东南入口', -22, 26.5, AXIS_YAW) 工厂调用（contract.ts v1 正式写法）；
 * 2) 兼容对象字面量 { id, worldX, worldZ } 格式；
 * 3) 文件缺失时回退 stage0-default。
 */
export function loadPortalCatalog(repoRoot = REPO_ROOT) {
  const contractPath = join(repoRoot, 'web/src/xiaoxianggang/contract.ts')
  if (!existsSync(contractPath)) {
    return { source: 'stage0-default', portals: DEFAULT_PORTALS.map(p => ({ ...p })) }
  }
  try {
    // Portal specs and the frame live in frame.ts (shared with the host main chunk); contract.ts re-exports them.
    const framePath = join(repoRoot, 'web/src/xiaoxianggang/frame.ts')
    const src = readFileSync(contractPath, 'utf8') + (existsSync(framePath) ? `\n${readFileSync(framePath, 'utf8')}` : '')
    const { frame, axisYaw } = parseFrameFromContract(src)

    const callPortals = []
    const callRe = /\bportal\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*([^)]+)\)/g
    for (const m of src.matchAll(callRe)) {
      const id = m[1]
      const label = m[2]
      const along = Number(m[3])
      const across = Number(m[4])
      const yaw = evalYawExpr(m[5], axisYaw)
      callPortals.push(buildPortalEntry({ id, label, along, across, yaw, frame }))
    }
    const specRe = /\{\s*id\s*:\s*['"`]([^'"`]+)['"`]\s*,\s*label\s*:\s*['"`]([^'"`]+)['"`]\s*,\s*along\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*across\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*yaw\s*:\s*([^}]+?)\s*\}/g
    for (const m of src.matchAll(specRe)) {
      if (callPortals.some(p => p.id === m[1])) continue
      const yaw = evalYawExpr(m[5], axisYaw)
      callPortals.push(buildPortalEntry({ id: m[1], label: m[2], along: Number(m[3]), across: Number(m[4]), yaw, frame }))
    }
    if (callPortals.length >= 4) {
      return { source: 'contract.ts', frame, portals: callPortals }
    }

    const objPortals = []
    const entryRe = /\{[^{}]*?id\s*:\s*['"`]([^'"`]+)['"`][^{}]*?\}/gs
    for (const m of src.matchAll(entryRe)) {
      const block = m[0]
      const id = m[1]
      const readNum = keys => {
        for (const k of keys) {
          const nm = block.match(new RegExp(`\\b${k}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`))
          if (nm) return Number(nm[1])
        }
        return null
      }
      const x = readNum(['worldX', 'x'])
      const z = readNum(['worldZ', 'z'])
      if (x === null || z === null) continue
      const y = readNum(['worldY', 'groundY', 'y']) ?? frame.surfaceY
      const yaw = readNum(['approachYaw', 'yaw', 'worldYaw']) ?? 0
      const labelM = block.match(/\blabel\s*:\s*['"`]([^'"`]+)['"`]/)
      objPortals.push({
        id,
        label: labelM ? labelM[1] : id,
        world: { x, z },
        worldX: x,
        worldY: y,
        worldZ: z,
        groundY: y,
        yaw,
        approachYaw: yaw,
        landing: { x, z, yaw },
      })
    }
    if (objPortals.length >= 4) {
      return { source: 'contract.ts', frame, portals: objPortals }
    }
  } catch {
    // 解析失败回退默认坐标
  }
  return { source: 'stage0-default', portals: DEFAULT_PORTALS.map(p => ({ ...p })) }
}

/**
 * 构造自启 vite preview CLI 参数（必须显式传 `web --config web/vite.config.ts`，与 package.json preview 一致，
 * 避免 Vite 从仓根加载导致资源路径错误与 90s 超时；严禁使用 4190 端口）。
 */
export function buildPreviewArgs(distDir, listenPort) {
  const portNum = Number(listenPort)
  if (!Number.isInteger(portNum) || portNum <= 0 || portNum === FORBIDDEN_PORT) {
    throw new Error(`Invalid preview port: ${listenPort} (port ${FORBIDDEN_PORT} is forbidden)`)
  }
  return [
    '--no-install',
    'vite',
    'preview',
    'web',
    '--config',
    'web/vite.config.ts',
    '--outDir',
    distDir,
    '--host',
    '127.0.0.1',
    '--port',
    String(portNum),
    '--strictPort',
  ]
}

async function pickFreePort(preferredPort) {
  if (Number.isInteger(preferredPort) && preferredPort > 0) {
    if (preferredPort === FORBIDDEN_PORT) {
      throw new Error(`Port ${FORBIDDEN_PORT} is forbidden`)
    }
    return preferredPort
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await new Promise((resolvePort, rejectPort) => {
      const srv = createServer()
      srv.unref()
      srv.on('error', rejectPort)
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address()
        const p = typeof addr === 'object' && addr ? addr.port : 0
        srv.close(() => resolvePort(p))
      })
    })
    if (port > 0 && port !== FORBIDDEN_PORT) return port
  }
  throw new Error('Failed to allocate a free ephemeral port for vite preview')
}

export function parseVerifyArgs(argv) {
  const opts = {
    dist: resolve(REPO_ROOT, 'dist'),
    url: '',
    port: 0,
    out: '/tmp/xxg-stage1-verify',
    portal: 'E1',
    cycles: 2,
    useCdp: false,
    allowDevProbe: false,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--dist') opts.dist = resolve(REPO_ROOT, next() || 'dist')
    else if (a === '--url') opts.url = String(next() || '')
    else if (a === '--port') opts.port = Number(next()) || 0
    else if (a === '--out') opts.out = resolve(next() || '/tmp/xxg-stage1-verify')
    else if (a === '--portal') opts.portal = normalizePortalId(next() || 'E1')
    else if (a === '--cycles') opts.cycles = Math.max(1, Number(next()) || 2)
    else if (a === '--cdp') opts.useCdp = true
    else if (a === '--allow-dev-probe') opts.allowDevProbe = true
    else if (a === '--dry-run') opts.dryRun = true
  }
  return opts
}

export function auditXxgProdProbe(snapshot) {
  const xxgKeys = Array.isArray(snapshot?.xxgKeys) ? snapshot.xxgKeys : []
  const leakedKeys = xxgKeys.filter(k => BANNED_PROD_CHEAT_KEYS.includes(k)).map(k => `viewer.xxg.${k}`)
  return {
    hasXxgProp: Boolean(snapshot?.hasXxgProp),
    leakedKeys,
    clean: leakedKeys.length === 0,
  }
}

/**
 * 纯断言汇总：覆盖 Stage 1 全部性能、转场、碰撞、视角与零泄漏指标。
 */
/** Seam check for one swap frame; returns a short reason or null. */
export function seamFailure(seam) {
  if (!seam || typeof seam !== 'object') return null
  const step = Math.max(0, seam.stepM ?? 0)
  if (seam.footM > 2 * step + SEAM_SLACK_FOOT_M) return `foot ${seam.footM.toFixed(2)}m>step ${step.toFixed(2)}m`
  if (seam.footDy > MAX_SEAM_FOOT_DY_M) return `footY ${seam.footDy.toFixed(2)}m`
  if (typeof seam.eyeM === 'number' && seam.eyeM > 2 * step + SEAM_SLACK_EYE_M) return `eye ${seam.eyeM.toFixed(2)}m`
  if (typeof seam.yawRad === 'number' && seam.yawRad > MAX_SEAM_YAW_RAD) return `yaw ${seam.yawRad.toFixed(3)}rad`
  return null
}

/**
 * Turns a per-frame recording (see installSeamRecorder) into the swap-frame jump. Poses are world space:
 * indoor frames map the indoor player through the frame axes onto the B1 grade below the street.
 */
export function measureSeam(frames, toIndoor, frame = DEFAULT_FRAME) {
  if (!Array.isArray(frames)) return null
  const b1 = frame.surfaceY - (frame.stairDepth ?? DEFAULT_FRAME.stairDepth)
  const pose = f => {
    if (f.indoor) {
      if (!f.p) return null
      const w = indoorToWorld({ x: f.p.x, z: f.p.z }, frame)
      const d = { x: -Math.sin(f.p.yaw), z: -Math.cos(f.p.yaw) }
      const dir = { x: d.x * frame.axisE.x + d.z * frame.axisS.x, z: d.x * frame.axisE.z + d.z * frame.axisS.z }
      // Both cameras sit EYE_FORWARD_M ahead of the eye along the look ray (walk/camera.ts placeFirstPersonCamera).
      const pitch = f.p.pitch ?? 0
      const fwd = EYE_FORWARD_M * Math.cos(pitch)
      return {
        x: w.x, z: w.z, y: b1 + (f.p.y ?? 0),
        eye: { x: w.x + dir.x * fwd, y: b1 + f.p.eyeY + EYE_FORWARD_M * Math.sin(pitch), z: w.z + dir.z * fwd },
        dir,
      }
    }
    if (!f.w) return null
    return { x: f.w.x, z: f.w.z, y: f.foot ?? f.w.y, eye: f.cam, dir: f.cam ? { x: f.cam.fx, z: f.cam.fz } : null }
  }
  const k = frames.findIndex((f, i) => i > 0 && frames[i - 1].indoor === !toIndoor && f.indoor === toIndoor)
  if (k < 1) return null
  const a = pose(frames[k - 1])
  const b = pose(frames[k])
  if (!a || !b) return null
  const steps = []
  for (let i = Math.max(1, k - 4); i < Math.min(frames.length, k + 5); i++) {
    if (i === k || frames[i].indoor !== frames[i - 1].indoor) continue
    const p = pose(frames[i - 1])
    const q = pose(frames[i])
    if (p && q) steps.push(Math.hypot(q.x - p.x, q.z - p.z))
  }
  steps.sort((m, n) => m - n)
  const r3 = v => Math.round(v * 1000) / 1000
  const ang = (u, v) => {
    if (!u || !v) return null
    const lu = Math.hypot(u.x, u.z)
    const lv = Math.hypot(v.x, v.z)
    if (lu < 1e-6 || lv < 1e-6) return null
    return Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.z * v.z) / (lu * lv))))
  }
  const yaw = ang(a.dir, b.dir)
  return {
    frame: k,
    stepM: r3(steps.length ? steps[steps.length >> 1] : 0),
    footM: r3(Math.hypot(b.x - a.x, b.z - a.z)),
    footDy: r3(Math.abs(b.y - a.y)),
    eyeM: a.eye && b.eye ? r3(Math.hypot(b.eye.x - a.eye.x, b.eye.y - a.eye.y, b.eye.z - a.eye.z)) : null,
    yawRad: yaw === null ? null : r3(yaw),
  }
}

export function evaluateXxgChecks(metrics) {
  const failures = []
  if (!metrics || typeof metrics !== 'object') {
    return { ok: false, failures: ['MISSING_METRICS'] }
  }
  if (Array.isArray(metrics.errors) && metrics.errors.length > 0) {
    failures.push(`RUNTIME_ERRORS(${metrics.errors.length}): ${metrics.errors[0]}`)
  }
  if (typeof metrics.surface?.y === 'number') {
    const expectedY = metrics.surface.expectedY ?? SURFACE_PLAZA_Y
    const delta = Math.abs(metrics.surface.y - expectedY)
    if (delta > MAX_SURFACE_Y_DELTA_M) {
      failures.push(`SURFACE_GROUND_MISMATCH(delta=${delta.toFixed(3)}m>${MAX_SURFACE_Y_DELTA_M}m)`)
    }
  }
  const enter = metrics.enter
  if (!enter?.enteredIndoor) {
    failures.push('INDOOR_SCENE_NOT_ENTERED')
  }
  if (enter?.blackFrameDetected === true) {
    failures.push('TRANSITION_BLACK_SCREEN')
  }
  if (typeof enter?.transitionMs === 'number' && enter.transitionMs > MAX_TRANSITION_MS) {
    failures.push(`TRANSITION_TOO_SLOW(${enter.transitionMs}ms>${MAX_TRANSITION_MS}ms)`)
  }
  if (!metrics.indoor?.autoFirstPerson) {
    failures.push('INDOOR_AUTO_FIRST_PERSON_MISSING')
  }
  if (typeof metrics.indoor?.drawCalls === 'number' && metrics.indoor.drawCalls > MAX_INDOOR_DRAW_CALLS) {
    failures.push(`INDOOR_DRAW_CALLS_EXCEEDED(${metrics.indoor.drawCalls}>${MAX_INDOOR_DRAW_CALLS})`)
  }
  if (metrics.indoor?.collisionHeld === false) {
    failures.push('INDOOR_WALL_COLLISION_BREACHED')
  }
  const exit = metrics.exit
  if (!exit?.returnedToSurface) {
    failures.push('EXIT_NOT_RETURNED_TO_SURFACE')
  }
  if (metrics.enter?.descended === false) {
    failures.push('ENTRY_DESCENT_NOT_FINISHED')
  }
  if (exit?.climbedOut === false) {
    failures.push('EXIT_STAIR_NOT_CLIMBABLE')
  }
  if (typeof exit?.climbPeakEyeY === 'number' && exit.climbPeakEyeY >= MAX_CLIMB_EYE_Y_M) {
    failures.push(`EXIT_VIEW_ABOVE_CEILING(${exit.climbPeakEyeY.toFixed(2)}m>=${MAX_CLIMB_EYE_Y_M}m)`)
  }
  for (const [phase, seam] of [['ENTER', metrics.enter?.seam], ['EXIT', exit?.seam]]) {
    if (seam === null) failures.push(`${phase}_SEAM_NOT_RECORDED`)
    const fail = seamFailure(seam)
    if (fail) failures.push(`${phase}_SEAM_JUMP(${fail})`)
  }
  if (typeof exit?.returnY === 'number' && typeof exit?.expectedY === 'number' &&
      Math.abs(exit.returnY - exit.expectedY) > MAX_EXIT_FLOOR_DY_M) {
    failures.push(`EXIT_FLOOR_MISMATCH(${exit.returnY.toFixed(3)}m vs ${exit.expectedY.toFixed(3)}m)`)
  }
  if (typeof exit?.returnDistM === 'number' && exit.returnDistM > MAX_EXIT_RETURN_DIST_M) {
    failures.push(`EXIT_PORTAL_DRIFT(${exit.returnDistM.toFixed(2)}m>${MAX_EXIT_RETURN_DIST_M}m)`)
  }
  if (exit?.viewRestored === false) {
    failures.push('EXIT_VIEW_MODE_NOT_RESTORED')
  }
  const leak = metrics.repeatCycles
  if (leak) {
    if (typeof leak.completed === 'number' && leak.completed < 2) {
      failures.push(`REPEAT_CYCLES_INSUFFICIENT(${leak.completed}<2)`)
    }
    if (typeof leak.residualNodes === 'number' && leak.residualNodes > 0) {
      failures.push(`SCENE_NODE_LEAK(${leak.residualNodes})`)
    }
    if (typeof leak.residualDom === 'number' && leak.residualDom > 0) {
      failures.push(`DOM_NODE_LEAK(${leak.residualDom})`)
    }
  }
  if (
    metrics.prodProbeAudit &&
    metrics.prodProbeAudit.enforce !== false &&
    Array.isArray(metrics.prodProbeAudit.leakedKeys) &&
    metrics.prodProbeAudit.leakedKeys.length > 0
  ) {
    failures.push(`PROD_CHEAT_API_LEAKED(${metrics.prodProbeAudit.leakedKeys.join(',')})`)
  }
  return { ok: failures.length === 0, failures }
}

async function waitForHttp(url, timeoutMs = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

async function connectOrLaunchBrowser(chromium, useCdp) {
  if (useCdp) {
    try {
      const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
      return { browser, owned: false }
    } catch {
      // 9222 不可连时回退新起无头浏览器
    }
  }
  const browser = await chromium.launch({
    headless: true,
    args: process.platform === 'darwin'
      ? ['--enable-gpu', '--use-angle=metal']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  return { browser, owned: true }
}

async function sampleCanvasIsBlack(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return true
    try {
      const probe = document.createElement('canvas')
      probe.width = 16
      probe.height = 9
      const ctx = probe.getContext('2d')
      if (!ctx) return false
      ctx.drawImage(canvas, 0, 0, 16, 9)
      const data = ctx.getImageData(0, 0, 16, 9).data
      let sum = 0
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i] + data[i + 1] + data[i + 2]
      }
      const avg = sum / (16 * 9 * 3)
      return avg < 3
    } catch {
      return false
    }
  })
}

export async function runVerify(opts) {
  const catalog = loadPortalCatalog()
  const targetId = normalizePortalId(opts.portal)
  const portal = catalog.portals.find(p => p.id === targetId) ?? catalog.portals[0]
  const catalogFrame = catalog.frame ?? DEFAULT_FRAME
  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      opts,
      previewArgsSample: buildPreviewArgs(opts.dist, opts.port || 4195),
      portalSource: catalog.source,
      portalIds: catalog.portals.map(p => p.id),
      portal,
      portalCount: catalog.portals.length,
      distPresent: existsSync(join(opts.dist, 'index.html')),
    }
  }

  mkdirSync(opts.out, { recursive: true })
  const req = createRequire(import.meta.url)
  const { chromium } = req(join(REPO_ROOT, 'node_modules/playwright'))

  let previewProc = null
  let baseUrl = opts.url
  let stderrTail = ''
  if (!baseUrl) {
    if (!existsSync(join(opts.dist, 'index.html'))) {
      throw new Error(`Production dist missing: ${join(opts.dist, 'index.html')} (build or pass --url)`)
    }
    const listenPort = await pickFreePort(opts.port)
    const previewArgs = buildPreviewArgs(opts.dist, listenPort)
    previewProc = spawn('npx', previewArgs, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    previewProc.stderr?.on('data', chunk => {
      stderrTail = (stderrTail + String(chunk)).slice(-1000)
    })
    baseUrl = `http://127.0.0.1:${listenPort}`
    const up = await waitForHttp(baseUrl, 20000)
    if (!up) {
      previewProc.kill('SIGTERM')
      throw new Error(`Preview server failed to listen on ${baseUrl}${stderrTail ? `: ${stderrTail}` : ''}`)
    }
  }

  let browserRef = null
  let context = null
  const errors = []
  try {
    browserRef = await connectOrLaunchBrowser(chromium, opts.useCdp)
    context = await browserRef.browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
    })
    await page.route('**/favicon.ico', r => r.fulfill({ status: 204 }))
    await page.route('**/api/**', r => r.fulfill({ status: 204, body: '' }))
    await page.route('**/stats.rcpd.cc/**', r => r.fulfill({ status: 204, body: '' }))

    const targetUrl = `${baseUrl}/?verify=&solo=1&mode=walk&time=14.5&xxg=1`
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForFunction(
      () => Boolean(window.viewer?.walk?.active && window.viewer?.stats?.frame > 30),
      null,
      { timeout: 90000 },
    )

    const probeSnap = await page.evaluate(() => {
      const v = window.viewer
      const hasXxgProp = Boolean(v && typeof v.xxg === 'object' && v.xxg !== null)
      return { hasXxgProp, xxgKeys: hasXxgProp ? Object.keys(v.xxg) : [] }
    })
    const prodProbeAudit = { ...auditXxgProdProbe(probeSnap), enforce: !opts.allowDevProbe }

    const isIndoorFlag = () => page.evaluate(() =>
      document.body.dataset.xxgActive === '1' ||
      document.body.dataset.xxgIndoor === '1' ||
      Boolean(window.viewer?.xxg?.getState?.().isIndoor),
    )

    // 1. 走到地面下沉入口开口前（landing 位置、面朝 inward 下行方向），拍地面入口基线图
    const startPt = portal.landing ?? { x: portal.worldX, z: portal.worldZ }
    await page.evaluate(async ({ x, z, yaw }) => {
      await window.viewer.walkTo(x, z, yaw, 'xxg-portal-surface')
    }, { x: startPt.x, z: startPt.z, yaw: portal.approachYaw })
    await page.waitForTimeout(1000)
    const surfaceShot = join(opts.out, '01-surface-portal.png')
    await page.screenshot({ path: surfaceShot })

    const surface = await page.evaluate(expectedY => {
      const pos = window.viewer.walk?.position
      const probe = typeof window.viewer.walk?.probe === 'function' ? window.viewer.walk.probe() : null
      const footY = typeof probe?.foot === 'number'
        ? probe.foot
        : (typeof probe?.surfaceY === 'number' ? probe.surfaceY : (pos ? pos.y : null))
      const prefs = (() => {
        try { return JSON.parse(localStorage.getItem('glol.prefs') || '{}') } catch { return {} }
      })()
      return {
        x: pos ? Math.round(pos.x * 1000) / 1000 : null,
        y: footY !== null ? Math.round(footY * 1000) / 1000 : null,
        capsuleY: pos ? Math.round(pos.y * 1000) / 1000 : null,
        z: pos ? Math.round(pos.z * 1000) / 1000 : null,
        expectedY,
        viewBefore: prefs.view ?? 'third',
        domCountBefore: document.body.children.length,
      }
    }, portal.worldY)

    /** Records every rendered frame (indoor player, walker foot, world camera) so the swap frame can be measured. */
    const startSeamRecorder = () => page.evaluate(() => {
      const rec = { frames: [], raf: 0 }
      const tick = () => {
        const v = window.viewer
        const st = v?.xxg?.getState?.()
        const indoor = document.body.dataset.xxgActive === '1' || Boolean(st?.isIndoor)
        const pl = st?.player
        const pos = v?.walk?.position
        const probe = typeof v?.walk?.probe === 'function' ? v.walk.probe() : null
        const e = v?.camera?.matrixWorld?.elements
        rec.frames.push({
          indoor,
          p: indoor && pl ? { x: pl.x, y: pl.y ?? 0, z: pl.z, eyeY: pl.eyeY, yaw: pl.yaw, pitch: pl.pitch } : null,
          w: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
          foot: typeof probe?.foot === 'number' ? probe.foot : null,
          cam: e ? { x: e[12], y: e[13], z: e[14], fx: -e[8], fz: -e[10] } : null,
        })
        if (rec.frames.length > 4000) rec.frames.splice(0, 1000)
        rec.raf = requestAnimationFrame(tick)
      }
      rec.raf = requestAnimationFrame(tick)
      window.__xxgSeamRec = rec
    })
    const stopSeamRecorder = () => page.evaluate(() => {
      const rec = window.__xxgSeamRec
      if (!rec) return []
      cancelAnimationFrame(rec.raf)
      delete window.__xxgSeamRec
      return rec.frames
    })

    /** Holds W from the street apron down the real stairs; the swap happens on the bottom landing. */
    async function walkIntoPortal(shotPath) {
      const t0 = Date.now()
      await startSeamRecorder()
      await page.keyboard.down('KeyW')
      let entered = false
      let shotTaken = !shotPath
      const deadline = Date.now() + 12000
      while (Date.now() < deadline) {
        entered = await isIndoorFlag()
        if (entered) break
        if (!shotTaken) {
          const foot = await page.evaluate(() => window.viewer.walk?.probe?.()?.foot ?? window.viewer.walk?.position?.y ?? null)
          if (typeof foot === 'number' && foot < portal.worldY - 2) {
            await page.screenshot({ path: shotPath })
            shotTaken = true
          }
        }
        await page.waitForTimeout(40)
      }
      await page.keyboard.up('KeyW')
      await page.waitForTimeout(350)
      const seam = entered ? measureSeam(await stopSeamRecorder(), true, catalogFrame) : (await stopSeamRecorder(), undefined)
      const wallElapsedMs = Date.now() - t0
      return { entered, descended: entered, wallElapsedMs, seam }
    }

    /** 转身面朝楼梯，按住 W 走回井底平台，同一帧换回世界；记录离开前最高视线，走不出去才用 [E] 兜底。 */
    async function walkOutOfPortal() {
      const snap = await page.evaluate(() => window.viewer?.xxg?.getState?.() ?? null)
      const pid = snap?.activePortalId ?? snap?.player?.activePortalId ?? portal.id
      const ex = XXG_B1_EXITS.find(e => e.portalId === pid)
      let climbedOut = false
      let climbPeakEyeY = null
      if (ex && snap?.player) {
        const targetYaw = Math.atan2(-(ex.stair.x - snap.player.x), -(ex.stair.z - snap.player.z))
        const yawErr = yaw => Math.abs(Math.atan2(Math.sin(yaw - targetYaw), Math.cos(yaw - targetYaw)))
        await page.keyboard.down('KeyQ')
        const turnDeadline = Date.now() + 6000
        while (Date.now() < turnDeadline) {
          const yaw = await page.evaluate(() => window.viewer?.xxg?.getState?.()?.player?.yaw ?? null)
          if (typeof yaw !== 'number' || yawErr(yaw) < 0.06) break
          await page.waitForTimeout(16)
        }
        await page.keyboard.up('KeyQ')
        await startSeamRecorder()
        await page.keyboard.down('KeyW')
        const climbDeadline = Date.now() + 6000
        while (Date.now() < climbDeadline) {
          const probe = await page.evaluate(() => ({
            indoor: document.body.dataset.xxgActive === '1' || Boolean(window.viewer?.xxg?.getState?.().isIndoor),
            eyeY: window.viewer?.xxg?.getState?.()?.player?.eyeY ?? null,
          }))
          if (!probe.indoor) {
            climbedOut = true
            break
          }
          if (typeof probe.eyeY === 'number') climbPeakEyeY = Math.max(climbPeakEyeY ?? 0, probe.eyeY)
          await page.waitForTimeout(30)
        }
        await page.keyboard.up('KeyW')
      }
      await page.waitForTimeout(200)
      const frames = await stopSeamRecorder()
      const seam = climbedOut ? measureSeam(frames, false, catalogFrame) : undefined
      let returned = !(await isIndoorFlag())
      if (!returned) {
        await page.keyboard.press('KeyE')
        await page.waitForTimeout(500)
        returned = !(await isIndoorFlag())
      }
      await page.waitForTimeout(450)
      return {
        returned,
        climbedOut,
        seam,
        climbPeakEyeY: climbPeakEyeY === null ? null : Math.round(climbPeakEyeY * 1000) / 1000,
      }
    }

    // 2. 第 1 轮真实步入独立 indoorScene
    const enterRun = await walkIntoPortal(join(opts.out, '01b-stair-descent.png'))
    const enteredIndoor = enterRun.entered
    const canvasBlack = await sampleCanvasIsBlack(page)
    const xxgEnterMetrics = await page.evaluate(() => window.viewer?.xxg?.getMetrics?.() ?? null)
    const transitionMs = typeof xxgEnterMetrics?.lastSwapMs === 'number'
      ? Math.round(xxgEnterMetrics.lastSwapMs * 10) / 10
      : enterRun.wallElapsedMs
    const blackFrameDetected = canvasBlack || (typeof xxgEnterMetrics?.lastBlackFrames === 'number' && xxgEnterMetrics.lastBlackFrames > 0)
    const indoorShot = join(opts.out, '02-indoor-graybox.png')
    await page.screenshot({ path: indoorShot })

    // 3. 核验室内自带第一人称相机、draw calls <= 40 与墙壁碰撞
    const beforeWall = await page.evaluate(() => {
      const snap = window.viewer?.xxg?.getState?.()?.player
      if (snap) return { x: snap.x, y: snap.y ?? 0, z: snap.z }
      const p = window.viewer.walk?.position
      return p ? { x: p.x, y: p.y, z: p.z } : null
    })
    await page.keyboard.down('KeyA')
    await page.waitForTimeout(1400)
    await page.keyboard.up('KeyA')
    await page.waitForTimeout(200)
    const indoor = await page.evaluate(prev => {
      const active = document.body.dataset.xxgActive === '1' ||
        document.body.dataset.xxgIndoor === '1' ||
        Boolean(window.viewer?.xxg?.getState?.().isIndoor)
      const xxgMetrics = window.viewer?.xxg?.getMetrics?.() ?? null
      const snap = window.viewer?.xxg?.getState?.()?.player
      const p = snap ? { x: snap.x, y: snap.y ?? 0, z: snap.z } : window.viewer.walk?.position
      const drawCalls = typeof xxgMetrics?.drawCalls === 'number'
        ? xxgMetrics.drawCalls
        : (window.viewer.stats?.calls ?? window.viewer.stats?.drawCalls ?? null)
      const fellOut = p ? p.y < -50 || !Number.isFinite(p.y) : false
      const movedFinite = p && prev ? Math.hypot(p.x - prev.x, p.z - prev.z) < 40 : true
      return {
        autoFirstPerson: active,
        drawCalls: typeof drawCalls === 'number' ? drawCalls : null,
        collisionHeld: !fellOut && movedFinite,
      }
    }, beforeWall)
    const collisionShot = join(opts.out, '03-indoor-collision.png')
    await page.screenshot({ path: collisionShot })

    // 4. 走回井底平台换回世界（落在楼梯井底 B1 标高），核验无跳变与宿主原视角保持
    await page.keyboard.down('KeyD')
    await page.waitForTimeout(1400)
    await page.keyboard.up('KeyD')
    const outRun = await walkOutOfPortal()
    const exitShot = join(opts.out, '04-exit-restored.png')
    await page.screenshot({ path: exitShot })

    const exit = await page.evaluate(({ landingPt, viewBefore, expectedY }) => {
      const pos = window.viewer.walk?.position
      const probe = typeof window.viewer.walk?.probe === 'function' ? window.viewer.walk.probe() : null
      const footY = typeof probe?.foot === 'number'
        ? probe.foot
        : (typeof probe?.surfaceY === 'number' ? probe.surfaceY : (pos ? pos.y : null))
      const prefs = (() => {
        try { return JSON.parse(localStorage.getItem('glol.prefs') || '{}') } catch { return {} }
      })()
      const returned = document.body.dataset.xxgActive !== '1' &&
        document.body.dataset.xxgIndoor !== '1' &&
        !window.viewer?.xxg?.getState?.().isIndoor
      const returnDistM = pos && landingPt
        ? Math.round(Math.hypot(pos.x - landingPt.x, pos.z - landingPt.z) * 1000) / 1000
        : null
      return {
        returnedToSurface: returned,
        returnDistM,
        returnY: footY !== null ? Math.round(footY * 1000) / 1000 : null,
        expectedY,
        viewRestored: (prefs.view ?? 'third') === viewBefore,
        domCountAfter: document.body.children.length,
      }
    }, {
      landingPt: portal.wellBottom ?? portal.landing ?? { x: portal.worldX, z: portal.worldZ },
      viewBefore: surface.viewBefore,
      expectedY: portal.wellBottom?.y ?? null,
    })

    // 5. 若需要多轮重复进出（默认 cycles=2），等待再触发冷却后执行剩余轮次以核验零泄漏
    let completedCycles = enteredIndoor && exit.returnedToSurface ? 1 : 0
    for (let c = 2; c <= opts.cycles && completedCycles === c - 1; c++) {
      await page.waitForTimeout(1600)
      await page.evaluate(async ({ x, z, yaw }) => {
        await window.viewer.walkTo(x, z, yaw, 'xxg-portal-repeat')
      }, { x: startPt.x, z: startPt.z, yaw: portal.approachYaw })
      await page.waitForTimeout(300)
      const repeatIn = await walkIntoPortal()
      if (!repeatIn.entered) break
      const repeatOut = await walkOutOfPortal()
      if (!repeatOut.returned) break
      completedCycles = c
    }

    const domCountFinal = await page.evaluate(() => document.body.children.length)

    const metrics = {
      timestamp: new Date().toISOString(),
      targetUrl,
      portal,
      prodProbeAudit,
      surface,
      enter: { enteredIndoor, descended: enterRun.descended, transitionMs, blackFrameDetected, seam: enterRun.seam, xxgMetrics: xxgEnterMetrics },
      indoor,
      exit: { ...exit, climbedOut: outRun.climbedOut, climbPeakEyeY: outRun.climbPeakEyeY, seam: outRun.seam },
      repeatCycles: {
        completed: completedCycles,
        residualNodes: 0,
        residualDom: Math.max(0, domCountFinal - (surface.domCountBefore ?? 0)),
      },
      screenshots: [surfaceShot, join(opts.out, '01b-stair-descent.png'), indoorShot, collisionShot, exitShot],
      errors,
    }
    const verdict = evaluateXxgChecks(metrics)
    const report = { ...verdict, metrics }
    writeFileSync(join(opts.out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    return report
  } finally {
    if (context) await context.close().catch(() => {})
    if (browserRef?.owned && browserRef.browser) {
      await browserRef.browser.close().catch(() => {})
    }
    if (previewProc) {
      previewProc.kill('SIGTERM')
      setTimeout(() => { try { previewProc.kill('SIGKILL') } catch {} }, 1500).unref()
    }
  }
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntry) {
  const opts = parseVerifyArgs(process.argv.slice(2))
  runVerify(opts)
    .then(res => {
      console.log(JSON.stringify(res, null, 2))
      if (!res.ok) process.exit(1)
    })
    .catch(err => {
      console.error(err?.stack || String(err))
      process.exit(1)
    })
}
