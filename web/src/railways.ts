import {Color,Vector3} from 'three'
import style from '../../pipeline/railway-style.json'
import {look} from './look/config'

/** Local x,z,y at both ends in cm, chainage in cm, flags and optional portal bits. */
export type RailSection=[number,number,number,number,number,number,number,number,number?]
export type CrossingSign=[number,number,number,number]
type Box=(x:number,y:number,z:number,w:number,h:number,d:number,yaw:number,tint:Color,pitch?:number)=>void
export type RailFace=(a:Vector3,b:Vector3,c:Vector3,color:Color,along:number[],kind:number)=>void
const ballast=new Color(style.ballast),steel=new Color(style.steel),panel=new Color(style.panel)
const pole=new Color(style.pole),wire=new Color(style.wire),fence=new Color(style.fence)
const sleeper=new Color(style.sleeper),warning=new Color(style.warning),concrete=new Color(look.bridgeSide)
const BRIDGE=1,TUNNEL=2,ELECTRIC=4,FENCE=8,LEVEL=16,RESERVED=32,PAINTED=64

export function railwayGeometry(sections:RailSection[],signs:CrossingSign[],ground:(x:number,z:number)=>number,
  roadLevel:(x:number,z:number,fallback:number)=>number,face:RailFace,box:Box,levelFace:(a:Vector3,b:Vector3,c:Vector3,color:Color,h:number,painted:boolean)=>void){
  const barriers:number[]=[]
  for(const [ax,az,ay,bx,bz,by,chainage,flags,ends=0] of sections){
    const x=ax/100,z=az/100,dx=(bx-ax)/100,dz=(bz-az)/100
    const len=Math.hypot(dx,dz)
    if(len<.005)continue
    const nx=-dz/len,nz=dx/len,yaw=-Math.atan2(dz,dx)
    const at=(t:number,offset:number,h:number)=>{
      const east=x+t*dx+nx*offset,south=z+t*dz+nz*offset
      const y=(ay+(by-ay)*t)/100
      return new Vector3(east,((flags&LEVEL)?roadLevel(east,south,flags&PAINTED?ground(east,south):y):y)+h,south)
    }
    function strip(left:number,right:number,hLeft:number,hRight:number,color:Color,kind=7){
      const count=flags&LEVEL?Math.ceil(len/.5):1
      for(let k=0;k<count;k++){
        const t=k/count,u=(k+1)/count
        const a=at(t,left,hLeft),b=at(u,left,hLeft),c=at(u,right,hRight),d=at(t,right,hRight)
        const s=chainage/100+t*len,e=chainage/100+u*len
        if(flags&LEVEL){
          levelFace(a,c,b,color,hLeft,!!(flags&PAINTED))
          levelFace(a,d,c,color,hLeft,!!(flags&PAINTED))
        }else{
          face(a,c,b,color,[s,e,e],kind)
          face(a,d,c,color,[s,s,e],kind)
        }
      }
    }
    const beam=(offset:number,h:number,size:number,depth:number,color:Color)=>{
      const mid=at(.5,offset,h)
      box(mid.x,mid.y,mid.z,len,size,depth,yaw,color,Math.atan2((by-ay)/100,len))
    }
    if(flags&TUNNEL){
      for(const [bit,t] of [[1,0],[2,1]]){
        if(!(ends&bit))continue
        for(const side of [-1,1]){
          const p=at(t,side*2.55,0),base=ground(p.x,p.z)
          box(p.x,(base+p.y+6.8)/2,p.z,.85,Math.max(.2,p.y+6.8-base),.55,yaw,concrete)
        }
        const p=at(t,0,6.9);box(p.x,p.y,p.z,.85,.55,5.65,yaw,concrete)
      }
      continue
    }
    if(flags&LEVEL){
      strip(-1.7,1.7,.003,.003,panel)
    }else{
      const bed=style.ballastHalfWidth
      strip(-bed,bed,-.22,-.22,ballast,8)
      for(const side of [-1,1]){
        const l=at(0,side*bed,-.22),r=at(1,side*bed,-.22)
        if(flags&BRIDGE){
          strip(side*bed,side*2.05,-.22,-.48,ballast)
          strip(side*2.05,side*2.05,-.48,-1.2,concrete)
        }else{
          function toe(p:Vector3){
            let y=ground(p.x,p.z)
            const span=Math.max(.52,(p.y-y)*style.ballastSlope)
            const east=p.x+side*nx*span,south=p.z+side*nz*span
            y=ground(east,south)
            return new Vector3(east,y-.03,south)
          }
          const a=toe(l),b=toe(r)
          face(l,r,b,ballast,[0,0,0],7);face(l,b,a,ballast,[0,0,0],7)
        }
      }
      if(flags&BRIDGE)strip(-2.05,2.05,-1.2,-1.2,concrete)
      const start=chainage/100
      // The far ballast shader carries the same repeat when furniture LOD drops the sleepers.
      for(let s=Math.ceil((start-.00001)/style.sleeperSpacing)*style.sleeperSpacing;s<start+len-.00001;s+=style.sleeperSpacing){
        const p=at((s-start)/len,0,-.155)
        box(p.x,p.y,p.z,.22,.13,2.55,yaw,sleeper)
      }
    }
    for(const side of [-1,1]){
      const inner=side*style.gauge/2,outer=inner+side*style.headWidth
      strip(inner,outer,.009,.009,steel)
      if(!(flags&LEVEL))strip(outer,outer,.009,-.095,steel)
    }
    if(flags&ELECTRIC && !(flags&LEVEL))beam(0,6.1,.027,.027,wire)
    if(flags&(RESERVED|LEVEL))continue
    const start=chainage/100
    const postAt=Math.ceil(start/style.mastSpacing)*style.mastSpacing
    if(postAt<start+len && flags&(BRIDGE|ELECTRIC)){
      const t=(postAt-start)/len
      if(flags&BRIDGE){
        const p=at(t,0,-1.2),base=ground(p.x,p.z)
        if(p.y>base)box(p.x,(base+p.y)/2,p.z,1.15,p.y-base,1.7,yaw,concrete)
      }
      if(flags&ELECTRIC){
        const p=at(t,3,0),base=flags&BRIDGE?p.y-1.2:ground(p.x,p.z)
        // Bridge masts sit on the deck edge.
        if(flags&BRIDGE){p.x-=nx*1.1;p.z-=nz*1.1}
        box(p.x,(base+p.y+6.4)/2,p.z,.19,p.y+6.4-base,.2,yaw,pole)
        const arm=at(t,flags&BRIDGE?.95:1.5,6.18)
        box(arm.x,arm.y,arm.z,.1,.10,flags&BRIDGE?2:3.1,yaw,pole)
      }
    }
    if(flags&FENCE && !(flags&BRIDGE)){
      for(const side of [-1,1]){
        const a=at(0,side*3.5,0),b=at(1,side*3.5,0)
        a.y=ground(a.x,a.z);b.y=ground(b.x,b.z)
        barriers.push(a.x,a.y,a.z,b.x,b.y,b.z)
        const topA=a.clone();topA.y+=1.4
        const topB=b.clone();topB.y+=1.4
        face(a,topB,b,fence,[0,len,len],9);face(a,topA,topB,fence,[0,0,len],9)
        box(a.x,a.y+.7,a.z,.065,1.4,.065,yaw,pole)
      }
    }
  }
  for(const [cx,cz,cy,angle] of signs){
    const x=cx/100,z=cz/100,y=cy/100,yaw=-angle/1000
    box(x,y+1.2,z,.1,2.4,.1,yaw,pole)
    box(x,y+2.12,z,.08,.55,.92,yaw,warning)
    box(x+.38*Math.sin(yaw),y+1.45,z+.38*Math.cos(yaw),.09,2.9,.09,yaw,warning)
  }
  return Float32Array.from(barriers)
}
