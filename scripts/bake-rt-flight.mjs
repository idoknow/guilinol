import {writeFileSync} from 'node:fs'
import {aircraftPose} from '../web/src/helicopter/flight.ts'
import {services,routeVersion} from '../lib/helicopter-clock.ts'

const routes={}
for(const [mode,plan] of Object.entries(services)){
  routes[mode]=Array.from({length:plan.total+1},(_,second)=>{
    const {x,y,z}=aircraftPose(second*1000,0,mode)
    return [x,y,z].map(Math.round)
  })
}
writeFileSync(new URL('../rt/flight-paths.json',import.meta.url),JSON.stringify({version:routeVersion,routes})+'\n')
