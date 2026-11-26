import railStyle from '../../pipeline/railway-style.json'
import type {CrossingPanel} from './railways'
type Point=[number,number,number]
type Plane=(p:Point)=>number
function clip(poly:Point[],plane:Plane){
  const result:Point[]=[]
  for(let index=0;index<poly.length;index++){
    const a=poly[index],b=poly[(index+1)%poly.length],da=plane(a),db=plane(b)
    if(da>=0)result.push(a)
    if((da<0)!==(db<0))result.push(a.map((value,k)=>value+(b[k]-value)*da/(da-db)) as Point)
  }
  return result
}
// Cut only the visible asphalt. The uninterrupted driving surface also supports
// wheels over the rubber panels and the narrow rail flangeways.
export function panelCut(panels:CrossingPanel[]){
  const strips=panels.map(([ax,az,bx,bz,y])=>{
    const x=ax/100,z=az/100,dx=(bx-ax)/100,dz=(bz-az)/100,length=Math.hypot(dx,dz)
    const along=(p:Point)=>((p[0]-x)*dx+(p[2]-z)*dz)/length
    const side=(p:Point)=>((p[2]-z)*dx-(p[0]-x)*dz)/length
    const w=railStyle.ballastHalfWidth
    // Join consecutive centimetre-encoded chords across their slightly
    // different cap normals. One millimetre covers the bevel at a rail head.
    const seam=.001
    const planes:Plane[]=[p=>along(p)+seam,p=>length+seam-along(p),p=>w-side(p),p=>w+side(p)]
    return {planes,y,left:Math.min(x,bx/100)-w,right:Math.max(x,bx/100)+w,top:Math.min(z,bz/100)-w,bottom:Math.max(z,bz/100)+w}
  })
  return (triangle:Point[], inside?:(panel:Point[])=>void)=>{
    let fragments=[triangle]
    for(const {planes,y,left,right,top,bottom} of strips){
      if(triangle.every(p=>p[0]<left)||triangle.every(p=>p[0]>right)||
        triangle.every(p=>p[2]<top)||triangle.every(p=>p[2]>bottom))continue
      const next:Point[][]=[]
      for(let polygon of fragments){
        if(polygon.every(p=>p[1]<y-.15) || polygon.every(p=>p[1]>y+.15) ||
          planes.some(test=>polygon.every(p=>test(p)<=0))){next.push(polygon);continue}
        for(const test of planes){
          const outside=clip(polygon,p=>-test(p))
          if(outside.length>=3)next.push(outside)
          polygon=clip(polygon,test)
          if(polygon.length<3)break
        }
        if(polygon.length>=3)inside?.(polygon)
      }
      fragments=next
    }
    return fragments
  }
}
