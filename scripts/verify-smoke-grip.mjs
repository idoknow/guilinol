// Capture actual game poses with the simulation paused between fixed steps.
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'
import {telemetryPreview} from './telemetry-preview.mjs'

const site=await preview({root:'web',configFile:'web/vite.config.ts',plugins:[telemetryPreview],preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch(browserOptions(true))
  for(const view of ['first','third']){
    const page=await browser.newPage({viewport:{width:1440,height:900}})
    const dir='captures/smoke-grip/'+view
    await mkdir(dir,{recursive:true})
    await page.addInitScript(view=>{
      localStorage.setItem('glol.prefs',JSON.stringify({view}))
      localStorage.setItem('glol.save.v1',JSON.stringify({schemaVersion:2,money:200,packs:[{brand:'yidianhong',remaining:20}]}))
    },view)
    await page.goto('http://127.0.0.1:'+site.httpServer.address().port+'/?verify&mode=walk&flow=0')
    await page.waitForFunction(()=>window.viewer?.walk?.active && !document.body.hasAttribute('data-home') && ![1,2].includes(window.__loading?.level),null,{timeout:90000})
    await page.evaluate(()=>window.viewer.freeze())
    await page.keyboard.press('3')
    const step=n=>page.evaluate(n=>{
      for(let i=0;i<n;i++)window.viewer.walk.tick(1/60)
    },n)
    async function shot(name,framing){
      const report=await page.evaluate(({framing,view})=>{
        const {camera:c,walk}=window.viewer,scene=c.parent
        scene.updateMatrixWorld(true)
        const figure=scene.getObjectByName('smoke-kit').parent
        const pack=figure.getObjectByName('smoke-pack'),lid=pack.getObjectByName('smoke-lid')
        const v=(x=0,y=0,z=0)=>c.position.clone().set(x,y,z)
        const world=(obj)=>obj.getWorldPosition(v())
        const joint=(name)=>world(figure.getObjectByName(name))
        const fingertip=(digit,side)=>joint(digit+'_03_'+side).lerp(joint(digit+'_04_leaf_'+side),digit==='thumb'?.90:.78)
        const thumb=fingertip('thumb','r')
        const lip=lid.localToWorld(v(.011,-.0135,.024))
        const info={phase:walk.probe().smoke.phase,angle:-lid.rotation.x*180/Math.PI,
          thumbMm:1000*thumb.distanceTo(lip),pads:['thumb','index','middle','ring','pinky'].map(d=>pack.worldToLocal(fingertip(d,'l')).multiplyScalar(1000).toArray().map(Math.round))}
        if(framing==='native'){
          // Use posed skin vertices, not the leaf bones beyond the fingertip.
          // Each value is the nearest signed distance to the pack surface (mm).
          const contacts={}
          figure.traverse(mesh=>{
            if(!mesh.isSkinnedMesh||mesh.name.includes('outline'))return
            const skin=mesh.geometry.getAttribute('skinIndex')
            for(let i=0;i<skin.count;i++){
              const bone=mesh.skeleton.bones[skin.getX(i)]?.name
              const digit=/^(thumb|index|middle|ring|pinky)_03_l$/.exec(bone)?.[1]
              if(!digit)continue
              const p=pack.worldToLocal(mesh.localToWorld(mesh.getVertexPosition(i,v()))).multiplyScalar(1000)
              const distance=Math.max(Math.abs(p.x)-29,Math.abs(p.z)-11.5,Math.abs(p.y)-42)
              contacts[digit]=Math.min(contacts[digit]??Infinity,distance)
            }
          })
          info.contacts=contacts
        }
        const origin=c.position.clone(),orientation=c.quaternion.clone(),near=c.near
        window.restoreProof=()=>{c.position.copy(origin);c.quaternion.copy(orientation);c.near=near;c.updateProjectionMatrix();c.updateMatrixWorld(true)}
        if(framing==='walk'){
          const center=figure.localToWorld(v(0,.95,0))
          c.position.copy(figure.localToWorld(v(1.8,1.32,1.0)))
          c.lookAt(center)
          info.position=walk.probe().figPos
          info.speed=walk.probe().planarSpeed
          const plume=scene.getObjectByName('smoke-plume')
          const offsets=plume.geometry.getAttribute('aOffset'),alpha=plume.geometry.getAttribute('aAlpha')
          const mouth=world(figure.getObjectByName('smoke-lips'))
          const travel=figure.localToWorld(v(0,0,-1)).sub(world(figure)).normalize()
          info.trail=Math.max(...Array.from({length:alpha.count},(_,i)=>alpha.getX(i)>.06
            ?mouth.clone().sub(v().fromBufferAttribute(offsets,i)).dot(travel):0))
          info.puff=walk.probe().smoke.puff
        }else if(framing!=='native'){
          const target=framing==='joints'?joint('index_02_r').lerp(joint('middle_02_r'),.45):world(pack)
          if(framing==='lid')target.lerp(lip,.53)
          if(view==='first'){
            const toward=c.position.clone().sub(target).normalize()
            c.position.copy(target).addScaledVector(toward,framing==='joints'?.16:.20)
          }else{
            const side=framing==='joints'?v(-.075,.062,.144):v(-.105,.088,.142)
            c.position.copy(target).add(side.applyQuaternion(pack.getWorldQuaternion(c.quaternion.clone())))
          }
          c.lookAt(target)
          info.distance=c.position.distanceTo(target)
        }
        c.near=.004;c.updateProjectionMatrix();c.updateMatrixWorld(true)
        window.viewer.redrawGfx()
        return info
      },{framing,view})
      console.log(view,name,JSON.stringify(report))
      try{await page.screenshot({path:dir+'/'+name+'.jpg',quality:92})}
      finally{await page.evaluate(()=>window.restoreProof())}
      if(framing==='native'){
        const gaps=Object.values(report.contacts)
        assert(gaps.length===5 && gaps.every(d=>Math.abs(d)<1),JSON.stringify(report.contacts))
      }
      return report
    }
    await step(1)
    await page.waitForFunction(()=>{
      const pack=window.viewer.camera.parent.getObjectByName('smoke-pack')
      return !!pack?.children[0].material[4].map.image?.naturalWidth
    })
    for(const [frames,angle] of [[23,0],[14,50],[16,106]]){
      await step(frames)
      const r=await shot('lid-'+angle,'lid')
      assert(Math.abs(r.angle-angle)<5 && r.thumbMm<5,JSON.stringify(r))
      for(const [x,,z] of r.pads.slice(1))assert(x>=-6 && x<28 && z>=13 && z<=16,JSON.stringify(r))
      assert(r.pads[0][0]<-29 && r.pads[0][0]>=-34,JSON.stringify(r))
    }
    await step(20)
    if(view==='first')await shot('sealed-grip','native')
    await page.keyboard.press('f');await step(20)
    if(view==='first')await shot('tear-grip','native')
    await step(40)
    const r=await shot('pinch-joints','joints')
    assert(r.distance<=.25)
    if(view==='first')await shot('open-grip','native')
    if(view==='third'){
      await page.keyboard.press('f');await step(100)
      await page.keyboard.press('f');await step(100)
      await page.evaluate(()=>window.viewer.walk.drive(0,-1,false))
      await step(60)
      const a=await shot('walk-0','walk')
      await step(30)
      const b=await shot('walk-500ms','walk')
      assert(a.trail>.4 && b.trail>.4 && a.speed>1 && b.speed>1 && Math.hypot(a.position[0]-b.position[0],a.position[2]-b.position[2])>.6)
      await page.keyboard.press('f');await step(20)
      await shot('walking-puff','walk')
      assert(await page.evaluate(()=>window.viewer.walk.probe().smoke.puff>.5))
    }
    if(view==='first'){
      // A consumed pack re-enters directly at the pickup prompt.
      await page.keyboard.press('f');await step(100)
      await page.keyboard.press('3');await step(10)
      await page.keyboard.press('3');await step(90)
      assert.equal((await shot('reopened-grip','native')).phase,'open')
    }
    await page.close()
  }
}finally{await browser?.close();await new Promise(resolve=>site.httpServer.close(resolve))}
