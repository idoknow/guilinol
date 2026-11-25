export function inRing(x:number,z:number,ring:number[][]){
  let inside=false
  for(let i=1;i<ring.length;i++){
    const [ax,az]=ring[i-1], [bx,bz]=ring[i]
    if((bx-ax)*(z-az)===(bz-az)*(x-ax)&&x>=Math.min(ax,bx)&&x<=Math.max(ax,bx)&&z>=Math.min(az,bz)&&z<=Math.max(az,bz))return true
    if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)inside=!inside
  }
  return inside
}
