import * as THREE from 'three'
import {buildingColor} from './look/buildings'

type Pair=[number,number]
type Vertex=[number,number,number]
export type Building=[number,number,Pair[][],number,number,number,number[],Pair[],number]

export function buildingGeometry(positions:Int16Array,normals:Int8Array,indices:Uint32Array,parts:Building[]){
  const xyz=Array.from(positions,(v,i)=>v/(i%3===1?10:100)),normal=Array.from(normals,v=>v/127),faces=Array.from(indices)
  const count=xyz.length/3,kinds=new Array<number>(count),floor=new Array<number>(count),facade=new Array<number>(count),roofs=new Array<number>(count)
  let cursor=0
  for(const [base,top,loops,kind,floors,seed,anchor,rectangle,complex] of parts){
    const level=top/10
    function tag(index:number,isRoof:number,f:number,u:number){kinds[index]=kind;floor[index]=f;facade[index]=u;roofs[index]=isRoof}
    function face(corners:Vertex[]){
      const start=xyz.length/3,points=corners.map(p=>new THREE.Vector3(...p))
      const n=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize()
      for(const p of corners){tag(xyz.length/3,1,floors,0);xyz.push(...p);normal.push(n.x,n.y,n.z)}
      for(let i=1;i+1<corners.length;i++)faces.push(start,start+i,start+i+1)
    }
    for(const loop of loops)for(let i=0;i<loop.length;i++)tag(cursor++,1,floors,0)
    for(const loop of loops){let u=0
      for(let i=0;i<loop.length;i++){
        const [x,z]=loop[i].map(v=>v/100),[ex,ez]=loop[(i+1)%loop.length].map(v=>v/100),len=Math.hypot(ex-x,ez-z)
        if(!len)continue
        for(const end of [false,false,true,true]){const index=cursor++;tag(index,0,(xyz[3*index+1]-base/10)/3.1,end?u+len:u)}u+=len
        if(!kind&&!(x===ex&&(x===0||x===256))&&!(z===ez&&(z===0||z===256)))face([[x,level,z],[x,level+.9,z],[ex,level+.9,ez],[ex,level,ez]])
      }
    }
    if(!anchor.length||kind===3)continue
    const [cx,cz]=anchor.map(v=>v/100)
    if(!kind){for(let box=0;box<seed%3;box++){
      const x=cx+box*2-1,z=cz-1,h=level+1.7
      const lid:Vertex[]=[[x,h,z],[x,h,z+1.6],[x+1.6,h,z+1.6],[x+1.6,h,z]];face(lid)
      for(let i=0;i<4;i++){const a=lid[i],b=lid[(i+1)%4];face([a,[a[0],level,a[2]],[b[0],level,b[2]],b])}
    }continue}
    const corners=rectangle.map(([x,z])=>new THREE.Vector2(cx+x/100,cz+z/100)),length=(i:number)=>corners[i].distanceTo(corners[(i+1)%4])
    if(length(0)<length(1))corners.push(corners.shift()!)
    const along=corners[1].clone().sub(corners[0]).normalize(),side=corners[3].clone().sub(corners[0]).normalize()
    const center=corners[0].clone().lerp(corners[2],.5),halfWidth=length(1)/2+.6,halfLength=length(0)/2+.6
    function pt(x:number,y:number,z:number):Vertex{return [center.x+x*along.x+z*side.x,y,center.y+x*along.y+z*side.y]}
    const ridge=halfLength-(complex||kind===2?Math.min(halfWidth,halfLength):0),height=level+halfWidth*Math.tan((28+seed%5)*Math.PI/180)
    const a=pt(-halfLength,level,-halfWidth),b=pt(halfLength,level,-halfWidth),c=pt(halfLength,level,halfWidth),d=pt(-halfLength,level,halfWidth)
    const start=pt(-ridge,height,0),end=pt(ridge,height,0)
    face([a,b,end,start]);face([d,start,end,c]);face([a,start,d]);face([b,c,end])
  }
  const geom=new THREE.BufferGeometry(),colors:number[]=new Array(kinds.length*3)
  kinds.forEach((kind,i)=>buildingColor(kind,!!roofs[i],normal[3*i+1],colors,i*3))
  for(const [name,values,size] of [['position',xyz,3],['normal',normal,3],['color',colors,3],['aFloor',floor,1],['aFacade',facade,1]] as const)
    geom.setAttribute(name,new THREE.Float32BufferAttribute(values,size))
  geom.setAttribute('aKind',new THREE.Uint8BufferAttribute(kinds,1));geom.setAttribute('aRoof',new THREE.Uint8BufferAttribute(roofs,1));geom.setIndex(faces);return geom
}
