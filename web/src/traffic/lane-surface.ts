// Samples include both bumpers beyond each track end so axles straddling a node
// still use their own road heights. Intermediate metre samples on straight
// grades are linearly reconstructed between the packed knots.
export const profilePad=2.5
export interface LaneSurface {
  floor?:string
  knots?:Int32Array
  length:number
}

function knots(track:LaneSurface){
  if(track.knots)return track.knots
  const bytes=atob(track.floor!),values:number[]=[]
  let cursor=0,station=0,height=0
  function unsigned(){
    let value=0,scale=1
    while(cursor<bytes.length){
      const byte=bytes.charCodeAt(cursor++)
      value+=(byte&127)*scale
      if(byte<128)return value
      scale*=128
    }
    throw Error('Truncated lane profile')
  }
  while(cursor<bytes.length){
    station+=unsigned()
    const delta=unsigned()
    height+=(delta>>>1)^-(delta&1)
    const cross=bytes.charCodeAt(cursor++)
    values.push(station,height,cross>127?cross-256:cross)
  }
  return track.knots=Int32Array.from(values)
}

function sampleAxle(track:LaneSurface,dist:number){
  const samples=knots(track),last=samples.length-3
  const station=Math.max(0,Math.min(samples[last],(dist+profilePad)*samples[last]/(track.length+2*profilePad)))
  let lo=0,hi=last/3
  while(hi-lo>1){
    const mid=(lo+hi)>>>1
    if(samples[3*mid]<=station)lo=mid
    else hi=mid
  }
  const a=3*lo,b=3*hi,t=(station-samples[a])/(samples[b]-samples[a])
  return {height:((1-t)*samples[a+1]+t*samples[b+1])/100,cross:((1-t)*samples[a+2]+t*samples[b+2])/128}
}

export function contactPose(track:LaneSurface,dist:number,front=1.34,rear=-1.31,halfTrack=.795,leftOffset=0){
  const a=sampleAxle(track,dist+front),b=sampleAxle(track,dist+rear)
  const frontY=a.height-a.cross*leftOffset,rearY=b.height-b.cross*leftOffset
  const incline=(frontY-rearY)/(front-rear),cross=halfTrack?(a.cross+b.cross)/2:0
  return {y:rearY-rear*incline,pitch:-Math.atan(incline),roll:Math.atan(cross/Math.hypot(1,incline))}
}
export function axleHeight(track:LaneSurface,dist:number){
  return sampleAxle(track,dist).height
}
