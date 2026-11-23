#!/usr/bin/env node
// 构建产物守卫：赞助 / 打赏模块一律不许进 dist
//
// 背景：天空下起雨那份 dist 里带了一个「爱发电」浮动按钮 + 赞助面板，
// 面板里的赞赏码是他本人的微信码，管理界面还只能改名单不能换码。
// 站挂在 idoknow 这边运营，钱不该进别人的号，所以整块删掉。
//
// 用法：node scripts/check-no-support.mjs [dist 目录，默认 dist]
// 退出码：0 = 干净；1 = 命中，构建应当失败
import {readdirSync, readFileSync, statSync, existsSync} from 'node:fs'
import {join, relative} from 'node:path'

const dist = process.argv[2] || 'dist'

if (!existsSync(dist)) {
  console.error(`找不到构建产物目录：${dist}`)
  process.exit(2)
}

// 1. 不该存在的文件 / 目录
const FORBIDDEN_PATHS = [/^support\//, /^assets\/support-/, /sponsors\.json$/]
// 2. 不该出现的字符串（打进 bundle 的模块名、文案、接口）
const FORBIDDEN_STRINGS = ['爱发电', 'dock-support', 'sponsor-panel', '/api/sponsors', 'guiling.support']

const hits = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = relative(dist, full).split('\\').join('/')
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full)
      continue
    }
    if (FORBIDDEN_PATHS.some(re => re.test(rel))) {
      hits.push(`文件 ${rel}`)
      continue
    }
    // 只扫文本资源，图片/模型跳过
    if (!/\.(js|mjs|css|html|json|webmanifest)$/.test(rel)) continue
    let text
    try {
      text = readFileSync(full, 'utf8')
    } catch {
      continue
    }
    for (const s of FORBIDDEN_STRINGS) {
      if (text.includes(s)) hits.push(`字符串 "${s}" 出现在 ${rel}`)
    }
  }
}

walk(dist)

if (hits.length) {
  console.error('赞助/打赏模块不该出现在构建产物里：')
  for (const h of [...new Set(hits)]) console.error('  ✗ ' + h)
  console.error('\n删掉 web/src 下的 support 模块、dock 里的「爱发电」按钮，以及 /api/sponsors 的读取逻辑。')
  process.exit(1)
}

console.log('✓ 构建产物里没有赞助/打赏模块')
