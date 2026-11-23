// IDOK-159 promo film renderer: deterministic frame-by-frame capture of scripted shots.
//
//   node scripts/promo/render.mjs --variant h            # every landscape shot, 1920x1080 @30
//   node scripts/promo/render.mjs --variant v --shots s07,s10
//   node scripts/promo/render.mjs --still 0,.5,1 --scale .5   # storyboard frames only
//
// Time is virtual (Playwright clock): every output frame advances the world by exactly 1/fps, so
// traffic, water and rain move at real speed no matter how slow the GPU is. Frames are read back
// from the WebGL canvas (preserveDrawingBuffer forced on) — page.screenshot would wait on a real
// requestAnimationFrame that the fake clock never delivers.
// Needs `npm run build` and public/world (see docs/deploy-hk.md). On a Mac set QA_NATIVE_GPU=1.
import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir, writeFile, rm} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {parseArgs} from 'node:util'
import {browserOptions} from '../qa-browser.mjs'
import {shots, variants} from './shots.mjs'

const {values:opt} = parseArgs({options:{
  variant:{type:'string',default:'h'}, shots:{type:'string'}, still:{type:'string'}, scale:{type:'string',default:'1'},
  fps:{type:'string',default:'30'}, out:{type:'string',default:'captures/promo'}, keep:{type:'boolean',default:false},
}})
const variant = variants[opt.variant]; if(!variant) throw Error(`unknown variant ${opt.variant}`)
const fps = Number(opt.fps), scale = Number(opt.scale)
const width = Math.round(variant.width*scale/2)*2, height = Math.round(variant.height*scale/2)*2
const wanted = opt.shots ? opt.shots.split(',') : variant.shots
const stills = opt.still?.split(',').map(Number)
const out = `${opt.out}/${opt.variant}`
await mkdir(out,{recursive:true})

// ---- camera path maths (Catmull-Rom through keys, eased in time) ----------------------------
const lerp = (a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t)
const ease = {linear:t=>t, inout:t=>t*t*(3-2*t), out:t=>1-(1-t)*(1-t), in:t=>t*t}
function catmull(p0,p1,p2,p3,t){const t2=t*t,t3=t2*t
  return p1.map((_,i)=>.5*(2*p1[i]+(-p0[i]+p2[i])*t+(2*p0[i]-5*p1[i]+4*p2[i]-p3[i])*t2+(-p0[i]+3*p1[i]-3*p2[i]+p3[i])*t3))}
function sample(keys,u,field){
  if(keys.length===1)return keys[0][field]
  const times = keys.map((k,i)=>k.t??i/(keys.length-1))
  let i=0; while(i<keys.length-2&&u>times[i+1])i++
  const local = Math.min(1,Math.max(0,(u-times[i])/((times[i+1]-times[i])||1)))
  const p=j=>keys[Math.max(0,Math.min(keys.length-1,j))][field]
  return catmull(p(i-1),p(i),p(i+1),p(i+2),local)
}
function pose(shot,u){
  const keys = (opt.variant==='v'&&shot.v?.keys)||shot.keys
  const e = ease[shot.ease??'inout'](u)
  const hour = Array.isArray(shot.hour) ? shot.hour[0]+(shot.hour[1]-shot.hour[0])*e : shot.hour
  const fov = (opt.variant==='v'&&shot.v?.fov)||shot.fov||(opt.variant==='v'?variant.fov:50)
  return {eye:sample(keys,e,'eye'),look:sample(keys,e,'look'),hour,fov}
}

// ---- browser ----------------------------------------------------------------------------------
const server = await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const base = `http://127.0.0.1:${server.httpServer.address().port}/`
const browser = await chromium.launch(browserOptions())
const hideUi = 'body>*:not(canvas){display:none!important}canvas{display:block!important}'

async function openPage(shot){
  const page = await browser.newPage({viewport:{width,height},deviceScaleFactor:1})
  page.on('pageerror',e=>console.log(`[${shot.id}] pageerror`,e.message))
  await page.addInitScript(()=>{
    const get = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function(type,o){if(/webgl/.test(type))o={...(o||{}),preserveDrawingBuffer:true};return get.call(this,type,o)}
    localStorage.setItem('glol.stamps','[]')
  })
  await page.clock.install({time:new Date('2026-11-23T08:00:00+08:00')})
  const hour0 = Array.isArray(shot.hour)?shot.hour[0]:shot.hour
  const params = new URLSearchParams({verify:'',traffic:shot.traffic===false?'0':'1',flow:'0',time:String(hour0),weather:shot.weather??'clear',radius:String(shot.radius??900)})
  if(shot.ride) params.set('mode','walk')
  await page.goto(base+'?'+params.toString().replace('verify=','verify'))
  await pumpUntil(page,()=>window.viewer?.stats.firstMs>0,'first frame',180000)
  if(shot.ride) await pumpUntil(page,()=>window.viewer.walk?.active&&window.viewer.walk.parked().length>0,'walker',120000)
  return page
}
async function pumpUntil(page,fn,what,timeout=90000,arg){
  const end = Date.now()+timeout
  while(Date.now()<end){
    await page.clock.runFor(34)
    if(await page.evaluate(fn,arg).catch(()=>false))return true
    await new Promise(r=>setTimeout(r,25))
  }
  console.log(`  ! ${what} not reached in ${timeout/1000}s, continuing`)
  return false
}
const idle = ()=>{const v=window.viewer;return !v.stats.pending&&!(v.stream.forest?.pending?.size)}
async function settle(page,minFrames=3,timeout=60000){
  for(let i=0;i<minFrames;i++)await page.clock.runFor(34)
  await pumpUntil(page,idle,'stream idle',timeout)
}
async function applyPose(page,p,weather){
  await page.evaluate(([p,weather])=>{
    const {camera,clock} = window.viewer
    camera.position.set(...p.eye); camera.lookAt(...p.look)
    if(camera.fov!==p.fov){camera.fov=p.fov;camera.updateProjectionMatrix()}
    camera.layers.disable(2)                          // spot seals and rings (play/index.ts MARK_LAYER)
    camera.updateMatrixWorld()
    clock.hour=p.hour; clock.weather=weather; clock.flowing=false; clock.goal=null; clock.blendMs=1
  },[p,weather])
}
async function grab(page,file){
  const data = await page.evaluate(()=>document.querySelector('canvas').toDataURL('image/png'))
  await writeFile(file,Buffer.from(data.slice(data.indexOf(',')+1),'base64'))
}

// Keys may give height above ground as a string ('+1.7'): resolve against the walkable surface.
async function groundKeys(page,shot){
  for(const keys of [shot.keys,shot.v?.keys])for(const k of keys??[])for(const f of ['eye','look']){
    if(typeof k[f][1]!=='string')continue
    const [x,,z]=k[f]
    await page.evaluate(([x,z])=>{const c=window.viewer.camera;c.position.set(x,600,z);c.lookAt(x,0,z+.01);c.updateMatrixWorld()},[x,z])
    await settle(page,3,30000)
    const y=await page.evaluate(()=>{const d=window.viewer.probeFoot().clearance;return d==null?null:600-d})
    k[f]=[x,(y??150)+Number(k[f][1]),z]; console.log(`  ground ${f} ${x},${z} -> ${y?.toFixed(1)}`)
  }
}

// ---- riding: steer the real walker/vehicle along waypoints, film it with our own camera --------
async function mount(page,shot){
  const kind = shot.ride.vehicle
  const parked = await page.evaluate(([k,[x,z]])=>[...window.viewer.walk.parked(k)].sort((a,b)=>Math.hypot(a[0]-x,a[2]-z)-Math.hypot(b[0]-x,b[2]-z))[0],[kind,shot.ride.parkNear])
  if(!parked)throw Error(`no parked ${kind}`)
  await page.evaluate(([x,z])=>window.viewer.walkTo(x,z,0,'promo'),[parked[0],parked[2]])
  await settle(page,10)
  const label = kind==='car'?'车':'车'
  for(let i=0;i<40;i++){
    await page.keyboard.press('f'); await page.clock.runFor(200)
    if(await page.evaluate(()=>window.viewer.walk.vehicle!=='foot'))break
  }
  const v = await page.evaluate(()=>window.viewer.walk.vehicle); if(v==='foot')throw Error(`could not mount ${kind} (${label})`)
  await page.addStyleTag({content:hideUi})
  // From here the game no longer advances the walker; drive() does, one fixed step per frame.
  await page.evaluate(()=>{const w=window.viewer.walk;w.__advance=w.tick;w.tick=()=>{}; if(w.ebike?.setHeadlight)w.ebike.setHeadlight('on'); w.car?.setHeadlight?.('on')})
}
// One frame of riding: hold keys to steer toward the next waypoint, return the rider pose.
async function drive(page,shot,dt){
  // Same steering as scripts/ride-route.mjs (tested over Jiefang Bridge), plus its stuck detour.
  return page.evaluate(([route,speed,dt])=>{
    const w=window.viewer.walk, s=(w.__route??={i:0,keys:new Set(),n:0,check:null,detour:0,attempt:0})
    const press=(code,on)=>{if(s.keys.has(code)===on)return;window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}));on?s.keys.add(code):s.keys.delete(code)}
    let pos=w.position.clone()
    while(s.i<route.length-1&&Math.hypot(route[s.i][0]-pos.x,route[s.i][1]-pos.z)<3)s.i++
    const [x,z]=route[s.i],dx=x-pos.x,dz=z-pos.z,gap=Math.hypot(dx,dz)
    s.n++; if(s.n%48===0){if(s.check&&Math.hypot(s.check[0]-pos.x,s.check[1]-pos.z)<.8){s.attempt++;s.detour=s.n+48}s.check=[pos.x,pos.z]}
    const offset=s.n<s.detour?(s.attempt%2?1:-1)*1.1:0
    const angle=Math.atan2(-dx,-dz)+offset-w.heading,err=Math.atan2(Math.sin(angle),Math.cos(angle))
    press('KeyA',err>.035);press('KeyD',err<-.035)
    const last=s.i>=route.length-1, want=Math.abs(err)>.4?speed*.3:last?Math.min(speed,1.8+gap*.5):speed
    press('KeyW',w.speed<want);press('KeyS',w.speed>want+.3)
    for(let k=0;k<2;k++)w.__advance(dt/2)
    pos=w.position.clone()
    return {x:pos.x,y:pos.y,z:pos.z,heading:w.heading,speed:w.speed,done:last&&gap<3}
  },[shot.ride.route,shot.ride.speed/3.6,dt])
}
// Chase/track camera relative to the rider, smoothed so steering wobble doesn't shake the frame.
function rideCam(shot,rider,prev,u){
  const c = (opt.variant==='v'&&shot.v?.cam)||shot.ride.cam
  const at = k=>Array.isArray(c[k])&&Array.isArray(c[k][0]) ? lerp(c[k][0],c[k][1],ease.inout(u)) : c[k]
  const [back,up,side] = at('offset'), [ahead,lookUp] = at('look')
  const fx=-Math.sin(rider.heading),fz=-Math.cos(rider.heading),rx=-fz,rz=fx
  const eye=[rider.x-fx*back+rx*side, rider.y+up, rider.z-fz*back+rz*side]
  const look=[rider.x+fx*ahead, rider.y+lookUp, rider.z+fz*ahead]
  if(!prev)return {eye,look}
  const k=shot.ride.smooth??.25
  return {eye:lerp(prev.eye,eye,k),look:lerp(prev.look,look,k)}
}

// ---- main loop ------------------------------------------------------------------------------
const list = wanted.map(id=>{const s=shots.find(s=>s.id===id);if(!s)throw Error(`unknown shot ${id}`);return s})
for(const shot of list){
  const t0=Date.now(), dur=(opt.variant==='v'&&shot.v?.dur)||shot.dur, frames=Math.round(dur*fps)
  console.log(`${shot.id} ${shot.title} ${dur}s ${frames}f ${width}x${height}`)
  const page = await openPage(shot)
  await groundKeys(page,shot)
  const dir = `${out}/${shot.id}`; await rm(dir,{recursive:true,force:true}); await mkdir(dir,{recursive:true})
  const weather = shot.weather??'clear'
  if(!shot.ride){
    await page.addStyleTag({content:hideUi})
    // Warm the stream along the whole path so nothing pops in mid-shot.
    for(const u of [1,.75,.5,.25,0]){await applyPose(page,pose(shot,u),weather);await settle(page,4)}
    for(let i=0;i<30;i++)await page.clock.runFor(1000/fps)       // let traffic and rain spread out
    const at = stills ?? [...Array(frames).keys()].map(f=>f/(frames-1))
    for(const [n,u] of at.entries()){
      await applyPose(page,pose(shot,u),weather)
      await page.clock.runFor(1000/fps)
      if(stills||n%15===0)await pumpUntil(page,idle,'stream idle',stills?60000:20000)
      await grab(page,stills?`${out}/${shot.id}-${String(u).replace('.','')}.png`:`${dir}/${String(n).padStart(4,'0')}.png`)
    }
  } else {
    console.log('  loaded',((Date.now()-t0)/1000).toFixed(0)+'s')
    await mount(page,shot)
    console.log('  mounted',await page.evaluate(()=>[window.viewer.walk.vehicle,...window.viewer.walk.position.toArray().map(Math.round)]),((Date.now()-t0)/1000).toFixed(0)+'s')
    // Pre-roll: ride the lead-in unfilmed so the shot starts at speed.
    let rider, cam
    for(let i=0;i<Math.round((shot.ride.preroll??2)*fps);i++){rider=await drive(page,shot,1/fps);if(i%10===0)await page.evaluate(()=>window.viewer.stream.tick(window.viewer.walk.position))}
    console.log('  preroll end',rider&&[rider.x,rider.z,rider.speed*3.6].map(Math.round),((Date.now()-t0)/1000).toFixed(0)+'s')
    const hour = Array.isArray(shot.hour)?shot.hour[0]:shot.hour
    const ats = new Set((stills??[]).map(u=>Math.round(u*(frames-1))))
    for(let f=0;f<frames;f++){
      const u=f/(frames-1)
      rider=await drive(page,shot,1/fps)
      cam=rideCam(shot,rider,cam,u)
      const h=Array.isArray(shot.hour)?shot.hour[0]+(shot.hour[1]-shot.hour[0])*u:hour
      if(stills&&!ats.has(f))continue
      await applyPose(page,{...cam,hour:h,fov:(opt.variant==='v'&&shot.v?.fov)||shot.fov||(opt.variant==='v'?variant.fov:50)},weather)
      await page.clock.runFor(1000/fps)
      if(f%15===0||stills)await pumpUntil(page,idle,'stream idle',stills?60000:20000)
      await grab(page,stills?`${out}/${shot.id}-${String(u.toFixed(2)).replace('.','')}.png`:`${dir}/${String(f).padStart(4,'0')}.png`)
    }
    console.log(`  rider end ${rider.x.toFixed(0)},${rider.z.toFixed(0)} ${(rider.speed*3.6).toFixed(0)}km/h${rider.done?' (route done)':''}`)
  }
  await page.close()
  if(!stills){
    const r=spawnSync('ffmpeg',['-y','-loglevel','error','-framerate',String(fps),'-i',`${dir}/%04d.png`,'-c:v','libx264','-preset','slow','-crf','12','-pix_fmt','yuv420p',`${out}/${shot.id}.mp4`],{stdio:'inherit'})
    if(r.status)throw Error(`ffmpeg failed for ${shot.id}`)
    if(!opt.keep)await rm(dir,{recursive:true,force:true})
  } else await rm(dir,{recursive:true,force:true})
  console.log(`  done in ${((Date.now()-t0)/1000).toFixed(0)}s`)
}
await browser.close(); await server.close()
