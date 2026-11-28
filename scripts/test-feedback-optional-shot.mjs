// 反馈无截图 / 可选截图前后端状态机与不变量单测（运行：node --import tsx --test scripts/test-feedback-optional-shot.mjs 或 node --experimental-transform-types --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.\w+$/.test(specifier) && context.parentURL) {
      const tsUrl = new URL(specifier + '.ts', context.parentURL)
      if (existsSync(fileURLToPath(tsUrl))) return { url: tsUrl.href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { APPEAL, BUG, kinds, photosOptional } = await import('../lib/feedback-contract.ts')
const { ll2xz, xz2ll } = await import('../lib/projection.ts')
const {
  FEEDBACK_MAX_X,
  FEEDBACK_MAX_Z,
  buildFeedbackDraftPayload,
  clampFeedbackPosition,
  describeFeedbackMedia,
  safeFeedbackLocation,
  shouldUploadDefaultShotPhoto,
  shouldUploadFeedbackViewShot,
  validateFeedbackSubmit,
} = await import('../web/src/ui/feedback-state.ts')
const { feedback } = await import('../lib/feedback.ts')
const { Problem } = await import('../lib/auth.ts')

test('核心不变量：任意状态下只要底部提示为可提交（countEmpty=false），提交校验绝不因缺截图报错', () => {
  for (const kind of kinds) {
    for (const hasSelection of [false, true]) {
      for (const useDefaultShot of hasSelection ? [false, true] : [false]) {
        for (const photoCount of [0, 1, 3]) {
          for (const canCapture of [false, true]) {
            const base = { kind, hasItem: false, hasSelection, useDefaultShot, photoCount, canCapture }
            const presentation = describeFeedbackMedia(base)
            const check = validateFeedbackSubmit({
              ...base,
              supplement: false,
              bodyText: kind === APPEAL ? '当时正常骑行被误判，麻烦核实' : '复现步骤说明',
            })
            if (!presentation.countEmpty) {
              assert.deepEqual(
                check,
                { ok: true, needsAutoCapture: false },
                `文案与校验冲突: kind=${kind} sel=${hasSelection} def=${useDefaultShot} photos=${photoCount} cap=${canCapture} countText=${presentation.countText}`,
              )
            } else {
              // 底部明确提示未就绪时，要么报错，要么仅在「有本地图但缺游戏视角且可截屏」时尝试自动补截
              assert.ok(
                !check.ok || check.needsAutoCapture,
                `未就绪状态却直接放行: kind=${kind} sel=${hasSelection} def=${useDefaultShot} photos=${photoCount} cap=${canCapture}`,
              )
            }
          }
        }
      }
    }
  }
})

test('游戏 bug 在无 selection / 取消默认截图 / 无 captureView 回调时均可直接无图提交', () => {
  for (const canCapture of [true, false]) {
    const state = {
      kind: BUG,
      hasItem: false,
      hasSelection: false,
      useDefaultShot: false,
      photoCount: 0,
      canCapture,
    }
    const presentation = describeFeedbackMedia(state)
    assert.equal(presentation.countText, '截图可选，可直接提交')
    assert.equal(presentation.countEmpty, false)
    assert.equal(presentation.showCaptureNow, canCapture)

    const okCheck = validateFeedbackSubmit({ ...state, supplement: false, bodyText: '过桥时卡住' })
    assert.deepEqual(okCheck, { ok: true, needsAutoCapture: false })

    const emptyBodyCheck = validateFeedbackSubmit({ ...state, supplement: false, bodyText: '   ' })
    assert.deepEqual(emptyBodyCheck, { ok: false, error: '请描述一下遇到的问题' })

    assert.equal(
      shouldUploadFeedbackViewShot({ kind: BUG, hasSelection: false, useDefaultShot: false, photoCount: 0, viewShotUploaded: false }),
      false,
    )
    assert.equal(
      shouldUploadDefaultShotPhoto({ hasItem: false, kind: BUG, hasSelection: false, useDefaultShot: false, photoCount: 0, defaultPhotoUploaded: false }),
      false,
    )
  }
})

test('非 bug 非申诉类型在缺少游戏视角时文案明确提示先截游戏画面，不制造假绿灯', () => {
  for (const kind of kinds.filter((k) => !photosOptional(k))) {
    const noShotNoPhoto = describeFeedbackMedia({
      kind, hasItem: false, hasSelection: false, useDefaultShot: false, photoCount: 0, canCapture: true,
    })
    assert.equal(noShotNoPhoto.countText, '请先截取游戏画面')
    assert.equal(noShotNoPhoto.countEmpty, true)
    assert.deepEqual(
      validateFeedbackSubmit({
        kind, hasItem: false, supplement: false, hasSelection: false, useDefaultShot: false, photoCount: 0, canCapture: true, bodyText: '细节',
      }),
      { ok: false, error: '请先截取游戏画面' },
    )

    const noShotWithLocalPhoto = describeFeedbackMedia({
      kind, hasItem: false, hasSelection: false, useDefaultShot: false, photoCount: 2, canCapture: true,
    })
    assert.equal(noShotWithLocalPhoto.countText, '已附 2 张图片，还需截取游戏画面')
    assert.equal(noShotWithLocalPhoto.countEmpty, true)
    assert.equal(noShotWithLocalPhoto.showCaptureNow, true)
    assert.deepEqual(
      validateFeedbackSubmit({
        kind, hasItem: false, supplement: false, hasSelection: false, useDefaultShot: false, photoCount: 2, canCapture: true, bodyText: '细节',
      }),
      { ok: true, needsAutoCapture: true },
    )

    // 无法调用 captureView 时，不误导也不崩溃
    const noCapCheck = validateFeedbackSubmit({
      kind, hasItem: false, supplement: false, hasSelection: false, useDefaultShot: false, photoCount: 1, canCapture: false, bodyText: '细节',
    })
    assert.equal(noCapCheck.ok, false)
  }
})

test('坐标安全兜底：越界、NaN、Infinity 与缺失位置都钳制回合法反馈边界', () => {
  assert.deepEqual(clampFeedbackPosition(null), { x: 0, z: 0 })
  assert.deepEqual(clampFeedbackPosition({ x: Number.NaN, z: Number.POSITIVE_INFINITY }), { x: 0, z: 0 })
  assert.deepEqual(clampFeedbackPosition({ x: 9999, z: -8888 }), { x: FEEDBACK_MAX_X, z: -FEEDBACK_MAX_Z })

  for (const input of [
    null,
    { lat: Number.NaN, lon: 110.3 },
    xz2ll(5000, -6000),
    xz2ll(-3072, 3328),
    xz2ll(-120, 340),
  ]) {
    const safe = safeFeedbackLocation(input)
    const pt = ll2xz(safe.lat, safe.lon)
    assert.ok(Number.isFinite(safe.lat) && Number.isFinite(safe.lon))
    assert.ok(Math.abs(pt.x) <= FEEDBACK_MAX_X + 1e-6, `x out of bounds: ${pt.x}`)
    assert.ok(Math.abs(pt.z) <= FEEDBACK_MAX_Z + 1e-6, `z out of bounds: ${pt.z}`)
  }

  const payload = buildFeedbackDraftPayload({
    kind: BUG,
    title: '越界 bug',
    body: '飞出边界后卡住',
    location: xz2ll(4800, -4900),
    view: null,
  })
  assert.equal(payload.view, null)
  assert.equal(payload.heading, null)
  assert.equal(payload.landmark_id, null)
  const pt = ll2xz(payload.lat, payload.lon)
  assert.ok(Math.abs(pt.x) <= FEEDBACK_MAX_X + 1e-6)
  assert.ok(Math.abs(pt.z) <= FEEDBACK_MAX_Z + 1e-6)
})

test('后端 POST /api/feedback 对游戏 bug 放行 view:null，仍拦截非可选类型 view:null 与非法 view', async () => {
  const rows = new Map()
  const user = { id: 'u1', uid: 1, email: 'u1@example.test', nickname: '玩家', verified: 1, role: 'user', banned_at: 0 }
  const makeStmt = (sql, bound = []) => ({
    bind: (...args) => makeStmt(sql, args),
    async run() {
      if (/^INSERT INTO feedback\(/.test(sql.trim())) {
        rows.set(bound[0], { id: bound[0], kind: bound[2], view_json: bound[9] })
        return { results: [], meta: { changes: 1 } }
      }
      return { results: [], meta: { changes: 0 } }
    },
    async first() {
      if (/FROM sessions JOIN users/.test(sql)) return user
      return null
    },
    async all() { return { results: [], meta: { changes: 0 } } },
  })
  const env = {
    DB: { prepare: (sql) => makeStmt(sql), batch: async (stmts) => Promise.all(stmts.map((s) => s.run())) },
    FEEDBACK: { get: async () => null, put: async () => {}, delete: async () => {} },
  }
  const post = (body) =>
    feedback(
      new Request('https://guilin.example/api/feedback', {
        method: 'POST',
        headers: { Origin: 'https://guilin.example', Cookie: 'glol_session=' + 'a'.repeat(64), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
      'feedback',
    )

  const okRes = await post({
    ...xz2ll(0, 0),
    kind: BUG,
    title: '无图 bug',
    body: '卡住了',
    view: null,
    heading: null,
    landmark_id: null,
  })
  assert.equal(okRes.status, 200)
  const { id } = await okRes.json()
  assert.equal(rows.get(id).view_json, null)

  await assert.rejects(
    () => post({ ...xz2ll(0, 0), kind: '缺失建筑', title: '无视角地标', body: '少了门楼', view: null }),
    (err) => err instanceof Problem && err.status === 400,
  )
  await assert.rejects(
    () => post({ ...xz2ll(0, 0), kind: BUG, title: '坏视角', body: '描述', view: { bad: true } }),
    (err) => err instanceof Problem && err.status === 400,
  )
})

test('Opus 终审回归项：申诉隐藏默认游戏画面、补充信息校验 1..1000 字、captureFailed 提示改选 bug、记录编号格式与续传草稿缺视角拦截', () => {
  // 1) 普通入口打开且有 selection 时切到「封禁申诉」，不误报已带默认游戏画面
  const appealWithCapture = describeFeedbackMedia({
    kind: APPEAL, hasItem: false, hasSelection: true, useDefaultShot: true, photoCount: 0, canCapture: true,
  })
  assert.equal(appealWithCapture.mode, 'appeal-empty')
  assert.equal(appealWithCapture.countText, '可直接提交申诉')

  // 2) 补充信息（supplement）拦截纯空格与超过 1000 字
  assert.deepEqual(
    validateFeedbackSubmit({
      kind: '其他', hasItem: true, supplement: true, hasSelection: false, useDefaultShot: false, photoCount: 0, canCapture: true, bodyText: '   ',
    }),
    { ok: false, error: '请填写补充内容' },
  )
  assert.deepEqual(
    validateFeedbackSubmit({
      kind: '其他', hasItem: true, supplement: true, hasSelection: false, useDefaultShot: false, photoCount: 0, canCapture: true, bodyText: '补'.repeat(1001),
    }),
    { ok: false, error: '补充内容最多 1000 字' },
  )
  assert.deepEqual(
    validateFeedbackSubmit({
      kind: '其他', hasItem: true, supplement: true, hasSelection: false, useDefaultShot: false, photoCount: 0, canCapture: true, bodyText: '补'.repeat(1000),
    }),
    { ok: true, needsAutoCapture: false },
  )

  // 3) captureFailed=true 时，即使 canCapture=true 也提示用户可改选「游戏 bug」
  const failedNonBug = describeFeedbackMedia({
    kind: '缺失建筑', hasItem: false, hasSelection: false, useDefaultShot: false, photoCount: 0, canCapture: true, captureFailed: true,
  })
  assert.match(failedNonBug.countText, /请先截取游戏画面.*游戏 bug/)
  assert.equal(failedNonBug.countEmpty, true)

  // 4) 申诉记录编号格式校验对齐后端
  assert.deepEqual(
    validateFeedbackSubmit({
      kind: APPEAL, hasItem: false, supplement: false, hasSelection: false, useDefaultShot: false, photoCount: 0, canCapture: true, bodyText: '网络波动误封请核实', banRecordId: 'bad id!',
    }),
    { ok: false, error: '记录编号格式不正确，请核对后重试' },
  )
  assert.deepEqual(
    validateFeedbackSubmit({
      kind: APPEAL, hasItem: false, supplement: false, hasSelection: false, useDefaultShot: false, photoCount: 0, canCapture: true, bodyText: '网络波动误封请核实', banRecordId: 'legacy-42',
    }),
    { ok: true, needsAutoCapture: false },
  )

  // 5) 续传非可选类型草稿时，若原草稿缺 view-shot（itemHasViewShot=false）不亮绿灯
  const resumeMissingShot = describeFeedbackMedia({
    kind: '其他', hasItem: true, itemHasViewShot: false, hasSelection: false, useDefaultShot: false, photoCount: 2, canCapture: true,
  })
  assert.equal(resumeMissingShot.countEmpty, true)
  assert.match(resumeMissingShot.countText, /还需截取游戏画面/)
  assert.deepEqual(
    validateFeedbackSubmit({
      kind: '其他', hasItem: true, supplement: false, itemHasViewShot: false, hasSelection: false, useDefaultShot: false, photoCount: 2, canCapture: true, bodyText: '旧草稿',
    }),
    { ok: true, needsAutoCapture: true },
  )
})
