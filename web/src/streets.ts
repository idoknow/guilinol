import * as THREE from 'three'
import {look} from './look/config'
import {nightStreets} from './look/night'

type Pair=[number,number]
type Path=[number,...Pair[][]]
export type Streets=[Path[],Pair[],number[][]]
const colors=look.streets.surfaces.map(v=>new THREE.Color(v)),tone=Object.fromEntries((['railing','lampPole','lampHead'] as const).map(k=>[k,new THREE.Color(look.streets[k])]))
const material=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide})
const cube=new THREE.BoxGeometry(),metal=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8})
nightStreets(material,metal)

export function streetGeometry([paths,lamps,banks]:Streets,ground:(x:number,z:number)=>number){
  const xyz:number[]=[],rgb:number[]=[],sidewalk:number[]=[],boxes:THREE.Matrix4[]=[],tints:THREE.Color[]=[]
  const vector=(pt:THREE.Vector2,offset:number)=>new THREE.Vector3(pt.x,ground(pt.x,pt.y)+offset,pt.y)
  function triangle(first:THREE.Vector3,second:THREE.Vector3,third:THREE.Vector3,kind:number){
    for(const pt of [first,second,third]){xyz.push(pt.x,pt.y,pt.z);rgb.push(...colors[kind].toArray());if(kind===1)sidewalk.push(pt.x,pt.y,pt.z)}
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
  function box(x:number,y:number,z:number,w:number,h:number,d:number,yaw=0,tint=tone.railing){object.position.set(x,y,z);object.scale.set(w,h,d);object.rotation.y=yaw;object.updateMatrix();boxes.push(object.matrix.clone());tints.push(tint)}
  for(const [x,z] of lamps){const y=ground(x/10,z/10),px=x/10,pz=z/10,yaw=(x*7+z*13)%6/6*Math.PI
    box(px,y+.3,pz,.34,.6,.34,0,tone.lampPole);box(px,y+2.9,pz,.14,5.2,.14,0,tone.lampPole);box(px,y+5.3,pz,1.6,.08,.08,yaw,tone.lampPole)
    for(const side of [-.75,.75])box(px+Math.cos(yaw)*side,y+5.05,pz-Math.sin(yaw)*side,.32,.42,.32,yaw,tone.lampHead)}
  for(const [ax,az,bx,bz,top,bottom] of banks){
    const a=new THREE.Vector3(ax/10,top/10,az/10),b=new THREE.Vector3(bx/10,top/10,bz/10)
    const foot=a.clone();foot.y=bottom/10;const end=b.clone();end.y=bottom/10
    triangle(a,b,end,3);triangle(a,end,foot,3)
    const angle=-Math.atan2(b.z-a.z,b.x-a.x);box(a.x,a.y+.55,a.z,.15,1.1,.15)
    for(const y of [.5,1])box((a.x+b.x)/2,a.y+y,(a.z+b.z)/2,a.distanceTo(b),.09,.09,angle)
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(rgb,3));geometry.computeVertexNormals()
  const group=new THREE.Group();if(xyz.length)group.add(new THREE.Mesh(geometry,material))
  const furniture=new THREE.InstancedMesh(cube,metal,boxes.length);boxes.forEach((mat,i)=>{furniture.setMatrixAt(i,mat);furniture.setColorAt(i,tints[i])});if(boxes.length)group.add(furniture)
  return {group,banks,sidewalk:Float32Array.from(sidewalk),dispose(){geometry.dispose();furniture.dispose()}}
}
