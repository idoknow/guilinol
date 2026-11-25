import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const bundle=await build({stdin:{contents:`import {interactions} from './web/src/traffic/interactions';import {npcDefaults} from './lib/npc';import {Scene,PerspectiveCamera} from 'three';import {setMasterVolume,setRideSoundMuted} from './web/src/walk/ride-sound-pref';Object.assign(window,{interactions,npcDefaults,Scene,PerspectiveCamera,setMasterVolume,setRideSoundMuted})`,resolveDir:process.cwd()},bundle:true,write:false})
const browser=await chromium.launch(browserOptions())
try{
  const page=await browser.newPage();await page.route('http://fixture.test/',route=>route.fulfill({contentType:'text/html',body:'<body></body>'}));await page.goto('http://fixture.test/');await page.addScriptTag({content:bundle.outputFiles[0].text})
  const result=await page.evaluate(async()=>{
    const gains=[],lines=[];let starts=0,cancels=0
    const create=AudioContext.prototype.createGain,start=OscillatorNode.prototype.start
    AudioContext.prototype.createGain=function(){const node=create.call(this);gains.push(node);return node}
    OscillatorNode.prototype.start=function(...args){starts++;return start.apply(this,args)}
    Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{lang:'zh-CN'}],speak:line=>lines.push(line.volume),cancel(){cancels++}}})
    Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{}})
    const effects=interactions(new Scene(),new PerspectiveCamera(),{...npcDefaults,volume:.8}),actors=['car','person'].map(kind=>({kind,x:0,y:0,z:0}))
    setMasterVolume(.25);window.dispatchEvent(new PointerEvent('pointerdown'));await new Promise(done=>setTimeout(done,100))
    const tick=time=>effects.tick(actors,time,.05,undefined,false,()=>0)
    tick(0);tick(46);const quarter=gains[0].gain.value
    setRideSoundMuted(true);tick(92);const muted=gains[0].gain.value
    setRideSoundMuted(false);setMasterVolume(0);tick(138)
    return {quarter,muted,zero:gains[0].gain.value,lines,starts,cancels}
  });assert.equal(result.quarter,.25);assert.equal(result.muted,0);assert.equal(result.zero,0);assert.deepEqual(result.lines,[.2]);assert.equal(result.starts,1);assert.ok(result.cancels>0);console.log(result)
}finally{await browser.close()}
