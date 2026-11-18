import * as THREE from 'three'
import {look} from './look/config'
import {nightStreets} from './look/night'
import {tileMaterial} from './look/tiles'

type Pair=[number,number]
type Path=[number,...Pair[][]]
export type Streets=[Path[],Pair[],number[][],Pair[]?,Pair[]?]
const colors=look.streets.surfaces.map(v=>new THREE.Color(v)),tone=Object.fromEntries((['railing','lampPole','lampHead'] as const).map(k=>[k,new THREE.Color(look.streets[k])]))
export const streetSurfaceMat=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide})
export const streetFurnitureGeo=new THREE.BoxGeometry()
export const streetFurnitureMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8})
nightStreets(streetSurfaceMat,streetFurnitureMat)

tileMaterial(streetSurfaceMat,false)

export function streetGeometry([paths,lamps,banks,signals=[],stops=[]]:Streets,ground:(x:number,z:number)=>number){
  const xyz:number[]=[],rgb:number[]=[],sidewalk:number[]=[],mats:number[]=[],cols:number[]=[]
  const vector=(pt:THREE.Vector2,offset:number)=>new THREE.Vector3(pt.x,ground(pt.x,pt.y)+offset,pt.y)
  const surfaceKinds:number[]=[]
  function triangle(first:THREE.Vector3,second:THREE.Vector3,third:THREE.Vector3,kind:number){
    surfaceKinds.push(kind,kind,kind)
    const c=colors[kind]
    for(const pt of [first,second,third]){xyz.push(pt.x,pt.y,pt.z);rgb.push(c.r,c.g,c.b);if(kind===1)sidewalk.push(pt.x,pt.y,pt.z)}
  }
  for(const [kind,...rings] of paths){
    const loops=rings.map(ring=>ring.map(([x,z])=>new THREE.Vector2(x/100,z/100)))
    const tris=THREE.ShapeUtils.triangulateShape(loops[0],loops.slice(1)),points=loops.flat()
    const height=[.035,.185,.05][kind]
    function tessellate(a:THREE.Vector2,b:THREE.Vector2,c:THREE.Vector2){
      const ab=a.distanceToSquared(b),bc=b.distanceToSquared(c),ca=c.distanceToSquared(a)
      if(Math.max(ab,bc,ca)<=144){triangle(vector(a,height),vector(c,height),vector(b,height),kind);return}
      if(bc>ab&&bc>=ca){tessellate(b,c,a);return}if(ca>ab){tessellate(c,a,b);return}
      const mid=a.clone().lerp(b,.5);tessellate(a,mid,c);tessellate(mid,b,c)
    }
    for(const [a,b,c] of tris)tessellate(points[a],points[b],points[c])
    if(kind===1)for(const loop of loops)for(let i=0;i<loop.length;i++){
      const a=loop[i],b=loop[(i+1)%loop.length],steps=Math.ceil(a.distanceTo(b)/8)
      if((a.x===b.x&&(a.x===0||a.x===256))||(a.y===b.y&&(a.y===0||a.y===256)))continue
      for(let j=0;j<steps;j++){
        const p=a.clone().lerp(b,j/steps),q=a.clone().lerp(b,(j+1)/steps)
        triangle(vector(p,.035),vector(p,height),vector(q,height),1);triangle(vector(p,.035),vector(q,height),vector(q,.035),1)
      }
    }
  }
  const object=new THREE.Object3D()
  function box(x:number,y:number,z:number,w:number,h:number,d:number,yaw=0,tint=tone.railing){
    object.position.set(x,y,z);object.scale.set(w,h,d);object.rotation.y=yaw;object.updateMatrix()
    mats.push(...object.matrix.elements);cols.push(tint.r,tint.g,tint.b)
  }
  for(const [x,z] of lamps){const y=ground(x/10,z/10),px=x/10,pz=z/10,yaw=(x*7+z*13)%6/6*Math.PI
    box(px,y+.3,pz,.34,.6,.34,0,tone.lampPole);box(px,y+2.9,pz,.14,5.2,.14,0,tone.lampPole);box(px,y+5.3,pz,1.6,.08,.08,yaw,tone.lampPole)
    for(const side of [-.75,.75])box(px+Math.cos(yaw)*side,y+5.05,pz-Math.sin(yaw)*side,.32,.42,.32,yaw,tone.lampHead)}
  for(const [east,south] of signals){const x=east/10,z=south/10,y=ground(x,z);box(x,y+2.5,z,.16,5,.16);box(x,y+4.7,z,.4,.9,.3)}
  for(const [east,south] of stops){const x=east/10,z=south/10,y=ground(x,z);box(x,y+1.3,z,.12,2.6,.12);box(x,y+2.15,z,.65,.85,.12)}
  for(const [ax,az,bx,bz,top,bottom] of banks){
    const a=new THREE.Vector3(ax/10,top/10,az/10),b=new THREE.Vector3(bx/10,top/10,bz/10)
    const foot=a.clone();foot.y=bottom/10;const end=b.clone();end.y=bottom/10
    triangle(a,b,end,3);triangle(a,end,foot,3)
    const angle=-Math.atan2(b.z-a.z,b.x-a.x);box(a.x,a.y+.55,a.z,.15,1.1,.15)
    for(const y of [.5,1])box((a.x+b.x)/2,a.y+y,(a.z+b.z)/2,a.distanceTo(b),.09,.09,angle)
  }
  let surface:THREE.BufferGeometry|null=null
  if(xyz.length){
    surface=new THREE.BufferGeometry()
    surface.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3))
    surface.setAttribute('color',new THREE.Float32BufferAttribute(rgb,3))
    surface.setAttribute('aSurface',new THREE.Uint8BufferAttribute(surfaceKinds,1))
    surface.computeVertexNormals()
  }
  return {
    banks,
    sidewalk:Float32Array.from(sidewalk),
    surface,
    furnitureMatrices:Float32Array.from(mats),
    furnitureColors:Float32Array.from(cols),
    dispose(){surface?.dispose()},
  }
}
