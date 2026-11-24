import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const output = process.env.EBIKE_SHOT_DIR
const server = await createServer({root:'web',configFile:'web/vite.config.ts',server:{port:0},plugins:[{
  name:'grip-test-deps',resolveId(id){if(id==='/grip-deps.js')return id},
  load(id){if(id==='/grip-deps.js')return `export * as THREE from 'three';export {defaultAvatar} from ${JSON.stringify(process.cwd()+'/lib/avatar.ts')}`},
}]})
await server.listen()
let browser
try {
  browser = await chromium.launch(browserOptions())
  const page = await browser.newPage({viewport:{width:720,height:520}})
  await page.route('**/grip-test',route=>route.fulfill({contentType:'text/html',body:'<body style="margin:0"></body>'}))
  await page.goto(server.resolvedUrls.local[0]+'grip-test')
  const results = await page.evaluate(async () => {
    const {characterModel,styleCharacter} = await import('/src/walk/character.ts')
    const {defaultAvatar, THREE:T} = await import('/grip-deps.js')
    const {ensureAvatarRig} = await import('/src/walk/avatar-rig.ts')
    const {createDynamicEbike} = await import('/src/walk/vehicle-model.ts')
    const {createEbikeGripPose} = await import('/src/walk/ebike-grip.ts')
    const {applyEbikeVisualAndRider,createEbikeFxController} = await import('/src/walk/ebike-fx.ts')
    const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}); renderer.setSize(720,520);document.body.append(renderer.domElement)
    const scene=new T.Scene();scene.background=new T.Color(0xdce5e9);scene.add(new T.HemisphereLight(0xffffff,0xc8bec3,2))
    const light=new T.DirectionalLight(0xfff7e7,2);light.position.set(2,4,-2);scene.add(light)
    const camera=new T.PerspectiveCamera(31,720/520,.02,20)
    const rig=createDynamicEbike();scene.add(rig.root)
    const results=[];window.shots={}
    for (const body of ['m','f']) {
      const profile={...defaultAvatar(),body};const {scene:figure}=await characterModel(profile)
      const avatar=ensureAvatarRig(figure);styleCharacter(figure,avatar,profile);scene.add(figure)
      const solve=createEbikeGripPose(figure),fx=createEbikeFxController()
      for(const [steerInput,lean,wheelie] of [[0,0,0],[-1,-.25,0],[1,.25,0],[0,0,.4]]){
        applyEbikeVisualAndRider({figure,joints:avatar.joints,rig,basePos:new T.Vector3(),heading:0,groundPitch:0,snapMountBlend:1,mountStartPos:new T.Vector3(),mountStartYaw:0,mountStartRot:new Map(),fx,state:{speed:0,steerInput,wheelie,lean,crashPhase:'none'},dt:.016})
        for(const phase of ['before','after']){
          if(phase==='after')solve(rig.frontAssembly,1)
          for(const side of ['l','r']){
            const grip=new T.Vector3(side==='r'?.264:-.264,1.128,.168)
            const relative=name=>rig.frontAssembly.worldToLocal(figure.getObjectByName(name+'_'+side).getWorldPosition(new T.Vector3())).sub(grip)
            const fingers=['index','middle','ring','pinky']
            const roots=fingers.map(name=>relative(name+'_01')),tips=fingers.map(name=>relative(name+'_04_leaf'))
            const thumb=relative('thumb_04_leaf')
            if(phase==='after'){
              const mesh=avatar.skinnedMesh, positions=mesh.geometry.attributes.position
              const contacts=new Set()
              figure.updateMatrixWorld(true)
              for(let vertex=0;vertex<positions.count;vertex++){
                const bone=mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getX(vertex)].name
                const match=/^(index|middle|ring|pinky|thumb)_\d+_([lr])$/.exec(bone)
                if(!match || match[2]!==side || contacts.has(match[1]))continue
                const point=rig.frontAssembly.worldToLocal(mesh.localToWorld(mesh.getVertexPosition(vertex,new T.Vector3()))).sub(grip)
                if(Math.abs(point.x)<.058 && Math.abs(Math.hypot(point.y,point.z)-.020)<.012)contacts.add(match[1])
              }
              if(contacts.size!==5)throw Error(`Missing grip contact: ${body} ${side} ${steerInput} ${wheelie}: ${[...contacts]}`)
            }
            results.push({body,steerInput,wheelie,side,phase,rootMin:Math.min(...roots.map(v=>v.y)),tipMax:Math.max(...tips.map(v=>v.y)),front:Math.max(...roots.map(v=>v.z)),thumbY:thumb.y,thumbZ:thumb.z,tipRad:Math.max(...tips.map(v=>Math.hypot(v.y,v.z)))})
          }
          if(body==='m'&&!steerInput&&!wheelie){
            for(const [name,x,y,z] of [['detail',.63,1.23,-.43],['overview',2.45,1.8,1.75]]){
              camera.position.set(x,y,z);camera.lookAt(name==='detail'?.254:0,name==='detail'?1.13:.86,name==='detail'?-.26:-.06);renderer.render(scene,camera);window.shots[phase+'-'+name]=renderer.domElement.toDataURL()
            }
          }
        }
      }
      scene.remove(figure)
    }
    return results
  })
  console.table(results)
  if(output){await mkdir(output,{recursive:true});const {writeFile}=await import('node:fs/promises');for(const [name,url] of Object.entries(await page.evaluate(()=>window.shots)))await writeFile(`${output}/${name}.png`,Buffer.from(url.split(',')[1],'base64'))}
  for(const result of results.filter(row=>row.phase==='after'))assert(result.rootMin>0 && result.tipMax<0 && result.thumbY<0 && result.thumbZ>result.front && result.tipRad<.06,JSON.stringify(result))
} finally {await browser?.close();await server.close()}
