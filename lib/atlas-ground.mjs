export function atlasTriangles(geometry,box,scale=[1,1],offset=[0,0]){
  // gltfpack quantizes texture coordinates to 12 bits by default.
  const tolerance=.5/4095
  const uv=geometry.getAttribute('uv'),indices=geometry.index,selected=[],rest=[]
  const count=indices?.count??geometry.getAttribute('position').count
  if(!uv){
    const idxArr=indices?.array
    for(let start=0;start<count;start+=3){
      if(idxArr)rest.push(idxArr[start],idxArr[start+1],idxArr[start+2])
      else rest.push(start,start+1,start+2)
    }
    return {selected,rest}
  }
  const idxArr=indices?.array
  const minU=box[0]-tolerance,maxU=box[2]+tolerance,minV=box[1]-tolerance,maxV=box[3]+tolerance
  const sx=scale[0],sy=scale[1],ox=offset[0],oy=offset[1]
  // Direct typed-array read avoids per-vertex getter overhead & GC on large meshes.
  const uvArr=uv.isInterleavedBufferAttribute?uv.data.array:uv.array
  const uvStride=uv.isInterleavedBufferAttribute?uv.data.stride:uv.itemSize
  const uvOffset=uv.isInterleavedBufferAttribute?uv.offset:0
  let norm=1
  if(uv.normalized){
    if(uvArr instanceof Uint16Array)norm=1/65535
    else if(uvArr instanceof Int16Array)norm=1/32767
    else if(uvArr instanceof Uint8Array)norm=1/255
    else if(uvArr instanceof Int8Array)norm=1/127
    else norm=0
  }
  if(norm){
    const fsx=sx*norm,fsy=sy*norm
    for(let start=0;start<count;start+=3){
      const a=idxArr?idxArr[start]:start
      const b=idxArr?idxArr[start+1]:start+1
      const c=idxArr?idxArr[start+2]:start+2
      const oa=a*uvStride+uvOffset
      const u0=uvArr[oa]*fsx+ox,v0=uvArr[oa+1]*fsy+oy
      if(u0>=minU&&u0<=maxU&&v0>=minV&&v0<=maxV){
        const ob=b*uvStride+uvOffset
        const u1=uvArr[ob]*fsx+ox,v1=uvArr[ob+1]*fsy+oy
        if(u1>=minU&&u1<=maxU&&v1>=minV&&v1<=maxV){
          const oc=c*uvStride+uvOffset
          const u2=uvArr[oc]*fsx+ox,v2=uvArr[oc+1]*fsy+oy
          if(u2>=minU&&u2<=maxU&&v2>=minV&&v2<=maxV){
            selected.push(a,b,c)
            continue
          }
        }
      }
      rest.push(a,b,c)
    }
    return {selected,rest}
  }
  for(let start=0;start<count;start+=3){
    const a=idxArr?idxArr[start]:start
    const b=idxArr?idxArr[start+1]:start+1
    const c=idxArr?idxArr[start+2]:start+2
    const u0=uv.getX(a)*sx+ox,v0=uv.getY(a)*sy+oy
    const u1=uv.getX(b)*sx+ox,v1=uv.getY(b)*sy+oy
    const u2=uv.getX(c)*sx+ox,v2=uv.getY(c)*sy+oy
    if(u0>=minU&&u0<=maxU&&v0>=minV&&v0<=maxV&&u1>=minU&&u1<=maxU&&v1>=minV&&v1<=maxV&&u2>=minU&&u2<=maxU&&v2>=minV&&v2<=maxV){
      selected.push(a,b,c)
    }else{
      rest.push(a,b,c)
    }
  }
  return {selected,rest}
}
