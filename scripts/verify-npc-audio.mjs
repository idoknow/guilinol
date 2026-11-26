import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const bundle=await build({loader:{'.css':'empty'},stdin:{contents:`import {interactions} from './web/src/traffic/interactions';import {NPC_VOICE_PAUSED,npcDefaults} from './lib/npc';import {Scene,PerspectiveCamera} from 'three';import {setMasterVolume,setRideSoundMuted} from './web/src/walk/ride-sound-pref';Object.assign(window,{interactions,NPC_VOICE_PAUSED,npcDefaults,Scene,PerspectiveCamera,setMasterVolume,setRideSoundMuted})`,resolveDir:process.cwd()},bundle:true,write:false})
const browser=await chromium.launch(browserOptions())
try{
  const page=await browser.newPage();await page.route('http://fixture.test/',route=>route.fulfill({contentType:'text/html',body:'<body></body>'}));await page.goto('http://fixture.test/');await page.addScriptTag({content:bundle.outputFiles[0].text})
  const result=await page.evaluate(async()=>{
    const gains=[],lines=[],forcedLines=[];let horns=0,oscStarts=0,cancels=0,voicesQueried=0,speakingTo=lines
    const create=AudioContext.prototype.createGain,createPanner=AudioContext.prototype.createPanner,start=OscillatorNode.prototype.start
    AudioContext.prototype.createGain=function(){const node=create.call(this);gains.push(node);return node}
    AudioContext.prototype.createPanner=function(){horns++;return createPanner.call(this)}
    OscillatorNode.prototype.start=function(...args){oscStarts++;return start.apply(this,args)}
    Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>{voicesQueried++;return [{lang:'zh-CN'}]},speak:line=>speakingTo.push(line.volume),cancel(){cancels++}}})
    Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{}})
    const effects=interactions(new Scene(),new PerspectiveCamera(),{...npcDefaults,volume:.8}),actors=['car','person'].map(kind=>({kind,x:0,y:0,z:0}))
    setMasterVolume(.25);window.dispatchEvent(new PointerEvent('pointerdown'));await new Promise(done=>setTimeout(done,100))
    const tick=(target,time)=>target.tick(actors,time,.05,undefined,false,()=>0)
    tick(effects,0);tick(effects,46);const quarter=gains[0].gain.value
    setRideSoundMuted(true);tick(effects,92);const muted=gains[0].gain.value
    setRideSoundMuted(false);setMasterVolume(0);tick(effects,138)
    const zero=gains[0].gain.value,defaultHorns=horns,defaultOscStarts=oscStarts
    effects.clear()

    // 模拟数据库历史遗留 mutter: true，验证代码门控仍阻止路人语音播报
    speakingTo=forcedLines
    const forced=interactions(new Scene(),new PerspectiveCamera(),{...npcDefaults,mutter:true,volume:.8})
    setMasterVolume(.25);setRideSoundMuted(false);window.dispatchEvent(new PointerEvent('pointerdown'));await new Promise(done=>setTimeout(done,100))
    tick(forced,0);tick(forced,46)
    const forcedHorns=horns-defaultHorns,forcedOscStarts=oscStarts-defaultOscStarts
    forced.clear()
    return {defaultMutter:npcDefaults.mutter,voicePaused:NPC_VOICE_PAUSED,quarter,muted,zero,lines,forcedLines,voicesQueried,horns:defaultHorns,oscStarts:defaultOscStarts,forcedHorns,forcedOscStarts,cancels}
  })
  assert.equal(result.defaultMutter,false)
  assert.equal(result.voicePaused,true)
  assert.equal(result.quarter,.25)
  assert.equal(result.muted,0)
  assert.equal(result.zero,0)
  assert.deepEqual(result.lines,[])
  assert.deepEqual(result.forcedLines,[])
  assert.equal(result.voicesQueried,0)
  assert.equal(result.horns,1)
  assert.equal(result.oscStarts,2)
  assert.equal(result.forcedHorns,1)
  assert.equal(result.forcedOscStarts,2)
  assert.equal(result.cancels,0)
  console.log(result)
}finally{await browser.close()}
