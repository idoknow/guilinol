import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const start=performance.now()
// Walk-only distance probes were tuned for the old 4 m/s walk; IDOK-133 walks at a natural 1.65 m/s, so the same
// distances need proportionally more simulated time.
const WALK_TIME=4/1.65
const outDir=process.env.WALK_CAPTURE_DIR??'captures/walk'
await mkdir(outDir,{recursive:true})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const baseUrl=`http://127.0.0.1:${server.httpServer.address().port}`
const walkUrl = baseUrl+'/?verify&mode=walk&flow=0'+(process.argv.includes('--solo')?'&solo=1':'')
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:480,height:270}}),errors=[]
  let releaseBridge
  const coldBridge=new Promise(resolve=>{releaseBridge=resolve})
  await page.route('**/jiefang_bridge.glb',async route=>{await coldBridge;await route.continue()})
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/favicon.ico',route=>route.fulfill({status:204}))
  await page.route('**/api/t',route=>route.fulfill({status:204}))
  page.on('console',message=>{if(message.type()==='error')errors.push(message.location().url+': '+message.text())})
  await page.goto(walkUrl)
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000})

  async function fixture(origin,direction,seconds,target){
    seconds=Math.ceil(seconds*WALK_TIME)
    const result=await page.evaluate(async({origin,direction,seconds,target})=>{
      const {walk,stream}=window.viewer;walk.leave()
      if(!await walk.enter(...origin,0,'quick'))throw Error('Spawn failed: '+target)
      if(target==='deck'){
        const deadline=performance.now()+45000
        while(![...stream.landmarks.keys()].some(entry=>entry.id==='jiefang_bridge')){
          if(performance.now()>deadline)throw Error('Bridge approach collider not loaded')
          await new Promise(requestAnimationFrame)
        }
      }
      if(target==='tree'){
        const tree=[...stream.forest.loaded.values()].flat().filter(tree=>tree.kind!==5).sort((one,two)=>Math.hypot(one.x-origin[0],one.z-origin[1])-Math.hypot(two.x-origin[0],two.z-origin[1]))[0]
        walk.leave();if(!await walk.enter(tree.x-2,tree.z,0,'tree'))throw Error('No tree approach')
      }
      const spawn=walk.probe();if(target==='shore')direction=[-740-spawn.x,868-spawn.z]
      walk.drive(...direction);let hit=false,maxSink=-Infinity
      for(let step=0;step<seconds*10;step++){
        walk.tick(.1);const probe=walk.probe()
        if(probe.resets||probe.inHouse||probe.inPeak||probe.renderClearance<-.15)throw Error(JSON.stringify(probe))
        if(probe.grounded&&Number.isFinite(probe.footSink))maxSink=Math.max(maxSink,probe.footSink)
        if(probe.grounded&&probe.footSink>.03)throw Error(`foot sank (${probe.footSink.toFixed(3)}m): `+JSON.stringify(probe))
        if(target==='gunanmen'){
          if(Math.abs(probe.foot-spawn.foot)>.6)throw Error('Walker left the gate passage')
          hit = probe.z-spawn.z>21.5
        }else if(target==='gunanmen-stairs'){
          // Cross the landing, turn north through the rail opening and finish
          // on the main deck, clear of both the stair ramp and its landing.
          const along=(probe.x-spawn.x)*.893+(probe.z-spawn.z)*.451
          if(along>=18.25)walk.drive(.451,-.893)
          hit=Math.hypot(probe.x+1404.62,probe.z-116.54)<.65 && Math.abs(probe.foot-160.20)<.25
        }else hit ||= target==='gate'?spawn.z-probe.z>39:target==='shore'?probe.blockedWater&&!probe.wet:target==='deck'?probe.wet&&probe.deck!==undefined&&probe.foot>=probe.deck-.35&&!probe.blockedWater:probe.hits.includes(target)
        if(hit)break
      }
      walk.drive(0,0);return {hit,maxSink,last:walk.probe()}
    },{origin,direction,seconds,target});assert(result.hit,`${target}: ${JSON.stringify(result)}`);console.log(target,'OK',result.maxSink>-Infinity?`maxSink=${result.maxSink.toFixed(4)}m`:'')
  }

  await page.waitForFunction(()=>[...window.viewer.stream.landmarks.keys()].some(entry=>entry.id==='jingjiang'))
  assert(await page.evaluate(()=>document.querySelector('.walk-ui')?.hidden===true),'desktop should hide mobile walk-ui')

  // Foot grounding & low-step/curb/slab direct autostep check (no jump, no floor sink).
  const grounding=await page.evaluate(async()=>{
    const {walk}=window.viewer
    // 1) Default spawn on Jingjiang stone plaza slab (+0.17m above terrain) through full idle breathing cycle.
    let idleMaxSink=-Infinity, idleMinSink=Infinity, spawnSurfaceY=0, spawnSoleY=0
    for(let i=0;i<180;i++){
      walk.tick(1/60)
      const p=walk.probe()
      if(i===10){spawnSurfaceY=p.surfaceY??0;spawnSoleY=p.soleY??0}
      if(p.grounded){idleMaxSink=Math.max(idleMaxSink,p.footSink);idleMinSink=Math.min(idleMinSink,p.footSink)}
    }
    // 2) Walk directly onto Jingjiang stone plaza from outside (-588, -193 -> north) without jumping.
    walk.leave()
    if(!await walk.enter(-588,-193,0,'slab-step'))throw Error('Spawn failed: slab-step')
    const slabStart=walk.probe()
    walk.drive(0,-1,false)
    let slabMaxSink=-Infinity, slabGroundedFrames=0
    for(let i=0;i<120*4/1.65;i++){
      walk.tick(1/60)
      const p=walk.probe()
      if(p.grounded){slabGroundedFrames++;slabMaxSink=Math.max(slabMaxSink,p.footSink)}
    }
    walk.drive(0,0,false)
    const slabEnd=walk.probe()

    // 3) Walk directly from asphalt road onto raised sidewalk curb at Shizijie (-840, -275 -> +X) without jumping.
    walk.leave()
    if(!await walk.enter(-840,-275,0,'curb-step'))throw Error('Spawn failed: curb-step')
    for(let i=0;i<6;i++)walk.tick(1/60)
    const curbStart=walk.probe()
    walk.drive(1,0,false)
    let curbHitSidewalk=false, curbMaxSink=-Infinity, curbMaxY=-Infinity
    for(let i=0;i<90*4/1.65;i++){
      walk.tick(1/60)
      const p=walk.probe()
      if(p.hits.includes('sidewalk')||p.surfaceKind==='sidewalk')curbHitSidewalk=true
      if(p.grounded){curbMaxSink=Math.max(curbMaxSink,p.footSink);curbMaxY=Math.max(curbMaxY,p.surfaceY??-Infinity)}
    }
    walk.drive(0,0,false)
    const curbEnd=walk.probe()

    // 4) Diagonal curb walk at Ronghu North (-872, 920 -> SW) must climb smoothly without wedging airborne.
    walk.leave()
    if(!await walk.enter(-872,920,0,'diag-curb'))throw Error('Spawn failed: diag-curb')
    for(let i=0;i<6;i++)walk.tick(1/60)
    const diagStart=walk.probe(), diagLen=Math.hypot(-.5,.85)
    walk.drive(-.5/diagLen,.85/diagLen,false)
    let diagAirborne=0, diagMaxSink=-Infinity, diagHitSidewalk=false
    for(let i=0;i<120*4/1.65;i++){
      walk.tick(1/60)
      const p=walk.probe()
      if(p.hits.includes('sidewalk')||p.surfaceKind==='sidewalk')diagHitSidewalk=true
      if(p.grounded)diagMaxSink=Math.max(diagMaxSink,p.footSink)
      else diagAirborne++
    }
    walk.drive(0,0,false)
    const diagEnd=walk.probe()
    return {
      spawnSurfaceY,spawnSoleY,idleMaxSink,idleMinSink,
      slabDist:slabStart.z-slabEnd.z,slabClimb:slabEnd.soleY-slabStart.soleY,slabMaxSink,slabGroundedFrames,slabEndSurface:slabEnd.surfaceY,
      curbStartKind:curbStart.surfaceKind,curbStartY:curbStart.surfaceY,curbEndKind:curbEnd.surfaceKind,curbEndY:curbEnd.surfaceY,
      curbDist:curbEnd.x-curbStart.x,curbHitSidewalk,curbMaxSink,curbMaxY,
      diagDist:Math.hypot(diagEnd.x-diagStart.x,diagEnd.z-diagStart.z),diagAirborne,diagMaxSink,diagHitSidewalk,
    }
  })
  assert(grounding.spawnSurfaceY>157.82&&grounding.idleMaxSink<=.015&&grounding.idleMinSink>=-.05,`idle/plaza grounding bad: ${JSON.stringify(grounding)}`)
  assert(grounding.slabDist>6&&grounding.slabEndSurface>157.75&&grounding.slabMaxSink<=.02&&grounding.slabGroundedFrames>100,`plaza slab step-up bad: ${JSON.stringify(grounding)}`)
  assert(grounding.curbDist>3&&grounding.curbHitSidewalk&&grounding.curbMaxSink<=.02&&grounding.curbMaxY>(grounding.curbStartY??0)+.08,`curb step-up bad: ${JSON.stringify(grounding)}`)
  assert(grounding.diagDist>6&&grounding.diagHitSidewalk&&grounding.diagAirborne<=4&&grounding.diagMaxSink<=.02,`diagonal curb step-up bad: ${JSON.stringify(grounding)}`)
  console.log('grounding & low-step OK',JSON.stringify({spawnY:+grounding.spawnSurfaceY.toFixed(3),idleSink:+grounding.idleMaxSink.toFixed(4),slabDist:+grounding.slabDist.toFixed(2),curbDist:+grounding.curbDist.toFixed(2),curbRise:+(grounding.curbMaxY-grounding.curbStartY).toFixed(3),diagAir:grounding.diagAirborne}))

  await fixture([-588,-212],[.145,-.989],7,'gate')

  // M6-1: gate tunnel / archway camera check (landmark arch) + LOS guard.
  const gateCam=await page.evaluate(async()=>{
    const {walk}=window.viewer;walk.leave()
    if(!await walk.enter(-588,-212,0,'gate-cam'))throw Error('Spawn failed: gate-cam')
    walk.drive(.145,-.989,false)
    for(let i=0;i<36*4/1.65;i++)walk.tick(.05)
    walk.drive(0,0,false)
    let blocked=false, houseClip=false, minDist=Infinity
    for(let step=0;step<12;step++){
      for(const pitch of [-.2,.25,.75]){
        walk.face(step*Math.PI/6,pitch)
        const p=walk.probe()
        minDist=Math.min(minDist,p.camDist)
        if(p.camBlocked)blocked=true
        if(p.camInHouse)houseClip=true
      }
    }
    return {blocked,houseClip,minDist}
  })
  assert(!gateCam.blocked&&!gateCam.houseClip,`gateCam: ${JSON.stringify(gateCam)}`)

  // M6-1: walk/run acceleration, crisp stop (<=0.35m), 180-deg pivot, 90-deg cut without lateral skid, jump + jump buffer.
  const feel=await page.evaluate(async()=>{
    const {walk}=window.viewer;walk.leave()
    if(!await walk.enter(-588,-212,0,'feel'))throw Error('Spawn failed: feel')
    const dir=[.145,-.989], perp=[.989,.145]
    walk.drive(dir[0],dir[1],false)
    for(let i=0;i<30;i++)walk.tick(1/60)
    const walkSpeed=walk.probe().planarSpeed

    walk.drive(dir[0],dir[1],true)
    for(let i=0;i<30;i++)walk.tick(1/60)
    const runSpeed=walk.probe().planarSpeed

    const stopFrom=walk.probe()
    walk.drive(0,0,false)
    for(let i=0;i<14;i++)walk.tick(1/60)
    const stopped=walk.probe(), stopSlip=Math.hypot(stopped.x-stopFrom.x,stopped.z-stopFrom.z)

    walk.drive(dir[0],dir[1],true)
    for(let i=0;i<24;i++)walk.tick(1/60)
    const pivotAt=walk.probe()
    walk.drive(-dir[0],-dir[1],true)
    for(let i=0;i<20;i++)walk.tick(1/60)
    const afterPivot=walk.probe()
    const along=(afterPivot.x-pivotAt.x)*(-dir[0])+(afterPivot.z-pivotAt.z)*(-dir[1])
    const lateralSkid=Math.abs((afterPivot.x-pivotAt.x)*(-dir[1])+(afterPivot.z-pivotAt.z)*dir[0])
    const facingTurn=Math.abs(Math.atan2(Math.sin(afterPivot.facing-pivotAt.facing),Math.cos(afterPivot.facing-pivotAt.facing)))

    // 90-degree sharp cut at full sprint: forward residual drift along old dir must arrest immediately.
    walk.leave()
    if(!await walk.enter(-588,-212,0,'cut90'))throw Error('Spawn failed: cut90')
    walk.drive(dir[0],dir[1],true)
    for(let i=0;i<24;i++)walk.tick(1/60)
    const cutAt=walk.probe()
    walk.drive(perp[0],perp[1],true)
    for(let i=0;i<18;i++)walk.tick(1/60)
    const afterCut=walk.probe()
    const cutForwardDrift=(afterCut.x-cutAt.x)*dir[0]+(afterCut.z-cutAt.z)*dir[1]
    const cutNewGain=(afterCut.x-cutAt.x)*perp[0]+(afterCut.z-cutAt.z)*perp[1]
    const cutGoalFacing=Math.atan2(-perp[0],-perp[1])
    const cutFacingErr=Math.abs(Math.atan2(Math.sin(afterCut.facing-cutGoalFacing),Math.cos(afterCut.facing-cutGoalFacing)))
    walk.drive(0,0,false)
    for(let i=0;i<15;i++)walk.tick(1/60)

    const ground0=walk.probe().foot
    let airborne=false, maxLift=0, bufferedJump=false, armedBuffer=false
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}))
    window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}))
    for(let i=0;i<90;i++){
      walk.tick(1/60)
      const p=walk.probe()
      if(!p.grounded)airborne=true
      maxLift=Math.max(maxLift,p.foot-ground0)
      if(airborne&&!p.grounded&&p.verticalVelocity<-5&&!armedBuffer&&i>=30){
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}))
        window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}))
        armedBuffer=true
      }
      if(armedBuffer&&p.verticalVelocity>5)bufferedJump=true
    }
    for(let i=0;i<60;i++)walk.tick(1/60)
    const finalJump=walk.probe()
    return {walkSpeed,runSpeed,stopSpeed:stopped.planarSpeed,stopSlip,reversed:along>0,facingTurn,lateralSkid,
      cutForwardDrift,cutNewGain,cutFacingErr,airborne,maxLift,bufferedJump,groundedEnd:finalJump.grounded,resets:finalJump.resets}
  })
  assert(feel.walkSpeed>1.55&&feel.walkSpeed<1.72,`walkSpeed: ${JSON.stringify(feel)}`)
  assert(feel.runSpeed>8.85&&feel.runSpeed<9.1,`runSpeed: ${JSON.stringify(feel)}`)
  assert(feel.stopSpeed===0&&feel.stopSlip<=.35,`stop: ${JSON.stringify(feel)}`)
  assert(feel.reversed&&feel.facingTurn>2.6&&feel.lateralSkid<.06,`pivot: ${JSON.stringify(feel)}`)
  assert(feel.cutForwardDrift<.22&&feel.cutNewGain>1.3&&feel.cutFacingErr<.15,`cut90: ${JSON.stringify(feel)}`)
  assert(feel.airborne&&feel.maxLift>1.02&&feel.maxLift<1.36&&feel.bufferedJump&&feel.groundedEnd&&!feel.resets,`jump: ${JSON.stringify(feel)}`)
  console.log('feel & jump OK',JSON.stringify({walk:+feel.walkSpeed.toFixed(2),run:+feel.runSpeed.toFixed(2),stopSlip:+feel.stopSlip.toFixed(2),cutDrift:+feel.cutForwardDrift.toFixed(2),lift:+feel.maxLift.toFixed(2)}))

  await fixture([-730.68,-277.1],[-.166,.986],2,'building')

  // M6-1: wall-hugging camera 360 sweep must pull in against walls, recover on open street, and never enter buildings or lose LOS.
  const wallCam=await page.evaluate(()=>{
    const {walk}=window.viewer
    let minDist=Infinity, maxDist=0, clippedCount=0, houseClip=false, blocked=false
    for(let step=0;step<16;step++){
      const yaw=step*Math.PI/8
      for(const pitch of [-.25,.28,.82]){
        walk.face(yaw,pitch)
        const p=walk.probe()
        minDist=Math.min(minDist,p.camDist);maxDist=Math.max(maxDist,p.camDist)
        if(p.camClipped)clippedCount++
        if(p.camInHouse)houseClip=true
        if(p.camBlocked)blocked=true
      }
    }
    return {minDist,maxDist,clippedCount,houseClip,blocked}
  })
  assert(!wallCam.houseClip&&!wallCam.blocked&&wallCam.clippedCount>0&&wallCam.minDist<3.5&&wallCam.maxDist>8.5,`wallCam: ${JSON.stringify(wallCam)}`)
  console.log('wall camera OK',JSON.stringify({minDist:+wallCam.minDist.toFixed(2),maxDist:+wallCam.maxDist.toFixed(2),clipped:wallCam.clippedCount}))

  await fixture([-577,-209],[1,0],2,'tree')
  await page.waitForFunction(()=>[...window.viewer.stream.landmarks.keys()].some(entry=>entry.id==='shizijie'))
  await fixture([-873,-197.63],[1,0],1,'landmark')
  await fixture([-1021.82,435.97],[.967,-.254],2,'rail')
  await fixture([-962,1096],[.8,.6],9,'peak')
  releaseBridge()
  await fixture([-309,-1],[.95,.32],18,'deck')

  // M6-1: under-bridge / arch camera guard — verify camera stays below bridge slab (deck - bridgeDepth) when character is beneath a bridge.
  const underBridge=await page.evaluate(async()=>{
    const {walk,stream,camera}=window.viewer
    let candidate=null, fallback=null
    for(const [tile,data] of stream.loaded){
      const d=data.deck
      for(let i=0;i<d.length;i+=9){
        const wx=tile.x+(d[i]+d[i+3]+d[i+6])/3, dy=(d[i+1]+d[i+4]+d[i+7])/3, wz=tile.z+(d[i+2]+d[i+5]+d[i+8])/3
        const col=Math.max(0,Math.min(64,Math.round((wx-tile.x)/4))), row=Math.max(0,Math.min(64,Math.round((wz-tile.z)/4))), at=row*65+col
        const gy=data.terrain[at]/10, water=data.water[at]
        const base=water===-32768?gy:water/10
        if(water===-32768 && dy-gy>1.9 && dy-gy<14){candidate={wx,wz,base:gy,dy};break}
        if(!fallback && dy-base>2.2 && dy-base<14)fallback={wx,wz,base,dy}
      }
      if(candidate)break
    }
    const target=candidate??fallback
    if(!target)throw Error('No loaded bridge deck for under-bridge camera test')
    let under=false, maxCamY=-Infinity, deckY=target.dy, minCeil=Infinity, blocked=false, houseClip=false
    if(candidate){
      for(let r=6;r<=28&&!under;r+=4){
        for(let a=0;a<8&&!under;a++){
          const sx=target.wx+Math.cos(a*Math.PI/4)*r, sz=target.wz+Math.sin(a*Math.PI/4)*r
          walk.leave()
          if(!await walk.enter(sx,sz,0,'underpass-start'))continue
          const p0=walk.probe()
          if(p0.deck!==undefined||Math.abs(p0.foot-target.base)>2.5)continue
          const len=Math.hypot(target.wx-p0.x,target.wz-p0.z)||1
          walk.drive((target.wx-p0.x)/len,(target.wz-p0.z)/len,true)
          for(let step=0;step<70;step++){
            walk.tick(.05)
            const p=walk.probe()
            if(p.deck!==undefined && p.foot<p.deck-1.8){under=true;deckY=p.deck;break}
          }
          walk.drive(0,0,false)
        }
      }
    }
    if(!under){
      // Place directly on the bridge approach shore and step/probe under the bridge soffit via boat/raft height or under-span check.
      const {wx,wz,base,dy}=target
      walk.leave()
      await walk.enter(-309,-1,0,'under-bridge-anchor')
      // Drive camera rig under bridge deck by placing character on low bank beside bridge deck or testing underpass soffit:
      for(const [tile,data] of stream.loaded){
        const d=data.deck
        for(let i=0;i<d.length&&!under;i+=9){
          const bx=tile.x+(d[i]+d[i+3]+d[i+6])/3, bdy=(d[i+1]+d[i+4]+d[i+7])/3, bz=tile.z+(d[i+2]+d[i+5]+d[i+8])/3
          for(const [ox,oz] of [[3,0],[-3,0],[0,3],[0,-3],[5,0],[-5,0]]){
            walk.leave()
            if(await walk.enter(bx+ox,bz+oz,0,'bank-near-bridge',true)){
              const p=walk.probe()
              if(p.foot<bdy-1.8){
                const yawTowardBridge=Math.atan2(bx-p.x,bz-p.z)
                for(const pitch of [-.15,.15,.45,.85]){
                  walk.face(yawTowardBridge,pitch)
                  const cp=walk.probe()
                  if(Number.isFinite(cp.camCeiling)){
                    under=true;deckY=bdy
                    maxCamY=Math.max(maxCamY,camera.position.y)
                    minCeil=Math.min(minCeil,cp.camCeiling)
                    if(cp.camBlocked)blocked=true
                    if(cp.camInHouse)houseClip=true
                  }
                }
                if(under)break
              }
            }
          }
        }
        if(under)break
      }
      void wx;void wz;void base;void dy
    }else{
      for(const pitch of [-.15,.2,.6,.95]){
        walk.face(0,pitch)
        const cp=walk.probe()
        maxCamY=Math.max(maxCamY,camera.position.y)
        minCeil=Math.min(minCeil,cp.camCeiling)
        if(cp.camBlocked)blocked=true
        if(cp.camInHouse)houseClip=true
      }
    }
    return {under,maxCamY,deckY,minCeil,blocked,houseClip}
  })
  assert(underBridge.under&&!underBridge.blocked&&!underBridge.houseClip&&underBridge.maxCamY<underBridge.deckY-.55&&underBridge.minCeil>=.18,`underBridge: ${JSON.stringify(underBridge)}`)
  console.log('under-bridge camera OK',JSON.stringify({deckY:+underBridge.deckY.toFixed(2),maxCamY:+underBridge.maxCamY.toFixed(2),minCeil:+underBridge.minCeil.toFixed(2)}))

  await fixture([-740,868],[0,0],6,'shore')
  // Start 4.8 m outside the northern opening, finish beyond the lake-side portal.
  await fixture([-1392.99,103.71],[-.451,.893],7,'gunanmen')
  await fixture([-1422.40,110.92],[.893,.451],9,'gunanmen-stairs')
  await page.close()

  // M6-1: Mobile 390x844 HUD layout non-overlap, touch joystick + sprint/jump buttons + touch camera drag, and screenshot.
  const mobileCtx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true})
  // Also run the mobile gait and vehicle checks with the second body and a longer hairstyle.
  await mobileCtx.addInitScript(()=>localStorage.setItem('glol.avatar.v1',JSON.stringify({
    v:1,body:'f',skin:2,face:1,brows:1,eyes:1,hair:'f_long',hairColor:0,look:'basic',createdAt:1,
  })))
  const mobile=await mobileCtx.newPage()
  mobile.on('pageerror',error=>errors.push('mobile: '+error.message))
  await mobile.route('**/favicon.ico',route=>route.fulfill({status:204}))
  await mobile.route('**/api/t',route=>route.fulfill({status:204}))
  await mobile.goto(walkUrl+'&time=10.5')
  await mobile.waitForFunction(()=>window.viewer?.walk?.active&&window.viewer?.tour?.map&&document.querySelector('.vehicle-action'),null,{timeout:90000})
  await mobile.evaluate(async()=>{for(let i=0;i<4;i++)await new Promise(requestAnimationFrame)})

  const hud=await mobile.evaluate(()=>{
    const selectors=['.walk-ui .joystick','.walk-ui .look-stick','.walk-ui .btn-run','.walk-ui .btn-crouch','.walk-ui .btn-jump','.walk-ui .btn-view','.dock','.sky-ui','output','.hud-me']
    const boxes=selectors.map(sel=>{
      const el=document.querySelector(sel)
      if(!el)return {sel,missing:true}
      const st=getComputedStyle(el), r=el.getBoundingClientRect()
      return {sel,missing:false,hidden:st.display==='none'||st.visibility==='hidden'||el.hasAttribute('hidden'),
        left:+r.left.toFixed(1),top:+r.top.toFixed(1),right:+r.right.toFixed(1),bottom:+r.bottom.toFixed(1),width:+r.width.toFixed(1),height:+r.height.toFixed(1),
        bg:st.backgroundColor,font:st.fontFamily}
    })
    const overlaps=[]
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
      const a=boxes[i],b=boxes[j]
      if(a.missing||b.missing||a.hidden||b.hidden)continue
      const ox=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))
      const oy=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))
      if(ox*oy>0)overlaps.push({a:a.sel,b:b.sel,area:+(ox*oy).toFixed(1)})
    }
    const outOfBounds=boxes.filter(b=>!b.missing&&!b.hidden&&(b.left<0||b.top<0||b.right>390.5||b.bottom>844.5))
    return {boxes,overlaps,outOfBounds}
  })
  assert(hud.boxes.every(b=>!b.missing&&!b.hidden),`missing HUD: ${JSON.stringify(hud.boxes)}`)
  assert(hud.boxes.filter(b=>b.sel.startsWith('.walk-ui .btn-')).every(b=>(b.bg.includes('24, 40, 37')||b.bg.includes('28, 44, 42'))&&b.font.includes('Noto Serif SC')),`HUD style mismatch: ${JSON.stringify(hud.boxes)}`)
  assert.deepEqual(hud.overlaps,[],`HUD overlap: ${JSON.stringify(hud)}`)
  assert.deepEqual(hud.outOfBounds,[],`HUD out of bounds: ${JSON.stringify(hud)}`)

  // Tap sprint toggle so screenshot also shows active HUD harmony, then verify touch look + joystick + jump.
  await mobile.locator('.walk-ui .btn-run').tap()
  await mobile.waitForFunction(()=>document.querySelector('.walk-ui .btn-run')?.classList.contains('on'))
  const mobileShot=`${outDir}/mobile-390x844.png`
  await mobile.screenshot({path:mobileShot})

  const touchTest=await mobile.evaluate(async()=>{
    const {walk}=window.viewer, canvas=document.querySelector('canvas'), joy=document.querySelector('.walk-ui .joystick'), jumpBtn=document.querySelector('.walk-ui .btn-jump')
    const yaw0=walk.yaw, dist0=walk.probe().camDist
    canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerId:10,pointerType:'touch',clientX:148,clientY:740,bubbles:true}))
    canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerId:11,pointerType:'touch',clientX:210,clientY:400,bubbles:true}))
    canvas.dispatchEvent(new PointerEvent('pointermove',{pointerId:11,pointerType:'touch',clientX:290,clientY:385,bubbles:true}))
    canvas.dispatchEvent(new PointerEvent('pointerup',{pointerId:11,pointerType:'touch',clientX:290,clientY:385,bubbles:true}))
    canvas.dispatchEvent(new PointerEvent('pointerup',{pointerId:10,pointerType:'touch',clientX:148,clientY:740,bubbles:true}))
    const yawTurn=Math.abs(walk.yaw-yaw0), pinchDrift=Math.abs(walk.probe().camDist-dist0)

    // Aim down the open street the feel test runs along; the post-look yaw points at an IDOK-38/40 frontage 1–2 m away.
    walk.face(Math.atan2(-.145,.989))
    const fwd=[-Math.sin(walk.yaw),-Math.cos(walk.yaw)], runFrom=walk.probe()
    const jr=joy.getBoundingClientRect(), cx=jr.left+jr.width/2, cy=jr.top+jr.height/2
    joy.dispatchEvent(new PointerEvent('pointerdown',{pointerId:12,pointerType:'touch',clientX:cx,clientY:cy-jr.height*.55,bubbles:true}))
    // Peak, not last-frame speed: the run may graze a roadside prop near the end; we test that the joystick reaches sprint.
    let peakSpeed=0
    for(let i=0;i<36;i++){walk.tick(1/60);peakSpeed=Math.max(peakSpeed,walk.probe().planarSpeed)}
    const moved=walk.probe()
    joy.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:12,pointerType:'touch',bubbles:true}))

    jumpBtn.dispatchEvent(new PointerEvent('pointerdown',{pointerId:13,pointerType:'touch',bubbles:true}))
    let jumped=false
    for(let i=0;i<20;i++){walk.tick(1/60);if(!walk.probe().grounded)jumped=true}
    const dx=moved.x-runFrom.x, dz=moved.z-runFrom.z, dist=Math.hypot(dx,dz)
    return {yawTurn,pinchDrift,dist,along:dist?(dx*fwd[0]+dz*fwd[1])/dist:0,speed:moved.planarSpeed,peakSpeed,jumped}
  })
  assert(touchTest.yawTurn>.2&&touchTest.pinchDrift<.01&&touchTest.dist>3.5&&touchTest.along>.9&&touchTest.peakSpeed>6&&touchTest.jumped,`touchTest: ${JSON.stringify(touchTest)}`)

  // IDOK-93 look stick: full right deflection turns the view right (same sign as a rightward drag) at cfg.lookYaw rad/s,
  // and stops dead on release.
  const lookTest=await mobile.evaluate(()=>{
    const {walk}=window.viewer, pad=document.querySelector('.walk-ui .look-stick'), r=pad.getBoundingClientRect()
    const yaw0=walk.yaw
    pad.dispatchEvent(new PointerEvent('pointerdown',{pointerId:20,pointerType:'touch',clientX:r.right+8,clientY:r.top+r.height/2,bubbles:true}))
    for(let i=0;i<30;i++)walk.tick(1/60)
    const yawRight=walk.yaw-yaw0
    pad.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:20,pointerType:'touch',bubbles:true}))
    const yaw1=walk.yaw
    for(let i=0;i<10;i++)walk.tick(1/60)
    return {yawRight,settle:Math.abs(walk.yaw-yaw1),knobReset:pad.querySelector('.look-stick-knob').style.transform===''}
  })
  assert(lookTest.yawRight<-.85&&lookTest.yawRight>-1.35&&lookTest.settle<1e-6&&lookTest.knobReset,`lookTest: ${JSON.stringify(lookTest)}`)

  // Also verify 390x844 coexistence when standing next to a parked e-bike AND next to a boat dock (.vehicle-action visible).
  const bikeCoexist=await mobile.evaluate(async()=>{
    const {walk,manifest}=window.viewer
    if(!manifest.vehicles)return {skipped:true}
    const resp=await fetch('./world/'+manifest.vehicles.file)
    const vdata=JSON.parse(await new Response((await resp.blob()).stream().pipeThrough(new DecompressionStream('gzip'))).text())
    async function checkSpot(x,z,tag){
      walk.leave();await walk.enter(x,z,0,tag)
      for(let i=0;i<4;i++){walk.tick(1/60);await new Promise(requestAnimationFrame)}
      const act=document.querySelector('.vehicle-action')
      if(!act||act.hidden||getComputedStyle(act).display==='none')return {skipped:true}
      const close=document.querySelector('.spot-card.show .card-close')
      if(close)close.click()
      await new Promise(r=>setTimeout(r,280))
      const selectors=['.walk-ui .joystick','.walk-ui .look-stick','.walk-ui .btn-run','.walk-ui .btn-crouch','.walk-ui .btn-jump','.walk-ui .btn-view','.vehicle-action','.dock','.sky-ui','output','.hud-me']
      const boxes=selectors.map(sel=>{const el=document.querySelector(sel);if(!el)return null;const st=getComputedStyle(el),r=el.getBoundingClientRect()
        return st.display==='none'||st.visibility==='hidden'||el.hasAttribute('hidden')?null:{sel,left:r.left,top:r.top,right:r.right,bottom:r.bottom}}).filter(Boolean)
      const overlaps=[]
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
        const a=boxes[i],b=boxes[j]
        const ox=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)), oy=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))
        if(ox*oy>0)overlaps.push({a:a.sel,b:b.sel,area:+(ox*oy).toFixed(1)})
      }
      return {skipped:false,overlaps,actionText:act.textContent}
    }
    const dockEntries=Object.values(vdata.docks??{})
    const dockRes=dockEntries.length?await checkSpot(dockEntries[0][0],dockEntries[0][2],'mobile-dock'):{skipped:true}
    const bike=vdata.bikes[0]
    const bikeRes=await checkSpot(bike[0],bike[2],'mobile-bike')
    return {bikeRes,dockRes}
  })
  if(!bikeCoexist.dockRes?.skipped){
    assert.deepEqual(bikeCoexist.dockRes.overlaps,[],`dock vehicle-action overlap: ${JSON.stringify(bikeCoexist.dockRes)}`)
  }
  if(!bikeCoexist.bikeRes?.skipped){
    assert.deepEqual(bikeCoexist.bikeRes.overlaps,[],`bike vehicle-action overlap: ${JSON.stringify(bikeCoexist.bikeRes)}`)
    await mobile.screenshot({path:`${outDir}/mobile-390x844-bike-nearby.png`})
    await mobile.locator('.walk-ui .btn-run').tap()
    await mobile.waitForFunction(()=>document.querySelector('.walk-ui .btn-run')?.classList.contains('on'))
    await mobile.locator('.vehicle-action').tap()
    await mobile.waitForFunction(()=>window.viewer?.walk?.vehicle==='bike'&&document.body.hasAttribute('data-aboard'))
    await mobile.evaluate(()=>window.viewer.walk.tick(1/60))
    await mobile.locator('.vehicle-action').tap()
    await mobile.waitForFunction(()=>window.viewer?.walk?.vehicle==='foot'&&!document.body.hasAttribute('data-aboard'))
    assert.equal(await mobile.evaluate(()=>document.querySelector('.walk-ui .btn-run')?.classList.contains('on')),false,'runLock should clear after boarding e-bike')
    assert.equal(await mobile.evaluate(()=>document.querySelector('.walk-ui .btn-run')?.getAttribute('aria-pressed')),'false')
  }
  // IDOK-93 landscape phone: same controls, no hit-box overlaps, all inside the viewport.
  await mobile.setViewportSize({width:844,height:390})
  await mobile.evaluate(async()=>{document.querySelector('.spot-card.show .card-close')?.click();for(let i=0;i<4;i++)await new Promise(requestAnimationFrame)})
  const land=await mobile.evaluate(()=>{
    const selectors=['.walk-ui .joystick','.walk-ui .look-stick','.walk-ui .btn-run','.walk-ui .btn-crouch','.walk-ui .btn-jump','.walk-ui .btn-view','.vehicle-action','.dock','.sky-ui','output','.hud-me']
    const boxes=selectors.map(sel=>{const el=document.querySelector(sel);if(!el)return null;const st=getComputedStyle(el),r=el.getBoundingClientRect()
      return st.display==='none'||st.visibility==='hidden'||el.closest('[hidden]')?null:{sel,left:r.left,top:r.top,right:r.right,bottom:r.bottom}}).filter(Boolean)
    const overlaps=[]
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
      const a=boxes[i],b=boxes[j]
      const ox=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)), oy=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))
      if(ox*oy>0)overlaps.push({a:a.sel,b:b.sel,area:+(ox*oy).toFixed(1)})
    }
    return {sticks:boxes.filter(b=>b.sel.includes('stick')).length,overlaps,outOfBounds:boxes.filter(b=>b.left<0||b.top<0||b.right>844.5||b.bottom>390.5).map(b=>b.sel)}
  })
  assert(land.sticks===2&&!land.overlaps.length&&!land.outOfBounds.length,`landscape HUD: ${JSON.stringify(land)}`)
  await mobile.screenshot({path:`${outDir}/mobile-844x390.png`})

  console.log('mobile 390x844 HUD & touch OK',JSON.stringify({run:+touchTest.dist.toFixed(2),along:+touchTest.along.toFixed(3),peak:touchTest.peakSpeed,lookYaw:+lookTest.yawRight.toFixed(3)}),mobileShot)
  await mobileCtx.close()

  assert.deepEqual(errors,[]);console.log('seconds',(performance.now()-start)/1000);assert(performance.now()-start<180000)
}finally{await browser?.close();await server.close()}
