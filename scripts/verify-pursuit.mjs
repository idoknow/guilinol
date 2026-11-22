import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const server=await createServer({root:'web',configFile:'web/vite.config.ts',server:{port:0,host:'127.0.0.1'}})
await server.listen()
let browser
try {
  browser=await chromium.launch(browserOptions())
  const page=await browser.newPage()
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`
  await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<title>G4</title>'}))
  await page.goto(`${origin}/fixture`)
  const result=await page.evaluate(async()=>{
    const {Pursuit}=await import('/src/traffic/pursuit.ts'),{Traffic}=await import('/src/traffic/sim.ts')
    const {getState,setMission,onEvent}=await import('/src/game/state.ts')
    const {resetSaveForTesting}=await import('/src/game/save.ts')
    const {isPointInQuietZone}=await import('/src/game/quiet-zones.ts')
    resetSaveForTesting(200)
    const events=[];onEvent(event=>events.push(event))
    const node=(id,x,z=0)=>({id,x,y:0,z}),lane=(from,to)=>({id:from,from,to,kind:'motor',offset:0,speedKmh:40})
    const graph=new Traffic({nodes:[node(1,9900),node(2,10100),node(3,10180)],lanes:[lane(1,2),lane(2,3)],walks:[[1,2,4]],
      signals:[{node:2,offset:0,phases:[{lanes:[2],green:15,yellow:2}]}]})
    const chase=new Pursuit(),levels=[]
    const drive=(x,z=0,id='cab',sim=graph)=>{
      chase.step(.1,sim,{x,y:0,z},id)
      for(const car of chase.officers)if(isPointInQuietZone(car.x,car.z))throw Error('officer inside quiet zone')
      return getState().wanted
    }
    setMission({id:'taxi',title:'taxi',step:'drive'})
    drive(10030,4);levels.push(drive(10031,4));drive(10032);levels.push(drive(10031))
    for(let step=0;step<54;step++)drive(10032+step)
    levels.push(drive(10086,4));drive(10087);levels.push(drive(10086));drive(10092);drive(10099)
    levels.push(drive(10100));graph.actors.push({kind:'car',x:10102,z:0,y:0,scale:1});drive(10102)
    const maxCars=chase.officers.length
    for(let step=0;step<82;step++)drive(10300+step,0)
    const escaped=getState().wanted
    setMission({id:'race',title:'race',step:'drive'})
    drive(10060,4);drive(10061,4);drive(10062,0)
    for(let step=0;step<90;step++)drive(10062)
    const fined=JSON.parse(localStorage.getItem('glol.save.v1')).money
    drive(10063,4);drive(10064,4);drive(10064,4,'second-car')
    const crossing=new Traffic({nodes:[node(1,-750,-600),node(2,-550,-600)],lanes:[lane(1,2)],walks:[[1,2,4]],signals:[]})
    drive(-747,-596,'second-car',crossing);drive(-746,-596,'second-car',crossing)
    return {levels,maxCars,escaped,fined,events,unsafeLaneWanted:getState().wanted,unsafeLaneOfficers:chase.officers.length}
  })
  assert.deepEqual(result.levels,[1,2,3,4,5]);assert.equal(result.maxCars,5);assert.equal(result.escaped,0)
  assert.equal(result.fined,165);assert.equal(result.events.filter(event=>event.type==='fine').length,1)
  assert.deepEqual(result.events.filter(event=>event.type==='pursuit:end').map(event=>event.reason),['lost','fine','switch'])
  assert.equal(result.unsafeLaneWanted,1);assert.equal(result.unsafeLaneOfficers,0)
  console.log(JSON.stringify(result))
} finally {await browser?.close();await server.close()}
