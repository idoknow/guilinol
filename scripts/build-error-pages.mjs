#!/usr/bin/env node
// IDOK-420: generates the self-contained error pages in web/errors/ (403/404/500/502/504).
// They are shown exactly when the site or its assets are unreachable, so every byte is inline:
// no external CSS/JS/fonts/images. Re-run after editing copy or style:  node scripts/build-error-pages.mjs
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const QQ_GROUP = '1137384288'
const RECOVER = '正在发布新版本或维护时，通常几十秒内就会恢复。'

const pages = {
  403: {
    title: '这里暂时进不去',
    lead: '当前网络或访问方式被安全策略拦截，暂时打不开这个页面。',
    causes: ['从别的网站直接引用了这里的图片或模型', '短时间内刷新或请求得太频繁', '代理、加速器或公共网络被误判为异常访问'],
    steps: ['返回首页，从入口重新进城', '稍等一两分钟再重试', '关掉代理或换个网络（比如切到手机流量）'],
  },
  404: {
    title: '这条街没找到',
    lead: '你要找的页面不在网上桂林的地图上。',
    causes: ['链接输错了，或者复制得不完整', '页面已经改名或下线', '从旧收藏、旧分享里打开的地址'],
    steps: ['检查一下地址栏里的链接', '返回首页，从入口重新进城'],
    path: true,
  },
  500: {
    title: '城里出了点小故障',
    lead: '服务器处理这次请求时出错了，不是你的操作问题。',
    causes: ['程序遇到了没料到的情况', '正在发布新版本或维护'],
    steps: ['等几秒，点「重试」刷新', '一直打不开的话，到 QQ 群告诉我们'],
    note: RECOVER, qq: true,
  },
  502: {
    title: '服务暂时没接上',
    lead: '游戏服务暂时不可用，多半是正在发布新版本。',
    causes: ['新版本正在上线，服务在重启', '服务器短暂繁忙'],
    steps: ['稍等几秒再点「重试」', '页面会自动重试，留在这里就好'],
    note: RECOVER, auto: 10, qq: true,
  },
  504: {
    title: '等得太久了',
    lead: '请求超时了：服务器正忙，或者当前网络比较慢。',
    causes: ['服务器同时处理的请求太多', '当前网络信号差或不稳定'],
    steps: ['点「重试」刷新一次', '换个网络再试（Wi-Fi 和手机流量互换）'],
    note: RECOVER, qq: true,
  },
}

// 青绿山水剪影：两层低多边形峰林 + 江面，纯内联 SVG。
// 青绿山水剪影：远近两层低多边形峰林 + 江面，纯内联 SVG（绝对坐标，铺满 0..400）。
const ridge = (fill, pts) => `<path fill="${fill}" d="M0 90L${pts}L400 90Z"/>`
const hills = '<svg class="hills" viewBox="0 0 400 90" preserveAspectRatio="none" aria-hidden="true">'
  + ridge('#223b35', '0 58 18 44 30 20 42 16 52 40 70 50 88 30 98 8 110 6 120 34 140 46 162 38 176 14 188 12 198 42 222 52 246 34 258 18 270 20 282 44 306 50 326 26 336 10 348 12 360 40 380 48 400 36')
  + ridge('#2f5a4d', '0 74 24 64 40 46 52 44 62 66 92 72 118 58 130 40 142 42 152 64 184 70 214 60 228 44 240 46 250 66 284 72 310 62 322 48 334 50 344 68 372 72 400 62')
  + '<path fill="#1a312c" d="M0 82h400v8H0z"/><path stroke="#9fc7b6" stroke-opacity=".18" d="M40 86h60M180 85h44M300 87h52"/></svg>'

const css = `*{box-sizing:border-box}html{background:#14211e;color-scheme:dark}
body{margin:0;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px;
color:#dfe9e4;font:15px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
background:radial-gradient(ellipse at 50% 0,#1d3430 0,#14211e 70%)}
main{position:relative;width:min(440px,100%);overflow:hidden;border:1px solid rgba(159,199,182,.14);border-radius:18px;background:#1c2c2a;
box-shadow:0 18px 48px rgba(0,0,0,.35)}
.top{position:relative;padding:28px 26px 0}
.brand{display:flex;align-items:center;gap:10px;margin:0 0 18px;color:#9fc7b6;font-size:13px;letter-spacing:.3em}
.seal{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:5px;background:#c8553d;color:#f4efe2;font-size:15px;letter-spacing:0;font-weight:600;transform:rotate(-4deg)}
.code{margin:0;color:#c8553d;font-size:clamp(64px,22vw,96px);font-weight:700;line-height:1;letter-spacing:.08em;font-variant-numeric:tabular-nums}
h1{margin:10px 0 6px;font-size:clamp(20px,5.6vw,24px);font-weight:600;letter-spacing:.12em}
.lead{margin:0;color:#dfe9e4;opacity:.92}
.hills{display:block;width:100%;height:64px;margin-top:20px}
.body{padding:18px 26px 24px;background:#1a312c}
h2{margin:0 0 6px;color:#9fc7b6;font-size:12px;font-weight:500;letter-spacing:.3em}
ul{margin:0 0 16px;padding-left:1.15em}li{margin:2px 0;font-size:14px}li::marker{color:#c8553d}
.note{margin:0 0 16px;padding:8px 12px;border-left:3px solid #c8553d;border-radius:0 6px 6px 0;background:rgba(200,85,61,.1);font-size:13px}
.path{margin:6px 0 0;color:#9fc7b6;font-size:12px;word-break:break-all;opacity:.8}
.qq{margin:-6px 0 16px;font-size:13px;color:#9fc7b6}.qq b{color:#dfe9e4;letter-spacing:.06em}
.qq button{margin-left:6px;padding:1px 8px;border:1px solid rgba(159,199,182,.35);border-radius:99px;background:none;color:#9fc7b6;font:inherit;font-size:12px;cursor:pointer}
.act{display:flex;gap:10px;flex-wrap:wrap}
.btn{flex:1 1 120px;display:inline-flex;align-items:center;justify-content:center;height:42px;padding:0 18px;border:1px solid #c8553d;border-radius:999px;
background:#c8553d;color:#f4efe2;font:inherit;font-size:14px;font-weight:500;letter-spacing:.14em;text-decoration:none;cursor:pointer}
.btn:hover{background:#d0694c;border-color:#d0694c}.btn:focus-visible{outline:2px solid #e2b878;outline-offset:2px}
.btn.ghost{background:transparent;border-color:rgba(159,199,182,.4);color:#dfe9e4}.btn.ghost:hover{border-color:#dfe9e4;background:rgba(223,233,228,.06)}
.auto{margin:10px 0 0;color:#9fc7b6;font-size:12px;text-align:center;min-height:1.2em}
footer{margin-top:18px;color:#9fc7b6;font-size:12px;letter-spacing:.12em;opacity:.7;text-align:center}
@media (max-width:360px){.top{padding:22px 18px 0}.body{padding:16px 18px 20px}}
/* 横向手机 / 矮窗口：压缩密度，操作按钮吸附在卡片底部，任何高度都能直接点到 */
@media (max-height:720px){
body{padding:10px;justify-content:flex-start}
main{max-height:calc(100dvh - 20px);display:flex;flex-direction:column}
.top{padding:16px 18px 0}
.brand{margin:0 0 10px;font-size:11px}
.seal{width:22px;height:22px;font-size:13px}
.code{font-size:clamp(40px,9vh,60px)}
h1{margin:6px 0 4px;font-size:clamp(16px,4.4vw,19px);letter-spacing:.1em}
.lead{font-size:13px}
.hills{height:34px;margin-top:10px}
.body{padding:10px 18px 14px;overflow-y:auto;overscroll-behavior:contain}
h2{margin:0 0 4px;font-size:11px}
ul{margin:0 0 8px}li{margin:0;font-size:12.5px;line-height:1.55}
.note{margin:0 0 8px;padding:5px 9px;font-size:12px}
.path{font-size:11px;margin:2px 0 0}
.act{position:sticky;bottom:0;padding-top:8px;background:#1a312c;gap:8px}
.btn{height:38px;font-size:13px}
.auto{margin:6px 0 0}
footer{margin-top:8px;font-size:11px}
}
/* 极矮（横屏小手机）：进一步瘦身 */
@media (max-height:470px){
.hills{display:none}
.brand{margin:0 0 6px}
.code{font-size:clamp(32px,7.5vh,44px)}
h1{font-size:16px}
li:nth-of-type(n+3){display:none}
.note{display:none}
footer{margin-top:6px}
}`

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

function page(code, p) {
  const list = items => '<ul>' + items.map(i => `<li>${esc(i)}</li>`).join('') + '</ul>'
  let js = 'document.getElementById("r").onclick=function(){location.reload()};'
  if (p.path) js += 'document.getElementById("p").textContent=location.host+location.pathname;'
  if (p.qq) js += `document.getElementById("c").onclick=function(){var b=this;try{navigator.clipboard.writeText("${QQ_GROUP}").then(function(){b.textContent="已复制"})}catch(e){}};`
  if (p.auto) js += `(function(){var k="glol-retry",v=(sessionStorage.getItem(k)||"0|0").split("|"),n=Date.now()-v[1]>3e5?0:+v[0],t=${p.auto},e=document.getElementById("a");if(n>=6){e.textContent="已自动重试多次，请稍后手动重试";return}
var i=setInterval(function(){if(--t<=0){clearInterval(i);sessionStorage.setItem(k,n+1+"|"+Date.now());location.reload()}else e.textContent=t+" 秒后自动重试"},1000);e.textContent=t+" 秒后自动重试"})();`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><meta name="theme-color" content="#14211e"><title>${code} · ${esc(p.title)} · 网上桂林</title>
<style>${css}</style></head><body>
<main><div class="top"><p class="brand"><span class="seal" aria-hidden="true">桂</span>网上桂林</p>
<p class="code">${code}</p><h1>${esc(p.title)}</h1><p class="lead">${esc(p.lead)}</p>${p.path ? '<p class="path" id="p"></p>' : ''}</div>${hills}
<div class="body"><h2>可能的原因</h2>${list(p.causes)}<h2>可以这样做</h2>${list(p.steps)}
${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}${p.qq ? `<p class="qq">玩家 QQ 群 <b>${QQ_GROUP}</b><button type="button" id="c">复制群号</button></p>` : ''}
<div class="act"><a class="btn" href="/">返回首页</a><button class="btn ghost" type="button" id="r">重试</button></div>${p.auto ? '<p class="auto" id="a" aria-live="polite"></p>' : ''}</div></main>
<footer>网上桂林 · v${version}</footer>
<script>${js}</script></body></html>
`
}

const dir = join(root, 'web/errors')
mkdirSync(dir, {recursive: true})
for (const [code, p] of Object.entries(pages)) {
  const html = page(code, p)
  const bytes = Buffer.byteLength(html)
  if (bytes > 10240) throw new Error(`${code}.html is ${bytes} B, over the 10 KB budget`)
  if (/(?:src|href)=["']?(?:https?:)?\/\//i.test(html) || /url\(/i.test(html)) throw new Error(`${code}.html references an external resource`)
  writeFileSync(join(dir, `${code}.html`), html)
  console.log(`web/errors/${code}.html  ${bytes} B`)
}
