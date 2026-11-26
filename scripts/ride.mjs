import {browserOptions, recordFrames} from './qa-browser.mjs'
import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {gunzipSync,gzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {rideToCrossroads} from './ride-route.mjs'
import {lakeChecks} from './ride-lake.mjs'
import {withFixtureBays} from './ride-fixture-bays.mjs'

const data=JSON.parse(gunzipSync(await readFile('dist/world/vehicles.bin')))
const jiefangBike=[-539,157.1,-95,1.57,0]
const crossroadsBike=[-537,156.5,-76,-1.83,0]
const slopeBike=[-322,146.4,94,-Math.PI/2,0]
// These three route fixtures start at exact poses. Give the synthetic bays
// matching sidewalk cells so real-world roadside snapping does not move them.
const bays=[jiefangBike,crossroadsBike,slopeBike]
const rideVehicles=gzipSync(JSON.stringify({...withFixtureBays(data,bays),bikes:[...data.bikes,...bays]}))
const atlas=JSON.parse(gunzipSync(await readFile('dist/world/atlas.bin')))
const output='captures/ride';await mkdir(output,{recursive:true})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch(browserOptions())
const errors=[]
const bounds=JSON.parse(await readFile('pipeline/vessel-bounds.json','utf8'))
const {bridges,minimum}=data.clearance
assert(bridges.length?minimum>=.3-1e-10:minimum===null)
console.log(`航线经过 ${bridges.length} 座桥；最小净空：${minimum===null?'不适用':minimum.toFixed(3)+' m'}`)
try{
  for(const mobile of [false,true]){
    const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:800,height:450},hasTouch:mobile,isMobile:mobile})
    page.on('pageerror',error=>{errors.push(error.message);console.error(error)})
    if(process.env.TRACE_BRIDGE)page.on('console',message=>{if(message.text().startsWith('bridge-trace'))console.log(mobile?'mobile':'desktop',message.text())})
    await page.route('**/world/vehicles.bin',route=>route.fulfill({body:rideVehicles}))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?mode=walk&verify&radius=480`)
    await page.waitForFunction(()=>window.viewer?.walk?.active && ![1,2].includes(window.__loading?.level),null,{timeout:90000})
    if(mobile)await page.getByRole('button',{name:'竖屏继续'}).tap()
    await recordFrames(page)
    if(!mobile){const boat=await lakeChecks(page,data,output);assert(boat.roof<=bounds.boat.roof+1e-6&&boat.head<=bounds.boat.head+1e-6)}
    async function fixture(x,z){assert(await page.evaluate(([x,z])=>window.viewer.walkTo(x,z,0,'ride-fixture'),[x,z]))}
    await page.waitForFunction(()=>window.viewer?.walk?.parked().length>0)
    async function fixtureNear(x,z,kind){
      const picked=await page.evaluate(([tx,tz,k])=>{
        const list=window.viewer.walk.parked(k)
        return [...list].sort((a,b)=>Math.hypot(a[0]-tx,a[2]-tz)-Math.hypot(b[0]-tx,b[2]-tz))[0]??null
      },[x,z,kind])
      assert(picked,`no parked ${kind??'vehicle'} near ${x},${z}`)
      await fixture(picked[0],picked[2])
      return picked
    }
    const button=page.locator('.vehicle-action')
    async function closeCard(){await page.evaluate(()=>document.querySelector('.spot-card.show .card-close')?.click())}
    async function interact(label){await closeCard();await page.waitForFunction(label=>{const t=document.querySelector('.vehicle-action')?.textContent??'';return t&&!t.startsWith('F ')&&t.includes(label)},label);if(mobile)await button.tap();else await page.keyboard.press('f')}
    async function shot(name){await closeCard();await page.screenshot({path:`${output}/${name}.png`})}
    async function timings(){return page.evaluate(async()=>{const samples=[];for(let frame=0;frame<24;frame++){await new Promise(requestAnimationFrame);samples.push(window.viewer.stats.ms)}return samples.sort((a,b)=>a-b)[12]})}
    const gate=[-588,-212]
    if(!mobile){
      const starterCheck=await page.evaluate(([gx,gz])=>{
        const eb=window.viewer.walk.parked('bike').filter(b=>Math.hypot(b[0]-gx,b[2]-gz)<18)
        const bc=window.viewer.walk.parked('bicycle').filter(b=>Math.hypot(b[0]-gx,b[2]-gz)<18)
        return {ebCount:eb.length,bcCount:bc.length}
      },gate)
      assert(starterCheck.ebCount>=1&&starterCheck.bcCount>=1,`missing starter vehicles near spawn plaza: ${JSON.stringify(starterCheck)}`)
    }
    const bike=jiefangBike
    await fixture(bike[0],bike[2])
    const foot=mobile?0:await timings()
    await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent==='骑电动车')
    if(!mobile){
      const deskKeycapAndTyping=await page.evaluate(()=>{
        const {walk}=window.viewer,btn=document.querySelector('.vehicle-action')
        const shortcut=btn?.getAttribute('aria-keyshortcuts'),text=btn?.textContent,before=btn?getComputedStyle(btn,'::before').content:''
        const host=document.createElement('div')
        host.innerHTML='<input><textarea></textarea><select><option>a</option></select><div contenteditable="true"><span>txt</span></div>'
        document.body.append(host)
        for(const el of host.querySelectorAll('input,textarea,select,[contenteditable],span')){
          el.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF',bubbles:true}))
          walk.tick(1/60)
          el.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyF',bubbles:true}))
        }
        host.remove()
        return {shortcut,text,before,vehicleAfterTyping:walk.vehicle}
      })
      console.log('desktop keycap & typing guard',deskKeycapAndTyping)
      assert.equal(deskKeycapAndTyping.shortcut,'F')
      assert.equal(deskKeycapAndTyping.text,'骑电动车')
      assert.equal(deskKeycapAndTyping.before,'"F"',`desktop ::before should be "F": ${JSON.stringify(deskKeycapAndTyping)}`)
      assert.equal(deskKeycapAndTyping.vehicleAfterTyping,'foot','KeyF inside form/contenteditable should not trigger vehicle interact')
    }
    if(mobile){
      await closeCard()
      const preHud=await page.evaluate(()=>{
        const btn=document.querySelector('.vehicle-action')
        const before=btn?getComputedStyle(btn,'::before').content:''
        const shortcut=btn?.getAttribute('aria-keyshortcuts'),text=btn?.textContent
        const sels=['.walk-ui .joystick','.walk-ui .btn-jump','.walk-ui .btn-view','.vehicle-action','.dock','.sky-ui','output','.hud-me']
        const boxes=sels.map(sel=>{const el=document.querySelector(sel);if(!el)return null;const st=getComputedStyle(el),r=el.getBoundingClientRect()
          return st.display==='none'||st.visibility==='hidden'||el.hasAttribute('hidden')?null:{sel,left:r.left,top:r.top,right:r.right,bottom:r.bottom}}).filter(Boolean)
        const overlaps=[]
        for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j]
          const ox=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)),oy=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))
          if(ox*oy>0)overlaps.push({a:a.sel,b:b.sel,area:+(ox*oy).toFixed(1)})}
        const outOfBounds=boxes.filter(b=>b.left<0||b.top<0||b.right>390.5||b.bottom>844.5)
        return {count:boxes.length,overlaps,outOfBounds,before,shortcut,text}
      })
      console.log('mobile keycap & HUD',{before:preHud.before,shortcut:preHud.shortcut,text:preHud.text,count:preHud.count})
      assert(preHud.count>=8&&preHud.overlaps.length===0&&preHud.outOfBounds.length===0,`mobile pre-mount HUD: ${JSON.stringify(preHud)}`)
      assert.equal(preHud.shortcut,'F')
      assert.equal(preHud.text,'骑电动车')
      assert.equal(preHud.before,'none',`mobile 390x844 ::before should be none: ${JSON.stringify(preHud)}`)
    }
    await interact('骑电动车')
    assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'bike')
    if(!mobile){
      const mountLockSpeed=await page.evaluate(()=>{
        const walker=window.viewer.walk
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}))
        walker.tick(.06);walker.tick(.06)
        const speed=walker.speed
        window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW'}))
        return speed
      })
      assert.equal(mountLockSpeed,0,'0.18s mount transition should lock initial throttle')
    }else{
      const mobileRideCheck=await page.evaluate(async()=>{
        const {walk}=window.viewer, joy=document.querySelector('.walk-ui .joystick')
        for(let i=0;i<5;i++)walk.tick(.06)
        const jumpHidden=getComputedStyle(document.querySelector('.walk-ui .btn-jump')).display==='none'
        const runHidden=!document.querySelector('.walk-ui .btn-run')
        const aboard=document.body.hasAttribute('data-aboard')
        const sels=['.walk-ui .joystick','.walk-ui .btn-view','.vehicle-action','.dock','.sky-ui','output','.hud-me']
        const boxes=sels.map(sel=>{const el=document.querySelector(sel);if(!el)return null;const st=getComputedStyle(el),r=el.getBoundingClientRect()
          return st.display==='none'||st.visibility==='hidden'||el.hasAttribute('hidden')?null:{sel,left:r.left,top:r.top,right:r.right,bottom:r.bottom}}).filter(Boolean)
        const overlaps=[]
        for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j]
          const ox=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)),oy=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))
          if(ox*oy>0)overlaps.push({a:a.sel,b:b.sel,area:+(ox*oy).toFixed(1)})}
        const jr=joy.getBoundingClientRect(),cx=jr.left+jr.width/2,cy=jr.top+jr.height/2
        const pos0=walk.position.clone(),h0=walk.heading
        joy.dispatchEvent(new PointerEvent('pointerdown',{pointerId:21,pointerType:'touch',clientX:cx,clientY:cy,bubbles:true}))
        joy.dispatchEvent(new PointerEvent('pointermove',{pointerId:21,pointerType:'touch',clientX:cx+jr.width*.2,clientY:cy-jr.height*.5,bubbles:true}))
        for(let i=0;i<48;i++)walk.tick(1/60)
        const ringAlpha=getComputedStyle(joy,'::after').borderColor
        const dist=walk.position.distanceTo(pos0),spd=walk.speed,dh=Math.abs(walk.heading-h0)
        joy.dispatchEvent(new PointerEvent('pointerup',{pointerId:21,pointerType:'touch',bubbles:true}))
        return {aboard,jumpHidden,runHidden,overlaps,ringAlpha,dist,spd,dh}
      })
      assert(mobileRideCheck.aboard&&mobileRideCheck.jumpHidden&&mobileRideCheck.runHidden,`mobile buttons not hidden: ${JSON.stringify(mobileRideCheck)}`)
      assert.deepEqual(mobileRideCheck.overlaps,[],`mobile ride HUD overlap: ${JSON.stringify(mobileRideCheck)}`)
      assert(mobileRideCheck.ringAlpha.endsWith(', 0)')||mobileRideCheck.ringAlpha==='transparent',`joystick running ring should stay hidden while riding: ${mobileRideCheck.ringAlpha}`)
      assert(mobileRideCheck.dist>.8&&mobileRideCheck.spd>2&&mobileRideCheck.dh>.08,`mobile stick drive failed: ${JSON.stringify(mobileRideCheck)}`)
      await fixture(crossroadsBike[0],crossroadsBike[2]);await interact('骑电动车')
    }
    async function steer(target,wall=false,arrive=3){return page.evaluate(({target,wall,arrive})=>{
      const walker=window.viewer.walk,keys=new Set(),start=walker.position.clone()
      function press(code,on){if(keys.has(code)===on)return;window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}));if(on)keys.add(code);else keys.delete(code)}
      for(let frame=0;frame<1200;frame++){
        const pos=walker.position,dx=target[0]-pos.x,dz=target[1]-pos.z,angle=Math.atan2(-dx,-dz)-walker.heading,error=Math.atan2(Math.sin(angle),Math.cos(angle))
        if(!wall&&Math.hypot(dx,dz)<arrive)break
        press('KeyA',error>.05);press('KeyD',error<-.05);press('KeyW',Math.abs(error)<.65);walker.tick(1/60)
        if(walker.probe().inHouse||walker.speed>25/3.6+.001)throw Error('unsafe ride')
      }
      for(const key of [...keys])press(key,false)
      const end=walker.position.clone();return {distance:end.distanceTo(start),targetDistance:Math.hypot(end.x-target[0],end.z-target[1]),end:end.toArray(),obstacle:walker.obstacle,speed:walker.speed}
    },{target,wall,arrive})}
    if(!mobile){
      for(const target of [[-552,-95],[-579,-101.5],[-590.4,-104.3],[-606,-108.1]]){
        const result=await steer(target)
        assert(result.targetDistance<3,`Jiefang eastbound lane, target ${target}: ${JSON.stringify(result)}`)
      }
      await interact('下车');await fixture(crossroadsBike[0],crossroadsBike[2]);await interact('骑电动车')
    }
    const ride=await rideToCrossroads(page,atlas);console.log('ride',ride);assert(ride.main>=500&&ride.crossed&&ride.targetDistance<=10)
    await shot(mobile?'bike-mobile':'bike-desktop');if(!mobile)console.log('median frame ms',{foot,bike:await timings()})
    let ebikeSpeed1s=0
    if(!mobile){
      const feelCheck=await page.evaluate(()=>{
        const {walk}=window.viewer, keys=new Set(), target=[-873,-215]
        function press(code,on){if(keys.has(code)===on)return;window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}));if(on)keys.add(code);else keys.delete(code)}
        for(let i=0;i<80;i++){
          const pos=walk.position,dx=target[0]-pos.x,dz=target[1]-pos.z,err=Math.atan2(Math.sin(Math.atan2(-dx,-dz)-walk.heading),Math.cos(Math.atan2(-dx,-dz)-walk.heading))
          press('KeyA',err>.05);press('KeyD',err<-.05);if(Math.abs(err)<.15)break;walk.tick(.06)
        }
        press('KeyA',false);press('KeyD',false)
        press('KeyW',true)
        let minThighR=Infinity,maxThighR=-Infinity,speed1s=0
        for(let i=0;i<40;i++){
          walk.tick(.06)
          if(i===16)speed1s=walk.speed
          if(i>=8){const tr=walk.probe().thighR;minThighR=Math.min(minThighR,tr);maxThighR=Math.max(maxThighR,tr)}
        }
        const peakSpeed=walk.speed, thighRRange=maxThighR-minThighR
        press('KeyW',false)
        const coastStart=walk.position.clone()
        for(let i=0;i<20;i++)walk.tick(.06)
        const coastDist=walk.position.distanceTo(coastStart), coastEndSpeed=walk.speed
        press('KeyS',true);for(let i=0;i<4;i++)walk.tick(.06)
        const brakeSpeed=walk.speed
        press('KeyS',false)
        while(walk.speed>0){walk.tick(.06)}
        press('KeyS',true);walk.tick(.06);walk.tick(.06)
        const tapRevSpeed=walk.speed
        const revStart=walk.position.clone()
        for(let i=0;i<12;i++)walk.tick(.06)
        const revSpeed=walk.speed, revDist=walk.position.distanceTo(revStart), inHouse=walk.probe().inHouse
        press('KeyS',false);walk.tick(.06);press('KeyS',true);walk.tick(.06)
        const repressRevSpeed=walk.speed
        press('KeyS',false)
        return {speed1s,peakSpeed,thighRRange,coastDist,coastEndSpeed,brakeSpeed,tapRevSpeed,revSpeed,repressRevSpeed,revDist,inHouse}
      })
      console.log('ride feel',feelCheck)
      ebikeSpeed1s=feelCheck.speed1s
      assert(feelCheck.peakSpeed>=5.5&&feelCheck.peakSpeed<=25/3.6+1e-4,`accel/cap: ${JSON.stringify(feelCheck)}`)
      assert(feelCheck.thighRRange<.02,`e-bike feet should stay static while riding: ${JSON.stringify(feelCheck)}`)
      assert(feelCheck.coastDist>=2.2&&feelCheck.coastEndSpeed>1.5&&feelCheck.coastEndSpeed<feelCheck.peakSpeed,`coast: ${JSON.stringify(feelCheck)}`)
      assert(feelCheck.brakeSpeed>=0&&feelCheck.brakeSpeed<feelCheck.coastEndSpeed-1.2,`brake: ${JSON.stringify(feelCheck)}`)
      assert(feelCheck.tapRevSpeed===0&&feelCheck.revSpeed<-.5&&feelCheck.revSpeed>=-1.85&&feelCheck.repressRevSpeed<-.3&&feelCheck.revDist>.35&&!feelCheck.inHouse,`reverse: ${JSON.stringify(feelCheck)}`)
    }
    await interact('下车');assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'foot')
    if(!mobile){
      await fixtureNear(189.1,-42);await interact('骑');const escape=await steer([189.1,-52]);console.log('off-pavement escape',escape);assert(escape.distance>4.5&&escape.speed>2&&!escape.obstacle,`off-pavement bike stuck: ${JSON.stringify(escape)}`)
      const roamOut=await steer([176,-34]);console.log('off-pavement >6.5m turn',roamOut);assert(roamOut.distance>10&&roamOut.speed>2&&roamOut.speed<=4.35&&!roamOut.obstacle,`off-pavement >6.5m locked: ${JSON.stringify(roamOut)}`)
      await interact('下车');assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'foot')
      await fixtureNear(-778.5,402.1);await interact('骑');const diag=await steer([-764,398]);console.log('diagonal road edge',diag);assert(diag.distance>10&&diag.speed>2.5&&!diag.obstacle,`diagonal road edge stuck: ${JSON.stringify(diag)}`)
      await interact('下车');assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'foot')
      // Use the next bike in the same row so the line to the wall clears the tree (matches origin/main).
      await fixtureNear(-1610.8,425);await interact('骑');const wall=await steer([-1606.2,418.7],true);console.log('wall',wall);assert(wall.obstacle==='building'&&wall.speed===0&&wall.distance<8)
      await page.evaluate(()=>{const w=window.viewer.walk;w.face(w.heading-.4,.22)})
      await shot('bike-ride-action')
      const wallReverse=await page.evaluate(()=>{
        const w=window.viewer.walk,start=w.position.clone()
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS'}))
        for(let i=0;i<60;i++)w.tick(1/60)
        const speed=w.speed,moved=w.position.distanceTo(start),inHouse=w.probe().inHouse
        window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyS'}))
        return {speed,moved,inHouse}
      })
      console.log('wall reverse escape',wallReverse);assert(wallReverse.speed<-.5&&wallReverse.moved>.5&&!wallReverse.inHouse,`wall reverse stuck: ${JSON.stringify(wallReverse)}`)
      const bikePos=await page.evaluate(()=>window.viewer.walk.position.toArray())
      await interact('下车')
      const dismount=await page.evaluate(bp=>{
        const w=window.viewer.walk,p0=w.probe(),fig0=p0.figPos
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyC'}))
        window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyC'}))
        const figAfterC=w.probe().figPos
        const cJump=Math.hypot(figAfterC[0]-fig0[0],figAfterC[2]-fig0[2])
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}))
        let prev=figAfterC,maxStep=0,inHouse=p0.inHouse
        for(let i=0;i<12;i++){
          w.tick(1/60)
          const p=w.probe(),cur=p.figPos
          maxStep=Math.max(maxStep,Math.hypot(cur[0]-prev[0],cur[2]-prev[2]))
          if(p.inHouse)inHouse=true
          prev=cur
        }
        window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW'}))
        const p1=w.probe(),endGap=Math.hypot(p1.figPos[0]-p1.x,p1.figPos[2]-p1.z)
        return {dist:Math.hypot(p0.x-bp[0],p0.z-bp[2]),cJump,maxStep,endGap,stepWalk:Math.hypot(p1.x-p0.x,p1.z-p0.z),inHouse}
      },bikePos)
      // #110: walking at 1.65 m/s covers ~0.298 m in the first 12 frames; >0.29 catches one stalled frame.
      console.log('wall dismount',dismount);assert(dismount.dist<=2.5&&dismount.cJump<.15&&dismount.maxStep<.3&&dismount.endGap<.05&&dismount.stepWalk>.29&&!dismount.inHouse,`dismount teleport/visual jump: ${JSON.stringify(dismount)}`)
      await fixtureNear(43.8,360.7);await interact('骑');await steer([35,358.2],false,.8);await steer([36.2,356.2],false,.6)
      const parkedWall=await page.evaluate(()=>window.viewer.walk.position.toArray())
      assert(Math.hypot(parkedWall[0]-35.8,parkedWall[2]-356)<1.2,`wall-blocked bike parked off target: ${JSON.stringify(parkedWall)}`)
      await interact('下车')
      await fixture(39.1,355.5);await page.evaluate(()=>window.viewer.walk.tick(1/60))
      const wallMountBlocked=await page.evaluate(async()=>{
        const {walk}=window.viewer
        await new Promise(r=>setTimeout(r,30))
        const label=document.querySelector('.vehicle-action')?.textContent??''
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF'}))
        walk.tick(1/60)
        window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyF'}))
        return {vehicle:walk.vehicle,label,pos:[walk.probe().x,walk.probe().z],toast:document.querySelector('.toast')?.classList.contains('show')??false}
      })
      console.log('wall-blocked mount',parkedWall,wallMountBlocked);assert(wallMountBlocked.vehicle==='foot'&&/^骑(电动车|单车)$/.test(wallMountBlocked.label)&&wallMountBlocked.toast,`should not mount across building wall: ${JSON.stringify(wallMountBlocked)}`)
      await fixture(slopeBike[0],slopeBike[2]);await interact('骑电动车')
      const parkedSlope=await page.evaluate(()=>{
        const {walk}=window.viewer
        const press=(code,down)=>window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code}))
        press('KeyW',true)
        try{for(let frame=0;frame<240&&walk.position.x<-318;frame++)walk.tick(1/60)}finally{press('KeyW',false)}
        press('KeyS',true)
        try{for(let frame=0;frame<120&&walk.speed>0;frame++)walk.tick(1/60)}finally{press('KeyS',false)}
        return {kind:walk.vehicle,x:walk.position.x,z:walk.position.z,speed:walk.speed}
      })
      assert(parkedSlope.kind==='bike'&&parkedSlope.speed===0&&Math.hypot(parkedSlope.x+317,parkedSlope.z-94)<1,JSON.stringify(parkedSlope))
      await interact('下车')
      const bikeSpotRenderY=await page.evaluate(parked=>{
        const {walk,stream,manifest}=window.viewer
        const spot=walk.parked(parked.kind).find(([x,,z])=>Math.hypot(x-parked.x,z-parked.z)<.05)
        if(!spot)throw Error(`Missing stopped e-bike: ${JSON.stringify(parked)}`)
        const [x,,z]=spot
        const p={x,z}
        let surfY=null
        const tile=manifest.chunks.find(c=>p.x>=c.x&&p.x<c.x+256&&p.z>=c.z&&p.z<c.z+256)
        const sw=tile&&stream.loaded.get(tile)?.streets.sidewalk
        if(sw&&tile){
          const lx=p.x-tile.x,lz=p.z-tile.z
          for(let i=0;i<sw.length;i+=9){
            const ax=sw[i],ay=sw[i+1],az=sw[i+2],bx=sw[i+3],by=sw[i+4],bz=sw[i+5],cx=sw[i+6],cy=sw[i+7],cz=sw[i+8]
            const det=(bx-ax)*(cz-az)-(cx-ax)*(bz-az);if(Math.abs(det)<1e-6)continue
            const w1=((lx-ax)*(cz-az)-(cx-ax)*(lz-az))/det,w2=((bx-ax)*(lz-az)-(lx-ax)*(bz-az))/det
            if(w1>=-1e-3&&w2>=-1e-3&&w1+w2<=1+1e-3){surfY=Math.max(surfY??-Infinity,ay+w1*(by-ay)+w2*(cy-ay));break}
          }
        }
        return surfY ?? walk.photoSupport(x,z).y
      },parkedSlope)
      const slopePark=await page.evaluate(bikeRenderY=>{const w=window.viewer.walk;w.tick(1/60);const p=w.probe();return {vehicle:w.vehicle,pitch:p.bikePitch,bikeY:p.bikeY,bikeRenderY,renderY:p.renderY,inHouse:p.inHouse}},bikeSpotRenderY)
      console.log('slope park',slopePark);assert(slopePark.vehicle==='foot'&&Math.abs(slopePark.pitch)>.025&&Math.abs(slopePark.bikeY-slopePark.bikeRenderY)<.05&&!slopePark.inHouse,`slope bike pitch/height bad: ${JSON.stringify(slopePark)}`)
      await fixture(-743.45,-1833.01);await page.evaluate(()=>window.viewer.walk.tick(1/60))
      const highDiffBlocked=await page.evaluate(async()=>{
        const {walk}=window.viewer
        await new Promise(r=>setTimeout(r,30))
        const btn=document.querySelector('.vehicle-action')
        const visible=!!btn&&!btn.hidden&&/^骑(电动车|单车)$/.test(btn.textContent??'')
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF'}))
        walk.tick(1/60)
        window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyF'}))
        return {visible,vehicle:walk.vehicle}
      })
      console.log('high-diff mount blocked',highDiffBlocked);assert(!highDiffBlocked.visible&&highDiffBlocked.vehicle==='foot',`should reject >1.5m vertical bike mount: ${JSON.stringify(highDiffBlocked)}`)

      // --- 新增单车 (bicycle) 专项验收：walk.parked('bicycle') 寻车 + F 上下车 + 平路峰速 4.5–5.1 m/s + 踩踏循环 + 同坡慢于电动车 ---
      const bicycleCount=await page.evaluate(()=>window.viewer.walk.parked('bicycle').length)
      assert(bicycleCount>100,`bicycles parked count missing: ${bicycleCount}`)
      const waitSlopeChunks=()=>page.waitForFunction(()=>{const {stream,manifest,walk}=window.viewer;stream.tick(walk.position.clone().set(592,0,1300));return manifest.chunks.filter(t=>Math.hypot(t.x+128-592,t.z+128-1300)<300).every(t=>stream.loaded.has(t))})
      await fixtureNear(585,1384,'bicycle')
      await waitSlopeChunks()
      const bicycleBtnLabel=await page.evaluate(()=>{window.viewer.walk.tick(1/60);return document.querySelector('.vehicle-action')?.textContent??''})
      assert.equal(bicycleBtnLabel,'骑单车',`bicycle prompt mismatch: ${bicycleBtnLabel}`)
      await interact('骑单车')
      assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'bicycle')
      await steer([592,1392],false,2.0)
      await steer([636,1392],false,2.0)
      const bicycleFlat=await page.evaluate(()=>{
        const {walk}=window.viewer,keys=new Set(),target=[710,1392]
        function press(code,on){if(keys.has(code)===on)return;window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}));if(on)keys.add(code);else keys.delete(code)}
        walk.hold(true);walk.hold(false)
        for(let i=0;i<90;i++){
          const pos=walk.position,dx=target[0]-pos.x,dz=target[1]-pos.z,err=Math.atan2(Math.sin(Math.atan2(-dx,-dz)-walk.heading),Math.cos(Math.atan2(-dx,-dz)-walk.heading))
          press('KeyA',err>.03);press('KeyD',err<-.03);if(Math.abs(err)<.04)break;walk.tick(1/60)
        }
        press('KeyA',false);press('KeyD',false)
        walk.hold(true);walk.hold(false)
        let peakSpeed=0,speed1s=0,minTL=Infinity,maxTL=-Infinity,minTR=Infinity,maxTR=-Infinity
        press('KeyW',true)
        for(let i=0;i<300;i++){
          const pos=walk.position,dx=target[0]-pos.x,dz=target[1]-pos.z,err=Math.atan2(Math.sin(Math.atan2(-dx,-dz)-walk.heading),Math.cos(Math.atan2(-dx,-dz)-walk.heading))
          press('KeyA',err>.035);press('KeyD',err<-.035)
          walk.tick(1/60)
          if(i===60)speed1s=walk.speed
          peakSpeed=Math.max(peakSpeed,walk.speed)
          if(i>=30){
            const p=walk.probe()
            minTL=Math.min(minTL,p.thighL);maxTL=Math.max(maxTL,p.thighL)
            minTR=Math.min(minTR,p.thighR);maxTR=Math.max(maxTR,p.thighR)
          }
        }
        for(const k of [...keys])press(k,false)
        return {speed1s,peakSpeed,thighLRange:maxTL-minTL,thighRRange:maxTR-minTR,inHouse:walk.probe().inHouse}
      })
      console.log('bicycle flat & pedal',bicycleFlat)
      assert(bicycleFlat.peakSpeed>=4.5&&bicycleFlat.peakSpeed<=6.0,`bicycle peak speed out of 4.5-6.0 m/s: ${JSON.stringify(bicycleFlat)}`)
      assert(bicycleFlat.speed1s<ebikeSpeed1s-.5,`bicycle launch should be slower than e-bike: ${JSON.stringify({bicycle1s:bicycleFlat.speed1s,ebike1s:ebikeSpeed1s})}`)
      assert(bicycleFlat.thighLRange>.45&&bicycleFlat.thighRRange>.45&&!bicycleFlat.inHouse,`bicycle pedaling cycle missing: ${JSON.stringify(bicycleFlat)}`)
      await interact('下车')
      assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'foot')

      async function measureUphillRun(target){
        return page.evaluate(tgt=>{
          const {walk}=window.viewer,keys=new Set()
          function press(code,on){if(keys.has(code)===on)return;window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}));if(on)keys.add(code);else keys.delete(code)}
          walk.hold(true);walk.hold(false)
          for(let i=0;i<90;i++){
            const pos=walk.position,dx=tgt[0]-pos.x,dz=tgt[1]-pos.z,err=Math.atan2(Math.sin(Math.atan2(-dx,-dz)-walk.heading),Math.cos(Math.atan2(-dx,-dz)-walk.heading))
            press('KeyA',err>.03);press('KeyD',err<-.03);if(Math.abs(err)<.04)break;walk.tick(1/60)
          }
          press('KeyA',false);press('KeyD',false)
          walk.hold(true);walk.hold(false)
          const startPos=walk.position.clone(),startFoot=walk.probe().foot
          let frames=0,peakUphill=0
          for(;frames<1200;frames++){
            const pos=walk.position,dx=tgt[0]-pos.x,dz=tgt[1]-pos.z,gap=Math.hypot(dx,dz)
            if(gap<2.0)break
            const err=Math.atan2(Math.sin(Math.atan2(-dx,-dz)-walk.heading),Math.cos(Math.atan2(-dx,-dz)-walk.heading))
            press('KeyA',err>.035);press('KeyD',err<-.035);press('KeyW',true)
            walk.tick(1/60)
            peakUphill=Math.max(peakUphill,walk.speed)
          }
          const endSpeed=walk.speed
          for(const k of [...keys])press(k,false)
          const dist=Math.hypot(walk.position.x-startPos.x,walk.position.z-startPos.z)
          const seconds=frames/60
          return {dist,seconds,avgSpeed:dist/Math.max(1/60,seconds),peakUphill,endSpeed,climbY:walk.probe().foot-startFoot}
        },target)
      }
      async function rideToSlopeBase(startZ){
        if(startZ>1320){await steer([592,1350],false,2.5);await steer([592,1280],false,2.5)}
        await steer([592,1216],false,2.0)
      }

      // 辅星路同一上坡路段 (592, 1216) -> (592, 1300) [+4.0m 爬升]: 对比单车 vs 电动车
      const bcSpot=await fixtureNear(585,1384,'bicycle');await waitSlopeChunks();await interact('骑单车')
      await rideToSlopeBase(bcSpot[2])
      const bicycleUphill=await measureUphillRun([592,1300])
      await interact('下车')
      const ebSpot=await fixtureNear(585,1196.9,'bike');await waitSlopeChunks();await interact('骑电动车')
      await rideToSlopeBase(ebSpot[2])
      const ebikeUphill=await measureUphillRun([592,1300])
      await interact('下车')
      console.log('same-slope uphill comparison',{bicycle:bicycleUphill,ebike:ebikeUphill})
      assert(bicycleUphill.climbY>1.8&&ebikeUphill.climbY>1.8,`slope climb elevation insufficient: ${JSON.stringify({bicycleUphill,ebikeUphill})}`)
      assert(bicycleUphill.avgSpeed<ebikeUphill.avgSpeed*.82&&bicycleUphill.endSpeed<ebikeUphill.endSpeed-1.4&&bicycleUphill.seconds>ebikeUphill.seconds*1.2,`bicycle should climb slower than e-bike on same slope: ${JSON.stringify({bicycleUphill,ebikeUphill})}`)

      const [x,,z]=data.docks['解放桥码头'];await fixture(x,z);await shot('dock');await interact('上船');
      const distance=await page.evaluate((bounds)=>{const walker=window.viewer.walk,start=walker.position.clone();for(let frame=0;frame<3600;frame++){walker.tick(1/60);const probe=walker.boatClearance();if(probe?.kind!=='raft'||probe.clearance<.3||probe.roof-walker.position.y>bounds.roof+1e-6||probe.head-walker.position.y>bounds.head+1e-6)throw Error(`unsafe raft: ${JSON.stringify({frame,position:walker.position.toArray(),probe,bounds})}`)}return walker.position.distanceTo(start)},bounds.raft)
      assert(distance>80&&distance<125);await shot('boat');await interact('下站下船')
      await page.evaluate(async()=>{const {walk,stream}=window.viewer;for(let count=0;count<4000&&walk.vehicle==='boat';count++){walk.tick(.12);if(count%24===0){stream.tick(walk.position);await new Promise(requestAnimationFrame)}}})
      assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'foot');console.log('60s boat displacement',distance)
    }
    await page.close()
  }
  assert.deepEqual(errors,[])
}finally{await browser.close();await server.close()}
