type Region={name:string;polygon:[number,number][]}

export function quietIndex(regions:Region[]){
  const bounds=regions.map(region=>{
    const east=region.polygon.map(point=>point[0]),south=region.polygon.map(point=>point[1])
    return {...region,left:Math.min(...east),right:Math.max(...east),top:Math.min(...south),bottom:Math.max(...south)}
  })
  return (east:number,south:number)=>{
    for(const {polygon,name,left,right,top,bottom} of bounds){
      if(east<left||east>right||south<top||south>bottom)continue
      let inside=false
      for(let index=0,prev=polygon.length-1;index<polygon.length;prev=index++){
        const [ax,az]=polygon[index],[bx,bz]=polygon[prev]
        if((az>south)!==(bz>south)&&east<(bx-ax)*(south-az)/(bz-az)+ax)inside=!inside
      }
      if(inside)return name
    }
  }
}
