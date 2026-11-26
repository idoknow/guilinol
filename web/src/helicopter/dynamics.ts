interface Point {x:number;y:number;z:number}
const clamp=(value:number,limit:number)=>Math.max(-limit,Math.min(limit,value))
const step=.05,gravity=9.81,mass=1650
export function flightTable(duration:number,target:(time:number)=>Point,ground:number){
  const at=(time:number)=>target(Math.min(duration,Math.max(0,time)))
  let {x,y,z}=at(0),vx=0,vy=0,vz=0,roll=0,pitch=0
  const initial=at(.5),final=at(duration),beforeFinal=at(duration-.5)
  let yaw=Math.atan2(initial.x-x,initial.z-z)
  const finalYaw=Math.atan2(final.x-beforeFinal.x,final.z-beforeFinal.z)
  const rows=[{x,y,z,yaw,vy,roll,pitch,speed:0}]
  for(let tick=1;tick<=duration/step;tick++){
    const time=(tick-.5)*step,goal=at(time),before=at(time-.25),after=at(time+.25)
    const desired=(axis:'x'|'y'|'z',position:number,velocity:number)=>{
      const command=(after[axis]-before[axis])*2+1.2*(goal[axis]-position)
      return (after[axis]+before[axis]-2*goal[axis])*16+2.2*(command-velocity)
    }
    const speed=Math.hypot(vx,vz),drag=.0015*speed,sine=Math.sin(yaw),cosine=Math.cos(yaw)
    const ax=desired('x',x,vx)+drag*vx,az=desired('z',z,vz)+drag*vz
    const vertical=clamp(desired('y',y,vy),1.45),support=gravity+vertical
    const side=clamp(Math.atan2(ax*cosine-az*sine,support),1.25)
    const nose=clamp(Math.atan2(ax*sine+az*cosine,support),1.25)
    roll+=(side-roll)*.32;pitch+=(nose-pitch)*.32
    const efficiency=1+.12*speed**2/(speed**2+100)+.1*Math.exp(-Math.max(0,y-ground)/6)
    const collective=mass*(support+.03*vy)/(efficiency*Math.cos(roll)*Math.cos(pitch))
    const lift=collective*efficiency/mass,up=lift*Math.cos(pitch)*Math.cos(roll)
    const right=up*Math.tan(roll),forward=up*Math.tan(pitch)
    const nextX=vx+step*(right*cosine+forward*sine-drag*vx),nextZ=vz+step*(forward*cosine-right*sine-drag*vz)
    const nextY=clamp(vy+step*(up-gravity-.03*vy),3.95)
    x+=(vx+nextX)*step/2;y+=(vy+nextY)*step/2;z+=(vz+nextZ)*step/2;vx=nextX;vy=nextY;vz=nextZ
    const heading=time>duration-1?finalYaw:Math.hypot(after.x-before.x,after.z-before.z)>.01?Math.atan2(after.x-before.x,after.z-before.z):yaw
    yaw+=clamp(Math.atan2(Math.sin(heading-yaw),Math.cos(heading-yaw)),step*.8)
    rows.push({x,y,z,yaw,vy,roll:clamp(roll*.6,25*Math.PI/180),pitch:clamp(pitch*.4,Math.PI/18),speed:Math.hypot(vx,vz)})
  }
  return (time:number)=>{
    const index=Math.min(rows.length-1,Math.max(0,time/step)),lower=Math.floor(index),fraction=index-lower
    const left=rows[lower],right=rows[Math.min(lower+1,rows.length-1)]
    const mix=(key:keyof typeof left)=>left[key]+(right[key]-left[key])*fraction
    return {x:mix('x'),y:left.y+step*(left.vy*fraction+(right.vy-left.vy)*fraction*fraction/2),z:mix('z'),yaw:mix('yaw'),roll:mix('roll'),pitch:mix('pitch'),speed:mix('speed')}
  }
}
