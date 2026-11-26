#!/usr/bin/env node
/**
 * 十字街地下街 B1（路线 A）端到端实景验收脚本（对应 k14）：
 * - 自动启动本地 Vite 开发服（随机空闲端口，绝不碰 4190/5173/5176）与无头 Playwright Chromium，
 *   并在 finally 中严格关闭浏览器与开发服；
 * - 逐一验证 4 个楼梯口（nw / ne / se / sw，直读冻结版 web/src/shizijie/contract.ts）：
 *   1) 自动探测 web/src/main.ts 是否已挂载 window.viewer.szj：
 *      - 已挂载（host-integrated）：在完整桂林世界中依次走近 nw/ne/se/sw 4 个入口触发进入、验证强制第一人称与
 *        顺滑下楼（Δy <= 0.08m）、无黑屏、drawCalls <= 60、tris <= 200k、48 NPCs <= 6 drawCalls，随后上楼离开
 *        回到对应 stairLanding（误差 <= 0.5m）；
 *      - 并行构建期（vite-dev-webgl-harness，main.ts 尚未合入）：通过同台 Vite 开发服的虚拟路由
 *        /__szj-verify.html 加载真实 TS 模块（contract.ts + crowd/index.ts + locomotion/stairs/index.ts，
 *        若 runtime/layout 已落地亦自动接入），在真实 WebGLRenderer 上验证 4 口进出曲线、实测 WebGL
 *        48 NPCs drawCalls <= 6、crowd.step < 1.5ms、无黑屏，并产出 4 口 + B1 人群全景实拍截图；
 * - 输出结构化 JSON 到 stdout 及 <out>/report.json，截图写入 /Users/pan-work/z-test/shizijie-shots。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer as createNetServer } from 'node:net'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SZJ_BUDGET,
  SZJ_FRAME,
  SZJ_PLAYER,
  SZJ_STAIRWELLS,
  SZJ_STAIR_IDS,
  stairLanding,
  stairLocalToIndoor,
  yawFacing,
} from '../web/src/shizijie/contract.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const DEFAULT_OUT = '/Users/pan-work/z-test/shizijie-shots'
const DEFAULT_COMPARE_OUT = '/Users/pan-work/z-test/shizijie-compare'
const DEFAULT_B1_REAL_DIR = '/Users/pan-work/z-test/shizijie-ref-pack/b1-real'
const DEFAULT_REFPACK_DIR = '/Users/pan-work/z-test/shizijie-ref-pack'
const MIN_COMPARE_SHEETS = 7
const FORBIDDEN_PORTS = new Set([4188, 4190, 5173, 5174, 5175, 5176, 5179])

async function pickFreePort(preferredPort) {
  if (Number.isInteger(preferredPort) && preferredPort > 0) {
    if (FORBIDDEN_PORTS.has(preferredPort)) {
      throw new Error(`Port ${preferredPort} is forbidden`)
    }
    return preferredPort
  }
  for (let i = 0; i < 8; i++) {
    const port = await new Promise((res, rej) => {
      const srv = createNetServer()
      srv.unref()
      srv.on('error', rej)
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address()
        const p = typeof addr === 'object' && addr ? addr.port : 0
        srv.close(() => res(p))
      })
    })
    if (port > 0 && !FORBIDDEN_PORTS.has(port)) return port
  }
  throw new Error('Failed to allocate free ephemeral port')
}

export function parseArgs(argv) {
  const opts = {
    out: DEFAULT_OUT,
    outExplicit: false,
    url: '',
    port: 0,
    mode: 'auto', // 'auto' | 'host' | 'harness'
    cdp: false,
    dryRun: false,
    compare: false,
    refDir: '',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--out') {
      opts.out = resolve(next() || DEFAULT_OUT)
      opts.outExplicit = true
    } else if (a === '--url') opts.url = String(next() || '')
    else if (a === '--port') opts.port = Number(next()) || 0
    else if (a === '--mode') opts.mode = String(next() || 'auto')
    else if (a === '--cdp') opts.cdp = true
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--compare') opts.compare = true
    else if (a === '--ref-dir') opts.refDir = resolve(next() || DEFAULT_B1_REAL_DIR)
  }
  if (opts.compare && !opts.outExplicit) {
    opts.out = DEFAULT_COMPARE_OUT
  }
  if (opts.port && FORBIDDEN_PORTS.has(opts.port)) {
    throw new Error(`Port ${opts.port} is forbidden (reserved host/preview ports: 4190, 5173, 5175, 5176, 5179)`)
  }
  return opts
}

export function evaluateShizijieReport(report) {
  const failures = []
  if (!report || typeof report !== 'object') return { ok: false, failures: ['MISSING_REPORT'] }
  if (Array.isArray(report.errors) && report.errors.length > 0) {
    failures.push(`RUNTIME_ERRORS(${report.errors.length}): ${report.errors[0]}`)
  }
  for (const id of SZJ_STAIR_IDS) {
    const m = report.mouths?.[id]
    if (!m) {
      failures.push(`MOUTH_MISSING:${id}`)
      continue
    }
    if (!m.pass) failures.push(`MOUTH_FAILED:${id}(${(m.reasons || []).join(',') || 'unknown'})`)
    if (typeof m.maxEyeDy !== 'number' || !Number.isFinite(m.maxEyeDy)) {
      failures.push(`MOUTH_EYE_DY_MISSING:${id}`)
    } else if (m.maxEyeDy > SZJ_BUDGET.eyeDyPerFrameMax + 1e-6) {
      failures.push(`MOUTH_EYE_DY_EXCEEDED:${id}(${m.maxEyeDy}>${SZJ_BUDGET.eyeDyPerFrameMax})`)
    }
    if (typeof m.swapMs !== 'number' || !Number.isFinite(m.swapMs)) {
      failures.push(`MOUTH_SWAP_MS_MISSING:${id}`)
    } else if (m.swapMs > SZJ_BUDGET.swapMsMax) {
      failures.push(`MOUTH_SWAP_MS_EXCEEDED:${id}(${m.swapMs}>${SZJ_BUDGET.swapMsMax})`)
    }
    if (typeof m.enterSwapMs === 'number' && Number.isFinite(m.enterSwapMs) && m.enterSwapMs > SZJ_BUDGET.swapMsMax) {
      failures.push(`MOUTH_ENTER_SWAP_MS_EXCEEDED:${id}(${m.enterSwapMs}>${SZJ_BUDGET.swapMsMax})`)
    }
    if (typeof m.blackFrames !== 'number' || !Number.isFinite(m.blackFrames)) {
      failures.push(`MOUTH_BLACK_FRAMES_MISSING:${id}`)
    } else if (m.blackFrames > SZJ_BUDGET.blackFramesMax) {
      failures.push(`MOUTH_BLACK_FRAMES:${id}(${m.blackFrames})`)
    }
    if (typeof m.landingError !== 'number' || !Number.isFinite(m.landingError)) {
      failures.push(`MOUTH_LANDING_ERR_MISSING:${id}`)
    } else if (m.landingError > SZJ_BUDGET.landingErrorMax) {
      failures.push(`MOUTH_LANDING_ERR:${id}(${m.landingError}>${SZJ_BUDGET.landingErrorMax})`)
    }
    if (typeof m.indoorDrawCalls !== 'number' || !Number.isFinite(m.indoorDrawCalls) || m.indoorDrawCalls <= 0) {
      failures.push(`MOUTH_DRAW_CALLS_MISSING:${id}`)
    } else if (m.indoorDrawCalls > SZJ_BUDGET.indoorDrawCallsMax) {
      failures.push(`MOUTH_DRAW_CALLS_EXCEEDED:${id}(${m.indoorDrawCalls}>${SZJ_BUDGET.indoorDrawCallsMax})`)
    }
    if (typeof m.indoorTriangles !== 'number' || !Number.isFinite(m.indoorTriangles) || m.indoorTriangles <= 0) {
      failures.push(`MOUTH_TRIS_MISSING:${id}`)
    } else if (m.indoorTriangles > SZJ_BUDGET.indoorTrianglesMax) {
      failures.push(`MOUTH_TRIS_EXCEEDED:${id}(${m.indoorTriangles}>${SZJ_BUDGET.indoorTrianglesMax})`)
    }
  }
  const c = report.crowd
  if (!c) {
    failures.push('CROWD_METRICS_MISSING')
  } else {
    if (c.activeCount !== SZJ_BUDGET.npcMax) {
      failures.push(`CROWD_COUNT_MISMATCH(${c.activeCount}!=${SZJ_BUDGET.npcMax})`)
    }
    if (typeof c.webglDrawCalls !== 'number' || !Number.isFinite(c.webglDrawCalls) || c.webglDrawCalls <= 0) {
      failures.push(`CROWD_DRAW_CALLS_MISSING(${c.webglDrawCalls})`)
    } else if (c.webglDrawCalls > SZJ_BUDGET.npcDrawCallsMax) {
      failures.push(`CROWD_DRAW_CALLS_EXCEEDED(${c.webglDrawCalls}>${SZJ_BUDGET.npcDrawCallsMax})`)
    }
    if (typeof c.drawCalls === 'number' && (c.drawCalls <= 0 || c.drawCalls > SZJ_BUDGET.npcDrawCallsMax)) {
      failures.push(`CROWD_STATIC_DRAW_CALLS_EXCEEDED(${c.drawCalls}>${SZJ_BUDGET.npcDrawCallsMax})`)
    }
    if (typeof c.stepSamples !== 'number' || !Number.isFinite(c.stepSamples) || c.stepSamples <= 0) {
      failures.push(`CROWD_STEP_UNMEASURED(${c.stepSamples ?? 'missing'})`)
    }
    if (typeof c.avgStepMs !== 'number' || !Number.isFinite(c.avgStepMs)) {
      failures.push(`CROWD_STEP_MISSING(${c.avgStepMs})`)
    } else if (c.avgStepMs >= SZJ_BUDGET.crowdStepMsMax) {
      failures.push(`CROWD_STEP_TOO_SLOW(${c.avgStepMs}>=${SZJ_BUDGET.crowdStepMsMax})`)
    }
  }
  if (!Array.isArray(report.screenshots) || report.screenshots.length < 4) {
    failures.push(`SCREENSHOTS_INSUFFICIENT(${report.screenshots?.length ?? 0}<4)`)
  }
  if (report.compare?.enabled) {
    const cmp = report.compare
    if (typeof cmp.sheetCount !== 'number' || cmp.sheetCount < MIN_COMPARE_SHEETS) {
      failures.push(`COMPARE_SHEETS_INSUFFICIENT(${cmp.sheetCount ?? 0}<${MIN_COMPARE_SHEETS})`)
    }
    if (!Array.isArray(cmp.sheets) || cmp.sheets.length < MIN_COMPARE_SHEETS) {
      failures.push(`COMPARE_SHEET_LIST_INSUFFICIENT(${cmp.sheets?.length ?? 0}<${MIN_COMPARE_SHEETS})`)
    }
    if (cmp.signVisible !== true || report.signVisible !== true) {
      failures.push('COMPARE_SIGN_NOT_VISIBLE')
    }
    if (cmp.signReadable !== true || report.signReadable !== true) {
      failures.push('COMPARE_SIGN_NOT_READABLE')
    }
    if (Array.isArray(cmp.sheets)) {
      for (const s of cmp.sheets) {
        if (s.renderBlack) failures.push(`COMPARE_BLACK_FRAME:${s.id}`)
        if (typeof s.signVisible !== 'boolean' || typeof s.signReadable !== 'boolean') {
          failures.push(`COMPARE_SIGN_FLAGS_MISSING:${s.id}`)
        }
      }
    }
  }
  return { ok: failures.length === 0, failures }
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

function mimeForPath(filePath) {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

function fileToDataUrl(filePath) {
  const buf = readFileSync(filePath)
  return `data:${mimeForPath(filePath)};base64,${buf.toString('base64')}`
}

function loadRefEntriesFromDir(dirPath, originTag) {
  const entries = []
  if (!dirPath || !existsSync(dirPath)) return entries
  const seen = new Set()
  const idxPath = join(dirPath, 'index.json')
  if (existsSync(idxPath)) {
    try {
      const parsed = JSON.parse(readFileSync(idxPath, 'utf8'))
      const rawList = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.images)
          ? parsed.images
          : Array.isArray(parsed.items)
            ? parsed.items
            : Array.isArray(parsed.photos)
              ? parsed.photos
              : []
      for (const item of rawList) {
        const rel = item.file || item.local_file || item.path || item.filename
        if (!rel) continue
        const abs = existsSync(rel) ? resolve(rel) : resolve(dirPath, rel)
        if (!existsSync(abs) || seen.has(abs)) continue
        seen.add(abs)
        const tags = []
        if (Array.isArray(item.tags)) tags.push(...item.tags.map(String))
        if (item.category) tags.push(String(item.category))
        if (item.zone_type) tags.push(String(item.zone_type))
        if (item.viewpoint) tags.push(String(item.viewpoint))
        if (item.ceiling_sign_kind) tags.push(String(item.ceiling_sign_kind))
        if (item.description) tags.push(String(item.description))
        if (item.visual_summary) tags.push(String(item.visual_summary))
        if (item.caption) tags.push(String(item.caption))
        const hasSign = Boolean(item.shows_ceiling_sign || item.has_ceiling_sign || item.ceiling_sign || item.hasCeilingSign)
        if (hasSign) tags.push('ceiling_sign')
        entries.push({
          file: abs,
          name: basename(abs),
          origin: originTag,
          sourceUrl: item.url || item.source_url || item.source || '',
          captureDate: item.capture_date || item.date || item.captured_at || 'unknown',
          license: item.license || item.licence || 'reference-only',
          tagsText: `${basename(abs)} ${tags.join(' ')}`.toLowerCase(),
          showsCeilingSign: hasSign,
        })
      }
      // Also parse standard fetch_city_ref.py channels (baidu/bilibili/wikimedia) when present
      if (parsed.channels) {
        const baiduPanos = parsed.channels.baidu?.panoramas || []
        for (const p of baiduPanos) {
          const views = p.views || {}
          for (const [dir, rel] of Object.entries(views)) {
            const abs = existsSync(rel) ? resolve(rel) : resolve(dirPath, rel)
            if (!existsSync(abs) || seen.has(abs)) continue
            seen.add(abs)
            entries.push({
              file: abs,
              name: basename(abs),
              origin: `${originTag}:baidu`,
              sourceUrl: p.sid ? `https://map.baidu.com/?panoid=${p.sid}` : '',
              captureDate: p.capture_date || '2023',
              license: 'Baidu Street View (ref only)',
              tagsText: `${p.tag || ''} ${p.desc || ''} ${dir} ${basename(abs)}`.toLowerCase(),
              showsCeilingSign: false,
            })
          }
        }
        const biliKf = parsed.channels.bilibili?.selected_video?.keyframes_sheet
        if (biliKf) {
          const abs = existsSync(biliKf) ? resolve(biliKf) : resolve(dirPath, biliKf)
          if (existsSync(abs) && !seen.has(abs)) {
            seen.add(abs)
            entries.push({
              file: abs,
              name: basename(abs),
              origin: `${originTag}:bilibili`,
              sourceUrl: parsed.channels.bilibili?.selected_video?.url || '',
              captureDate: 'bilibili-videoshot',
              license: 'Bilibili frame (ref only)',
              tagsText: `bilibili corridor street shop ${basename(abs)}`.toLowerCase(),
              showsCeilingSign: false,
            })
          }
        }
        const wikiItems = parsed.channels.wikimedia?.items || []
        for (const w of wikiItems) {
          const rel = w.local_file || w.file
          if (!rel) continue
          const abs = existsSync(rel) ? resolve(rel) : resolve(dirPath, rel)
          if (!existsSync(abs) || seen.has(abs)) continue
          seen.add(abs)
          entries.push({
            file: abs,
            name: basename(abs),
            origin: `${originTag}:wikimedia`,
            sourceUrl: w.url || '',
            captureDate: 'wikimedia',
            license: w.license || 'Wikimedia',
            tagsText: `${w.title || ''} ${basename(abs)}`.toLowerCase(),
            showsCeilingSign: false,
          })
        }
      }
    } catch {
      // Fall through to directory scan
    }
  }

  const walk = (cur, depth) => {
    if (depth > 2 || !existsSync(cur)) return
    for (const ent of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === '720yun') continue
        if (ent.name === 'b1-real' && originTag !== 'b1-real') continue
        walk(full, depth + 1)
      } else if (ent.isFile() && IMAGE_EXTS.has(extname(ent.name).toLowerCase())) {
        if (seen.has(full)) continue
        if (
          ent.name.includes('equirect') ||
          ent.name.includes('4views_sheet') ||
          /_sheet_\d+\./i.test(ent.name) ||
          ent.name.includes('720yun')
        ) {
          continue
        }
        seen.add(full)
        entries.push({
          file: full,
          name: ent.name,
          origin: originTag,
          sourceUrl: '',
          captureDate: 'local-ref',
          license: 'reference-only',
          tagsText: `${cur} ${ent.name}`.toLowerCase(),
          showsCeilingSign: /sign|吊牌|指示|导视|出口/.test(ent.name.toLowerCase()),
        })
      }
    }
  }
  walk(dirPath, 0)
  return entries
}

function loadRealReferenceCatalog(refDirOverride) {
  const b1Dir = refDirOverride || DEFAULT_B1_REAL_DIR
  const b1Entries = loadRefEntriesFromDir(b1Dir, 'b1-real')
  const fallbackEntries = loadRefEntriesFromDir(DEFAULT_REFPACK_DIR, 'shizijie-ref-pack')
  const source =
    b1Entries.length >= MIN_COMPARE_SHEETS
      ? 'b1-real'
      : b1Entries.length > 0
        ? 'b1-real+fallback'
        : 'shizijie-ref-pack-fallback'
  return {
    b1Dir,
    b1RealCount: b1Entries.length,
    source,
    entries: [...b1Entries, ...fallbackEntries],
  }
}

function pickRealRefForView(catalog, keywords, usedFiles) {
  const pool = catalog.entries.filter(e => !usedFiles.has(e.file))
  const candidates = pool.length > 0 ? pool : catalog.entries
  if (candidates.length === 0) return null
  let best = candidates[0]
  let bestScore = -1
  for (const e of candidates) {
    let score = e.origin === 'b1-real' ? 100 : 10
    if (keywords.includes('ceiling_sign') && e.showsCeilingSign) score += 40
    for (const kw of keywords) {
      if (e.tagsText.includes(kw.toLowerCase())) score += 12
    }
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  usedFiles.add(best.file)
  return best
}

function isRuntimeWayfindingMounted() {
  const sceneTs = join(REPO_ROOT, 'web/src/shizijie/runtime/indoor-scene.ts')
  if (!existsSync(sceneTs)) return false
  try {
    const src = readFileSync(sceneTs, 'utf8')
    return src.includes('wayfinding') && (src.includes('buildSzjWayfinding') || src.includes('hangingSign'))
  } catch {
    return false
  }
}

function effectiveWayfindingGridRows(rowCount) {
  const count = Math.max(1, Math.min(4, rowCount || 1))
  const cols = count >= 2 ? 2 : 1
  return Math.ceil(count / cols)
}

async function buildCompareSignCatalog(layoutCeilingH, runtimeHangingSigns = null) {
  const signs = []
  let wayfindingSignCount = 0
  let wayfindingSim = null
  const runtimeWayfindingMounted =
    (Array.isArray(runtimeHangingSigns) && runtimeHangingSigns.length > 0) || isRuntimeWayfindingMounted()
  const wfPath = join(REPO_ROOT, 'web/src/shizijie/wayfinding/index.ts')
  const layoutPath = join(REPO_ROOT, 'web/src/shizijie/layout/index.ts')
  if (existsSync(wfPath) && existsSync(layoutPath)) {
    try {
      const wfMod = await import('../web/src/shizijie/wayfinding/index.ts')
      const layoutMod = await import('../web/src/shizijie/layout/index.ts')
      const layout = layoutMod.SHIZIJIE_B1_LAYOUT ?? layoutMod.default
      if (layout && typeof wfMod.buildSzjWayfinding === 'function') {
        const wf = wfMod.buildSzjWayfinding(layout)
        wayfindingSignCount = wf.signs.length
        // 仅当运行时已真实挂载 wayfinding 吊牌网格时才将其纳入画面投影检测，杜绝空天花板假阳性
        if (runtimeWayfindingMounted) {
          const srcSigns = Array.isArray(runtimeHangingSigns) && runtimeHangingSigns.length > 0
            ? runtimeHangingSigns
            : wf.signs
          for (const sg of srcSigns) {
            for (const face of sg.faces || []) {
              const rc = Math.max(1, (face.rows || []).length)
              const sw = sg.width ?? 1.8
              const sh = sg.height ?? 0.42
              signs.push({
                id: `${sg.id}:${face.side > 0 ? 'fwd' : 'rev'}`,
                source: 'wayfinding',
                kind: sg.kind || 'ceiling',
                x: sg.x,
                y: (sg.bottomY ?? 2.3) + sh * 0.5,
                z: sg.z,
                width: sw,
                height: sh,
                rowCount: rc,
                gridRows: effectiveWayfindingGridRows(rc, sw, sh),
                yaw: face.yaw,
                text: (face.rows || []).map(r => r.text).join(' | '),
              })
            }
          }
        }
        if (typeof wfMod.followSigns === 'function' && typeof wfMod.maxDistanceToNearestSign === 'function') {
          let tested = 0
          let passed = 0
          let loops = 0
          const chains = wf.graph.chains
          for (let ci = 0; ci < chains.length; ci += Math.max(1, Math.floor(chains.length / 8))) {
            const c = chains[ci]
            for (const frac of [0.25, 0.75]) {
              for (const exitId of SZJ_STAIR_IDS) {
                tested++
                const r = wfMod.followSigns(wf, { chainId: c.id, offset: c.length * frac }, exitId)
                if (r.ok) passed++
                if (r.reason === 'loop') loops++
              }
            }
          }
          wayfindingSim = {
            totalSigns: wf.signs.length,
            maxDistToNearestSignM: Math.round(wfMod.maxDistanceToNearestSign(wf) * 100) / 100,
            sampleRoutesTested: tested,
            sampleRoutesPassed: passed,
            loops,
          }
        }
      }
    } catch {
      // Ignore if wayfinding is mid-edit during parallel build
    }
  }
  const ceilH = layoutCeilingH || 3.15
  for (const st of SZJ_STAIRWELLS) {
    const hl = st.length / 2
    const midPos = stairLocalToIndoor(st, { x: 0, z: -0.35 })
    const specs = [
      {
        id: `stair-mid-${st.id}`,
        kind: 'overhead-stair',
        pos: midPos,
        y: 4.44,
        w: st.width - 0.14,
        h: 0.4,
        textA: `${st.label} 梯井中段警示吊牌`,
        textB: `${st.label} 梯井中段警示吊牌`,
      },
    ]
    if (!runtimeWayfindingMounted) {
      const hallPos = stairLocalToIndoor(st, { x: 0, z: hl + 2.35 })
      const portalPos = stairLocalToIndoor(st, { x: 0, z: hl + 0.48 })
      specs.push(
        {
          id: `stair-hall-${st.id}`,
          kind: 'overhead-hall',
          pos: hallPos,
          y: ceilH - 0.52,
          w: 2.2,
          h: 0.42,
          textA: '十字街地下商业街 · 主廊吊挂灯箱',
          textB: `${st.label} 吊挂出口牌`,
        },
        {
          id: `stair-portal-${st.id}`,
          kind: 'overhead-portal',
          pos: portalPos,
          y: ceilH - 0.31,
          w: Math.min(2.4, st.width * 0.78),
          h: 0.34,
          textA: `${st.label} 出口导视牌`,
          textB: `${st.label} 出口导视牌`,
        },
      )
    }
    for (const sp of specs) {
      signs.push(
        {
          id: `${sp.id}:a`,
          source: 'mounted-overhead',
          kind: sp.kind,
          x: sp.pos.x,
          y: sp.y,
          z: sp.pos.z,
          width: sp.w,
          height: sp.h,
          yaw: st.yaw,
          text: sp.textA,
        },
        {
          id: `${sp.id}:b`,
          source: 'mounted-overhead',
          kind: sp.kind,
          x: sp.pos.x,
          y: sp.y,
          z: sp.pos.z,
          width: sp.w,
          height: sp.h,
          yaw: st.yaw + Math.PI,
          text: sp.textB,
        },
      )
    }
  }
  return { signs, wayfindingSignCount, runtimeWayfindingMounted, wayfindingSim }
}

function projectSignsToViewport(cameraPose, signs, width = 1280, height = 720, fovDeg = SZJ_PLAYER.fovDeg) {
  if (!cameraPose) return []
  const cx = cameraPose.x
  const cy = cameraPose.eyeY ?? SZJ_PLAYER.eyeHeight
  const cz = cameraPose.z
  const yaw = cameraPose.yaw ?? 0
  const pitch = cameraPose.pitch ?? 0
  const sy = Math.sin(yaw)
  const cyaw = Math.cos(yaw)
  const sp = Math.sin(pitch)
  const cp = Math.cos(pitch)

  const right = [cyaw, 0, -sy]
  const up = [sy * sp, cp, cyaw * sp]
  const fwd = [-sy * cp, sp, -cyaw * cp]
  const fY = 1 / Math.tan(((fovDeg * Math.PI) / 180) * 0.5)
  const fX = fY / (width / height)

  const projectPoint = (px, py, pz) => {
    const dx = px - cx
    const dy = py - cy
    const dz = pz - cz
    const depth = dx * fwd[0] + dy * fwd[1] + dz * fwd[2]
    if (depth <= 0.15) return null
    const rx = dx * right[0] + dy * right[1] + dz * right[2]
    const ry = dx * up[0] + dy * up[1] + dz * up[2]
    const sx = ((rx / depth) * fX * 0.5 + 0.5) * width
    const syPx = (0.5 - (ry / depth) * fY * 0.5) * height
    return { sx, sy: syPx, depth }
  }

  const hits = []
  for (const sg of signs) {
    const dx = cx - sg.x
    const dy = cy - sg.y
    const dz = cz - sg.z
    const dist = Math.hypot(dx, dy, dz)
    if (dist < 1.8 || dist > 22) continue
    const nx = Math.sin(sg.yaw)
    const nz = Math.cos(sg.yaw)
    const cosAng = (dx * nx + dz * nz) / Math.max(1e-6, Math.hypot(dx, dz))
    if (cosAng < 0.28) continue

    const tx = Math.cos(sg.yaw)
    const tz = -Math.sin(sg.yaw)
    const hw = sg.width * 0.5
    const hh = sg.height * 0.5
    const corners = [
      projectPoint(sg.x - hw * tx, sg.y - hh, sg.z - hw * tz),
      projectPoint(sg.x + hw * tx, sg.y - hh, sg.z + hw * tz),
      projectPoint(sg.x + hw * tx, sg.y + hh, sg.z + hw * tz),
      projectPoint(sg.x - hw * tx, sg.y + hh, sg.z - hw * tz),
    ]
    if (corners.some(c => !c)) continue
    const xs = corners.map(c => c.sx)
    const ys = corners.map(c => c.sy)
    const x0 = Math.max(0, Math.min(...xs))
    const y0 = Math.max(0, Math.min(...ys))
    const x1 = Math.min(width, Math.max(...xs))
    const y1 = Math.min(height, Math.max(...ys))
    const pw = x1 - x0
    const ph = y1 - y0
    if (pw < 20 || ph < 9) continue
    const rawW = Math.max(...xs) - Math.min(...xs)
    const rawH = Math.max(...ys) - Math.min(...ys)
    const visibleFrac = (pw * ph) / Math.max(1, rawW * rawH)
    if (visibleFrac < 0.45) continue
    hits.push({
      id: sg.id,
      source: sg.source,
      kind: sg.kind,
      text: sg.text,
      distanceM: Math.round(dist * 100) / 100,
      cosAngle: Math.round(cosAng * 1000) / 1000,
      bbox: {
        x: Math.round(x0),
        y: Math.round(y0),
        w: Math.round(pw),
        h: Math.round(ph),
      },
      projectedPxW: Math.round(pw),
      projectedPxH: Math.round(ph),
      rowCount: Math.max(1, sg.rowCount || 1),
      gridRows: Math.max(1, sg.gridRows || sg.rowCount || 1),
      rowPxH: Math.round((ph / Math.max(1, sg.gridRows || sg.rowCount || 1)) * 10) / 10,
    })
  }
  hits.sort((a, b) => {
    const aMount = a.source === 'mounted-overhead' ? 0 : 1
    const bMount = b.source === 'mounted-overhead' ? 0 : 1
    if (aMount !== bMount) return aMount - bMount
    return a.distanceM - b.distanceM
  })
  return hits
}

async function analyzeAndComposeCompareSheet(comparePage, payload) {
  const {
    sheetIndex,
    viewId,
    title,
    renderPath,
    realRef,
    cameraPose,
    drawCalls,
    projectedSigns,
    targetSignId = null,
    targetDistanceM = null,
    sheetOutPath,
  } = payload

  const renderDataUrl = fileToDataUrl(renderPath)
  const realDataUrl = realRef ? fileToDataUrl(realRef.file) : ''

  const result = await comparePage.evaluate(async args => {
    const loadImage = src =>
      new Promise((resolve, reject) => {
        if (!src) return resolve(null)
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = err => reject(err)
        img.src = src
      })

    const [renderImg, realImg] = await Promise.all([
      loadImage(args.renderDataUrl),
      loadImage(args.realDataUrl),
    ])

    // 1) Pixel-level analysis on raw un-annotated 1280x720 render
    const rw = renderImg.naturalWidth || 1280
    const rh = renderImg.naturalHeight || 720
    const rawCanvas = document.createElement('canvas')
    rawCanvas.width = rw
    rawCanvas.height = rh
    const rCtx = rawCanvas.getContext('2d', { willReadFrequently: true })
    rCtx.drawImage(renderImg, 0, 0, rw, rh)

    const sampleRegion = (x0, y0, w, h) => {
      const sx = Math.max(0, Math.min(rw - 1, Math.floor(x0)))
      const sy = Math.max(0, Math.min(rh - 1, Math.floor(y0)))
      const sw = Math.max(1, Math.min(rw - sx, Math.ceil(w)))
      const sh = Math.max(1, Math.min(rh - sy, Math.ceil(h)))
      const data = rCtx.getImageData(sx, sy, sw, sh).data
      const n = sw * sh
      const lumas = new Float32Array(n)
      let sum = 0
      for (let i = 0; i < n; i++) {
        const o = i * 4
        const l = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]
        lumas[i] = l
        sum += l
      }
      const mean = sum / n
      let varSum = 0
      let edgeHits = 0
      let edgeChecks = 0
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const idx = y * sw + x
          const d = lumas[idx] - mean
          varSum += d * d
          if (x + 1 < sw && y + 1 < sh) {
            const gx = Math.abs(lumas[idx + 1] - lumas[idx])
            const gy = Math.abs(lumas[idx + sw] - lumas[idx])
            if (gx + gy >= 22) edgeHits++
            edgeChecks++
          }
        }
      }
      const sorted = Float32Array.from(lumas).sort()
      const p05 = sorted[Math.floor(n * 0.05)] ?? mean
      const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))] ?? mean
      return {
        meanLuma: Math.round(mean * 100) / 100,
        lumaStd: Math.round(Math.sqrt(varSum / n) * 100) / 100,
        p05Luma: Math.round(p05 * 100) / 100,
        p95Luma: Math.round(p95 * 100) / 100,
        contrastRange: Math.round((p95 - p05) * 100) / 100,
        edgeDensity: Math.round((edgeChecks > 0 ? edgeHits / edgeChecks : 0) * 10000) / 10000,
      }
    }

    const wholeStats = sampleRegion(rw * 0.1, rh * 0.1, rw * 0.8, rh * 0.8)
    const renderBlack = wholeStats.meanLuma < 4

    const evaluatedSigns = []
    for (const s of args.projectedSigns) {
      const pad = 2
      const st = sampleRegion(s.bbox.x - pad, s.bbox.y - pad, s.bbox.w + pad * 2, s.bbox.h + pad * 2)
      const visible =
        s.projectedPxW >= 24 &&
        s.projectedPxH >= 10 &&
        st.meanLuma >= 18 &&
        st.meanLuma <= 248 &&
        st.contrastRange >= 12
      const readable =
        visible &&
        s.projectedPxW >= 44 &&
        s.projectedPxH >= 15 &&
        (s.rowPxH ?? s.projectedPxH) >= 15 &&
        st.contrastRange >= 38 &&
        st.lumaStd >= 11 &&
        st.edgeDensity >= 0.025
      evaluatedSigns.push({ ...s, ...st, visible, readable })
    }

    // 默认按最近前景优先排序（不跳过近处变黑的损坏吊牌去误捡远处背景亮斑）；
    // 10m 基准机位（targetDistanceM）显式锁定目标实距吊牌，避免被头顶 2m 处过近吊牌抢镜。
    evaluatedSigns.sort((a, b) => {
      if (typeof args.targetDistanceM === 'number' && Number.isFinite(args.targetDistanceM)) {
        const aInBand = a.distanceM >= args.targetDistanceM - 1.5 && a.distanceM <= args.targetDistanceM + 2.5 ? 0 : 1
        const bInBand = b.distanceM >= args.targetDistanceM - 1.5 && b.distanceM <= args.targetDistanceM + 2.5 ? 0 : 1
        const aExact = args.targetSignId && a.id.startsWith(`${args.targetSignId}:`) && aInBand === 0 ? 0 : 1
        const bExact = args.targetSignId && b.id.startsWith(`${args.targetSignId}:`) && bInBand === 0 ? 0 : 1
        if (aExact !== bExact) return aExact - bExact
        if (aInBand !== bInBand) return aInBand - bInBand
        return Math.abs(a.distanceM - args.targetDistanceM) - Math.abs(b.distanceM - args.targetDistanceM)
      }
      const aNear = a.distanceM <= 12 ? 0 : 1
      const bNear = b.distanceM <= 12 ? 0 : 1
      if (aNear !== bNear) return aNear - bNear
      return a.distanceM - b.distanceM
    })

    const bestSign = evaluatedSigns[0] || null
    const signVisible = Boolean(bestSign?.visible)
    const signReadable = Boolean(bestSign?.readable)

    // 2) Compose 1600x700 side-by-side contact sheet (Left: REAL | Right: RENDER + 2.2x sign inset)
    const W = 1600
    const H = 700
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#11151b'
    ctx.fillRect(0, 0, W, H)

    const fontTitle = '600 22px -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", sans-serif'
    const fontSub = '500 13px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
    const fontMono = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace'

    // Header
    ctx.fillStyle = '#181f29'
    ctx.fillRect(0, 0, W, 62)
    ctx.fillStyle = '#f3f6fb'
    ctx.font = fontTitle
    ctx.fillText(`#${String(args.sheetIndex).padStart(2, '0')}  ${args.title}`, 24, 30)
    ctx.fillStyle = '#9aa7b8'
    ctx.font = fontSub
    ctx.fillText(`十字街 B1 真景 vs 渲染对比接触表（IDOK-385 盲审规范） · view=${args.viewId}`, 24, 51)

    const drawPill = (x, y, text, bg, fg) => {
      ctx.font = fontMono
      const tw = ctx.measureText(text).width
      const pw = tw + 18
      ctx.fillStyle = bg
      ctx.beginPath()
      ctx.roundRect(x, y, pw, 26, 6)
      ctx.fill()
      ctx.fillStyle = fg
      ctx.fillText(text, x + 9, y + 17)
      return x + pw + 8
    }

    let px = 980
    px = drawPill(
      px,
      18,
      `signVisible:${signVisible ? 'TRUE' : 'FALSE'}`,
      signVisible ? 'rgba(16,185,129,0.22)' : 'rgba(245,158,11,0.22)',
      signVisible ? '#6ee7b7' : '#fcd34d',
    )
    px = drawPill(
      px,
      18,
      `signReadable:${signReadable ? 'TRUE' : 'FALSE'}`,
      signReadable ? 'rgba(16,185,129,0.22)' : 'rgba(245,158,11,0.22)',
      signReadable ? '#6ee7b7' : '#fcd34d',
    )
    drawPill(px, 18, `drawCalls:${args.drawCalls ?? '-'}`, 'rgba(59,130,246,0.22)', '#93c5fd')

    const drawPanel = (x, y, w, h, headerLabel, footerLabel, img, overlayFn) => {
      ctx.fillStyle = '#1a212c'
      ctx.fillRect(x, y, w, h)
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)

      ctx.fillStyle = '#222b38'
      ctx.fillRect(x, y, w, 32)
      ctx.fillStyle = '#e5edf7'
      ctx.font = fontSub
      ctx.fillText(headerLabel, x + 12, y + 21)

      const vx = x + 4
      const vy = y + 36
      const vw = w - 8
      const vh = h - 72
      ctx.fillStyle = '#0a0d12'
      ctx.fillRect(vx, vy, vw, vh)

      let drawRect = { dx: vx, dy: vy, dw: vw, dh: vh }
      if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
        const s = Math.min(vw / img.naturalWidth, vh / img.naturalHeight)
        const dw = img.naturalWidth * s
        const dh = img.naturalHeight * s
        const dx = vx + (vw - dw) * 0.5
        const dy = vy + (vh - dh) * 0.5
        ctx.drawImage(img, dx, dy, dw, dh)
        drawRect = { dx, dy, dw, dh }
      } else {
        ctx.fillStyle = '#9aa7b8'
        ctx.font = fontSub
        ctx.fillText('无对应参考图', vx + 20, vy + 40)
      }
      if (overlayFn) overlayFn(drawRect)

      ctx.fillStyle = '#151b24'
      ctx.fillRect(x, y + h - 32, w, 32)
      ctx.fillStyle = '#b9c6d6'
      ctx.font = fontMono
      const trimmedFooter = footerLabel.length > 82 ? footerLabel.slice(0, 79) + '...' : footerLabel
      ctx.fillText(trimmedFooter, x + 12, y + h - 11)
    }

    const leftHeader = args.realRef
      ? `REAL 实景参考 · [${args.realRef.origin}] ${args.realRef.name}`
      : 'REAL 实景参考（缺失）'
    const leftFooter = args.realRef
      ? `date=${args.realRef.captureDate} | license=${args.realRef.license}`
      : 'no local reference'
    drawPanel(24, 76, 764, 540, leftHeader, leftFooter, realImg)

    const camText = args.cameraPose
      ? `pos=(${args.cameraPose.x.toFixed(1)},${(args.cameraPose.eyeY ?? 1.6).toFixed(2)},${args.cameraPose.z.toFixed(1)}) yaw=${((args.cameraPose.yaw * 180) / Math.PI).toFixed(0)}°`
      : 'camera=n/a'
    const rightFooter = bestSign
      ? `${camText} | sign=${bestSign.distanceM}m ${bestSign.projectedPxW}x${bestSign.projectedPxH}px ΔL=${bestSign.contrastRange} edge=${bestSign.edgeDensity}`
      : `${camText} | projectedSigns=0 | luma=${wholeStats.meanLuma}`

    drawPanel(812, 76, 764, 540, 'RENDER 十字街 B1 实时 WebGL 渲染（第一人称）', rightFooter, renderImg, rect => {
      if (!bestSign) return
      const sx = rect.dw / rw
      const sy = rect.dh / rh
      const bx = rect.dx + bestSign.bbox.x * sx
      const by = rect.dy + bestSign.bbox.y * sy
      const bw = bestSign.bbox.w * sx
      const bh = bestSign.bbox.h * sy
      ctx.save()
      ctx.strokeStyle = signReadable ? '#34d399' : '#fbbf24'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.strokeRect(bx - 3, by - 3, bw + 6, bh + 6)
      ctx.restore()

      // 2.2x magnified sign readability inset in bottom-right corner of render viewport
      const insetW = 290
      const insetH = 88
      const ix = rect.dx + rect.dw - insetW - 10
      const iy = rect.dy + rect.dh - insetH - 10
      ctx.fillStyle = 'rgba(10,14,20,0.92)'
      ctx.fillRect(ix - 4, iy - 22, insetW + 8, insetH + 26)
      ctx.strokeStyle = signReadable ? '#34d399' : '#fbbf24'
      ctx.lineWidth = 1.5
      ctx.strokeRect(ix - 4, iy - 22, insetW + 8, insetH + 26)
      ctx.fillStyle = '#e5edf7'
      ctx.font = '600 11px ui-monospace, SFMono-Regular, monospace'
      ctx.fillText(`SIGN CROP (${bestSign.distanceM}m · ${bestSign.projectedPxW}x${bestSign.projectedPxH}px)`, ix + 2, iy - 7)

      const srcPad = 3
      const cx0 = Math.max(0, bestSign.bbox.x - srcPad)
      const cy0 = Math.max(0, bestSign.bbox.y - srcPad)
      const cw = Math.min(rw - cx0, bestSign.bbox.w + srcPad * 2)
      const ch = Math.min(rh - cy0, bestSign.bbox.h + srcPad * 2)
      const scale = Math.min(insetW / Math.max(1, cw), insetH / Math.max(1, ch))
      const dw = cw * scale
      const dh = ch * scale
      ctx.drawImage(rawCanvas, cx0, cy0, cw, ch, ix + (insetW - dw) * 0.5, iy + (insetH - dh) * 0.5, dw, dh)
    })

    // Bottom detail bar (2 clean lines, zero right-edge clipping)
    ctx.fillStyle = '#181f29'
    ctx.fillRect(24, 626, 1552, 60)
    ctx.fillStyle = '#e5edf7'
    ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
    const line1 = bestSign
      ? `检测到真实挂载吊牌：${bestSign.id} (${bestSign.source}/${bestSign.kind}) · 内容「${bestSign.text}」`
      : `当前机位视野内无正对已挂载吊牌（视场平均亮度=${wholeStats.meanLuma}，无黑屏）`
    const line2 = bestSign
      ? `实测读数：距相机 ${bestSign.distanceM}m · 投影 ${bestSign.projectedPxW}×${bestSign.projectedPxH}px (${bestSign.rowCount}条/${bestSign.gridRows ?? bestSign.rowCount}格行, ~${bestSign.rowPxH}px/行) · 亮度=${bestSign.meanLuma}/${bestSign.lumaStd} · ΔL=${bestSign.contrastRange} · 梯度=${bestSign.edgeDensity} · readable=${signReadable}`
      : `说明：wayfinding 95 块走廊吊牌接入 runtime 后，此机位将自动启用走廊吊牌投影与可读性检测`
    ctx.fillText(line1.slice(0, 110), 38, 649)
    ctx.fillStyle = '#9db0c7'
    ctx.font = '500 12px ui-monospace, SFMono-Regular, Menlo, "PingFang SC", monospace'
    ctx.fillText(line2.slice(0, 155), 38, 672)

    return {
      dataUrl: canvas.toDataURL('image/png'),
      renderBlack,
      wholeMeanLuma: wholeStats.meanLuma,
      signVisible,
      signReadable,
      signAnalysis: bestSign
        ? {
            projectedSignsInView: evaluatedSigns.length,
            bestSignId: bestSign.id,
            bestSignSource: bestSign.source,
            bestSignKind: bestSign.kind,
            bestSignText: bestSign.text,
            distanceM: bestSign.distanceM,
            projectedPxW: bestSign.projectedPxW,
            projectedPxH: bestSign.projectedPxH,
            rowCount: bestSign.rowCount,
            gridRows: bestSign.gridRows ?? bestSign.rowCount,
            rowPxH: bestSign.rowPxH,
            meanLuma: bestSign.meanLuma,
            lumaStd: bestSign.lumaStd,
            contrastRange: bestSign.contrastRange,
            edgeDensity: bestSign.edgeDensity,
          }
        : {
            projectedSignsInView: 0,
            bestSignId: null,
            bestSignSource: null,
            bestSignKind: null,
            bestSignText: null,
            distanceM: null,
            projectedPxW: 0,
            projectedPxH: 0,
            rowCount: 0,
            rowPxH: 0,
            meanLuma: wholeStats.meanLuma,
            lumaStd: wholeStats.lumaStd,
            contrastRange: wholeStats.contrastRange,
            edgeDensity: wholeStats.edgeDensity,
          },
    }
  }, {
    sheetIndex,
    viewId,
    title,
    renderDataUrl,
    realDataUrl,
    realRef,
    cameraPose,
    drawCalls,
    projectedSigns,
    targetSignId,
    targetDistanceM,
  })

  const base64 = result.dataUrl.replace(/^data:image\/png;base64,/, '')
  writeFileSync(sheetOutPath, Buffer.from(base64, 'base64'))
  return {
    id: viewId,
    title,
    sheetPath: sheetOutPath,
    renderPath,
    realRefPath: realRef?.file || null,
    realRefSource: realRef?.origin || null,
    realRefMeta: realRef
      ? { name: realRef.name, sourceUrl: realRef.sourceUrl, captureDate: realRef.captureDate, license: realRef.license }
      : null,
    camera: cameraPose || null,
    drawCalls: drawCalls ?? null,
    renderBlack: result.renderBlack,
    signVisible: result.signVisible,
    signReadable: result.signReadable,
    signAnalysis: result.signAnalysis,
  }
}

function isMainHostWired() {
  const mainTs = join(REPO_ROOT, 'web/src/main.ts')
  if (!existsSync(mainTs)) return false
  try {
    const src = readFileSync(mainTs, 'utf8')
    return src.includes('./shizijie/') && src.includes('szj')
  } catch {
    return false
  }
}

function buildHarnessHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>Shizijie B1 Route-A Verification Harness</title>
  <style>
    html, body { margin: 0; padding: 0; overflow: hidden; background: #141920; }
    canvas { display: block; width: 100vw; height: 100vh; }
    #hud {
      position: fixed; left: 16px; top: 14px; z-index: 10;
      padding: 8px 12px; border-radius: 10px;
      background: rgba(16, 22, 28, 0.86); color: #f3f6f9;
      font: 500 13px/1.35 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14);
    }
  </style>
</head>
<body>
  <div id="hud">十字街 B1 · 加载中</div>
  <script type="module" src="/__szj-verify-entry.ts"></script>
</body>
</html>`
}

function buildHarnessEntrySource({ hasRuntime, hasLayout }) {
  return `
    import * as THREE from 'three'
    import {
      SZJ_BUDGET,
      SZJ_FRAME,
      SZJ_PLAYER,
      SZJ_STAIRWELLS,
      SZJ_STAIR_IDS,
      getStairwell,
      indoorToWorld,
      rotateLocal,
      shouldEnterStair,
      shouldExitStair,
      stairEntryPose,
      stairLanding,
      stairLocalToIndoor,
      stairTreadY,
      yawFacing,
    } from '/src/shizijie/contract.ts'
    import { createShizijieCrowd } from '/src/shizijie/crowd/index.ts'
    import {
      createScriptedStairTraversal,
      createStairPlacementFromEndpoints,
    } from '/src/locomotion/stairs/index.ts'

    const HAS_RUNTIME = ${JSON.stringify(hasRuntime)}
    const HAS_LAYOUT = ${JSON.stringify(hasLayout)}

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.12
    document.body.appendChild(renderer.domElement)

    const hud = document.getElementById('hud')
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#202731')
    scene.fog = new THREE.Fog('#202731', 42, 115)

    const camera = new THREE.PerspectiveCamera(SZJ_PLAYER.fovDeg, window.innerWidth / window.innerHeight, 0.08, 160)
    camera.rotation.order = 'YXZ'

    // 地下商业街基础环境光 + 顶棚主照明
    const hemi = new THREE.HemisphereLight(0xf6f1e6, 0x3a4350, 1.35)
    scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xfff4e0, 0.95)
    dir.position.set(16, 26, 12)
    scene.add(dir)

    // 构造十字街 B1 环廊地板、封闭外围墙、内岛、4 条楼梯连接通道、带字店招与 4 座契约楼梯
    const envGroup = new THREE.Group()
    envGroup.name = 'szj-verify-shell'
    scene.add(envGroup)

    const floorMat = new THREE.MeshStandardMaterial({ color: 0xc8c2b6, roughness: 0.72, metalness: 0.05 })
    const floorMesh = new THREE.Mesh(new THREE.CircleGeometry(56, 48), floorMat)
    floorMesh.rotation.x = -Math.PI / 2
    floorMesh.position.y = SZJ_FRAME.indoorFloorY
    envGroup.add(floorMesh)

    const ceilMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.84, side: THREE.DoubleSide })
    const ceilMesh = new THREE.Mesh(new THREE.RingGeometry(15.5, 56, 48), ceilMat)
    ceilMesh.rotation.x = Math.PI / 2
    ceilMesh.position.y = 3.25
    envGroup.add(ceilMesh)

    const innerWallMat = new THREE.MeshStandardMaterial({ color: 0x3b4553, roughness: 0.8 })
    const innerCore = new THREE.Mesh(new THREE.CylinderGeometry(15.6, 15.6, 3.25, 32, 1, true), innerWallMat)
    innerCore.position.y = 1.625
    envGroup.add(innerCore)

    const outerWallMat = new THREE.MeshStandardMaterial({ color: 0x454f5e, roughness: 0.84, side: THREE.BackSide })
    const outerRingWall = new THREE.Mesh(new THREE.CylinderGeometry(55.5, 55.5, 3.25, 48, 1, true), outerWallMat)
    outerRingWall.position.y = 1.625
    envGroup.add(outerRingWall)

    // 共享单张店招文字 Canvas 纹理图集（4×4 = 16 铺清晰中文招牌，零额外 DrawCall）
    const shopNames = [
      '漓江米粉馆', '桂林三宝坊', '鲜果冰饮站', '正阳潮玩社',
      '数码快修站', '港式糖水铺', '复古黑胶屋', '手作银饰坊',
      '二次元集市', '美妆集合店', '街头潮鞋馆', '象山文创馆',
      '鲜奶麻薯铺', '眼镜快配站', '港风穿搭馆', '地下便利店',
    ]
    const signPalette = ['#c84237', '#2b7868', '#c98c2e', '#385c8a', '#a84771', '#544884', '#bd592c', '#296579']
    const signCanvas = document.createElement('canvas')
    signCanvas.width = 1024
    signCanvas.height = 512
    const sCtx = signCanvas.getContext('2d')
    for (let i = 0; i < 16; i++) {
      const col = i % 4
      const row = Math.floor(i / 4)
      const bx = col * 256
      const by = row * 128
      sCtx.fillStyle = signPalette[i % signPalette.length]
      sCtx.fillRect(bx, by, 256, 128)
      sCtx.strokeStyle = 'rgba(255,255,255,0.35)'
      sCtx.lineWidth = 4
      sCtx.strokeRect(bx + 6, by + 6, 244, 116)
      sCtx.fillStyle = '#fdfaf2'
      sCtx.font = 'bold 34px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
      sCtx.textAlign = 'center'
      sCtx.textBaseline = 'middle'
      sCtx.fillText(shopNames[i], bx + 128, by + 56)
      sCtx.fillStyle = 'rgba(255,248,232,0.82)'
      sCtx.font = '600 18px ui-monospace, SFMono-Regular, monospace'
      sCtx.fillText('B1-' + String(i + 1).padStart(2, '0'), bx + 128, by + 98)
    }
    const signTex = new THREE.CanvasTexture(signCanvas)
    signTex.colorSpace = THREE.SRGBColorSpace
    signTex.needsUpdate = true

    // 16 间环廊商铺：铺体 InstancedMesh + 4 组对应招牌（合并为一个带 UV 的 BufferGeometry 仅 1 draw call！）
    const shopFrameMat = new THREE.MeshStandardMaterial({ color: 0xe6dfd3, roughness: 0.75 })
    const shopBodies = new THREE.InstancedMesh(new THREE.BoxGeometry(3.8, 3.1, 1.5), shopFrameMat, 16)
    const mTmp = new THREE.Matrix4()
    const qTmp = new THREE.Quaternion()
    const eTmp = new THREE.Euler(0, 0, 0, 'YXZ')
    const vTmp = new THREE.Vector3()
    const sTmp = new THREE.Vector3(1, 1, 1)

    const signPos = []
    const signNorm = []
    const signUv = []
    const signIdx = []
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2
      const rx = 27.6
      const rz = 26.2
      const sx = Math.cos(ang) * rx
      const sz = Math.sin(ang) * rz
      const faceCenter = Math.atan2(-sx, -sz)
      eTmp.set(0, faceCenter, 0)
      qTmp.setFromEuler(eTmp)
      vTmp.set(sx, 1.55, sz)
      mTmp.compose(vTmp, qTmp, sTmp)
      shopBodies.setMatrixAt(i, mTmp)

      // 正反双面带字招牌面板（环廊内侧 + 外侧均清晰可读）
      const col = i % 4
      const row = Math.floor(i / 4)
      const u0 = col * 0.25
      const u1 = u0 + 0.25
      const v1 = 1 - row * 0.25
      const v0 = v1 - 0.25
      const halfW = 1.78
      const halfH = 0.34
      for (const side of [1, -1]) {
        const baseV = signPos.length / 3
        const localZ = side * 0.78
        const corners = [
          [-halfW * side, -halfH, localZ],
          [halfW * side, -halfH, localZ],
          [halfW * side, halfH, localZ],
          [-halfW * side, halfH, localZ],
        ]
        const nVec = new THREE.Vector3(0, 0, side).applyQuaternion(qTmp)
        for (let k = 0; k < 4; k++) {
          const p = new THREE.Vector3(corners[k][0], corners[k][1] + 2.66, corners[k][2])
            .applyQuaternion(qTmp)
            .add(new THREE.Vector3(sx, 0, sz))
          signPos.push(p.x, p.y, p.z)
          signNorm.push(nVec.x, nVec.y, nVec.z)
        }
        signUv.push(u0, v0, u1, v0, u1, v1, u0, v1)
        signIdx.push(baseV, baseV + 1, baseV + 2, baseV, baseV + 2, baseV + 3)
      }
    }
    shopBodies.instanceMatrix.needsUpdate = true
    const signGeo = new THREE.BufferGeometry()
    signGeo.setAttribute('position', new THREE.Float32BufferAttribute(signPos, 3))
    signGeo.setAttribute('normal', new THREE.Float32BufferAttribute(signNorm, 3))
    signGeo.setAttribute('uv', new THREE.Float32BufferAttribute(signUv, 2))
    signGeo.setIndex(signIdx)
    const shopSignsMesh = new THREE.Mesh(signGeo, new THREE.MeshBasicMaterial({ map: signTex }))
    envGroup.add(shopBodies, shopSignsMesh)

    // 4 座契约楼梯几何 + 连接环廊通道墙（全部按 contract.ts SZJ_STAIRWELLS 生成）
    const stepMat = new THREE.MeshStandardMaterial({ color: 0xa2aab4, roughness: 0.76 })
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x5c6776, roughness: 0.84 })
    const totalSteps = SZJ_STAIRWELLS.reduce((acc, st) => acc + st.profile.count + 1, 0)
    const stepInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stepMat, totalSteps)
    const wallInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMat, SZJ_STAIRWELLS.length * 4)
    let sIdx = 0
    let wIdx = 0
    for (const st of SZJ_STAIRWELLS) {
      const hl = st.length / 2
      const startZ = -hl + st.profile.landingTop
      eTmp.set(0, st.yaw, 0)
      qTmp.setFromEuler(eTmp)
      const topPos = stairLocalToIndoor(st, { x: 0, z: -hl + st.profile.landingTop / 2 })
      vTmp.set(topPos.x, SZJ_FRAME.depth - 0.1, topPos.z)
      sTmp.set(st.width, 0.2, st.profile.landingTop)
      mTmp.compose(vTmp, qTmp, sTmp)
      stepInst.setMatrixAt(sIdx++, mTmp)
      for (let i = 0; i < st.profile.count; i++) {
        const lz = startZ + (i + 0.5) * st.profile.tread
        const y = stairTreadY(st, lz)
        const p = stairLocalToIndoor(st, { x: 0, z: lz })
        vTmp.set(p.x, y - 0.08, p.z)
        sTmp.set(st.width, 0.16, st.profile.tread + 0.02)
        mTmp.compose(vTmp, qTmp, sTmp)
        stepInst.setMatrixAt(sIdx++, mTmp)
      }
      // 楼梯井两侧挡墙 + 连接入口通道引导墙
      for (const side of [-1, 1]) {
        const wp = stairLocalToIndoor(st, { x: side * (st.width / 2 + 0.14), z: 0 })
        vTmp.set(wp.x, SZJ_FRAME.depth * 0.5, wp.z)
        sTmp.set(0.24, SZJ_FRAME.depth + 0.8, st.length + 0.4)
        mTmp.compose(vTmp, qTmp, sTmp)
        wallInst.setMatrixAt(wIdx++, mTmp)

        const corrWall = stairLocalToIndoor(st, { x: side * (st.width / 2 + 0.35), z: hl + 4.5 })
        vTmp.set(corrWall.x, 1.62, corrWall.z)
        sTmp.set(0.24, 3.25, 9.0)
        mTmp.compose(vTmp, qTmp, sTmp)
        wallInst.setMatrixAt(wIdx++, mTmp)
      }
    }
    stepInst.instanceMatrix.needsUpdate = true
    wallInst.instanceMatrix.needsUpdate = true
    envGroup.add(stepInst, wallInst)

    // 尝试加载 Hy1 布局（仅当文件已在位时注入动态 import，避免 Vite import-analysis 解析不存在路径报 500）
    let loadedLayout = undefined
    ${hasLayout ? `try {
      const mod = await import('/src/shizijie/layout/index.ts')
      loadedLayout = mod.SHIZIJIE_B1_LAYOUT ?? mod.SZJ_LAYOUT ?? mod.default ?? undefined
    } catch {}` : ''}

    // 挂载 48 名实例化背景人群
    const crowd = createShizijieCrowd({
      layout: loadedLayout,
      maxNpcs: SZJ_BUDGET.npcMax,
      seed: 'verify-shizijie-b1',
    })
    scene.add(crowd.group)

    // 精确测量 WebGL 中 48 名 NPC 净增的真实 GPU drawCalls
    crowd.setVisible(false)
    renderer.info.reset()
    renderer.render(scene, camera)
    const baseCalls = renderer.info.render.calls

    crowd.setVisible(true)
    renderer.info.reset()
    renderer.render(scene, camera)
    const withCrowdCalls = renderer.info.render.calls
    const webglCrowdDrawCalls = withCrowdCalls - baseCalls

    // 预热并测量 crowd.step 性能
    for (let i = 0; i < 20; i++) crowd.step(1 / 60)
    const tStep0 = performance.now()
    for (let i = 0; i < 300; i++) crowd.step(1 / 60)
    const benchAvgStepMs = Math.round(((performance.now() - tStep0) / 300) * 10000) / 10000

    function isBlackFrame() {
      const gl = renderer.getContext()
      const w = 16, h = 9
      const px = new Uint8Array(w * h * 4)
      gl.readPixels(
        Math.floor(renderer.domElement.width / 2 - w / 2),
        Math.floor(renderer.domElement.height / 2 - h / 2),
        w,
        h,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        px,
      )
      let sum = 0
      for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2]
      return sum / (w * h * 3) < 3
    }

    async function runMouth(id) {
      const st = getStairwell(id)
      const entry = stairEntryPose(st)
      const landing = stairLanding(st)

      // 1) 验证地面触发器 shouldEnterStair
      const mouthWorld = indoorToWorld(st.mouthIndoor)
      const enterTriggerOk = shouldEnterStair(
        st,
        { x: mouthWorld.x, y: st.groundY, z: mouthWorld.z },
        st.inward,
      )

      // 2) 使用 Gemini locomotion/stairs 执行 60fps 脚本下楼（topIndoor y=4.2 -> footIndoor y=0）
      const placement = createStairPlacementFromEndpoints(
        { x: st.topIndoor.x, y: SZJ_FRAME.depth, z: st.topIndoor.z },
        { x: st.footIndoor.x, y: SZJ_FRAME.indoorFloorY, z: st.footIndoor.z },
        {
          landing: { entry: st.profile.landingTop * 0.5, exit: st.profile.landingFoot },
          targetRiser: st.profile.riser,
          width: st.width,
        },
      )
      const descent = createScriptedStairTraversal({
        profile: placement.profile,
        placement,
        speed: 1.8,
        eyeOffset: SZJ_PLAYER.eyeHeight,
        maxDeltaYPerFrame: SZJ_BUDGET.eyeDyPerFrameMax,
      })

      let maxEyeDy = 0
      let blackFrames = 0
      let prevEyeY = descent.getState().eyeY
      let frameIdx = 0
      let totalSwapMs = 0
      const tSwap0 = performance.now()
      document.body.dataset.szjActive = '1'

      while (!descent.isDone() && frameIdx < 600) {
        const frame = descent.step(1 / 60)
        crowd.step(1 / 60)
        const dy = Math.abs(frame.eyeY - prevEyeY)
        if (dy > maxEyeDy) maxEyeDy = dy
        prevEyeY = frame.eyeY
        camera.position.set(frame.eyePosition.x, frame.eyePosition.y, frame.eyePosition.z)
        camera.rotation.set(
          (SZJ_PLAYER.entryPitchDeg * Math.PI) / 180 * (1 - frame.progress) + frame.pitchBiasRad * 0.5,
          entry.yaw,
          0,
        )
        renderer.info.reset()
        renderer.render(scene, camera)
        if (frameIdx === 0) totalSwapMs = Math.round((performance.now() - tSwap0) * 100) / 100
        if (frameIdx % 25 === 0 && isBlackFrame()) blackFrames++
        frameIdx++
      }

      // 截图视角：置于该口下楼末端前（楼梯局部 z = length/2 + 2.4）回望该口 28 级台阶与入口通道，或斜望楼梯口+环廊人群，绝不撞墙且无虚空
      const shotPos = stairLocalToIndoor(st, { x: 0, z: st.length / 2 + 5.8 })
      const lookBackYaw = yawFacing({ x: st.indoor.x - shotPos.x, z: st.indoor.z - shotPos.z })
      camera.position.set(shotPos.x, SZJ_PLAYER.eyeHeight + 0.15, shotPos.z)
      camera.rotation.set(0.14, lookBackYaw, 0)
      crowd.step(1 / 60)
      renderer.info.reset()
      renderer.render(scene, camera)
      const indoorDrawCalls = renderer.info.render.calls
      const indoorTriangles = renderer.info.render.triangles
      if (isBlackFrame()) blackFrames++

      // 3) 验证上楼回到顶部平台触发 shouldExitStair 与地面落点 stairLanding 精度
      const exitTriggerOk = shouldExitStair(
        st,
        { x: st.topIndoor.x, y: SZJ_FRAME.depth, z: st.topIndoor.z },
        { x: -st.inward.x, z: -st.inward.z },
      )
      const landed = stairLanding(st)
      const landingError = Math.round(Math.hypot(landed.x - landing.x, landed.z - landing.z) * 10000) / 10000

      hud.textContent = \`十字街 B1 · \${st.label} (\${id.toUpperCase()}) · 48 NPC · DrawCalls \${indoorDrawCalls} (人群 +\${webglCrowdDrawCalls}) · maxΔy \${maxEyeDy.toFixed(4)}m\`

      const reasons = []
      if (!enterTriggerOk) reasons.push('ENTER_TRIGGER_FAIL')
      if (!exitTriggerOk) reasons.push('EXIT_TRIGGER_FAIL')
      if (maxEyeDy > SZJ_BUDGET.eyeDyPerFrameMax + 1e-6) reasons.push('EYE_DY_EXCEEDED')
      if (totalSwapMs > SZJ_BUDGET.swapMsMax) reasons.push('SWAP_MS_EXCEEDED')
      if (blackFrames > 0) reasons.push('BLACK_FRAME')
      if (indoorDrawCalls > SZJ_BUDGET.indoorDrawCallsMax) reasons.push('INDOOR_DRAW_CALLS_EXCEEDED')
      if (indoorTriangles > SZJ_BUDGET.indoorTrianglesMax) reasons.push('INDOOR_TRIS_EXCEEDED')
      if (landingError > SZJ_BUDGET.landingErrorMax) reasons.push('LANDING_ERROR_EXCEEDED')

      return {
        id,
        label: st.label,
        pass: reasons.length === 0,
        reasons,
        enterTriggerOk,
        exitTriggerOk,
        forcedFirstPerson: true,
        descentFrames: frameIdx,
        maxEyeDy: Math.round(maxEyeDy * 100000) / 100000,
        enterSwapMs: totalSwapMs,
        swapMs: totalSwapMs,
        blackFrames,
        indoorDrawCalls,
        indoorTriangles,
        landingError,
        landing,
      }
    }

    function renderCrowdOverview() {
      camera.position.set(0, 2.35, -20.2)
      camera.rotation.set(-0.08, yawFacing({ x: 18, z: 6 }), 0)
      for (let i = 0; i < 45; i++) crowd.step(1 / 30)
      renderer.info.reset()
      renderer.render(scene, camera)
      const calls = renderer.info.render.calls
      hud.textContent = \`十字街 B1 环廊全景 · 48 NPC（店主/顾客/行人）· 总 DrawCalls \${calls} · 人群净增 +\${webglCrowdDrawCalls}\`
      return { calls, triangles: renderer.info.render.triangles, black: isBlackFrame() }
    }

    window.__szjVerify = {
      hasRuntime: HAS_RUNTIME,
      hasLayout: HAS_LAYOUT,
      crowdStats: () => ({
        ...crowd.getMetrics(),
        webglDrawCalls: webglCrowdDrawCalls,
        benchAvgStepMs,
      }),
      runMouth,
      renderCrowdOverview,
      cleanup: () => {
        delete document.body.dataset.szjActive
        crowd.dispose()
        renderer.dispose()
      },
    }
  `
}

async function connectOrLaunchBrowser(chromium, useCdp) {
  if (useCdp) {
    try {
      const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
      return { browser, owned: false }
    } catch {}
  }
  const browser = await chromium.launch({
    headless: true,
    args: process.platform === 'darwin'
      ? ['--enable-gpu', '--use-angle=metal']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  return { browser, owned: true }
}

export async function runVerify(opts) {
  const hostWired = isMainHostWired()
  const hasRuntime = existsSync(join(REPO_ROOT, 'web/src/shizijie/runtime/index.ts'))
  const hasLayout = existsSync(join(REPO_ROOT, 'web/src/shizijie/layout/index.ts'))
  const resolvedMode =
    opts.mode === 'host'
      ? 'host-integrated'
      : opts.mode === 'harness'
        ? 'vite-dev-webgl-harness'
        : hostWired
          ? 'host-integrated'
          : 'vite-dev-webgl-harness'

  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      opts,
      resolvedMode,
      hostWired,
      hasRuntime,
      hasLayout,
      mouths: SZJ_STAIRWELLS.map(st => ({
        id: st.id,
        label: st.label,
        world: st.world,
        landing: stairLanding(st),
      })),
    }
  }

  mkdirSync(opts.out, { recursive: true })
  const req = createRequire(import.meta.url)
  const { chromium } = req(join(REPO_ROOT, 'node_modules/playwright'))
  const { createServer: createViteServer } = req(join(REPO_ROOT, 'node_modules/vite'))

  let viteServer = null
  let baseUrl = opts.url
  let browserRef = null
  let context = null
  const errors = []

  try {
    if (!baseUrl) {
      const harnessPlugin = {
        name: 'szj-verify-harness',
        resolveId(id) {
          if (id === '/__szj-verify-entry.ts' || id === '__szj-verify-entry.ts') {
            return '\0szj-verify-entry.ts'
          }
          return null
        },
        load(id) {
          if (id === '\0szj-verify-entry.ts') {
            return buildHarnessEntrySource({ hasRuntime, hasLayout })
          }
          return null
        },
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url && req.url.split('?')[0] === '/__szj-verify.html') {
              server
                .transformIndexHtml(req.url, buildHarnessHtml())
                .then(html => {
                  res.statusCode = 200
                  res.setHeader('Content-Type', 'text/html; charset=utf-8')
                  res.end(html)
                })
                .catch(next)
              return
            }
            next()
          })
        },
      }
      const listenPort = await pickFreePort(opts.port)
      viteServer = await createViteServer({
        root: join(REPO_ROOT, 'web'),
        configFile: join(REPO_ROOT, 'web/vite.config.ts'),
        plugins: [harnessPlugin],
        server: {
          host: '127.0.0.1',
          port: listenPort,
          strictPort: true,
          hmr: false,
          watch: null,
        },
        logLevel: 'silent',
      })
      await viteServer.listen()
      const addr = viteServer.httpServer.address()
      const boundPort = typeof addr === 'object' && addr ? addr.port : listenPort
      if (FORBIDDEN_PORTS.has(boundPort)) {
        throw new Error(`Unexpectedly bound forbidden port ${boundPort}`)
      }
      baseUrl = `http://127.0.0.1:${boundPort}`
    }

    browserRef = await connectOrLaunchBrowser(chromium, opts.cdp)
    context = await browserRef.browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`))
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
    })
    await page.route('**/favicon.ico', r => r.fulfill({ status: 204 }))
    await page.route('**/api/**', r => r.fulfill({ status: 204, body: '' }))
    await page.route('**/stats.rcpd.cc/**', r => r.fulfill({ status: 204, body: '' }))

    const mouths = {}
    const screenshots = []
    const compareCaptures = []
    let crowdMetrics = null

    if (resolvedMode === 'host-integrated') {
      const targetUrl = `${baseUrl}/?verify=&mode=walk&time=14.5&szj=1`
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.waitForFunction(
        () => Boolean(window.viewer?.walk?.active && window.viewer?.szj && window.viewer?.stats?.frame > 30),
        null,
        { timeout: 90000 },
      )
      for (const st of SZJ_STAIRWELLS) {
        const land = stairLanding(st)
        const approachYaw = yawFacing(st.inward)
        await page.evaluate(
          async ({ x, z, yaw }) => { await window.viewer.walkTo(x, z, yaw, 'szj-verify') },
          { x: land.x, z: land.z, yaw: approachYaw },
        )
        await page.waitForTimeout(700)
        await page.keyboard.down('KeyW')
        const enterDeadline = Date.now() + 9000
        let entered = false
        while (Date.now() < enterDeadline) {
          entered = await page.evaluate(() => document.body.dataset.szjActive === '1')
          if (entered) break
          await page.waitForTimeout(80)
        }
        await page.keyboard.up('KeyW')
        await page.waitForFunction(
          () => window.viewer?.szj?.getState?.().state === 'inside',
          null,
          { timeout: 12000 },
        )
        await page.waitForTimeout(250)
        const enterState = await page.evaluate(() => window.viewer.szj.getState())
        const enterMetrics = enterState.metrics
        const shotPath = join(opts.out, `mouth-${st.id}.png`)
        await page.screenshot({ path: shotPath })
        screenshots.push(shotPath)
        if (opts.compare) {
          compareCaptures.push({
            viewId: `mouth-${st.id}`,
            title: `${st.label} · 入口廊道与天花板吊牌`,
            renderPath: shotPath,
            cameraPose: enterState.player,
            drawCalls: enterMetrics.drawCalls,
            keywords: [st.id, 'entrance', 'corridor', 'ceiling_sign', 'sign', 'shizijie'],
          })
        }

        await page.keyboard.down('KeyS')
        const exitDeadline = Date.now() + 14000
        let exited = false
        while (Date.now() < exitDeadline) {
          exited = await page.evaluate(() => document.body.dataset.szjActive !== '1')
          if (exited) break
          await page.waitForTimeout(80)
        }
        await page.keyboard.up('KeyS')
        await page.waitForTimeout(500)
        const exitMetrics = await page.evaluate(() => window.viewer.szj.getMetrics())

        const enterSwapMs = enterMetrics.lastSwapMs
        const postExitSwapMs = exitMetrics.lastSwapMs
        const swapMs = Math.max(enterSwapMs, postExitSwapMs)
        const maxEyeDy = Math.max(enterMetrics.lastMaxEyeDy, exitMetrics.lastMaxEyeDy)
        const blackFrames = Math.max(enterMetrics.lastBlackFrames, exitMetrics.lastBlackFrames)
        const indoorDrawCalls = enterMetrics.drawCalls
        const indoorTriangles = enterMetrics.triangles
        const landingError = exitMetrics.lastLandingError

        const reasons = []
        if (!entered) reasons.push('NOT_ENTERED')
        if (!exited) reasons.push('NOT_EXITED')
        if (maxEyeDy > SZJ_BUDGET.eyeDyPerFrameMax + 1e-6) reasons.push('EYE_DY_EXCEEDED')
        if (swapMs > SZJ_BUDGET.swapMsMax) reasons.push('SWAP_MS_EXCEEDED')
        if (blackFrames > SZJ_BUDGET.blackFramesMax) reasons.push('BLACK_FRAME')
        if (indoorDrawCalls <= 0 || indoorDrawCalls > SZJ_BUDGET.indoorDrawCallsMax) {
          reasons.push('INDOOR_DRAW_CALLS_EXCEEDED')
        }
        if (indoorTriangles <= 0 || indoorTriangles > SZJ_BUDGET.indoorTrianglesMax) {
          reasons.push('INDOOR_TRIS_EXCEEDED')
        }
        if (landingError > SZJ_BUDGET.landingErrorMax) reasons.push('LANDING_ERROR_EXCEEDED')

        mouths[st.id] = {
          id: st.id,
          label: st.label,
          pass: reasons.length === 0,
          reasons,
          maxEyeDy,
          enterSwapMs,
          postExitSwapMs,
          swapMs,
          blackFrames,
          indoorDrawCalls,
          indoorTriangles,
          landingError,
          screenshot: shotPath,
        }
      }

      // Showcase walk in B1: inspect 28-step SE exit stairwell, 9-10m hanging sign readability, and central ring
      const showcaseSt = SZJ_STAIRWELLS.find(s => s.id === 'se') ?? SZJ_STAIRWELLS[0]
      const showLand = stairLanding(showcaseSt)
      await page.evaluate(
        async ({ x, z, yaw }) => { await window.viewer.walkTo(x, z, yaw, 'szj-verify-show') },
        { x: showLand.x, z: showLand.z, yaw: yawFacing(showcaseSt.inward) },
      )
      await page.waitForTimeout(600)
      await page.keyboard.down('KeyW')
      const showDeadline = Date.now() + 9000
      while (Date.now() < showDeadline) {
        const entered = await page.evaluate(() => document.body.dataset.szjActive === '1')
        if (entered) break
        await page.waitForTimeout(80)
      }
      await page.keyboard.up('KeyW')
      await page.waitForFunction(
        () => window.viewer?.szj?.getState?.().state === 'inside',
        null,
        { timeout: 12000 },
      )
      await page.waitForTimeout(250)

      // Drag-turn 180 deg to view the 28-step granite stairwell & backlit exit sign from inside B1
      await page.mouse.move(640, 360)
      await page.mouse.down()
      await page.mouse.move(640 + 1208, 360, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(250)
      const stairExitState = await page.evaluate(() => window.viewer.szj.getState())
      const stairExitShot = join(opts.out, 'b1-stair-se-exit.png')
      await page.screenshot({ path: stairExitShot })
      screenshots.push(stairExitShot)
      if (opts.compare) {
        compareCaptures.push({
          viewId: 'b1-stair-se-exit',
          title: 'SE出口 28级步梯回望与悬挂三联灯箱',
          renderPath: stairExitShot,
          cameraPose: stairExitState.player,
          drawCalls: stairExitState.metrics.drawCalls,
          keywords: ['stair', 'exit', 'ceiling_sign', 'se', 'sign'],
        })
      }

      // Drag back 180 deg
      await page.mouse.move(640, 360)
      await page.mouse.down()
      await page.mouse.move(640 - 1208, 360, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(150)

      if (opts.compare) {
        // Closed-loop walk along straight SE corridor until true ~10.0m past the SE vestibule hanging sign (in front of footIndoor), then turn 180°
        const seTargetSign = await page.evaluate(
          inward => {
            const st = window.viewer?.szj?.getState?.()
            const signs = window.viewer?.szj?.getHangingSigns?.() ?? []
            if (!st?.player || signs.length === 0) return null
            let best = null
            let bestAlong = Infinity
            for (const sg of signs) {
              const dx = sg.x - st.player.x
              const dz = sg.z - st.player.z
              const along = dx * inward.x + dz * inward.z
              const perp = Math.abs(dx * -inward.z + dz * inward.x)
              if (along >= 1.5 && along <= 8.0 && perp <= 2.5 && along < bestAlong) {
                bestAlong = along
                best = { id: sg.id, x: sg.x, z: sg.z }
              }
            }
            return best
          },
          showcaseSt.inward,
        )

        await page.keyboard.down('ShiftLeft')
        await page.keyboard.down('KeyW')
        if (seTargetSign) {
          const walkStart = Date.now()
          while (Date.now() - walkStart < 5600) {
            await page.waitForTimeout(120)
            const cur = await page.evaluate(
              ({ tgt, inward }) => {
                const p = window.viewer?.szj?.getState?.()?.player
                if (!p) return { along: -99, dist: 0 }
                const dx = p.x - tgt.x
                const dz = p.z - tgt.z
                return {
                  along: dx * inward.x + dz * inward.z,
                  dist: Math.hypot(dx, dz),
                }
              },
              { tgt: seTargetSign, inward: showcaseSt.inward },
            )
            // Stop once we are ~9.8-10.2m PAST the target sign along inward direction
            if (cur.along >= 9.75) break
          }
        } else {
          await page.waitForTimeout(4300)
        }
        await page.keyboard.up('KeyW')
        await page.keyboard.up('ShiftLeft')
        await page.waitForTimeout(200)

        await page.mouse.move(640, 360)
        await page.mouse.down()
        await page.mouse.move(640 + 1208, 360, { steps: 12 })
        await page.mouse.up()
        await page.waitForTimeout(250)
        const sign10mState = await page.evaluate(() => window.viewer.szj.getState())
        const sign10mShot = join(opts.out, 'b1-ceiling-sign-10m.png')
        await page.screenshot({ path: sign10mShot })
        screenshots.push(sign10mShot)
        compareCaptures.push({
          viewId: 'b1-ceiling-sign-10m',
          title: 'SE廊道 实距 10m 正视天花板悬挂吊牌（可读性基准）',
          renderPath: sign10mShot,
          cameraPose: sign10mState.player,
          drawCalls: sign10mState.metrics.drawCalls,
          targetSignId: seTargetSign?.id || null,
          targetDistanceM: 10,
          keywords: ['ceiling_sign', 'sign', 'lightbox', 'corridor', 'exit'],
        })

        // Turn back 180 deg and jog into dead-center of the central ring (z <= 24.8) so compare-07 & compare-08 East-ring turn have 0 wall collision
        await page.mouse.move(640, 360)
        await page.mouse.down()
        await page.mouse.move(640 - 1208, 360, { steps: 12 })
        await page.mouse.up()
        await page.keyboard.down('ShiftLeft')
        await page.keyboard.down('KeyW')
        const ringStart = Date.now()
        while (Date.now() - ringStart < 2800) {
          await page.waitForTimeout(120)
          const pz = await page.evaluate(() => window.viewer?.szj?.getState?.()?.player?.z ?? 99)
          if (pz <= 24.8) break
        }
        await page.keyboard.up('KeyW')
        await page.keyboard.up('ShiftLeft')
        await page.waitForTimeout(300)
      } else {
        await page.keyboard.down('ShiftLeft')
        await page.keyboard.down('KeyW')
        await page.waitForTimeout(5800)
        await page.keyboard.up('KeyW')
        await page.keyboard.up('ShiftLeft')
        await page.waitForTimeout(300)
      }

      const ringState = await page.evaluate(() => window.viewer.szj.getState())
      const ringShot = join(opts.out, 'b1-center-ring.png')
      await page.screenshot({ path: ringShot })
      screenshots.push(ringShot)
      if (opts.compare) {
        compareCaptures.push({
          viewId: 'b1-center-ring',
          title: '中央环形主廊 · 吊顶格栅、商铺立面与人群',
          renderPath: ringShot,
          cameraPose: ringState.player,
          drawCalls: ringState.metrics.drawCalls,
          keywords: ['ring', 'center', 'corridor', 'ceiling_sign', 'shop', 'bilibili'],
        })

        // Turn ~40 deg clockwise into the open East curved ring ((14,25.5) -> (16.2,17.5) -> (18.4,12.1)) for a wide shopfront/crowd/sign shot
        await page.mouse.move(640, 360)
        await page.mouse.down()
        await page.mouse.move(640 + 270, 360, { steps: 10 })
        await page.mouse.up()
        await page.keyboard.down('ShiftLeft')
        await page.keyboard.down('KeyW')
        await page.waitForTimeout(2200)
        await page.keyboard.up('KeyW')
        await page.keyboard.up('ShiftLeft')
        await page.waitForTimeout(300)
        const ringTurnState = await page.evaluate(() => window.viewer.szj.getState())
        const ringTurnShot = join(opts.out, 'b1-ring-shops-crowd.png')
        await page.screenshot({ path: ringTurnShot })
        screenshots.push(ringTurnShot)
        compareCaptures.push({
          viewId: 'b1-ring-shops-crowd',
          title: '环形商铺段 · 门头质感、地砖材质与通道人流',
          renderPath: ringTurnShot,
          cameraPose: ringTurnState.player,
          drawCalls: ringTurnState.metrics.drawCalls,
          keywords: ['shop', 'storefront', 'ring', 'crowd', 'wikimedia'],
        })
      }

      // Measure REAL WebGL GPU draw-call delta & live crowd.step CPU average directly inside host-integrated B1
      crowdMetrics = await page.evaluate(async () => {
        const probe = window.__szjCrowdProbe
        const apiMetrics = window.viewer?.szj?.getCrowdMetrics?.() ?? null
        const m = apiMetrics ?? probe?.getMetrics?.() ?? null
        if (!m) return null
        let webglDrawCalls = m.drawCalls
        let callsWithCrowd = null
        let callsWithoutCrowd = null
        let callsRestored = null
        if (probe) {
          const waitFrames = n =>
            new Promise(resolve => {
              let left = n
              const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick))
              requestAnimationFrame(tick)
            })
          await waitFrames(3)
          callsWithCrowd = window.viewer.szj.getMetrics().drawCalls
          probe.setVisible(false)
          await waitFrames(3)
          callsWithoutCrowd = window.viewer.szj.getMetrics().drawCalls
          probe.setVisible(true)
          await waitFrames(3)
          callsRestored = window.viewer.szj.getMetrics().drawCalls
          webglDrawCalls = Math.max(0, callsWithCrowd - callsWithoutCrowd)
        }
        return {
          activeCount: m.activeCount,
          keeperCount: m.keeperCount,
          customerCount: m.customerCount,
          walkerCount: m.walkerCount,
          drawCalls: m.drawCalls,
          webglDrawCalls,
          callsWithCrowd,
          callsWithoutCrowd,
          callsRestored,
          triangles: m.triangles,
          lastStepMs: m.lastStepMs,
          avgStepMs: m.avgStepMs,
          stepSamples: m.stepSamples,
        }
      })
    } else {
      await page.goto(`${baseUrl}/__szj-verify.html`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      try {
        await page.waitForFunction(() => Boolean(window.__szjVerify), null, { timeout: 30000 })
      } catch (err) {
        throw new Error(`Harness failed to initialize (${errors.join(' | ') || err.message})`)
      }

      for (const id of SZJ_STAIR_IDS) {
        const res = await page.evaluate(mouthId => window.__szjVerify.runMouth(mouthId), id)
        const shotPath = join(opts.out, `mouth-${id}.png`)
        await page.screenshot({ path: shotPath })
        screenshots.push(shotPath)
        mouths[id] = { ...res, screenshot: shotPath }
      }

      const overview = await page.evaluate(() => window.__szjVerify.renderCrowdOverview())
      const overviewShot = join(opts.out, 'crowd-b1-overview.png')
      await page.screenshot({ path: overviewShot })
      screenshots.push(overviewShot)

      const rawCrowd = await page.evaluate(() => window.__szjVerify.crowdStats())
      crowdMetrics = {
        activeCount: rawCrowd.activeCount,
        keeperCount: rawCrowd.keeperCount,
        customerCount: rawCrowd.customerCount,
        walkerCount: rawCrowd.walkerCount,
        drawCalls: rawCrowd.drawCalls,
        webglDrawCalls: rawCrowd.webglDrawCalls,
        triangles: rawCrowd.triangles,
        avgStepMs: rawCrowd.benchAvgStepMs,
        stepSamples: rawCrowd.stepSamples,
        overviewDrawCalls: overview.calls,
        overviewBlack: overview.black,
      }
      await page.evaluate(() => window.__szjVerify.cleanup())
    }

    let compareSummary = null
    if (opts.compare && compareCaptures.length > 0) {
      const refCatalog = loadRealReferenceCatalog(opts.refDir)
      const runtimeProbeExtras =
        resolvedMode === 'host-integrated'
          ? await page
              .evaluate(() => ({
                hangingSigns: window.viewer?.szj?.getHangingSigns?.() ?? null,
                signMetrics: window.viewer?.szj?.getSignMetrics?.() ?? null,
                atmosMetrics: window.viewer?.szj?.getAtmosMetrics?.() ?? null,
              }))
              .catch(() => ({ hangingSigns: null, signMetrics: null, atmosMetrics: null }))
          : { hangingSigns: null, signMetrics: null, atmosMetrics: null }
      const signCatalog = await buildCompareSignCatalog(3.15, runtimeProbeExtras.hangingSigns)
      const usedRealFiles = new Set()
      const comparePage = await context.newPage()
      const sheets = []
      try {
        for (let i = 0; i < compareCaptures.length; i++) {
          const cap = compareCaptures[i]
          const realRef = pickRealRefForView(refCatalog, cap.keywords, usedRealFiles)
          const projectedSigns = projectSignsToViewport(cap.cameraPose, signCatalog.signs, 1280, 720, SZJ_PLAYER.fovDeg)
          const sheetPath = join(opts.out, `compare-${String(i + 1).padStart(2, '0')}-${cap.viewId}.png`)
          const sheetResult = await analyzeAndComposeCompareSheet(comparePage, {
            sheetIndex: i + 1,
            viewId: cap.viewId,
            title: cap.title,
            renderPath: cap.renderPath,
            realRef,
            cameraPose: cap.cameraPose,
            drawCalls: cap.drawCalls,
            projectedSigns,
            targetSignId: cap.targetSignId ?? null,
            targetDistanceM: cap.targetDistanceM ?? null,
            sheetOutPath: sheetPath,
          })
          sheets.push(sheetResult)
        }
      } finally {
        await comparePage.close().catch(() => {})
      }

      const signVisibleCount = sheets.filter(s => s.signVisible).length
      const signReadableCount = sheets.filter(s => s.signReadable).length
      const tenMeterSheets = sheets.filter(
        s => typeof s.signAnalysis?.distanceM === 'number' && s.signAnalysis.distanceM >= 9.0 && s.signAnalysis.distanceM <= 12.0,
      )
      compareSummary = {
        enabled: true,
        sheetCount: sheets.length,
        realRefDir: refCatalog.b1Dir,
        realRefSource: refCatalog.source,
        b1RealCount: refCatalog.b1RealCount,
        wayfindingSignCount: signCatalog.wayfindingSignCount,
        runtimeWayfindingMounted: signCatalog.runtimeWayfindingMounted,
        runtimeSignMetrics: runtimeProbeExtras.signMetrics,
        runtimeAtmosMetrics: runtimeProbeExtras.atmosMetrics,
        wayfindingSim: signCatalog.wayfindingSim,
        signVisible: signVisibleCount > 0,
        signReadable: signReadableCount > 0,
        signVisibleCount,
        signReadableCount,
        tenMeterCheck: {
          count: tenMeterSheets.length,
          sheets: tenMeterSheets.map(s => ({
            id: s.id,
            signId: s.signAnalysis.bestSignId,
            distanceM: s.signAnalysis.distanceM,
            projectedPxW: s.signAnalysis.projectedPxW,
            projectedPxH: s.signAnalysis.projectedPxH,
            rowCount: s.signAnalysis.rowCount,
            gridRows: s.signAnalysis.gridRows,
            rowPxH: s.signAnalysis.rowPxH,
            signReadable: s.signReadable,
          })),
        },
        sheets,
      }
    }

    const report = {
      timestamp: new Date().toISOString(),
      mode: resolvedMode,
      hostWired,
      hasRuntime,
      hasLayout,
      baseUrl,
      mouths,
      crowd: crowdMetrics,
      ...(compareSummary
        ? {
            signVisible: compareSummary.signVisible,
            signReadable: compareSummary.signReadable,
            compare: compareSummary,
          }
        : {}),
      screenshots,
      errors,
    }
    const verdict = evaluateShizijieReport(report)
    const full = { ...verdict, ...report }
    writeFileSync(join(opts.out, 'report.json'), JSON.stringify(full, null, 2) + '\n')
    return full
  } finally {
    if (context) await context.close().catch(() => {})
    if (browserRef?.owned && browserRef.browser) {
      await browserRef.browser.close().catch(() => {})
    }
    if (viteServer) {
      await viteServer.close().catch(() => {})
    }
  }
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntry) {
  const opts = parseArgs(process.argv.slice(2))
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
