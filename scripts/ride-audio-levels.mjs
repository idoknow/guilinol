// Offline loudness check for the procedural ride audio (IDOK-212).
// Renders each scenario through the real engine in Chromium with an
// OfflineAudioContext stand-in and prints RMS / peak / sub-150 Hz RMS in dBFS.
//   node scripts/ride-audio-levels.mjs [engine.ts] [--json]
import {build} from 'esbuild'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const entry=process.argv.slice(2).find(arg=>!arg.startsWith('--'))??'web/src/walk/ebike-audio.ts'
const bundle=await build({entryPoints:[entry],bundle:true,write:false,format:'iife',globalName:'RideAudio',target:'es2020'})
const code=bundle.outputFiles[0].text+';window.RideAudio=RideAudio'

const SR=48000
const scenarios={
  // 25 km/h e-bike cruise with half throttle: the hum the feedback is about.
  cruise:{seconds:4,run:'cruise'},
  // Full-throttle 35 km/h.
  sprint:{seconds:4,run:'sprint'},
  // Horn held 1 s.
  horn:{seconds:1.5,run:'horn'},
  // Deep lean warning beeps.
  leanWarn:{seconds:2,run:'lean'},
  // 8 m/s crash.
  crash:{seconds:1.5,run:'crash'},
}

const browser=await chromium.launch(browserOptions())
const rows={}
try{
  const page=await browser.newPage()
  await page.setContent('<!doctype html><title>ride audio</title>')
  for(const [name,s] of Object.entries(scenarios)){
    rows[name]=await page.evaluate(async({code,SR,seconds,run})=>{
      let ctx=null
      class Fake extends OfflineAudioContext{
        constructor(){super(1,Math.round(SR*seconds),SR);ctx=this}
        get state(){return 'running'}
        resume(){return Promise.resolve()}
        close(){return Promise.resolve()}
      }
      window.AudioContext=Fake
      new Function(code)()
      const engine=window.RideAudio.createEbikeAudioEngine()
      if(engine.muted)engine.setMuted(false)
      await engine.prepare()
      engine.unlock()
      const base={active:true,rideKind:'bike',braking:false,parked:false,leanRisk:0,dt:1/60}
      if(run==='cruise')engine.updateContinuous({...base,speed:25/3.6,throttle:.5})
      if(run==='sprint')engine.updateContinuous({...base,speed:35/3.6,throttle:1})
      if(run==='horn')engine.setHorn(true,'bike')
      if(run==='lean')engine.updateContinuous({...base,speed:8,throttle:.3,leanRisk:.95})
      if(run==='crash')engine.playCrashImpact(8)
      const data=(await ctx.startRendering()).getChannelData(0)
      // skip the first 0.5 s of the continuous scenarios (gain ramp-in)
      const from=run==='cruise'||run==='sprint'?Math.round(SR*.5):0
      let sum=0,peak=0,low=0,lowSum=0,n=0
      const a=Math.exp(-2*Math.PI*150/SR) // one-pole low-pass, 4 cascaded poles
      const lp=[0,0,0]
      for(let i=0;i<data.length;i++){
        const x=data[i]
        lp[0]=(1-a)*x+a*lp[0];lp[1]=(1-a)*lp[0]+a*lp[1];lp[2]=(1-a)*lp[1]+a*lp[2];low=(1-a)*lp[2]+a*low
        if(i<from)continue
        sum+=x*x;lowSum+=low*low;peak=Math.max(peak,Math.abs(x));n++
      }
      const db=v=>v>0?+(20*Math.log10(v)).toFixed(1):-Infinity
      return {rmsDb:db(Math.sqrt(sum/n)),peakDb:db(peak),sub150RmsDb:db(Math.sqrt(lowSum/n))}
    },{code,SR,seconds:s.seconds,run:s.run})
  }
}finally{await browser.close()}
if(process.argv.includes('--json'))console.log(JSON.stringify(rows))
else console.table(rows)
