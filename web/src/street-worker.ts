import * as THREE from 'three'
import {look} from './look/config'
type Pair=[number,number]
type Path=[number,...Pair[][]]
type RoadCtrl=[number,number[]]
export type Streets=[Path[],Pair[],number[][],Pair[]?,Pair[]?,(RoadCtrl|null)?,number[][]?,number[][]?,number[][]?,number[][]?]
const colors=look.streets.surfaces.map(v=>new THREE.Color(v)),tone=Object.fromEntries((['railing','lampPole','lampHead'] as const).map(k=>[k,new THREE.Color(look.streets[k])]))
const stoneLight=new THREE.Color(0xa6a39a),stoneMid=new THREE.Color(0x8c8981),stoneBase=new THREE.Color(0x74726b)
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

function streetGeometry([paths,lamps,banks,signals=[],stops=[],roadCtrl,stoneRails=[],beds=[],shops=[],decor=[]]:Streets,ground:(x:number,z:number)=>number){
  const xyz:number[]=[],rgb:number[]=[],sidewalk:number[]=[],road:number[]=[],mats:number[]=[],cols:number[]=[]
  const baseLevel=(x:number,z:number)=>{const g=ground(x,z);return roadCtrl?Math.max(evalRoadCtrl(roadCtrl,x,z),g):g}
  const vector=(pt:THREE.Vector2,offset:number)=>new THREE.Vector3(pt.x,baseLevel(pt.x,pt.y)+offset,pt.y)
  const surfaceKinds:number[]=[],alongVals:number[]=[]
  function triangle(first:THREE.Vector3,second:THREE.Vector3,third:THREE.Vector3,kind:number,u1=0,u2=0,u3=0,vertical=false){
    let p1=first,p2=second,p3=third,a1=u1,a2=u2,a3=u3
    if(kind!==3&&!vertical){
      const x1=Math.fround(p1.x),y1=Math.fround(p1.y),z1=Math.fround(p1.z)
      const x2=Math.fround(p2.x),y2=Math.fround(p2.y),z2=Math.fround(p2.z)
      const x3=Math.fround(p3.x),y3=Math.fround(p3.y),z3=Math.fround(p3.z)
      const ny=(z2-z1)*(x3-x1)-(x2-x1)*(z3-z1)
      if(Math.abs(ny)<1e-4)return
      if(ny<0){const tmp=p2;p2=p3;p3=tmp;const tu=a2;a2=a3;a3=tu}
      void y1;void y2;void y3
    }
    const channel=kind===4||kind===6?1:kind===5?0:kind
    const textureChannel=kind===6?6:channel
    surfaceKinds.push(textureChannel,textureChannel,textureChannel);alongVals.push(a1,a2,a3)
    const c=colors[kind]
    for(const pt of [p1,p2,p3]){xyz.push(pt.x,pt.y,pt.z);rgb.push(c.r,c.g,c.b);if(channel===1&&!vertical)sidewalk.push(pt.x,pt.y,pt.z);else if(channel===0&&!vertical)road.push(pt.x,pt.y,pt.z)}
  }
  for(const [kind,...rings] of paths){
    const loops=rings.map(ring=>ring.map(([x,z])=>new THREE.Vector2(x/100,z/100)))
    const tris=THREE.ShapeUtils.triangulateShape(loops[0],loops.slice(1)),points=loops.flat()
    const height=[.045,.195,.065,0,.195,.06,.195][kind]
    function tessellate(a:THREE.Vector2,b:THREE.Vector2,c:THREE.Vector2){
      const ab=a.distanceToSquared(b),bc=b.distanceToSquared(c),ca=c.distanceToSquared(a)
      if(Math.max(ab,bc,ca)<=16){triangle(vector(a,height),vector(c,height),vector(b,height),kind);return}
      if(bc>ab&&bc>=ca){tessellate(b,c,a);return}if(ca>ab){tessellate(c,a,b);return}
      const mid=a.clone().lerp(b,.5);tessellate(a,mid,c);tessellate(mid,b,c)
    }
    for(const [a,b,c] of tris)tessellate(points[a],points[b],points[c])
    if(kind===1)for(const loop of loops)for(let i=0;i<loop.length;i++){
      const a=loop[i],b=loop[(i+1)%loop.length],steps=Math.ceil(a.distanceTo(b)/4)
      if((a.x===b.x&&(a.x===0||a.x===256))||(a.y===b.y&&(a.y===0||a.y===256)))continue
      for(let j=0;j<steps;j++){
        const p=a.clone().lerp(b,j/steps),q=a.clone().lerp(b,(j+1)/steps)
        triangle(vector(p,.045),vector(p,height),vector(q,height),1,0,0,0,true);triangle(vector(p,.045),vector(q,height),vector(q,.045),1,0,0,0,true)
      }
    }
  }
  const object=new THREE.Object3D()
  function box(x:number,y:number,z:number,w:number,h:number,d:number,yaw=0,tint=tone.railing,pitch=0){
    object.position.set(x,y,z);object.scale.set(w,h,d);object.rotation.set(0,yaw,pitch,'YXZ');object.updateMatrix()
    mats.push(...object.matrix.elements);cols.push(tint.r,tint.g,tint.b)
  }
  const hedge=new THREE.Color(look.streets.hedge),iron=new THREE.Color(look.streets.iron)
  const awnings=look.streets.awnings.map(value=>new THREE.Color(value)),shutter=new THREE.Color(look.streets.shutter)
  const parked:number[]=[],blue=new THREE.Color(look.streets.directionSign)
  for(const [kind,east,south,heading,span] of decor){
    if(kind===5||kind===6||kind===7){
      const x=east/10,z=south/10,y=baseLevel(x,z)+.195
      const height=kind===7?.68+.06*Math.sin(east*.13+south*.07):.44
      box(x,y+height/2,z,span/10+.04,height,kind===7?.74:.95,-heading/100,hedge)
      continue
    }
    if(kind!==1&&kind!==2)continue
    const x=east/10,z=south/10,angle=-heading/100,y=baseLevel(x,z)+.195
    box(x,y+.88,z,span/10,.085,.07,angle,stoneLight)
    if(kind===2)box(x,y+.59,z,1.35,.42,.09,angle,awnings[2])
  }
  const railLodCount=mats.length/16
  for(const [kind,east,south,heading,span] of decor){
    const x=east/10,z=south/10,angle=-heading/100,y=baseLevel(x,z)+.195
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
  const detailCount=mats.length/16
  for(const [x,z] of lamps){const px=x/10,pz=z/10,y=baseLevel(px,pz),yaw=(x*7+z*13)%6/6*Math.PI
    box(px,y+.3,pz,.34,.6,.34,0,tone.lampPole);box(px,y+2.9,pz,.14,5.2,.14,0,tone.lampPole);box(px,y+5.3,pz,1.6,.08,.08,yaw,tone.lampPole)
    for(const side of [-.75,.75])box(px+Math.cos(yaw)*side,y+5.05,pz-Math.sin(yaw)*side,.32,.42,.32,yaw,tone.lampHead)}
  for(const [east,south] of signals){const x=east/10,z=south/10,y=baseLevel(x,z);box(x,y+2.5,z,.16,5,.16);box(x,y+4.7,z,.4,.9,.3)}
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
  return {
    positions, normals:surface.getAttribute('normal').array as Float32Array,
    colors:new Float32Array(rgb), kinds:new Uint8Array(surfaceKinds), along:new Float32Array(alongVals),
    detailCount, railLodCount, parked:Float32Array.from(parked), sidewalk:Float32Array.from(sidewalk), road:Float32Array.from(road),
    furnitureMatrices:Float32Array.from(mats), furnitureColors:Float32Array.from(cols),
  }
}

export type StreetData=ReturnType<typeof streetGeometry>
export interface StreetRequest {id:number; paths:Streets; step:number; elevations:Float32Array}
export type StreetResponse={id:number; data:StreetData}|{id:number; error:string}

self.onmessage=({data:{id,paths,step,elevations}}:MessageEvent<StreetRequest>)=>{
  try {
    const segments=256/step, stride=segments+1
    const data=streetGeometry(paths,(x,z)=>{
      const col=Math.min(segments-1,Math.max(0,Math.floor(x/step))),row=Math.min(segments-1,Math.max(0,Math.floor(z/step))),at=row*stride+col
      const u=x/step-col,v=z/step-row,a=elevations[at],b=elevations[at+1],c=elevations[at+stride],d=elevations[at+stride+1]
      return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v)
    })
    const transfer=Object.values(data).flatMap(value=>typeof value==='number'?[]:[value.buffer])
    self.postMessage({id,data} satisfies StreetResponse,{transfer})
  } catch(error) {
    self.postMessage({id,error:String(error)} satisfies StreetResponse)
  }
}
