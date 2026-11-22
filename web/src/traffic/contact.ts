export type Solid={x:number,y:number,z:number,yaw:number,halfWidth:number,halfLength:number,height:number,holdUntil?:number}
type Point={x:number,y:number,z:number}
export const cellKey=(col:number,row:number)=>col*65536+row
type Visit=(x:number,z:number,callback:(solid:Solid)=>void)=>void
export class SolidGrid {
  private bins=new Map<number,Set<Solid>>()
  add(solid:Solid){
    const keys:number[]=[]
    for(let east=Math.floor((solid.x-7)/16);east<=Math.floor((solid.x+7)/16);east++)for(let south=Math.floor((solid.z-7)/16);south<=Math.floor((solid.z+7)/16);south++){
      const key=cellKey(east,south);let bin=this.bins.get(key)
      if(!bin){bin=new Set();this.bins.set(key,bin)}bin.add(solid);keys.push(key)
    }
    return ()=>{for(const key of keys){const bin=this.bins.get(key);if(bin?.delete(solid)&&!bin.size)this.bins.delete(key)}}
  }
  clear(){this.bins.clear()}
  near:Visit=(x,z,callback)=>{
    const bin=this.bins.get(cellKey(Math.floor(x/16),Math.floor(z/16)));if(bin)for(const solid of bin)callback(solid)
  }
  hasNearby(x:number,z:number){return this.bins.size!==0&&this.bins.has(cellKey(Math.floor(x/16),Math.floor(z/16)))}
}
export const pickups=new SolidGrid(),curbside=new SolidGrid()
export const nearStatic=(x:number,z:number)=>pickups.hasNearby(x,z)||curbside.hasNearby(x,z)
export const staticSolids:Visit=(x,z,callback)=>{pickups.near(x,z,callback);curbside.near(x,z,callback)}
let visit:Visit|undefined
export function useTrafficSolids(source?:Visit){visit=source}
export const contactSamples:number[]=[]
let sampling=false,sampleIndex=0
export function sampleContacts(enabled:boolean){sampling=enabled}

export function resolveContact(point:Point,footY:number,yaw:number,width:number,length:number,source=visit){
  const start=sampling?performance.now():0
  let hit=false
  source?.(point.x,point.z,solid=>{
    if(footY>=solid.y+solid.height||footY+1.5<=solid.y)return
    const dx=point.x-solid.x,dz=point.z-solid.z
    const reach=width+length+solid.halfWidth+solid.halfLength
    if(dx*dx+dz*dz>reach*reach)return
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
  if(sampling)contactSamples[sampleIndex++%1024]=performance.now()-start
  return hit
}
