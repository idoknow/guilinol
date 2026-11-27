export function acceptSample(player,x,z,at,teleport=false){
  const samples=player.motionSamples??=[]
  while(samples.length && samples[0].at<at-1000)samples.shift()
  if(teleport || at-(samples.at(-1)?.at??at)>500)samples.length=0
  const previous=samples.at(-1)
  const distance=previous ? previous.distance+Math.hypot(x-previous.x,z-previous.z) : 0
  samples.push({x,z,at,distance})
}

export function acceptedSpeed(player,at){
  const samples=player.motionSamples,first=samples?.[0],last=samples?.at(-1)
  if(!last || at-last.at>500 || last.at-first.at<250)return null
  return +(1000*(last.distance-first.distance)/(last.at-first.at)).toFixed(2)
}
