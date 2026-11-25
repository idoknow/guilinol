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
  let a=sampleAxle(track,dist+front),b=sampleAxle(track,dist+rear)
  let frontY=a.height-a.cross*leftOffset,rearY=b.height-b.cross*leftOffset
  const incline=(frontY-rearY)/(front-rear)
  let pitch=-Math.atan(incline)
  if(Math.abs(incline)>.1){
    // Pitch shortens the horizontal wheelbase. Intersect the rotated axles
    // with their own stations before locating the rigid body's origin.
    const projected=Math.cos(pitch)
    a=sampleAxle(track,dist+front*projected)
    b=sampleAxle(track,dist+rear*projected)
    frontY=a.height-a.cross*leftOffset
    rearY=b.height-b.cross*leftOffset
    pitch=-Math.atan2(frontY-rearY,(front-rear)*projected)
  }
  const cross=halfTrack?(a.cross+b.cross)/2:0
  const y=Math.abs(incline)>.1?rearY+rear*Math.sin(pitch):rearY-rear*incline
  const roll=Math.atan(cross*Math.cos(pitch))
  if(!halfTrack || Math.abs(incline)<.35 || Math.abs(a.cross-b.cross)<.25)return {y,pitch,roll}
  // On a steep, twisted grade the left and right hubs project onto distinct
  // longitudinal stations. Balance their residuals using the model's track.
  const cp=Math.cos(pitch),sp=Math.sin(pitch),sr=Math.sin(roll),cr=Math.cos(roll)
  const origins=[]
  for(const forward of [rear,front])for(const side of [-halfTrack,halfTrack]){
    const axle=sampleAxle(track,dist+forward*cp+side*sr*sp)
    origins.push(axle.height+axle.cross*(side*cr-leftOffset)-side*sr*cp+forward*sp)
  }
  return {y:(Math.min(...origins)+Math.max(...origins))/2,pitch,roll}
}
export function axleHeight(track:LaneSurface,dist:number){
  return sampleAxle(track,dist).height
}
