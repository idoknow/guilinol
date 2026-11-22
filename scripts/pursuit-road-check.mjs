export async function checkRoads(){
  const {Traffic}=await import('/src/traffic/sim.ts'),{Pursuit}=await import('/src/traffic/pursuit.ts')
  const {getState,onEvent}=await import('/src/game/state.ts')
  const response=await fetch('/world/roads/graph.json.gz')
  if(!response.ok)throw Error('Missing real traffic graph')
  const bytes=await response.arrayBuffer(),magic=new Uint8Array(bytes,0,2)
  const body=magic[0]===31&&magic[1]===139?new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')):bytes
  const graph=JSON.parse(await new Response(body).text()),sim=new Traffic(graph)
  const motor=[...sim.allTracks()].filter(track=>!track.walk&&track.kind==='motor')
  const signals=new Set(graph.signals.map(signal=>signal.node)),exits=new Map()
  for(const track of motor){const list=exits.get(track.from)??[];list.push(track);exits.set(track.from,list)}
  const dt=.05,stride=11*dt,chase=new Pursuit()
  function drive(track,along,lateral){
    const offset=track.offset+lateral
    chase.step(dt,sim,{x:track.start.x+track.dx*along-track.dz*offset,z:track.start.z+track.dz*along+track.dx*offset,
      y:track.start.y+(track.end.y-track.start.y)*Math.min(1,along/track.length)},'test-car')
  }
  const results=[]
  for(const lateral of [0,-.6,.6,-1,1]){
    let seed=12345,meters=0,junctions=0,signalPasses=0
    sim.time=0
    const random=()=>(seed=seed*16807%2147483647)/2147483647
    const counts={'wrong-way':0,sidewalk:0,red:0,collision:0}
    const off=onEvent(event=>{if(event.type==='traffic:violation')counts[event.reason]++})
    for(let run=0;run<60;run++){
      chase.end('clear')
      let track=motor[Math.floor(random()*motor.length)],along=0
      for(let frame=0;frame<6000;frame++){
        sim.time+=dt
        let move=stride
        if(along+move>=track.length){
          if(signals.has(track.to)&&sim.phase(track)!=='green')move=0
          else{
            const choices=(exits.get(track.to)??[]).filter(next=>next.to!==track.from)
            if(!choices.length)break
            along+=move-track.length;if(signals.has(track.to))signalPasses++;junctions++
            track=choices[Math.floor(random()*choices.length)];move=0
          }
        }
        along+=move;meters+=move;drive(track,along,lateral)
      }
    }
    off();results.push({lateral,meters:Math.round(meters),junctions,signalPasses,counts})
  }
  chase.end('clear');sim.time=0
  const approach=motor.find(track=>track.length>20&&signals.has(track.to)&&sim.phase(track)==='red'&&sim.phase(track,2)==='red')
  if(!approach)throw Error('No red signal approach')
  const reasons=[],off=onEvent(event=>{if(event.type==='traffic:violation')reasons.push(event.reason)})
  for(let index=-10;index<=1;index++){sim.time+=dt;drive(approach,approach.length+index,0)}
  off();return {results,red:{node:approach.to,lane:approach.id,wanted:getState().wanted,reasons}}
}
