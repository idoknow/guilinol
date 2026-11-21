import {loadavg} from 'node:os'
import {execFileSync} from 'node:child_process'

const roots=process.argv.slice(2)
if(roots.length!==2)throw Error('Usage: node scripts/telemetry-ab.mjs MAIN_DIST PR_DIST')
const results=[[],[]]
for(let round=1;round<=5;round++){
  for(const [i,dist] of roots.entries()){
    const load=loadavg()
    const log=execFileSync(process.execPath,['scripts/flight.mjs'],{
      env:{...process.env,QA_FLIGHT_DIST:dist},encoding:'utf8',maxBuffer:2**20
    })
    const m=JSON.parse(/^FLIGHT_AB (.+)$/m.exec(log)[1])
    results[i].push(m)
    console.log(JSON.stringify({round,variant:i?'PR':'main',load,...m}))
  }
}
const median=(rows,key)=>rows.map(row=>row[key]).sort((a,b)=>a-b)[2]
const [a,b]=results
console.log(JSON.stringify({playableDeltaMs:median(b,'playable')-median(a,'playable'),
  frameP95ChangePercent:100*(median(b,'p95')/median(a,'p95')-1)}))
