import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  XXG_LAYOUT_LIMITS,
  XXG_PLAYER,
  XXG_PORTAL_IDS,
  XXG_PORTALS,
  getPortal,
  validateXxgLayout,
} from '../contract.ts'
import {
  XIAOXIANGGANG_B1_LAYOUT,
  XXG_ARCHITECTURAL_META,
  assertValidXxgLayout,
  corridorToRect,
} from './index.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../..')

function rectsOverlap2D(a, b, eps = 0.001) {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w - eps * 2 && Math.abs(a.z - b.z) * 2 < a.d + b.d - eps * 2
}

function pointInRect(p, r, pad = 0) {
  return (
    p.x >= r.x - r.w * 0.5 + pad &&
    p.x <= r.x + r.w * 0.5 - pad &&
    p.z >= r.z - r.d * 0.5 + pad &&
    p.z <= r.z + r.d * 0.5 - pad
  )
}

function rectDistance2D(a, b) {
  const dx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) * 0.5)
  const dz = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) * 0.5)
  return Math.hypot(dx, dz)
}

test('contract validateXxgLayout 严格通过且 JSON 与 TS 导出逐位一致', () => {
  const jsonPath = path.join(__dirname, 'xiaoxianggang-b1.layout.json')
  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  assert.deepEqual(validateXxgLayout(parsed), [])
  assert.deepEqual(validateXxgLayout(XIAOXIANGGANG_B1_LAYOUT), [])
  assert.deepEqual(XIAOXIANGGANG_B1_LAYOUT, parsed)
  assert.doesNotThrow(() => assertValidXxgLayout(XIAOXIANGGANG_B1_LAYOUT))
})

test('全铺位严格互不重叠、紧贴 frontage 走廊且零侵入走廊主道', () => {
  const layout = XIAOXIANGGANG_B1_LAYOUT
  assert.ok(layout.shops.length >= 25, `expected realistic multi-zone shop count, got ${layout.shops.length}`)
  const corrRects = new Map(layout.corridors.map(c => [c.id, corridorToRect(c)]))

  for (let i = 0; i < layout.shops.length; i++) {
    const a = layout.shops[i]
    for (let j = i + 1; j < layout.shops.length; j++) {
      const b = layout.shops[j]
      assert.equal(
        rectsOverlap2D(a.rect, b.rect, XXG_LAYOUT_LIMITS.overlapEpsilon),
        false,
        `shops overlap: ${a.id} (${a.no}) vs ${b.id} (${b.no})`,
      )
    }

    // 铺面距离所声明的 frontage 走廊边界 <= 0.85m（不悬空脱节），且不能突入任何走廊内部
    const frontageRect = corrRects.get(a.frontage)
    assert.ok(frontageRect, `missing frontage corridor ${a.frontage} for ${a.id}`)
    const dist = rectDistance2D(a.rect, frontageRect)
    assert.ok(dist <= 0.85, `shop ${a.id} is ${dist.toFixed(3)}m away from frontage ${a.frontage}`)

    for (const [cid, cRect] of corrRects.entries()) {
      assert.equal(rectsOverlap2D(a.rect, cRect, 0.02), false, `shop ${a.id} intrudes into corridor ${cid}`)
    }
    for (const sky of XXG_ARCHITECTURAL_META.skylights) {
      const skyRect = { x: sky.center.x, z: sky.center.z, w: sky.baseWidthM, d: sky.baseWidthM }
      assert.equal(rectsOverlap2D(a.rect, skyRect, 0.01), false, `shop ${a.id} intrudes into skylight ${sky.id}`)
    }
  }
})

test('4个地下出口与 contract.ts XXG_PORTALS 一一对应，落点可走且楼梯不挡路/不叠铺', () => {
  const layout = XIAOXIANGGANG_B1_LAYOUT
  const corrRects = layout.corridors.map(c => ({ id: c.id, kind: c.kind, rect: corridorToRect(c) }))

  assert.equal(layout.exits.length, XXG_PORTAL_IDS.length)
  for (const portalId of XXG_PORTAL_IDS) {
    const portal = getPortal(portalId)
    const exit = layout.exits.find(e => e.portalId === portalId)
    assert.ok(exit, `missing exit for ${portalId}`)

    const offsetM = Math.hypot(exit.foot.x - portal.indoor.x, exit.foot.z - portal.indoor.z)
    assert.ok(
      offsetM <= XXG_LAYOUT_LIMITS.exitMaxOffset,
      `exit ${portalId} offset ${offsetM.toFixed(2)}m > ${XXG_LAYOUT_LIMITS.exitMaxOffset}m`,
    )

    // foot 必须位于至少一条走廊可步行净区内（留出玩家半径）
    const landingCorridor = corrRects.find(c => pointInRect(exit.foot, c.rect, XXG_PLAYER.radius))
    assert.ok(landingCorridor, `exit ${portalId} foot (${exit.foot.x}, ${exit.foot.z}) not inside corridor`)

    // foot 不得与任何楼梯 / 铺位碰撞，且前方 2.5m 视野落入开放走廊
    for (const otherExit of layout.exits) {
      assert.equal(
        pointInRect(exit.foot, otherExit.stair, -XXG_PLAYER.radius),
        false,
        `exit ${portalId} foot collides with stair ${otherExit.portalId}`,
      )
      assert.ok(
        otherExit.stair.x - otherExit.stair.w * 0.5 >= layout.bounds.minX &&
          otherExit.stair.x + otherExit.stair.w * 0.5 <= layout.bounds.maxX &&
          otherExit.stair.z - otherExit.stair.d * 0.5 >= layout.bounds.minZ &&
          otherExit.stair.z + otherExit.stair.d * 0.5 <= layout.bounds.maxZ,
        `stair ${otherExit.portalId} out of bounds`,
      )
    }

    const lookAhead = {
      x: exit.foot.x - Math.sin(exit.yaw) * 2.5,
      z: exit.foot.z - Math.cos(exit.yaw) * 2.5,
    }
    const openAhead = corrRects.some(c => pointInRect(lookAhead, c.rect, 0))
    assert.ok(openAhead, `exit ${portalId} facing yaw=${exit.yaw.toFixed(2)} does not face open corridor`)

    for (const shop of layout.shops) {
      assert.equal(
        rectsOverlap2D(exit.stair, shop.rect, 0.01),
        false,
        `stair ${portalId} overlaps shop ${shop.id}`,
      )
    }
  }
  assert.equal(XXG_PORTALS.length, 4)
})

test('结构柱网零堵塞走廊/出口/楼梯/铺位，且全走廊网络单连通可达全部4个入口', () => {
  const layout = XIAOXIANGGANG_B1_LAYOUT
  const corrItems = layout.corridors.map(c => ({ id: c.id, kind: c.kind, rect: corridorToRect(c) }))
  const halfCol = layout.columns.size * 0.5

  for (const cx of layout.columns.xs) {
    for (const cz of layout.columns.zs) {
      const colRect = { x: cx, z: cz, w: layout.columns.size, d: layout.columns.size }
      assert.ok(cx >= layout.bounds.minX + halfCol && cx <= layout.bounds.maxX - halfCol)
      assert.ok(cz >= layout.bounds.minZ + halfCol && cz <= layout.bounds.maxZ - halfCol)

      for (const c of corrItems) {
        assert.equal(
          rectsOverlap2D(colRect, c.rect, 0.01),
          false,
          `column (${cx}, ${cz}) blocks corridor ${c.id}`,
        )
      }
      for (const s of layout.shops) {
        assert.equal(
          rectsOverlap2D(colRect, s.rect, 0.01),
          false,
          `column (${cx}, ${cz}) overlaps shop ${s.id}`,
        )
      }
      for (const e of layout.exits) {
        assert.equal(
          rectsOverlap2D(colRect, e.stair, 0.01),
          false,
          `column (${cx}, ${cz}) overlaps stair ${e.portalId}`,
        )
        assert.ok(
          Math.hypot(e.foot.x - cx, e.foot.z - cz) > halfCol + XXG_PLAYER.radius + 0.2,
          `column (${cx}, ${cz}) too close to exit ${e.portalId} foot`,
        )
      }
    }
  }

  // 验证整套走廊拓扑单连通（任意入口之间均可室内步行直达）
  const adj = new Map(corrItems.map(c => [c.id, new Set()]))
  for (let i = 0; i < corrItems.length; i++) {
    for (let j = i + 1; j < corrItems.length; j++) {
      if (rectDistance2D(corrItems[i].rect, corrItems[j].rect) <= 0.05) {
        adj.get(corrItems[i].id).add(corrItems[j].id)
        adj.get(corrItems[j].id).add(corrItems[i].id)
      }
    }
  }
  const visited = new Set([corrItems[0].id])
  const queue = [corrItems[0].id]
  while (queue.length > 0) {
    const cur = queue.shift()
    for (const next of adj.get(cur)) {
      if (!visited.has(next)) {
        visited.add(next)
        queue.push(next)
      }
    }
  }
  assert.equal(visited.size, corrItems.length, 'corridor graph must be 100% connected')
})

test('实拍参照来源、采光井元数据、源码纯粹性与对照标注平面图 PNG 全部就绪', () => {
  const refsDir = path.join(REPO_ROOT, 'docs/xiaoxianggang/refs')
  for (const sky of XXG_ARCHITECTURAL_META.skylights) {
    for (const f of sky.refPhotos) {
      assert.equal(fs.existsSync(path.join(refsDir, f)), true, `missing skylight ref ${f}`)
    }
  }
  for (const z of XXG_ARCHITECTURAL_META.zones) {
    for (const f of z.refPhotos) {
      assert.equal(fs.existsSync(path.join(refsDir, f)), true, `missing zone ref ${f}`)
    }
  }

  // 严禁跨模块耦合 runtime / three 值导入
  const layoutIndexText = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8')
  assert.equal(/from\s+['"]three['"]/.test(layoutIndexText), false)
  assert.equal(/\.\.\/runtime|\/runtime\//.test(layoutIndexText), false)

  // k104: 平面图 PNG 必须存在、为合法 PNG 且具备高清尺寸
  const pngPath = path.join(__dirname, 'xiaoxianggang-b1-floorplan.png')
  assert.equal(fs.existsSync(pngPath), true, `missing annotated floorplan PNG at ${pngPath}`)
  const buf = fs.readFileSync(pngPath)
  assert.ok(buf.byteLength > 50_000, `floorplan PNG unexpectedly small: ${buf.byteLength} bytes`)
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'valid PNG header')
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  assert.ok(width >= 1800 && height >= 1100, `floorplan PNG resolution too low: ${width}x${height}`)
})
