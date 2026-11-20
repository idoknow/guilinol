export function atlasTriangles(geometry,box,scale=[1,1],offset=[0,0]){
  const uv=geometry.getAttribute('uv'),indices=geometry.index,selected=[],rest=[]
  const count=indices?.count??geometry.getAttribute('position').count
  for(let start=0;start<count;start+=3){
    const triangle=[0,1,2].map(delta=>indices?indices.getX(start+delta):start+delta)
    const inside=uv&&triangle.every(vertex=>{
      const column=uv.getX(vertex)*scale[0]+offset[0],row=uv.getY(vertex)*scale[1]+offset[1]
      return column>=box[0]&&column<=box[2]&&row>=box[1]&&row<=box[3]
    })
    ;(inside?selected:rest).push(...triangle)
  }
  return {selected,rest}
}
