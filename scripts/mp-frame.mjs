export async function frameSample(page){
  return page.evaluate(async()=>{
    const times=[];let previous=0
    for(let frame=0;frame<110;frame++){
      const now=await new Promise(requestAnimationFrame)
      if(frame>=20)times.push(now-previous)
      previous=now
    }
    times.sort((left,right)=>left-right)
    return {frames:times.length,p50:times[45],p95:times[85],mean:times.reduce((sum,ms)=>sum+ms,0)/times.length}
  })
}
