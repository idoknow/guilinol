import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {rideToCrossroads} from './ride-route.mjs'
import {lakeChecks} from './ride-lake.mjs'

const data=JSON.parse(gunzipSync(await readFile('dist/world/vehicles.bin')))
const atlas=JSON.parse(gunzipSync(await readFile('dist/world/atlas.bin')))
const output='captures/ride';await mkdir(output,{recursive:true})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const errors=[]
const bounds=JSON.parse(await readFile('pipeline/vessel-bounds.json','utf8'))
const {bridges,minimum}=data.clearance
assert(bridges.length?minimum>=.3-1e-10:minimum===null)
console.log(`航线经过 ${bridges.length} 座桥；最小净空：${minimum===null?'不适用':minimum.toFixed(3)+' m'}`)
try{
  for(const mobile of [false,true]){
    const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:800,height:450},hasTouch:mobile,isMobile:mobile})
    page.on('pageerror',error=>errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?mode=walk&verify&radius=480`)
    await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000})
    if(!mobile){const boat=await lakeChecks(page,data,output);assert(boat.roof<=bounds.boat.roof+1e-6&&boat.head<=bounds.boat.head+1e-6)}
    async function fixture(x,z){assert(await page.evaluate(async([x,z])=>{const walker=window.viewer.walk;walker.leave();return walker.enter(x,z,0,'ride-fixture')},[x,z]))}
    const button=page.locator('.vehicle-action')
    async function closeCard(){const close=page.locator('.spot-card.show .card-close');if(await close.isVisible())await close.click()}
    async function interact(label){await closeCard();await page.waitForFunction(label=>document.querySelector('.vehicle-action')?.textContent.includes(label),label);if(mobile)await button.tap();else await page.keyboard.press('e')}
    async function shot(name){await closeCard();await page.screenshot({path:`${output}/${name}.png`})}
    async function timings(){return page.evaluate(async()=>{const samples=[];for(let frame=0;frame<24;frame++){await new Promise(requestAnimationFrame);samples.push(window.viewer.stats.ms)}return samples.sort((a,b)=>a-b)[12]})}
    const gate=[-588,-212],distance=bike=>Math.hypot(bike[0]-gate[0],bike[2]-gate[1]);const bike=[...data.bikes].sort((first,second)=>distance(first)-distance(second))[0]
    await fixture(bike[0],bike[2]);const foot=mobile?0:await timings()
    if(mobile){
      await closeCard()
      const preHud=await page.evaluate(()=>{
        const sels=['.walk-ui .joystick','.walk-ui .btn-run','.walk-ui .btn-jump','.walk-ui .btn-view','.vehicle-action','.dock','.sky-ui','output','.btn-about']
        const boxes=sels.map(sel=>{const el=document.querySelector(sel);if(!el)return null;const st=getComputedStyle(el),r=el.getBoundingClientRect()
          return st.display==='none'||st.visibility==='hidden'||el.hasAttribute('hidden')?null:{sel,left:r.left,top:r.top,right:r.right,bottom:r.bottom}}).filter(Boolean)
        const overlaps=[]
        for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j]
          const ox=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)),oy=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))
          if(ox*oy>0)overlaps.push({a:a.sel,b:b.sel,area:+(ox*oy).toFixed(1)})}
        const outOfBounds=boxes.filter(b=>b.left<0||b.top<0||b.right>390.5||b.bottom>844.5)
        return {count:boxes.length,overlaps,outOfBounds}
      })
      assert(preHud.count>=8&&preHud.overlaps.length===0&&preHud.outOfBounds.length===0,`mobile pre-mount HUD: ${JSON.stringify(preHud)}`)
    }
    await interact('骑行')
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
        const runHidden=getComputedStyle(document.querySelector('.walk-ui .btn-run')).display==='none'
        const aboard=document.body.hasAttribute('data-aboard')
        const sels=['.walk-ui .joystick','.walk-ui .btn-view','.vehicle-action','.dock','.sky-ui','output','.btn-about']
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
      await fixture(bike[0],bike[2]);await interact('骑行')
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
    const ride=await rideToCrossroads(page,atlas);console.log('ride',ride);assert(ride.main>=500&&ride.crossed&&ride.targetDistance<=10)
    await shot(mobile?'bike-mobile':'bike-desktop');if(!mobile)console.log('median frame ms',{foot,bike:await timings()})
    if(!mobile){
      const feelCheck=await page.evaluate(()=>{
        const {walk}=window.viewer, keys=new Set(), target=[-873,-215]
        function press(code,on){if(keys.has(code)===on)return;window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}));if(on)keys.add(code);else keys.delete(code)}
        for(let i=0;i<80;i++){
          const pos=walk.position,dx=target[0]-pos.x,dz=target[1]-pos.z,err=Math.atan2(Math.sin(Math.atan2(-dx,-dz)-walk.heading),Math.cos(Math.atan2(-dx,-dz)-walk.heading))
          press('KeyA',err>.05);press('KeyD',err<-.05);if(Math.abs(err)<.15)break;walk.tick(.06)
        }
        press('KeyA',false);press('KeyD',false)
        press('KeyW',true);for(let i=0;i<40;i++)walk.tick(.06)
        const peakSpeed=walk.speed
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
        return {peakSpeed,coastDist,coastEndSpeed,brakeSpeed,tapRevSpeed,revSpeed,repressRevSpeed,revDist,inHouse}
      })
      console.log('ride feel',feelCheck)
      assert(feelCheck.peakSpeed>=5.5&&feelCheck.peakSpeed<=25/3.6+1e-4,`accel/cap: ${JSON.stringify(feelCheck)}`)
      assert(feelCheck.coastDist>=2.2&&feelCheck.coastEndSpeed>1.5&&feelCheck.coastEndSpeed<feelCheck.peakSpeed,`coast: ${JSON.stringify(feelCheck)}`)
      assert(feelCheck.brakeSpeed>=0&&feelCheck.brakeSpeed<feelCheck.coastEndSpeed-1.2,`brake: ${JSON.stringify(feelCheck)}`)
      assert(feelCheck.tapRevSpeed===0&&feelCheck.revSpeed<-.5&&feelCheck.revSpeed>=-1.85&&feelCheck.repressRevSpeed<-.3&&feelCheck.revDist>.35&&!feelCheck.inHouse,`reverse: ${JSON.stringify(feelCheck)}`)
    }
    await interact('下车');assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'foot')
    if(!mobile){
      await fixture(189.1,-42);await interact('骑行');const escape=await steer([189.1,-52]);console.log('off-pavement escape',escape);assert(escape.distance>4.5&&escape.speed>2&&!escape.obstacle,`off-pavement bike stuck: ${JSON.stringify(escape)}`)
      const roamOut=await steer([176,-34]);console.log('off-pavement >6.5m turn',roamOut);assert(roamOut.distance>10&&roamOut.speed>2&&roamOut.speed<=4.35&&!roamOut.obstacle,`off-pavement >6.5m locked: ${JSON.stringify(roamOut)}`)
      await interact('下车');assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'foot')
      await fixture(-778.5,402.1);await interact('骑行');const diag=await steer([-764,398]);console.log('diagonal road edge',diag);assert(diag.distance>10&&diag.speed>2.5&&!diag.obstacle,`diagonal road edge stuck: ${JSON.stringify(diag)}`)
      await interact('下车');assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'foot')
      await fixture(-31,510.3);await interact('骑行');const wall=await steer([-42,510.5],true);console.log('wall',wall);assert(wall.obstacle==='building'&&wall.speed===0&&wall.distance<8)
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
        const w=window.viewer.walk,p0=w.probe()
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyC'}))
        window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyC'}))
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}))
        for(let i=0;i<12;i++)w.tick(1/60)
        window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW'}))
        const p1=w.probe()
        return {dist:Math.hypot(p0.x-bp[0],p0.z-bp[2]),stepWalk:Math.hypot(p1.x-p0.x,p1.z-p0.z),inHouse:p0.inHouse||p1.inHouse}
      },bikePos)
      console.log('wall dismount',dismount);assert(dismount.dist<=2.5&&dismount.stepWalk>.3&&!dismount.inHouse,`dismount teleport/house: ${JSON.stringify(dismount)}`)
      await fixture(43.8,360.7);await interact('骑行');await steer([36.3,359],false,.8);await steer([36.8,356.6],false,.8)
      const parkedWall=await page.evaluate(()=>window.viewer.walk.position.toArray())
      await interact('下车')
      await fixture(39.3,355.5);await page.evaluate(()=>window.viewer.walk.tick(1/60))
      const wallMountBlocked=await page.evaluate(async()=>{
        const {walk}=window.viewer
        await new Promise(r=>setTimeout(r,30))
        const label=document.querySelector('.vehicle-action')?.textContent??''
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE'}))
        walk.tick(1/60)
        window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyE'}))
        return {vehicle:walk.vehicle,label,pos:[walk.probe().x,walk.probe().z],toast:document.querySelector('.toast')?.classList.contains('show')??false}
      })
      console.log('wall-blocked mount',parkedWall,wallMountBlocked);assert(wallMountBlocked.vehicle==='foot'&&wallMountBlocked.label.includes('骑行')&&wallMountBlocked.toast,`should not mount across building wall: ${JSON.stringify(wallMountBlocked)}`)
      const [x,,z]=data.docks['解放桥码头'];await fixture(x,z);await shot('dock');await interact('上船');
      const distance=await page.evaluate((bounds)=>{const walker=window.viewer.walk,start=walker.position.clone();for(let frame=0;frame<3600;frame++){walker.tick(1/60);const probe=walker.boatClearance();if(probe?.kind!=='raft'||probe.clearance<.3||probe.roof-walker.position.y>bounds.roof+1e-6||probe.head-walker.position.y>bounds.head+1e-6)throw Error(`unsafe raft: ${JSON.stringify(probe)}`)}return walker.position.distanceTo(start)},bounds.raft)
      assert(distance>80&&distance<125);await shot('boat');await interact('下站下船')
      await page.evaluate(async()=>{const {walk,stream}=window.viewer;for(let count=0;count<4000&&walk.vehicle==='boat';count++){walk.tick(.12);if(count%24===0){stream.tick(walk.position);await new Promise(requestAnimationFrame)}}})
      assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'foot');console.log('60s boat displacement',distance)
    }
    await page.close()
  }
  assert.deepEqual(errors,[])
}finally{await browser.close();await server.close()}
