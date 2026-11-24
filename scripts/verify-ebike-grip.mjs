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
          const distances=['l','r'].map((side,index)=>figure.getObjectByName('hand_'+side).localToWorld(new T.Vector3(0,.06,0)).distanceTo(rig.frontAssembly.localToWorld(new T.Vector3(index?.264:-.264,1.128,.168))))
          results.push({body,steerInput,wheelie,phase,distances})
          if(body==='m'&&!steerInput&&!wheelie){
            for(const [name,x,y,z] of [['detail',1.35,1.6,-.85],['overview',2.45,1.8,1.75]]){
              camera.position.set(x,y,z);camera.lookAt(0,name==='detail'?1.21:.86,-.06);renderer.render(scene,camera);window.shots[phase+'-'+name]=renderer.domElement.toDataURL()
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
  for(const result of results.filter(row=>row.phase==='after'))assert(Math.max(...result.distances)<.035,JSON.stringify(result))
} finally {await browser?.close();await server.close()}
