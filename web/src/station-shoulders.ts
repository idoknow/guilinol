import {Vector3} from 'three'
import {split} from './station-paving'
export type ShoulderPlane = [number,number,number,number,number,number,number]

// Intersect high pavement with the actual longitudinal grade planes. Checking
// only the three vertices misses curb faces crossing diagonal or curved roads.
export function stationShoulders(segments:ShoulderPlane[]){
  const bins=new Map<string,ShoulderPlane[]>()
  for(const seg of segments){
    const [ax,az,bx,bz,width]=seg
    for(let i=Math.floor((Math.min(ax,bx)-width)/8);i<=Math.floor((Math.max(ax,bx)+width)/8);i++)
      for(let j=Math.floor((Math.min(az,bz)-width)/8);j<=Math.floor((Math.max(az,bz)+width)/8);j++){
        const key=i+','+j
        if(!bins.has(key))bins.set(key,[])
        bins.get(key)!.push(seg)
      }
  }
  if(!bins.size)return
  return (a:Vector3,b:Vector3,c:Vector3)=>{
    const candidates=new Set<ShoulderPlane>()
    // A long sidewalk triangle can cross a graded cell with all vertices outside it.
    for(let i=Math.floor(Math.min(a.x,b.x,c.x)/8);i<=Math.floor(Math.max(a.x,b.x,c.x)/8);i++)
      for(let j=Math.floor(Math.min(a.z,b.z,c.z)/8);j<=Math.floor(Math.max(a.z,b.z,c.z)/8);j++)
        for(const seg of bins.get(i+','+j)??[])candidates.add(seg)
    // Project vertices already inside a shoulder first. Most interior faces
    // then satisfy every grade plane without introducing any new vertices.
    const project=(p:Vector3)=>{
      let y=p.y
      for(const [ax,az,bx,bz,width,ay,by] of bins.get(Math.floor(p.x/8)+','+Math.floor(p.z/8))??[]){
        const dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz)
        const at=((p.x-ax)*dx+(p.z-az)*dz)/length
        if(at<-.006||at>length+.006||Math.abs((p.z-az)*dx-(p.x-ax)*dz)>width*length)continue
        y=Math.min(y,ay+(by-ay)*at/length)
      }
      return y<p.y?new Vector3(p.x,y,p.z):p
    }
    let pieces=[[project(a),project(b),project(c)]]
    for(const [ax,az,bx,bz,width,ay,by] of candidates){
      const length=Math.hypot(bx-ax,bz-az), ux=(bx-ax)/length,uz=(bz-az)/length
      const along=(p:Vector3)=>(p.x-ax)*ux+(p.z-az)*uz
      const side=(p:Vector3)=>(p.z-az)*ux-(p.x-ax)*uz
      const ceiling=(p:Vector3)=>ay+(by-ay)*along(p)/length
      const planes=[(p:Vector3)=>along(p)+.006,(p:Vector3)=>length+.006-along(p),(p:Vector3)=>width+side(p),(p:Vector3)=>width-side(p),(p:Vector3)=>p.y-ceiling(p)]
      const next:Vector3[][]=[]
      for(const tri of pieces){
        if(planes.some(plane=>tri.every(p=>plane(p)<=1e-7))){next.push(tri);continue}
        let inner=tri
        const outside:Vector3[][]=[]
        for(const plane of planes){
          const [inside,out]=split(inner,plane)
          if(out.length>=3)outside.push(out)
          inner=inside
          if(inner.length<3)break
        }
        if(inner.length<3){next.push(tri);continue}
        next.push(...outside,inner.map(p=>new Vector3(p.x,ceiling(p),p.z)))
      }
      pieces=next
    }
    return pieces
  }
}
