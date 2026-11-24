import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const bundle=await build({stdin:{contents:`import {interactions} from './web/src/traffic/interactions';import {npcDefaults} from './lib/npc';import {Scene,PerspectiveCamera,Vector3} from 'three';Object.assign(window,{interactions,npcDefaults,Scene,PerspectiveCamera,Vector3})`,resolveDir:process.cwd()},bundle:true,write:false})
const browser=await chromium.launch(browserOptions())
try{
  const page=await browser.newPage();await page.setContent('<body></body>');await page.addScriptTag({content:bundle.outputFiles[0].text})
  const counts=await page.evaluate(()=>{
    const scene=new Scene(),camera=new PerspectiveCamera(60,1,.1,100);camera.position.set(0,2,6);camera.updateMatrixWorld()
    const effects=interactions(scene,camera,{...npcDefaults,horn:false,mutter:false}),events=[]
    window.addEventListener('crowd:bump',event=>events.push(event.detail))
    const actor={x:0,y:0,z:0,kind:'person',speed:0,track:{dx:1,dz:0}},player=new Vector3()
    const tick=(time,x,dt)=>{player.set(x,1,0);effects.tick([actor],time,dt,player,false,()=>0);return [events.length,document.querySelectorAll('.npc-bubble:not([hidden]) > .npc-bubble__text').length]}
    tick(0,-1,1);const slow=tick(1,-.5,1),fast=tick(1.25,0,.25),cooldown=tick(1.5,-.5,.25),expired=tick(4.1,-.5,2.6),again=tick(8,0,.25)
    return {slow,fast,cooldown,expired,again}
  });assert.deepEqual(counts,{slow:[0,0],fast:[1,1],cooldown:[1,1],expired:[1,0],again:[2,1]});console.log(counts)
}finally{await browser.close()}
