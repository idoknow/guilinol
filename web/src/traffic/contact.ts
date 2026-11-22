export type Solid={x:number,y:number,z:number,yaw:number,halfWidth:number,halfLength:number,height:number,holdUntil?:number}
type Point={x:number,y:number,z:number}
export const cellKey=(col:number,row:number)=>col*65536+row
type Visit=(x:number,z:number,callback:(solid:Solid)=>void)=>void
let visit:Visit|undefined
export function useTrafficSolids(source?:Visit){visit=source}

export function resolveContact(point:Point,footY:number,yaw:number,width:number,length:number){
  let hit=false
  visit?.(point.x,point.z,solid=>{
    if(footY>=solid.y+solid.height||footY+1.5<=solid.y)return
    const dx=point.x-solid.x,dz=point.z-solid.z
    const cs=Math.cos(solid.yaw),sn=Math.sin(solid.yaw)
    let pushX=0,pushZ=0
    if(!length){
      const lateral=dx*cs-dz*sn,along=dx*sn+dz*cs
      const gapW=Math.abs(lateral)-solid.halfWidth,gapL=Math.abs(along)-solid.halfLength
      const outerW=Math.max(0,gapW),outerL=Math.max(0,gapL),distance=Math.hypot(outerW,outerL)
      if(distance>=width)return
      const stepW=(distance?outerW/distance*(width-distance):gapW>=gapL?width-gapW:0)*(lateral<0?-1:1)
      const stepL=(distance?outerL/distance*(width-distance):gapL>gapW?width-gapL:0)*(along<0?-1:1)
      pushX=stepW*cs+stepL*sn;pushZ=-stepW*sn+stepL*cs
    }else{
      const cp=Math.cos(yaw),sp=Math.sin(yaw)
      let min=Infinity
      for(const [ax,az] of [[cs,-sn],[sn,cs],[cp,-sp],[sp,cp]]){
        const center=dx*ax+dz*az
        const depth=width*Math.abs(cp*ax-sp*az)+length*Math.abs(sp*ax+cp*az)+solid.halfWidth*Math.abs(cs*ax-sn*az)+solid.halfLength*Math.abs(sn*ax+cs*az)-Math.abs(center)
        if(depth<=0)return
        if(depth<min){min=depth;pushX=ax*depth*(center<0?-1:1);pushZ=az*depth*(center<0?-1:1)}
      }
    }
    point.x+=pushX;point.z+=pushZ;hit=true
    solid.holdUntil=performance.now()+250
  })
  return hit
}
