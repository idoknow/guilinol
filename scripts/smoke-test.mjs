import test from 'node:test'
import assert from 'node:assert/strict'
import {SmokeSession,RemoteSmoke} from '../web/src/smoke/session.ts'
import {queueCigarette,takeCigaretteIntent} from '../web/src/citizen/use-item.ts'

test('same-tab backpack intent can only be consumed once',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}
  queueCigarette(storage);assert.equal(takeCigaretteIntent(storage),true);assert.equal(takeCigaretteIntent(storage),false)
})
import {executePurchase} from '../web/src/game/commerce.ts'
import {resetSaveForTesting,getActiveSaveSnapshot,openPack,takeFromPack,loadLocalSave,setSaveStorageForTest} from '../web/src/game/save.ts'
function buy(id,key){
  return executePurchase({shopId:'smoke',itemType:'cigarette_pack',itemId:id,expectedPrice:25,idempotencyKey:key})
}
test('shop caps inventory atomically and discard never charges a second cigarette',()=>{
  resetSaveForTesting(100)
  const session=new SmokeSession()
  assert.equal(session.start(getActiveSaveSnapshot().packs[0]?.brand),false)
  for(let n=0;n<3;n++)assert.equal(buy('bailong',String(n)).code,'OK')
  assert.equal(buy('bailong','4').code,'ALREADY_FULL')
  assert.equal(getActiveSaveSnapshot().money,25)
  session.start('bailong')
  session.advance(1.5)
  const take=()=>takeFromPack('bailong')
  session.act(take);session.advance(1.5);session.act(take);session.advance(1.5)
  session.stop()
  assert.equal(getActiveSaveSnapshot().packs[0].remaining,19)
  resetSaveForTesting(0)
  assert.equal(buy('bailong','5').code,'INSUFFICIENT_FUNDS')
})
test('seeded burn interval and ten segments with single and double puffs',()=>{
  let seed=37
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32)
  const counts=new Set()
  for(let n=0;n<50;n++){
    const session=new SmokeSession(random)
    session.start('hehua')
    assert(session.total>=150 && session.total<=180)
    for(const phase of ['sealed','open','ready']){
      session.advance(1.5);assert.equal(session.phase,phase);assert(session.act(()=>true))
    }
    session.advance(1.5)
    assert(session.lit)
    session.act(()=>true)
    counts.add(session.strength)
    assert(Math.abs(session.length-(1-session.strength/10))<1e-10)
    assert(!session.act(()=>true))
    assert(session.advance(session.burn));assert(!session.active)
  }
  assert.deepEqual(counts,new Set([1,2]))
})
test('remote keeps legacy wire codes and decodes reopened packs and new brands',()=>{
  const peer=new RemoteSmoke()
  for(const [i,phase] of ['idle','light','smoking','draw','sealed','tear','open','take','ready','drawOpened'].entries()){
    const brand=i===9?11:5
    peer.update(i,1800,0,brand,.1)
    assert.equal(peer.view().phase,phase)
    assert.equal(peer.view().brand,i===9?'dangui':'lijiang')
  }
})

test('mixed packs survive reload and an empty pack advances to the next brand',()=>{
  const disk=new Map()
  const storage={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v),removeItem:k=>disk.delete(k)}
  setSaveStorageForTest(storage)
  resetSaveForTesting(200,storage)
  loadLocalSave(storage)
  assert.equal(buy('bailong','first').code,'OK')
  assert.equal(executePurchase({shopId:'smoke',itemType:'cigarette_pack',itemId:'hehua',expectedPrice:38,idempotencyKey:'second'}).code,'OK')
  assert(openPack('bailong'))
  assert.deepEqual(loadLocalSave(storage).save.packs[0],{brand:'bailong',remaining:20,opened:true})
  for(let i=0;i<19;i++)assert(takeFromPack('bailong'))
  assert.deepEqual(loadLocalSave(storage).save.packs,[{brand:'bailong',remaining:1,opened:true},{brand:'hehua',remaining:20,opened:false}])
  assert(takeFromPack('bailong'))
  assert(!takeFromPack('bailong'))
  assert.deepEqual(loadLocalSave(storage).save.packs,[{brand:'hehua',remaining:20,opened:false}])
})

import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname,join} from 'node:path'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {fingerPose} from '../web/src/walk/ebike-grip.ts'
import {cameraHoldLayer,DEFAULT_CAMERA_HOLD_AIM} from '../web/src/walk/camera-hold.ts'
import {smokingHand} from '../web/src/smoke/hands.ts'
import {firstPersonArms} from '../web/src/smoke/first-person-arms.ts'
import {SmokeKit,VIEW_ANCHORS} from '../web/src/smoke/kit.ts'
import {emotePlayback} from '../web/src/emote/playback.ts'
import {ensureAvatarRig} from '../web/src/walk/avatar-rig.ts'

async function loadCreatorFigure(file='figure_m.glb'){
  const avatarDir=join(dirname(fileURLToPath(import.meta.url)),'../public/avatar')
  const origLoad=THREE.FileLoader.prototype.load
  THREE.FileLoader.prototype.load=function(url,onLoad){
    const name=String(url).replace(/^.*\//,'')
    const raw=readFileSync(join(avatarDir,name))
    const ab=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)
    setImmediate(()=>onLoad(ab))
  }
  try{
    const raw=readFileSync(join(avatarDir,file))
    const ab=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)
    return await new Promise((resolve,reject)=>new GLTFLoader().parse(ab,'avatar/',resolve,reject))
  }finally{
    THREE.FileLoader.prototype.load=origLoad
  }
}

function quatDiff(a,b){
  return a.clone().normalize().angleTo(b.clone().normalize())
}

test('fingerPose reads bind pose even when constructed mid-idle or mid-cameraHold',async()=>{
  const bindModel=await loadCreatorFigure('figure_m.glb')
  const posedModel=await loadCreatorFigure('figure_m.glb')
  ensureAvatarRig(bindModel.scene)
  ensureAvatarRig(posedModel.scene)

  const bindCurlR=fingerPose(bindModel.scene,'r',1)
  const bindCurlL=fingerPose(bindModel.scene,'l',-1)

  const mixer=new THREE.AnimationMixer(posedModel.scene)
  const idle=mixer.clipAction(posedModel.animations.find(c=>c.name==='idle'))
  idle.reset().setEffectiveWeight(1).play()
  mixer.update(0.25)
  const hold=cameraHoldLayer(posedModel.scene)
  hold.apply(1,{...DEFAULT_CAMERA_HOLD_AIM})

  const posedCurlR=fingerPose(posedModel.scene,'r',1)
  const posedCurlL=fingerPose(posedModel.scene,'l',-1)
  assert.equal(posedCurlR.length,bindCurlR.length)
  assert.equal(posedCurlL.length,bindCurlL.length)
  for(let i=0;i<bindCurlR.length;i++){
    assert(quatDiff(bindCurlR[i].rotation,posedCurlR[i].rotation)<1e-4,`right finger ${i} curl drifted from bind pose`)
    assert(quatDiff(bindCurlL[i].rotation,posedCurlL[i].rotation)<1e-4,`left finger ${i} curl drifted from bind pose`)
  }
})

test('smokingHand apply is idempotent, supports smooth blend, and LIFO resets with cameraHold + emote',async()=>{
  const model=await loadCreatorFigure('figure_m.glb')
  const fig=model.scene
  ensureAvatarRig(fig)
  const mixer=new THREE.AnimationMixer(fig)
  const idle=mixer.clipAction(model.animations.find(c=>c.name==='idle'))
  idle.reset().setEffectiveWeight(1).play()
  mixer.update(0.2)

  const boneNames=['upperarm_r','lowerarm_r','hand_r','index_01_r','middle_01_r','ring_01_r','pinky_01_r','thumb_01_r']
  const idleQuats=boneNames.map(n=>fig.getObjectByName(n).quaternion.clone())

  const hold=cameraHoldLayer(fig)
  const handR=smokingHand(fig,'r')
  const emote=emotePlayback(fig,undefined,mixer)
  assert(handR)

  const target=new THREE.Group()
  target.position.set(0.06,1.46,-0.22)
  fig.add(target)
  fig.updateMatrixWorld(true)

  // Smooth blend: blend=0.5 sits strictly between idle and blend=1.0
  handR.apply('puff',target,1)
  const fullUpper=fig.getObjectByName('upperarm_r').quaternion.clone()
  handR.reset()
  handR.apply('puff',target,0.5)
  const midUpper=fig.getObjectByName('upperarm_r').quaternion.clone()
  assert(quatDiff(midUpper,idleQuats[0])>0.05,'half-blended puff must move away from idle')
  assert(quatDiff(midUpper,fullUpper)>0.05,'half-blended puff must not snap to full puff')

  // Idempotent double apply must still restore exact idle pose on reset()
  handR.apply('puff',target,1)
  handR.apply('puff',target,1)
  handR.reset()
  boneNames.forEach((n,i)=>{
    assert(quatDiff(fig.getObjectByName(n).quaternion,idleQuats[i])<1e-5,`${n} leaked after double smokingHand.apply`)
  })

  // Overlapping cameraHold -> smokingHand -> emote with strict LIFO reset never bakes finger pose
  emote.play(1)
  for(let f=0;f<5;f++){
    emote.reset()
    handR.reset()
    hold.reset()
    mixer.update(1/60)
    hold.apply(f<3?0.6:0,{...DEFAULT_CAMERA_HOLD_AIM})
    if(f<4)handR.apply('puff',target,0.8)
    emote.tick(1/60,false)
  }
  emote.stop()
  emote.reset()
  handR.reset()
  hold.reset()
  const nextIdle=boneNames.map(n=>fig.getObjectByName(n).quaternion.clone())
  // Finger tracks are constant in idle; verify exact preservation against initial idleQuats
  for(let i=3;i<boneNames.length;i++){
    assert(quatDiff(nextIdle[i],idleQuats[i])<1e-5,`${boneNames[i]} drifted after overlapping hold/smoke/emote`)
  }
  handR.dispose()
})

test('firstPersonArms dispose preserves original SkinnedMesh shared BufferAttributes',async()=>{
  const model=await loadCreatorFigure('figure_m.glb')
  const fig=model.scene
  const props=new THREE.Group()
  fig.add(props)
  const mesh=fig.getObjectByProperty('isSkinnedMesh',true)
  const origGeom=mesh.geometry
  const origAttrs=Object.entries(origGeom.attributes)
  const mask=firstPersonArms(fig,props)
  mask.show(true)
  assert.notEqual(mesh.geometry,origGeom)
  const subset=mesh.geometry
  let origDisposed=false
  origGeom.addEventListener('dispose',()=>{origDisposed=true})
  mask.dispose()
  assert.equal(mesh.geometry,origGeom,'original geometry must be restored')
  assert.equal(origDisposed,false,'original geometry must not be disposed')
  assert.equal(Object.keys(subset.attributes).length,0,'subset must detach borrowed attributes before dispose')
  for(const [name,attr] of origAttrs){
    assert.equal(origGeom.getAttribute(name),attr,`original attribute ${name} must stay attached`)
  }
})

test('SmokeKit hides pack immediately on ready/light/smoking and resets carry across sessions',()=>{
  const noop=()=>{}
  const ctxStub={
    fillStyle:'',strokeStyle:'',lineWidth:1,font:'',textAlign:'',textBaseline:'',globalAlpha:1,
    fillRect:noop,strokeRect:noop,clearRect:noop,beginPath:noop,closePath:noop,moveTo:noop,lineTo:noop,
    arc:noop,ellipse:noop,fill:noop,stroke:noop,fillText:noop,save:noop,restore:noop,translate:noop,rotate:noop,scale:noop,
    quadraticCurveTo:noop,bezierCurveTo:noop,roundRect:noop,
    createLinearGradient:()=>({addColorStop:noop}),
    createRadialGradient:()=>({addColorStop:noop}),
    measureText:()=>({width:20}),
  }
  const prevDoc=globalThis.document
  const makeEl=()=>({width:0,height:0,getContext:()=>ctxStub,addEventListener:noop,removeEventListener:noop})
  globalThis.document={createElement:makeEl,createElementNS:(_ns,_tag)=>makeEl()}
  try{
    const scene=new THREE.Scene()
    const kit=new SmokeKit(scene,'bailong')
    const anchors={
      handL:VIEW_ANCHORS.handL.clone(),
      handR:VIEW_ANCHORS.handR.clone(),
      mouth:new THREE.Vector3(0,-0.044,-0.08),
      forward:new THREE.Vector3(0,-0.08,-1).normalize(),
    }
    const session=new SmokeSession(()=>0.5)
    session.start('bailong',20)
    session.advance(1.5) // sealed
    for(let i=0;i<15;i++)kit.apply(session.view(),anchors)
    assert.equal(kit.pack.visible,true)

    session.act(()=>true);session.advance(1.5) // open
    session.act(()=>true);session.advance(1.5) // ready (skipping gradual carry decay at low FPS)
    kit.apply(session.view(),anchors)
    assert.equal(kit.pack.visible,false,'pack must not linger into ready phase')
    assert.equal(kit.lighter.visible,true)

    session.act(()=>true);session.advance(1.5) // smoking
    kit.apply(session.view(),anchors)
    assert.equal(kit.pack.visible,false,'pack must never resurface during smoking idle')
    assert.equal(kit.lighter.visible,false,'lighter must hide during smoking idle')
    assert.equal(kit.cigarette.visible,true)

    kit.resetState()
    assert.equal(kit.cigarette.visible,false)
    kit.dispose()
  }finally{
    if(prevDoc===undefined)delete globalThis.document
    else globalThis.document=prevDoc
  }
})


import {readPacks,brandOf,validRules,smokeDefaults,formatSmokeCount,isLowSmokeBurn} from '../web/src/smoke/data.ts'
test('opened full and legacy partial packs skip the foil',()=>{
  for(const [remaining,opened,phase] of [[20,false,'sealed'],[20,true,'open'],[19,undefined,'open']]){
    const [pack]=readPacks([{brand:'dangui',remaining,opened}])
    const session=new SmokeSession()
    session.start(pack.brand,pack.remaining,pack.opened)
    session.advance(1)
    assert.equal(session.phase,phase)
  }
})
test('brand details and inclusive shop price limits',()=>{
  assert.equal(brandOf('letu').length,70)
  assert.equal(brandOf('yidianhong').filterDot,'#bc2428')
  for(const price of [4,5,60,61]){
    assert.equal(validRules({...smokeDefaults,brands:[{id:'letu',price}]}),price>=5&&price<=60)
  }
})
test('taking a cigarette deducts 1 stick and updates remaining view + HUD text',()=>{
  resetSaveForTesting(200)
  assert.equal(buy('bailong','take-1').code,'OK')
  const pack=getActiveSaveSnapshot().packs[0]
  const session=new SmokeSession(()=>0.5)
  assert.equal(session.start(pack.brand,pack.remaining,pack.opened),true)
  session.advance(1.5) // sealed
  session.act(()=>takeFromPack(session.brand),()=>openPack(session.brand))
  session.advance(1.5) // open
  assert.equal(session.view().cig,0)
  assert.equal(session.act(()=>takeFromPack(session.brand),()=>openPack(session.brand)),true)
  assert.equal(getActiveSaveSnapshot().packs[0].remaining,19)
  assert.equal(session.view().remaining,19)
  assert.equal(session.view().cig,1)
  assert.equal(formatSmokeCount(session.view().remaining,getActiveSaveSnapshot().packs.length,'hud'),'剩余 19 / 20')
  assert.equal(formatSmokeCount(getActiveSaveSnapshot().packs[0].remaining,getActiveSaveSnapshot().packs.length,'backpack'),'剩余 19 / 20')
})
test('taking the 20th stick shifts empty pack out and shows exhausted backpack state',()=>{
  resetSaveForTesting(200)
  assert.equal(buy('bailong','pack-exhaust').code,'OK')
  for(let i=0;i<19;i++)assert.equal(takeFromPack('bailong'),true)
  const lastPack=getActiveSaveSnapshot().packs[0]
  assert.equal(lastPack.remaining,1)
  const session=new SmokeSession(()=>0.5)
  assert.equal(session.start(lastPack.brand,lastPack.remaining,lastPack.opened),true)
  session.advance(1.5) // open
  assert.equal(session.act(()=>takeFromPack(session.brand),()=>openPack(session.brand)),true)
  assert.equal(getActiveSaveSnapshot().packs.length,0)
  assert.equal(session.view().remaining,0)
  assert.equal(formatSmokeCount(0,0,'hud'),'剩余 0 / 20')
  assert.equal(formatSmokeCount(0,0,'backpack'),'已抽完')
  assert.equal(formatSmokeCount(19,2,'hud'),'剩余 19 / 20 · 共 2 盒')
  assert.equal(formatSmokeCount(19,2,'backpack'),'剩余 19 / 20 · 共 2 盒')
})
test('puff drops burn progress by 1 segment or 2 segments with seeded random and marks low at <= 2 segments',()=>{
  // Seeded single-puff (random >= 0.2) drops 1/10 of total
  const single=new SmokeSession(()=>0.5)
  single.start('hehua',20,true)
  single.advance(1.5) // open
  single.act(()=>true) // take
  single.advance(1.5) // ready
  single.act(()=>true) // light
  single.advance(1.5) // smoking
  assert.equal(single.view().length,1)
  assert.equal(single.act(()=>true),true)
  assert.equal(single.strength,1)
  assert(Math.abs(single.view().length-0.9)<1e-10)
  assert.equal(isLowSmokeBurn(single.view().length),false)

  // Seeded double-puff (random < 0.2) drops 2/10 of total and triggers low state at <= 2 segments
  const dbl=new SmokeSession(()=>0.1)
  dbl.start('hehua',20,true)
  dbl.advance(1.5);dbl.act(()=>true);dbl.advance(1.5);dbl.act(()=>true);dbl.advance(1.5)
  assert.equal(dbl.act(()=>true),true)
  assert.equal(dbl.strength,2)
  assert(Math.abs(dbl.view().length-0.8)<1e-10)
  for(let i=0;i<3;i++){
    dbl.advance(1.5)
    assert.equal(dbl.act(()=>true),true)
  }
  assert(dbl.view().length<=0.2+1e-6)
  assert.equal(isLowSmokeBurn(dbl.view().length),true)
})
