import {platformShift, type PlatformGrade} from './platform-grade'
import {panelCut} from './crossing-panels'
import {stationShoulders,type ShoulderPlane} from './station-shoulders'
import style from '../../pipeline/railway-style.json'
import {inRing} from './polygon'
import {stationPaving,type StationPavingCut} from './station-paving'
import {stationRoadSurface,type StationRoadSegment} from './station-road-surface'
import {railwayGeometry,type RailSection,type RailFace,type CrossingSign} from './railways'
import {buildRoadBarriers} from './road-barriers'
import {isShizijieCrosswalkRing,isShizijieDecorSuppressed,isShizijieSignalSuppressed,touchesShizijieTile} from './shizijie-zone.ts'
import * as THREE from 'three'
import {look} from './look/config'
type Pair=[number,number]
export interface StationPavingStyle {plaza?:Pair[]; platformEdges?:[Pair,Pair][]; platformGrades?:PlatformGrade[]}
type Path=[number,...Pair[][]]
type RoadCtrl=[number,number[]]
type Lower=[number,Pair[],[number,number,number,number][]]
type CrossingPanel=import('./railways').CrossingPanel
type LayeredRoad = [...ShoulderPlane, number]
export type Streets=[Path[],Pair[],number[][],Pair[]?,Pair[]?,(RoadCtrl|null)?,number[][]?,number[][]?,number[][]?,number[][]?,Pair[][]?,(Lower|null)?,([number,number,number]|null)?,unknown?,StationRoadSegment[]?,StationPavingCut[]?,ShoulderPlane[]?,LayeredRoad[]?,CrossingPanel[]?]
const colors=look.streets.surfaces.map(v=>new THREE.Color(v)),tone=Object.fromEntries((['railing','lampPole','lampHead'] as const).map(k=>[k,new THREE.Color(look.streets[k])]))
const stoneLight=new THREE.Color(0xa6a39a),stoneMid=new THREE.Color(0x8c8981),stoneBase=new THREE.Color(0x74726b)
const platformBrick=new THREE.Color(style.station.platformBrick)
const plazaStone=new THREE.Color(style.station.plazaStone)
const parkingYellow=new THREE.Color(0xe7b62e)
function evalRoadCtrl([baseMm,deltas]:RoadCtrl,lx:number,lz:number){
  const u=lx/8+1,v=lz/8+1
  const ic=Math.min(32,Math.max(1,Math.floor(u))),ir=Math.min(32,Math.max(1,Math.floor(v)))
  const tu=Math.min(1,Math.max(0,u-ic)),tv=Math.min(1,Math.max(0,v-ir))
  const omU=1-tu,omV=1-tv
  const wu=[omU*omU*omU/6,(3*tu*tu*tu-6*tu*tu+4)/6,(-3*tu*tu*tu+3*tu*tu+3*tu+1)/6,tu*tu*tu/6]
  const wv=[omV*omV*omV/6,(3*tv*tv*tv-6*tv*tv+4)/6,(-3*tv*tv*tv+3*tv*tv+3*tv+1)/6,tv*tv*tv/6]
  let sum=0
  for(let dr=0;dr<4;dr++){const rOff=(ir-1+dr)*35,wr=wv[dr];for(let dc=0;dc<4;dc++)sum+=wr*wu[dc]*deltas[rOff+ic-1+dc]}
  return (baseMm+sum)/1000
}

function lowerHeight(x:number,z:number,base:number,terrain:number,[,corners,profile]:Lower){
  const [start,end,,side]=corners
  if((x-(start[0]+end[0])/2)*(end[0]-start[0])+(z-(start[1]+end[1])/2)*(end[1]-start[1])>0){
    let best=Infinity,height=base
    for(let i=1;i<profile.length;i++){
      const a=profile[i-1],b=profile[i],dx=b[0]-a[0],dz=b[1]-a[1]
      const t=THREE.MathUtils.clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz),0,1)
      const distance=(x-a[0]-t*dx)**2+(z-a[1]-t*dz)**2
      if(distance<best){best=distance;height=base+(a[2]+t*(b[2]-a[2])-base)*(a[3]+t*(b[3]-a[3]))}
    }
    return height
  }
  const outside=(point:Pair)=>{const dx=point[0]-start[0],dz=point[1]-start[1],len=Math.hypot(dx,dz),along=((x-start[0])*dx+(z-start[1])*dz)/len;return Math.max(0,-along,along-len)}
  const factor=THREE.MathUtils.smoothstep(Math.hypot(outside(end),outside(side)),2,24)
  return terrain+factor*(base-terrain)
}

const ROAD_LIFT=.03
export function streetGeometry([paths,lamps,banks,signals=[],stops=[],roadCtrl,stoneRails=[],beds=[],shops=[],decor=[],curbCuts=[],lower,platform,,stationRoads,stationCuts,shoulderPlanes,layeredRoads,panels]:Streets,ground:(x:number,z:number)=>number,rails:RailSection[]=[],signs:CrossingSign[]=[],railGround:(x:number,z:number)=>number=ground,paving?:StationPavingStyle,roadbeds=new Set<number>(),origin?:readonly [number,number], inspectSlope?:(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3)=>void){
  const xyz:number[]=[],rgb:number[]=[],sidewalk:number[]=[],road:number[]=[],mats:number[]=[],cols:number[]=[]
  const stationLevel=stationRoads?stationRoadSurface(stationRoads):null
  const shoulders=shoulderPlanes && stationShoulders(shoulderPlanes)
  const remaining=stationCuts?stationPaving(stationCuts,stationLevel?.protectedAt):null
  const baseLevel=(x:number,z:number)=>{const g=ground(x,z);const level=roadCtrl?Math.max(evalRoadCtrl(roadCtrl,x,z),g):g;return stationLevel?stationLevel.height(x,z,level):level}
  const curbSegments=curbCuts.flatMap(line=>line.slice(1).map(([x,z],i)=>
    new THREE.Line3(new THREE.Vector3(line[i][0]/100,0,line[i][1]/100),new THREE.Vector3(x/100,0,z/100)))).filter(segment=>segment.distanceSq()>0)
  const testPoint=new THREE.Vector3(), closest=new THREE.Vector3()
  const edges=paving?.platformEdges?.map(([[ax,az],[bx,bz]])=>
    new THREE.Line3(new THREE.Vector3(ax,0,az),new THREE.Vector3(bx,0,bz)))
  function edgeDistance(p:THREE.Vector3){
    testPoint.set(p.x,0,p.z)
    let distance=8
    for(const edge of edges??[]){
      edge.closestPointToPoint(testPoint,true,closest)
      distance=Math.min(distance,closest.distanceTo(testPoint))
    }
    return distance
  }
  const passengerGrades=paving?.platformGrades?.filter(grade=>grade.along) ?? []
  const cutPanels=panels?.length ? panelCut(panels) : undefined
  let platformPath=false
  let lowerPath=false
  function vector(pt:THREE.Vector2,offset:number){
    if(offset===.195 && curbSegments.length){
      testPoint.set(pt.x,0,pt.y)
      let distance=2
      for(const segment of curbSegments){
        segment.closestPointToPoint(testPoint,true,closest)
        distance=Math.min(distance,testPoint.distanceTo(closest))
      }
      offset=.045+.15*distance/2
    }
    if(platformPath && platform)return new THREE.Vector3(pt.x,platform[2]+offset-.195,pt.y)
    const base=baseLevel(pt.x,pt.y)
    return new THREE.Vector3(pt.x,(lower&&lowerPath?lowerHeight(pt.x,pt.y,base,ground(pt.x,pt.y),lower):base)+offset,pt.y)
  }
  const surfaceKinds:number[]=[],alongVals:number[]=[]
  const fenceXyz:number[]=[],fenceRgb:number[]=[],fenceAlong:number[]=[]
  function triangle(first:THREE.Vector3,second:THREE.Vector3,third:THREE.Vector3,kind:number,u1=0,u2=0,u3=0,vertical=false){
    if(kind===1 && paving?.platformGrades) {
      const grades=paving.platformGrades
      const shift=(p:THREE.Vector3)=>platformShift(grades,p.x,p.z,vertical ? baseLevel(p.x,p.z)+.195 : p.y)
      const tolerance=grades.some(g=>g.along) ? .0008 : .006
      const heights=[shift(first),shift(second),shift(third)]
      const vertices=[first,second,third]
      // Preserve the original pavement plane when adding a vertex at a change of grade.
      const mids=vertices.map((v,i)=>v.clone().lerp(vertices[(i+1)%3],.5))
      if(mids.some((mid,i)=>{
        const j=(i+1)%3
        return Math.hypot(vertices[i].x-vertices[j].x,vertices[i].z-vertices[j].z)>.25
          && Math.abs(shift(mid)-(heights[i]+heights[j])/2)>tolerance
      })){
        const [ab,bc,ca]=mids
        const uab=(u1+u2)/2, ubc=(u2+u3)/2, uca=(u3+u1)/2
        triangle(first,ab,ca,kind,u1,uab,uca,vertical)
        triangle(ab,second,bc,kind,uab,u2,ubc,vertical)
        triangle(ca,bc,third,kind,uca,ubc,u3,vertical)
        triangle(ab,bc,ca,kind,uab,ubc,uca,vertical)
        return
      }
      first=first.clone();second=second.clone();third=third.clone()
      first.y+=heights[0];second.y+=heights[1];third.y+=heights[2]
    }
    if(remaining && (kind===0||kind===5) && !vertical){
      for(const poly of remaining(first,second,third))
        for(let k=1;k<poly.length-1;k++)emit(poly[0],poly[k],poly[k+1],kind,u1,u2,u3,false)
      return
    }
    emit(first,second,third,kind,u1,u2,u3,vertical)
  }
  function emit(first:THREE.Vector3,second:THREE.Vector3,third:THREE.Vector3,kind:number,u1:number,u2:number,u3:number,vertical:boolean){
    if(shoulders){
      const polys=shoulders(first,second,third)
      for(const poly of polys)for(let k=1;k+1<poly.length;k++)emitFace(poly[0],poly[k],poly[k+1],kind,u1,u2,u3,vertical)
    }else emitFace(first,second,third,kind,u1,u2,u3,vertical)
  }
  function emitFace(first:THREE.Vector3,second:THREE.Vector3,third:THREE.Vector3,kind:number,u1:number,u2:number,u3:number,vertical:boolean){
    let p1=first,p2=second,p3=third,a1=u1,a2=u2,a3=u3
    if(kind!==3&&!vertical){
      const x1=Math.fround(p1.x),y1=Math.fround(p1.y),z1=Math.fround(p1.z)
      const x2=Math.fround(p2.x),y2=Math.fround(p2.y),z2=Math.fround(p2.z)
      const x3=Math.fround(p3.x),y3=Math.fround(p3.y),z3=Math.fround(p3.z)
      const ny=(z2-z1)*(x3-x1)-(x2-x1)*(z3-z1)
      if(Math.abs(ny)<(kind===1 && paving?.platformGrades?.some(g=>g.along) ? 1e-9 : 1e-4))return
      if(ny<0){const tmp=p2;p2=p3;p3=tmp;const tu=a2;a2=a3;a3=tu}
      void y1;void y2;void y3
    }
    const channel=kind===4||kind===6?1:kind===5?0:kind
    const platformTop=kind===1 && platformPath && edges?.length && !vertical
    const stone=kind===1 && paving?.plaza && inRing((p1.x+p2.x+p3.x)/3,(p1.z+p2.z+p3.z)/3,paving.plaza)
    const textureChannel=platformTop?9:stone?10:kind===6?6:channel
    const c=platformTop?platformBrick:stone?plazaStone:colors[kind]
    const pts=[p1,p2,p3]
    if(!vertical && (channel===0 || channel===1)){
      const collision=channel===0?road:sidewalk
      for(const p of pts)collision.push(p.x,p.y,p.z)
    }
    if(cutPanels && channel===0 && !vertical){
      const src=pts.map(p=>[p.x,p.y,p.z] as [number,number,number])
      const dux=p2.x-p1.x,duz=p2.z-p1.z,dvx=p3.x-p1.x,dvz=p3.z-p1.z
      const det=dux*dvz-duz*dvx
      for(const poly of cutPanels(src))for(let j=2;j<poly.length;j++){
        for(const [x,y,z] of [poly[0],poly[j-1],poly[j]]){
          xyz.push(x,y,z);rgb.push(c.r,c.g,c.b);surfaceKinds.push(textureChannel)
          alongVals.push(a1+((x-p1.x)*dvz-(z-p1.z)*dvx)/det*(a2-a1)+
            (dux*(z-p1.z)-duz*(x-p1.x))/det*(a3-a1))
        }
      }
      return
    }
    surfaceKinds.push(textureChannel,textureChannel,textureChannel)
    if(platformTop)alongVals.push(edgeDistance(p1),edgeDistance(p2),edgeDistance(p3))
    else alongVals.push(a1,a2,a3)
    for(const pt of pts){xyz.push(pt.x,pt.y,pt.z);rgb.push(c.r,c.g,c.b)}
  }
  const checkShizijie=origin?touchesShizijieTile(origin[0],origin[1]):false
  for(const [index,[kind,...rings]] of paths.entries()){
    platformPath=!!platform && index>=platform[0] && index<platform[1]
    lowerPath=!!lower && index>=lower[0]
    const loops=rings.map(ring=>ring.map(([x,z])=>new THREE.Vector2(x/100,z/100)))
    if(kind===2&&checkShizijie&&origin&&rings[0]?.length>=4&&isShizijieCrosswalkRing(loops[0].map(v=>[v.x,v.y] as const),origin[0],origin[1]))continue
    const tris=THREE.ShapeUtils.triangulateShape(loops[0],loops.slice(1)),points=loops.flat()
    const protectedDeck=roadbeds.has(-index-1)
    const lifted=roadbeds.has(index)||protectedDeck
    const roadbed=lifted&&(kind===0||kind===5)
    const height=[.045,.195,.065,0,.195,.06,.195][kind]+(lifted?ROAD_LIFT:0)
    function tessellate(a:THREE.Vector2,b:THREE.Vector2,c:THREE.Vector2){
      const ab=a.distanceToSquared(b),bc=b.distanceToSquared(c),ca=c.distanceToSquared(a)
      if(Math.max(ab,bc,ca)<=16){
        const first=vector(a,height),second=vector(c,height),third=vector(b,height)
        triangle(first,second,third,kind)
        if(roadbed&&(protectedDeck||[first,second,third].some(point=>point.y-railGround(point.x,point.z)>.15))){
          for(const point of [first,second,third])point.y-=protectedDeck?.18:ROAD_LIFT
          triangle(first,third,second,3)
        }
        return
      }
      if(bc>ab&&bc>=ca){tessellate(b,c,a);return}if(ca>ab){tessellate(c,a,b);return}
      const mid=a.clone().lerp(b,.5);tessellate(a,mid,c);tessellate(mid,b,c)
    }
    for(const [a,b,c] of tris)tessellate(points[a],points[b],points[c])
    if(roadbed)for(const loop of loops)for(let index=0;index<loop.length;index++){
      const start=loop[index],end=loop[(index+1)%loop.length]
      if((start.x===end.x&&(start.x===0||start.x===256))||(start.y===end.y&&(start.y===0||start.y===256)))continue
      const segments=2**Math.ceil(Math.log2(Math.max(1,start.distanceTo(end)/4)))
      for(let segment=0;segment<segments;segment++){
        const first=vector(start.clone().lerp(end,segment/segments),height),second=vector(start.clone().lerp(end,(segment+1)/segments),height)
        const low=first.clone(),next=second.clone();low.y=protectedDeck?first.y-.18:railGround(low.x,low.z)-.04;next.y=protectedDeck?second.y-.18:railGround(next.x,next.z)-.04
        triangle(first,second,next,3);triangle(first,next,low,3)
      }
    }
    if(kind===1)for(const loop of loops)for(let i=0;i<loop.length;i++){
      const a=loop[i],b=loop[(i+1)%loop.length],steps=Math.ceil(a.distanceTo(b)/4)
      if((a.x===b.x&&(a.x===0||a.x===256))||(a.y===b.y&&(a.y===0||a.y===256)))continue
      for(let j=0;j<steps;j++){
        const p=a.clone().lerp(b,j/steps),q=a.clone().lerp(b,(j+1)/steps)
        const grade=passengerGrades.find(row=>inRing(p.x,p.y,row.ring)&&inRing(q.x,q.y,row.ring)&&inRing((p.x+q.x)/2,(p.y+q.y)/2,row.ring))
        if(grade){
          const top=(v:THREE.Vector2)=>new THREE.Vector3(v.x,platformShift([grade],v.x,v.y,0),v.y)
          const upper=top(p),end=top(q)
          // Bound the entire face by the lowest corner of each 4 m terrain cell it touches.
          let foot=Math.min(upper.y,end.y)-.15
          for(let x=Math.floor(Math.min(p.x,q.x)/4)*4;x<=Math.ceil(Math.max(p.x,q.x)/4)*4;x+=4)
            for(let z=Math.floor(Math.min(p.y,q.y)/4)*4;z<=Math.ceil(Math.max(p.y,q.y)/4)*4;z+=4)
              foot=Math.min(foot,railGround(x,z)-.04)
          const low=new THREE.Vector3(p.x,foot,p.y),next=new THREE.Vector3(q.x,foot,q.y)
          emit(low,upper,end,1,0,0,0,true)
          emit(low,end,next,1,0,0,0,true)
        }else{
          triangle(vector(p,.045),vector(p,height),vector(q,height),1,0,0,0,true)
          triangle(vector(p,.045),vector(q,height),vector(q,.045),1,0,0,0,true)
        }
      }
    }
  }
  platformPath=false
  const object=new THREE.Object3D()
  function box(x:number,y:number,z:number,w:number,h:number,d:number,yaw=0,tint=tone.railing,pitch=0){
    object.position.set(x,y,z);object.scale.set(w,h,d);object.rotation.set(0,yaw,pitch,'YXZ');object.updateMatrix()
    mats.push(...object.matrix.elements);cols.push(tint.r,tint.g,tint.b)
  }
  const hedge=new THREE.Color(look.streets.hedge),iron=new THREE.Color(look.streets.iron)
  const awnings=look.streets.awnings.map(value=>new THREE.Color(value)),shutter=new THREE.Color(look.streets.shutter)
  const parked:number[]=[],blue=new THREE.Color(look.streets.directionSign)
  const suppressDecor=(kind:number,x:number,z:number)=>checkShizijie&&!!origin&&isShizijieDecorSuppressed(origin[0]+x,origin[1]+z,kind)
  for(const [kind,east,south,heading,span] of decor){
    if(kind===5||kind===6||kind===7){
      const x=east/10,z=south/10
      if(suppressDecor(kind,x,z))continue
      const y=baseLevel(x,z)+.195
      const height=kind===7?.68+.06*Math.sin(east*.13+south*.07):.44
      box(x,y+height/2,z,span/10+.04,height,kind===7?.74:.95,-heading/100,hedge)
      continue
    }
    if(kind!==1&&kind!==2)continue
    const x=east/10,z=south/10
    if(suppressDecor(kind,x,z))continue
    const angle=-heading/100,y=baseLevel(x,z)+.195
    box(x,y+.88,z,span/10,.085,.07,angle,stoneLight)
    if(kind===2)box(x,y+.59,z,1.35,.42,.09,angle,awnings[2])
  }
  const railLodCount=mats.length/16
  for(const [kind,east,south,heading,span] of decor){
    const x=east/10,z=south/10
    if(suppressDecor(kind,x,z))continue
    const angle=-heading/100,y=baseLevel(x,z)+.195
    if(kind===3){
      for(const along of [-1.25,0,1.25]){
        const px=x+along*Math.cos(angle),pz=z-along*Math.sin(angle)
        object.position.set(px,baseLevel(px,pz)+.195,pz);object.rotation.y=angle+.75;object.scale.setScalar(1);object.updateMatrix();parked.push(...object.matrix.elements)
      }
    }else if(kind===5||kind===6){
      const length=span/10,offset=kind===5?.58:-.58
      const fx=x+offset*Math.sin(angle),fz=z+offset*Math.cos(angle)
      for(const level of [.24,.60])box(fx,y+level,fz,length+.04,.055,.055,angle,iron)
      for(const shift of [-.4,0,.4])box(fx+shift*length*Math.cos(angle),y+.31,fz-shift*length*Math.sin(angle),.055,.62,.055,angle,iron)
    }else if(kind===8){
      const length=span/10
      box(x-length*.5*Math.cos(angle),y+.62,z+length*.5*Math.sin(angle),.32,1.24,.32,angle,stoneMid)
      for(const level of [.32,1.05])box(x,y+level,z,length,.06,.07,angle,iron)
      for(const fraction of [-.32,-.12,.12,.32])box(x+fraction*length*Math.cos(angle),y+.69,z-fraction*length*Math.sin(angle),.04,.78,.04,angle,iron)
    }else if(kind===10){
      box(x,baseLevel(x,z)+.075,z,span/10,.012,.1,angle,parkingYellow)
    }else if(kind===11){
      for(let band=0;band<5;band++)box(x,y+.09+band*.18,z,.21,.18,.21,angle,band%2?iron:parkingYellow)
    }else if(kind===9){
      box(x,y+.012,z,span/10+.01,.018,.12,angle,stoneLight)
    }else if(kind===7){
      continue
    }else if(kind===4){
      box(x,y+1.5,z,.12,3,.12,angle);box(x,y+2.7,z,.09,.65,1.35,angle,blue)
      box(x,y+2.72,z,.1,.045,.85,angle,stoneLight)
    }else{
      box(x,y+.28,z,span/10,.065,.07,angle)
      for(const along of [-.35,0,.35])box(x+along*span/10*Math.cos(angle),y+.58,z-along*span/10*Math.sin(angle),.05,.6,.05,angle)
    }
  }
  for(const [east,south,base,heading,width,variant,arterial] of shops){
    const normalX=Math.cos(heading/100),normalZ=Math.sin(heading/100),angle=-heading/100+Math.PI/2
    const panel=(out:number,y:number,w:number,h:number,d:number,tint:THREE.Color)=>box(east/10+normalX*out,base/10+y,south/10+normalZ*out,w,h,d,angle,tint)
    panel(.58,2.5,width/10-.15,.12,1.1,awnings[variant]);panel(.12,2.84,width/10-.12,.53,.12,awnings[arterial?2:(variant+1)%4])
    if(variant%2===0){panel(.09,1.25,width/10-.34,2.32,.06,shutter);for(const level of [.48,1.0,1.52,2.04])panel(.14,level,width/10-.38,.035,.03,stoneMid)}
  }
  for(const [east,south,heading,arterial] of beds){
    const x=east/10,z=south/10,y=baseLevel(x,z)+.195,angle=-heading/100
    if(!arterial){
      for(const side of [-1,1]){
        box(x+side*.45*Math.sin(angle),y+.1,z+side*.45*Math.cos(angle),1,.2,.1,angle,stoneMid)
        box(x+side*.45*Math.cos(angle),y+.1,z-side*.45*Math.sin(angle),.1,.2,.8,angle,stoneMid)
      }
      for(const corner of [-.58,.58])box(x+corner*Math.cos(angle),y+.25,z-corner*Math.sin(angle),.28,.5,.28,angle,stoneLight)
    }
  }
  // Index the existing road surface first. Railway geometry never enters the
  // carriageway/sidewalk arrays used by walking, driving and height sampling.
  // Match the Float32 carriageway sent to rendering and physics at shared edges.
  if(rails.some(section=>section[7]&16))for(let i=0;i<road.length;i++)road[i]=Math.fround(road[i])
  const roadBins=new Map<number,number[]>()
  if(rails.some(section=>section[7]&16))for(let i=0;i<road.length;i+=9){
    const xs=[road[i],road[i+3],road[i+6]],zs=[road[i+2],road[i+5],road[i+8]]
    for(let r=Math.floor(Math.min(...zs)/8);r<=Math.floor(Math.max(...zs)/8);r++){
      for(let c=Math.floor(Math.min(...xs)/8);c<=Math.floor(Math.max(...xs)/8);c++){
        const key=r*64+c,bin=roadBins.get(key)
        if(bin)bin.push(i);else roadBins.set(key,[i])
      }
    }
  }
  const upperRoads = layeredRoads?.filter(row => !row[7])
  const coveredRoads = layeredRoads?.filter(row => row[7])
  function layerHeight(rows: LayeredRoad[], x:number, z:number, pad:number) {
    let closest=Infinity, level=-Infinity
    for (const [ax,az,bx,bz,width,low,high] of rows) {
      const dx=bx-ax,dz=bz-az,length=dx*dx+dz*dz
      if (!length) continue
      const t=THREE.MathUtils.clamp(((x-ax)*dx+(z-az)*dz)/length,0,1)
      const distance=Math.hypot(x-ax-t*dx,z-az-t*dz)
      if (distance <= width+pad && distance < closest) {
        closest=distance; level=low+t*(high-low)
      }
    }
    return level
  }
  function crossingHeight(x:number,z:number,fallback:number){
    const lower = coveredRoads?.length ? layerHeight(coveredRoads,x,z,8) : -Infinity
    if (upperRoads?.length && Number.isFinite(lower)) {
      const upper=layerHeight(upperRoads,x,z,2)
      if (Number.isFinite(upper)) return upper
    }
    let level=-Infinity
    for(const i of roadBins.get(Math.floor(z/8)*64+Math.floor(x/8))??[]){
      const ax=road[i],az=road[i+2],dx=road[i+3]-ax,dz=road[i+5]-az,ex=road[i+6]-ax,ez=road[i+8]-az
      const det=dx*ez-dz*ex
      if(Math.abs(det)<1e-9)continue
      const u=((x-ax)*ez-(z-az)*ex)/det,v=(dx*(z-az)-dz*(x-ax))/det
      if(u>=-1e-8&&v>=-1e-8&&u+v<=1.00000001)level=Math.max(level,road[i+1]+u*(road[i+4]-road[i+1])+v*(road[i+7]-road[i+1]))
    }
    return Math.max(Number.isFinite(level)?level:fallback,lower+style.stationLevels.roadClearance+.15)
  }
  const railFace:RailFace=(a,b,c,color,along,kind)=>{
    if(kind>8.5){
      for(const p of [a,b,c]){fenceXyz.push(p.x,p.y,p.z);fenceRgb.push(color.r,color.g,color.b)}
      fenceAlong.push(...along)
      return
    }
    for(const p of [a,b,c]){xyz.push(p.x,p.y,p.z);rgb.push(color.r,color.g,color.b)}
    alongVals.push(...along);surfaceKinds.push(kind,kind,kind)
  }
  // Project each part of the steel or rubber panel onto one carriageway
  // triangle. Interpolation between two road samples can bridge a curb edge.
  function levelFace(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,color:THREE.Color,h:number,painted:boolean){
    const original=[a,b,c]
    const triangles=new Set<number>()
    const xs=original.map(p=>Math.floor(p.x/8)),zs=original.map(p=>Math.floor(p.z/8))
    for(let r=Math.min(...zs);r<=Math.max(...zs);r++)for(let col=Math.min(...xs);col<=Math.max(...xs);col++){
      for(const i of roadBins.get(r*64+col)??[])triangles.add(i)
    }
    const snap=(p:THREE.Vector3)=>{
      const x=Math.fround(p.x),z=Math.fround(p.z)
      return new THREE.Vector3(x,crossingHeight(x,z,painted?ground(x,z):p.y-h)+h,z)
    }
    function emit(p:THREE.Vector3,q:THREE.Vector3,r:THREE.Vector3,depth:number){
      if(Math.abs((q.x-p.x)*(r.z-p.z)-(r.x-p.x)*(q.z-p.z))<1e-10)return
      const center=p.clone().add(q).add(r).multiplyScalar(1/3)
      const y=crossingHeight(center.x,center.z,painted?ground(center.x,center.z):center.y-h)+h
      if(depth<4 && Math.abs(y-center.y)>.009){
        const m=snap(center)
        emit(p,q,m,depth+1);emit(q,r,m,depth+1);emit(r,p,m,depth+1)
      }else railFace(p,q,r,color,[0,0,0],7)
    }
    const draw=(poly:THREE.Vector3[])=>{
      const vertices=poly.map(snap)
      for(let j=1;j+1<vertices.length;j++)emit(vertices[0],vertices[j],vertices[j+1],0)
    }
    let remaining=[original]
    const peak=(i:number)=>Math.max(road[i+1],road[i+4],road[i+7])
    for(const i of [...triangles].sort((u,v)=>peak(v)-peak(u))){
      if(!remaining.length)break
      const polygon=[0,3,6].map(k=>new THREE.Vector3(road[i+k],road[i+k+1],road[i+k+2]))
      const [p,q,r]=polygon,det=(q.x-p.x)*(r.z-p.z)-(r.x-p.x)*(q.z-p.z)
      if(Math.abs(det)<1e-9)continue
      const next:THREE.Vector3[][]=[]
      for(const fragment of remaining){
        let inside=fragment
        const outside:THREE.Vector3[][]=[]
        for(let edge=0;edge<3 && inside.length>=3;edge++){
          const u=polygon[edge],v=polygon[(edge+1)%3],orientation=Math.sign(det)
          const dist=(n:THREE.Vector3)=>orientation*((v.x-u.x)*(n.z-u.z)-(v.z-u.z)*(n.x-u.x))
          const keep:THREE.Vector3[]=[],rest:THREE.Vector3[]=[]
          for(let j=0;j<inside.length;j++){
            const m=inside[j],n=inside[(j+1)%inside.length],dm=dist(m),dn=dist(n)
            if(dm>=0)keep.push(m);else rest.push(m)
            if((dm>=0)!==(dn>=0)){
              const cut=m.clone().lerp(n,dm/(dm-dn))
              keep.push(cut);rest.push(cut)
            }
          }
          inside=keep
          if(rest.length>=3)outside.push(rest)
        }
        if(inside.length<3){next.push(fragment);continue}
        draw(inside.map(n=>{
          const u=((n.x-p.x)*(r.z-p.z)-(n.z-p.z)*(r.x-p.x))/det
          const v=((q.x-p.x)*(n.z-p.z)-(q.z-p.z)*(n.x-p.x))/det
          return new THREE.Vector3(n.x,p.y+u*(q.y-p.y)+v*(r.y-p.y)+h,n.z)
        }))
        next.push(...outside)
      }
      remaining=next
    }
    for(const poly of remaining)draw(poly)
  }
  // The terrain below a graded bore follows its carriageway. Track-bed slopes,
  // masts and fences above it are supported by the tunnel roof.
  const bores=shoulderPlanes?.length?stationCuts?.filter(([ax,az,bx,bz,,,,open,footprint])=>
    !open&&!footprint&&shoulderPlanes.some(([x,z,u,v])=>
      Math.abs(x-ax)+Math.abs(z-az)<1e-6 && (u-x)*(bx-ax)+(v-z)*(bz-az)>0 &&
      Math.abs((u-x)*(bz-az)-(v-z)*(bx-ax))<1e-6)):undefined
  const railSupport=bores?.length||coveredRoads?.length?(x:number,z:number)=>{
    let height=railGround(x,z)
    for(const [ax,az,bx,bz,width,ay,by] of bores??[]){
      const dx=bx-ax,dz=bz-az,length=dx*dx+dz*dz
      if(!length)continue
      const t=THREE.MathUtils.clamp(((x-ax)*dx+(z-az)*dz)/length,0,1)
      const distance=Math.hypot(x-ax-t*dx,z-az-t*dz)
      // A GL04 chord spans up to 12 m. Carry the roof beyond the wall so a
      // chord with both ends outside the bore cannot hang through its ceiling.
      const outside=Math.max(0,distance-width-12)
      height=Math.max(height,ay+t*(by-ay)+style.stationLevels.roadClearance-outside)
    }
    if (coveredRoads?.length) {
      const floor=layerHeight(coveredRoads,x,z,12)
      // The rendered ballast toe sits 3 cm below its support. Keep both
      // endpoints above the soffit throughout a full GL04 chord.
      height=Math.max(height,floor+style.stationLevels.roadClearance+.15)
    }
    return height
  }:railGround
  const railBarriers=railwayGeometry(rails,signs,railSupport,crossingHeight,railFace,box,levelFace,inspectSlope,panels)
  const roadBarriers=buildRoadBarriers(decor,baseLevel,origin)
  const detailCount=mats.length/16
  for(const [x,z] of lamps){const px=x/10,pz=z/10,y=baseLevel(px,pz),yaw=(x*7+z*13)%6/6*Math.PI
    box(px,y+.3,pz,.34,.6,.34,0,tone.lampPole);box(px,y+2.9,pz,.14,5.2,.14,0,tone.lampPole);box(px,y+5.3,pz,1.6,.08,.08,yaw,tone.lampPole)
    for(const side of [-.75,.75])box(px+Math.cos(yaw)*side,y+5.05,pz-Math.sin(yaw)*side,.32,.42,.32,yaw,tone.lampHead)}
  for(const [east,south] of signals){const x=east/10,z=south/10;if(checkShizijie&&origin&&isShizijieSignalSuppressed(origin[0]+x,origin[1]+z))continue;const y=baseLevel(x,z);box(x,y+2.5,z,.16,5,.16);box(x,y+4.7,z,.4,.9,.3)}
  for(const [east,south] of stops){const x=east/10,z=south/10,y=baseLevel(x,z);box(x,y+1.3,z,.12,2.6,.12);box(x,y+2.15,z,.65,.85,.12)}
  let bankAlong=0
  for(const [ax,az,bx,bz,top,bottom,endTop=top] of banks){
    const a=new THREE.Vector3(ax/10,top/10,az/10),b=new THREE.Vector3(bx/10,endTop/10,bz/10)
    const span=Math.hypot(b.x-a.x,b.z-a.z),u0=bankAlong,u1=bankAlong+span;bankAlong=u1
    const foot=a.clone();foot.y=bottom/10;const end=b.clone();end.y=bottom/10
    triangle(a,b,end,3,u0,u1,u1);triangle(a,end,foot,3,u0,u1,u0)
    const angle=-Math.atan2(b.z-a.z,b.x-a.x);box(a.x,a.y+.55,a.z,.15,1.1,.15)
    for(const y of [.5,1])box((a.x+b.x)/2,(a.y+b.y)/2+y,(a.z+b.z)/2,a.distanceTo(b),.09,.09,angle,tone.railing,Math.atan2(b.y-a.y,span))
  }
  for(const [ax,az,bx,bz] of stoneRails){
    const x1=ax/10,z1=az/10,x2=bx/10,z2=bz/10,span=Math.hypot(x2-x1,z2-z1)
    const angle=span>.05?-Math.atan2(z2-z1,x2-x1):0
    const drum=(px:number,pz:number)=>{
      const ys=baseLevel(px,pz)+.195
      box(px,ys+.08,pz,.48,.16,.48,angle,stoneBase)
      box(px,ys+.35,pz,.38,.42,.44,angle,stoneLight)
      box(px,ys+.35,pz,.46,.32,.34,angle,stoneMid)
    }
    drum(x1,z1)
    if(span>.35){
      drum(x2,z2)
      const mx=(x1+x2)/2,mz=(z1+z2)/2,ym=baseLevel(mx,mz)+.195
      box(mx,ym+.33,mz,Math.max(.1,span-.34),.13,.3,angle,stoneLight)
      box(mx,ym+.15,mz,Math.max(.1,span-.36),.07,.18,angle,stoneBase)
    }
  }
  const positions=new Float32Array(xyz)
  const surface=new THREE.BufferGeometry()
  surface.setAttribute('position',new THREE.BufferAttribute(positions,3))
  surface.computeVertexNormals()
  const fencePositions=new Float32Array(fenceXyz)
  let fenceNormals:Float32Array=new Float32Array(0)
  if(fencePositions.length){
    const fenceGeo=new THREE.BufferGeometry()
    fenceGeo.setAttribute('position',new THREE.BufferAttribute(fencePositions,3))
    fenceGeo.computeVertexNormals()
    fenceNormals=fenceGeo.getAttribute('normal').array as Float32Array
  }
  return {
    positions, normals:surface.getAttribute('normal').array as Float32Array,
    colors:new Float32Array(rgb), kinds:new Uint8Array(surfaceKinds), along:new Float32Array(alongVals),
    fencePositions, fenceNormals, fenceColors:new Float32Array(fenceRgb), fenceAlong:new Float32Array(fenceAlong),
    detailCount, railLodCount, railBarriers, roadBarriers, parked:Float32Array.from(parked), sidewalk:Float32Array.from(sidewalk), road:Float32Array.from(road),
    furnitureMatrices:Float32Array.from(mats), furnitureColors:Float32Array.from(cols),
  }
}

export type StreetData=ReturnType<typeof streetGeometry>
export interface StreetRequest {id:number; paths:Streets; paving?:StationPavingStyle; roadbeds?:number[]; rails?:RailSection[]; signs?:CrossingSign[]; railCuts?:[number,number][]; step:number; elevations:Float32Array; origin?:readonly [number,number]}
export type StreetResponse={id:number; data:StreetData}|{id:number; error:string}

if(typeof self!=='undefined')self.onmessage=({data:{id,paths,step,elevations,paving,rails=[],signs=[],railCuts=[],roadbeds=[],origin}}:MessageEvent<StreetRequest>)=>{
  try {
    const segments=256/step, stride=segments+1
    const sample=(grid:Float32Array)=>(x:number,z:number)=>{
      const col=Math.min(segments-1,Math.max(0,Math.floor(x/step))),row=Math.min(segments-1,Math.max(0,Math.floor(z/step))),at=row*stride+col
      const u=x/step-col,v=z/step-row,a=grid[at],b=grid[at+1],c=grid[at+stride],d=grid[at+stride+1]
      return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v)
    }
    const cut=railCuts.length?elevations.slice():elevations
    for(const [i,cm] of railCuts)cut[i]=cm/100
    const data=streetGeometry(paths,sample(elevations),rails,signs,sample(cut),paving,new Set(roadbeds),origin)
    const transfer=Object.values(data).flatMap(value=>typeof value==='number'?[]:[value.buffer])
    self.postMessage({id,data} satisfies StreetResponse,{transfer})
  } catch(error) {
    self.postMessage({id,error:String(error)} satisfies StreetResponse)
  }
}
