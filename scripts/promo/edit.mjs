// IDOK-159 promo film edit: join rendered shots, lay captions/end card, mix music.
//   node scripts/promo/edit.mjs --variant h   → captures/promo/glol-promo-h.mp4
// Inputs: captures/promo/<variant>/<shot>.mp4 from render.mjs; optional music in
// captures/promo/music/{shanshui,city}.(mp3|m4a|wav) — the scenery cue plays until the first ride
// shot, then crossfades into the city cue.
import {chromium} from 'playwright'
import {existsSync} from 'node:fs'
import {mkdir, readFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {parseArgs} from 'node:util'
import {shots, variants} from './shots.mjs'

const {values:opt} = parseArgs({options:{variant:{type:'string',default:'h'}, dir:{type:'string',default:'captures/promo'}}})
const variant = variants[opt.variant], V = opt.variant, dir = opt.dir
const W = variant.width, H = variant.height
const list = variant.shots.map(id=>shots.find(s=>s.id===id))
const dur = s=>(V==='v'&&s.v?.dur)||s.dur
const X = .5                                   // dissolve length
const cityFrom = list.findIndex(s=>s.ride)     // music switches at the first ride shot

// ---- timeline ---------------------------------------------------------------------------------
let t = 0; const start = list.map((s,i)=>{const at=t; t+=dur(s)-(i<list.length-1?X:0); return at})
const total = t
const at = id=>start[list.findIndex(s=>s.id===id)]
const captions = [
  {text:'山水', at:at('s02')+.4, len:2.6},
  {text:'古城', at:at('s05')+.3, len:2.4},
  {text:'夜桂林', at:at('s12')+.3, len:2.6},
].filter(c=>Number.isFinite(c.at))
const endAt = total-3.6

// ---- caption and end-card PNGs (rendered by Chromium so CJK typesetting is right) --------------
await mkdir(`${dir}/cards`,{recursive:true})
const logo = 'data:image/webp;base64,'+(await readFile('public/brand/logo.webp')).toString('base64')
const browser = await chromium.launch()
const page = await browser.newPage({viewport:{width:W,height:H}})
const font = `'Noto Serif CJK SC','Noto Serif SC','Songti SC',serif`
async function card(name,html){
  await page.setContent(`<html><body style="margin:0;width:${W}px;height:${H}px;background:transparent;display:flex;align-items:center;justify-content:center">${html}</body></html>`)
  await page.screenshot({path:`${dir}/cards/${name}-${V}.png`,omitBackground:true})
}
const small = V==='v'
for(const [i,c] of captions.entries())
  await card(`cap${i}`,`<div style="position:absolute;${small?'left:0;right:0;bottom:22%;text-align:center':'left:7%;bottom:12%'};font-family:${font};font-weight:600;
    font-size:${small?64:58}px;letter-spacing:.5em;color:#f7f3ea;text-shadow:0 2px 18px rgba(0,0,0,.45)">${c.text}</div>`)
await card('end',`<div style="position:absolute;inset:0;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center">
  <img src="${logo}" style="width:${small?620:520}px;display:block">
  <div style="margin-top:${small?36:26}px;font-family:'Noto Sans Mono CJK SC',ui-monospace,monospace;font-size:${small?48:38}px;letter-spacing:.14em;color:#2f5d3a">glol.rcpd.cc</div></div>`)
await browser.close()

// ---- ffmpeg graph -----------------------------------------------------------------------------
const inputs = [], f = []
for(const s of list){const file=`${dir}/${V}/${s.id}.mp4`;if(!existsSync(file))throw Error(`missing ${file}`);inputs.push('-i',file)}
list.forEach((s,i)=>f.push(`[${i}:v]trim=0:${dur(s)},setpts=PTS-STARTPTS,fps=30,scale=${W}:${H},format=yuv420p[c${i}]`))
let prev = 'c0'
for(let i=1;i<list.length;i++){f.push(`[${prev}][c${i}]xfade=transition=fade:duration=${X}:offset=${(start[i]).toFixed(3)}[x${i}]`);prev=`x${i}`}
let n = list.length
const overlay = (png,from,len,label)=>{inputs.push('-loop','1','-t',String(total),'-i',png)
  f.push(`[${n}:v]format=rgba,fade=t=in:st=${from}:d=0.6:alpha=1,fade=t=out:st=${from+len-.6}:d=0.6:alpha=1[o${n}]`,`[${prev}][o${n}]overlay=0:0[${label}]`)
  prev=label; n++}
captions.forEach((c,i)=>overlay(`${dir}/cards/cap${i}-${V}.png`,c.at,c.len,`k${i}`))
// End card: dissolve to the white logo card (the logo artwork has a white ground), hold, then fade out.
inputs.push('-loop','1','-t',String(total),'-i',`${dir}/cards/end-${V}.png`)
f.push(`[${n}:v]format=rgba,fade=t=in:st=${endAt}:d=1.2:alpha=1[e]`,`[${prev}][e]overlay=0:0,fade=t=out:st=${(total-.5).toFixed(2)}:d=0.5[vout]`)
n++
const pick = name=>['mp3','m4a','wav','flac'].map(e=>`${dir}/music/${name}.${e}`).find(existsSync)
const a = pick('shanshui'), b = pick('city'), audio = []
if(a&&b){
  const cut = start[cityFrom]
  inputs.push('-i',a,'-i',b)
  f.push(`[${n}:a]atrim=0:${cut+1.5},afade=t=out:st=${cut-.5}:d=2,asetpts=PTS-STARTPTS[ma]`,
    `[${n+1}:a]atrim=0:${total-cut+1},adelay=${Math.round((cut-.5)*1000)}|${Math.round((cut-.5)*1000)},afade=t=in:st=${cut-.5}:d=0.8[mb]`,
    `[ma][mb]amix=inputs=2:normalize=0,atrim=0:${total},afade=t=in:st=0:d=1,afade=t=out:st=${total-2.5}:d=2.5,loudnorm=I=-16:TP=-1.5[aout]`)
  audio.push('-map','[aout]','-c:a','aac','-b:a','192k')
} else console.log('no music in',`${dir}/music — rendering silent`)
const outFile = `${dir}/glol-promo-${V}.mp4`
const r = spawnSync('ffmpeg',['-y','-loglevel','error',...inputs,'-filter_complex',f.join(';'),'-map','[vout]',...audio,
  '-c:v','libx264','-preset','slow','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart','-t',String(total),outFile],{stdio:'inherit'})
if(r.status)throw Error('ffmpeg failed')
console.log(outFile,`${total.toFixed(1)}s`)
