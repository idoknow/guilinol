// IDOK-159 promo film edit: beat-locked cut, place captions, blur-to-white logo ending.
//   node scripts/promo/edit.mjs --variant h   → captures/promo/glol-promo-h.mp4
// Inputs: captures/promo/<variant>/<shot>.mp4 (render.mjs) and captures/promo/music/{shanshui,city}.wav
// (BudgetPixel AI, CC BY 4.0: "Flowing Guzheng Elegance", "Sunset Synth Cruise").
//
// Music: both cues share one tempo (161.5 BPM by librosa). The city cue's drums enter at 12.10 s, after
// an 8-beat build from 9.13 s. The drum entry is placed exactly on the cut into the first ride shot;
// the build plays under the last scenery shot through a rising high-pass while the guzheng closes
// through a falling low-pass. City shots are hard cuts on beats; the night shots dissolve on bar lines.
// The film ends on the guzheng's outro while the picture blurs out to white behind the logo.
import {chromium} from 'playwright'
import {existsSync} from 'node:fs'
import {mkdir, readFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {parseArgs} from 'node:util'
import {shots, variants} from './shots.mjs'

const {values:opt} = parseArgs({options:{variant:{type:'string',default:'h'}, dir:{type:'string',default:'captures/promo'}, draft:{type:'boolean',default:false}}})
const V = opt.variant, variant = variants[V], dir = opt.dir, W = variant.width, H = variant.height
const P = 60/161.5                                  // one beat
const CITY_DROP = 12.10, GUZHENG_OUTRO = 47.6       // seconds inside the cue files
const CUT = 1/30                                     // a "cut" is a one-frame dissolve

// ---- edit decision list -------------------------------------------------------------------------
// scenery: seconds on screen (dissolves); city: beats (hard cuts); night: beats, dissolve in.
// skip = seconds dropped from the clip head, max = usable clip length (IDOK-172 review: tree canopy
// at the head of s02 and the tail of s03; a bus brushes the lens at the head of s15). The portrait
// cut drops s10 (a wall fills the foreground). The last s15 frame is held under the blur-out.
const edl = {
  h:[
    ['s01',{sec:5.6}], ['s02',{sec:3.6,skip:1.0}], ['s03',{sec:3.0,max:3.4}], ['s04',{sec:3.6}], ['s05',{sec:4.6}],
    ['s07',{beats:8,cut:true}], ['s08',{beats:8,cut:true}], ['s09',{beats:8,cut:true}], ['s10',{beats:8,cut:true}], ['s11',{beats:8,cut:true}],
    ['s12',{beats:6,fade:.8,max:3.05}], ['s15',{sec:7.6,fade:.8,skip:1.8}],
  ],
  v:[
    ['s01',{sec:4.0}], ['s02',{sec:2.0,skip:.9}], ['s03',{sec:1.9,max:2.2}],
    ['s07',{beats:8,cut:true}], ['s09',{beats:8,cut:true}], ['s11',{beats:8,cut:true}],
    ['s12',{beats:6,fade:.8,max:3.05}], ['s15',{sec:5.8,fade:.8,skip:1.4}],
  ],
}[V]
const prerollBeats = 8
const SCENERY_FADE = .6

const clips = edl.map(([id,o])=>({id,...o,shot:shots.find(s=>s.id===id),
  rendered:Math.min((V==='v'&&shots.find(s=>s.id===id).v?.dur)||shots.find(s=>s.id===id).dur, o.max??Infinity)-(o.skip??0)}))
// boundary b[i] = film time where clip i takes over (middle of its transition)
let t = 0
for(const [i,c] of clips.entries()){
  c.d = i===0 ? 0 : c.cut ? CUT : c.fade ?? SCENERY_FADE
  c.b = t
  t += c.beats ? c.beats*P : c.sec
}
const total = t
const dropAt = clips.find(c=>c.shot.ride).b         // first ride shot: city drums land here
for(const [i,c] of clips.entries()){
  const next = clips[i+1]
  c.from = c.b - c.d/2                               // clip starts with its incoming transition
  c.len = (next ? next.b + next.d/2 : total) - c.from
  if(c.len > c.rendered + .25) console.log(`  ! ${c.id} needs ${c.len.toFixed(2)}s of ${c.rendered}s (last frame held)`)
}

// ---- captions --------------------------------------------------------------------------------
const names = {
  s01:['漓江','LI RIVER'], s02:['象鼻山','ELEPHANT TRUNK HILL'], s03:['日月双塔','SUN & MOON PAGODAS'],
  s04:['叠彩山','DIECAI HILL'], s05:['靖江王城 · 独秀峰','JINGJIANG PRINCES’ CITY'], s06:['东西巷','DONGXI LANES'],
  s07:['解放东路','JIEFANG EAST ROAD'], s08:['十字街','SHIZIJIE CROSSROADS'], s09:['穿城而过','ACROSS THE CITY'], s10:['解放桥','JIEFANG BRIDGE'],
  s11:['雨夜街头','CITY NIGHTS'], s12:['杉湖夜色','SHAN LAKE BY NIGHT'],
}
const caps = clips.filter(c=>names[c.id]).map(c=>{
  const inAt = c.b + (c.cut ? .15 : .35), outAt = c.b + (c.beats?c.beats*P:c.sec) - (c.cut ? .2 : .45)
  return {id:c.id, zh:names[c.id][0], en:names[c.id][1], inAt, len:outAt-inAt}
})
// Opening title over the first shot (the s01 place caption is replaced by it).
const title = {inAt:.5, len:3.0}
const capsShown = caps.filter(c=>c.id!=='s01')
const endStart = total-5.0                           // blur-to-white ending

// ---- caption / title / logo PNGs rendered by Chromium ------------------------------------------
await mkdir(`${dir}/cards`,{recursive:true})
const logo = 'data:image/png;base64,'+(await readFile('scripts/promo/logo-alpha.png')).toString('base64')
const serif = `'Noto Serif CJK SC',serif`, sans = `'Noto Sans CJK SC','Noto Sans CJK JP',sans-serif`
const portrait = V==='v'
const browser = await chromium.launch()
const page = await browser.newPage({viewport:{width:W,height:H}})
async function card(name,html){
  await page.setContent(`<html><body style="margin:0;width:${W}px;height:${H}px;background:transparent;overflow:hidden">${html}</body></html>`)
  await page.evaluate(()=>document.fonts.ready)
  await page.screenshot({path:`${dir}/cards/${name}-${V}.png`,omitBackground:true})
}
const shade = portrait
  ? `<div style="position:absolute;left:0;right:0;bottom:0;height:38%;background:linear-gradient(to top,rgba(0,0,0,.42),rgba(0,0,0,0))"></div>`
  : `<div style="position:absolute;left:0;bottom:0;width:60%;height:34%;background:radial-gradient(ellipse at 0% 100%,rgba(0,0,0,.38),rgba(0,0,0,0) 70%)"></div>`
for(const c of capsShown){
  const block = portrait
    ? `<div style="position:absolute;left:0;right:0;bottom:15%;text-align:center;color:#f8f5ee">
         <div style="font-family:${serif};font-weight:600;font-size:76px;letter-spacing:.18em;text-shadow:0 2px 16px rgba(0,0,0,.35)">${c.zh}</div>
         <div style="width:64px;height:2px;background:#d9b26a;margin:22px auto 18px"></div>
         <div style="font-family:${sans};font-size:42px;letter-spacing:.26em;opacity:.92">${c.en}</div></div>`
    : `<div style="position:absolute;left:96px;bottom:92px;color:#f8f5ee;display:flex;align-items:stretch;gap:24px">
         <div style="width:4px;background:#d9b26a;border-radius:2px"></div>
         <div><div style="font-family:${serif};font-weight:600;font-size:66px;letter-spacing:.14em;line-height:1.1;text-shadow:0 2px 14px rgba(0,0,0,.35)">${c.zh}</div>
         <div style="font-family:${sans};font-size:40px;letter-spacing:.22em;margin-top:14px;opacity:.92">${c.en}</div></div></div>`
  await card(`cap-${c.id}`, shade+block)
}
// Dawn haze is bright: the title is ink-green on a soft light halo so it reads on any sky.
await card('title',`<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#1f3d36">
  <div style="position:absolute;width:${portrait?900:1100}px;height:${portrait?420:360}px;background:radial-gradient(ellipse at center,rgba(255,255,255,.55),rgba(255,255,255,0) 68%)"></div>
  <div style="position:relative;font-family:${serif};font-weight:700;font-size:${portrait?128:120}px;letter-spacing:.3em;margin-left:.3em;text-shadow:0 0 24px rgba(255,255,255,.8)">网上桂林</div>
  <div style="position:relative;font-family:${sans};font-size:${portrait?38:34}px;letter-spacing:.6em;margin:22px 0 0 .6em;color:#2f5d4f;text-shadow:0 0 14px rgba(255,255,255,.9)">GUILIN · ONLINE</div></div>`)
await card('logo',`<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
  <img src="${logo}" style="width:${portrait?440:360}px;image-rendering:pixelated">
  <div style="margin-top:${portrait?30:24}px;font-family:${sans};font-size:${portrait?40:34}px;letter-spacing:.16em;color:#2f5d3a">glol.rcpd.cc</div></div>`)
await browser.close()

// ---- picture ---------------------------------------------------------------------------------
const inputs = [], f = []
for(const c of clips){const file=`${dir}/${V}/${c.id}.mp4`;if(!existsSync(file))throw Error(`missing ${file}`);inputs.push('-i',file)}
// Every clip is placed on an absolute timeline over a black base. (An xfade chain rounded each join
// and the picture drifted up to 9 frames ahead of the music by the last city cut.)
f.push(`color=black:s=${W}x${H}:r=30:d=${total.toFixed(4)},format=yuv420p[base]`)
let prev='base'
clips.forEach((c,i)=>{
  const fade = i===0 || c.cut ? '' : `,fade=t=in:st=0:d=${c.d}:alpha=1`
  f.push(`[${i}:v]trim=start=${c.skip??0},setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration=2,trim=end_frame=${Math.round(c.len*30)},`+
    `scale=${W}:${H},format=yuva420p${fade},setpts=PTS-STARTPTS+${(Math.round(c.from*30)/30).toFixed(4)}/TB[c${i}]`,
    `[${prev}][c${i}]overlay=0:0:eof_action=pass:format=yuv420[x${i}]`)
  prev=`x${i}`
})
// Ending: the picture blurs in two stages and washes to white; the logo settles in the centre.
const e0 = endStart
// Only the tail is blurred (blurring the whole film made the edit 10× slower).
f.push(`[${prev}]split=2[hd0][tl0]`,`[hd0]trim=0:${e0.toFixed(4)},setpts=PTS-STARTPTS[hd]`,
  `[tl0]trim=${e0.toFixed(4)},setpts=PTS-STARTPTS,split=3[p0][p1][p2]`,
  `[p1]gblur=sigma=${portrait?10:12}[b1]`, `[p2]gblur=sigma=${portrait?40:48}:steps=3[b2]`,
  `[p0][b1]blend=all_expr='A+(B-A)*clip(T/1.2\\,0\\,1)'[q1]`,
  `[q1][b2]blend=all_expr='A+(B-A)*clip((T-0.9)/1.4\\,0\\,1)'[q2]`,
  `[hd][q2]concat=n=2:v=1:a=0,settb=1/30,setpts=N/30/TB[q3]`)
prev='q3'
let n = clips.length
const layer = (png,from,len,label,fadeIn=.5,fadeOut=.5)=>{
  const span = len ?? (total-from)
  inputs.push('-loop','1','-framerate','30','-t',(span+(len==null?.3:0)).toFixed(3),'-i',png)   // +0.3: no black last frame
  const out = len==null ? '' : `,fade=t=out:st=${(span-fadeOut).toFixed(3)}:d=${fadeOut}:alpha=1`
  f.push(`[${n}:v]format=rgba,fade=t=in:st=0:d=${fadeIn}:alpha=1${out},setpts=PTS-STARTPTS+${from.toFixed(3)}/TB[o${n}]`,
    `[${prev}][o${n}]overlay=0:0:format=auto:eof_action=pass[${label}]`)
  prev=label; n++
}
layer(`${dir}/cards/title-${V}.png`,title.inAt,title.len,'t0',.9,.9)
capsShown.forEach((c,i)=>layer(`${dir}/cards/cap-${c.id}-${V}.png`,c.inAt,c.len,`k${i}`,c.len>2?.45:.3,.35))
f.push(`color=white:s=${W}x${H}:r=30:d=${(total-e0-1.3+.3).toFixed(3)},format=rgba,fade=t=in:st=0:d=1.6:alpha=1,setpts=PTS-STARTPTS+${(e0+1.3).toFixed(3)}/TB[white]`,`[${prev}][white]overlay=0:0:eof_action=pass[w1]`)
prev='w1'
layer(`${dir}/cards/logo-${V}.png`,e0+1.1,null,'lg',1.3)
f.push(`[${prev}]format=yuv420p[vout]`)

// ---- music -----------------------------------------------------------------------------------
const pick = name=>['wav','flac','m4a','mp3'].map(e=>`${dir}/music/${name}.${e}`).find(existsSync)
const a = pick('shanshui'), b = pick('city'), audio = []
if(a&&b){
  const sweep = prerollBeats*P, cityStart = dropAt - sweep, cityFileStart = CITY_DROP - sweep
  const cityEnd = e0 + 2.2                          // synth gone shortly after the picture starts to blur
  const ms = x=>Math.round(x*1000)
  // A: guzheng from 0 → closes over the build through a falling low-pass.
  inputs.push('-i',a); const ia=n++
  // B: city cue from its build; the high-pass opens across the build, drums on the cut.
  inputs.push('-ss',cityFileStart.toFixed(3),'-i',b); const ib=n++
  // C: guzheng outro under the logo.
  inputs.push('-ss',String(GUZHENG_OUTRO),'-i',a); const ic=n++
  const sfx = name=>`${dir}/music/sfx-${name}.wav`
  const riserAt = dropAt - 8*P, risePos = clips.at(-1).b + (portrait?1.2:1.6)
  inputs.push('-i',sfx('riser')); const ir=n++; inputs.push('-i',sfx('impact')); const ii=n++; inputs.push('-i',sfx('whoosh')); const iw=n++
  f.push(`[${ir}:a]volume=0.32,adelay=${ms(riserAt)}|${ms(riserAt)}[sr]`,
    `[${ii}:a]volume=0.55,adelay=${ms(dropAt)}|${ms(dropAt)}[si]`,
    `[${iw}:a]volume=0.30,adelay=${ms(risePos)}|${ms(risePos)}[sw]`)
  f.push(
    `[${ia}:a]atrim=0:${(dropAt+.3).toFixed(3)},asetpts=PTS-STARTPTS,`+
      `lowpass=f=1800:enable='gte(t,${cityStart.toFixed(3)})',lowpass=f=700:enable='gte(t,${(cityStart+sweep*.6).toFixed(3)})',`+
      `afade=t=in:st=0:d=1.5,afade=t=out:st=${cityStart.toFixed(3)}:d=${(sweep+.3).toFixed(3)}:curve=qsin[ga]`,
    `[${ib}:a]atrim=0:${(cityEnd-cityStart).toFixed(3)},asetpts=PTS-STARTPTS,`+
      `highpass=f=900:enable='lt(t,${(sweep*.5).toFixed(3)})',highpass=f=300:enable='between(t,${(sweep*.5).toFixed(3)},${(sweep-.05).toFixed(3)})',`+
      `afade=t=in:st=0:d=${(sweep*.85).toFixed(3)}:curve=qsin,afade=t=out:st=${(cityEnd-cityStart-2.6).toFixed(3)}:d=2.6:curve=qsin,`+
      `adelay=${ms(cityStart)}|${ms(cityStart)}[cb]`,
    `[${ic}:a]atrim=0:${(total-e0+.5).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=1.6:curve=qsin,afade=t=out:st=${(total-e0-1.6).toFixed(3)}:d=1.5,`+
      `adelay=${ms(e0+.6)}|${ms(e0+.6)}[go]`,
    `[ga][cb][go][sr][si][sw]amix=inputs=6:normalize=0:duration=longest,atrim=0:${total.toFixed(3)},loudnorm=I=-16.5:TP=-1.5:LRA=9[aout]`)
  audio.push('-map','[aout]','-c:a','aac','-b:a','224k','-ar','48000')
} else console.log('no music — rendering silent')

const outFile = `${dir}/glol-promo-${V}.mp4`
const r = spawnSync('ffmpeg',['-y','-loglevel','error',...inputs,'-filter_complex',f.join(';'),'-map','[vout]',...audio,
  '-c:v','libx264','-preset',opt.draft?'veryfast':'medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart','-t',total.toFixed(3),outFile],{stdio:'inherit'})
if(r.status)throw Error('ffmpeg failed')
console.log(outFile,`${total.toFixed(2)}s; drums on the cut at ${dropAt.toFixed(2)}s; ending from ${e0.toFixed(2)}s`)
console.log(clips.map(c=>`${c.id}@${c.b.toFixed(2)}`).join(' '))
