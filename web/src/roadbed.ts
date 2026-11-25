// Tile-local positions in tenths of a millimetre keep the road and bed rims
// coincident. Decode close to the mesh consumer to avoid nested JS arrays.
export type RoadBed = {drop:number[],vertices?:number[][],packed?:string}

export function positions(encoded:string,unit:number){
  const raw=atob(encoded)
  const view=new DataView(new ArrayBuffer(raw.length))
  for(let i=0;i<raw.length;i++)view.setUint8(i,raw.charCodeAt(i))
  const result=new Float32Array(raw.length/4)
  for(let i=0;i<result.length;i++)result[i]=view.getInt32(i*4,true)*unit
  return result
}

export function bedPositions(bed:RoadBed){
  return bed.packed?positions(bed.packed,.0001):Float32Array.from(bed.vertices!.flat())
}

// Keep the surveyed replacement triangles intact. Coalesce coplanar patches
// of the adjoining native grid, retaining every shared boundary vertex.
export function nativeTerrainIndices(segments:number,heights:{getY:(i:number)=>number},removed:Uint8Array){
  const stride=segments+1
  const corner=(x:number,z:number)=>z*stride+x
  const dropped=(face:number)=>!!(removed[face>>3]&(1<<(face&7)))
  const used=new Uint8Array(stride*stride)
  const blocks:{x:number;z:number;size:number}[]=[]
  const indices:number[]=[]
  function planar(x:number,z:number,n:number){
    const start=heights.getY(corner(x,z))
    const dx=(heights.getY(corner(x+n,z))-start)/n
    const dz=(heights.getY(corner(x,z+n))-start)/n
    for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
      const face=2*((z+j)*segments+x+i)
      if(i<n&&j<n&&(dropped(face)||dropped(face+1)))return false
      if(Math.abs(heights.getY(corner(x+i,z+j))-(start+dx*i+dz*j))>.00004)return false
    }
    return true
  }
  function partition(x:number,z:number,n:number){
    if(n>1&&!planar(x,z,n)){
      const half=n/2
      partition(x,z,half);partition(x+half,z,half)
      partition(x,z+half,half);partition(x+half,z+half,half)
      return
    }
    for(const i of [corner(x,z),corner(x+n,z),corner(x,z+n),corner(x+n,z+n)])used[i]=1
    blocks.push({x,z,size:n})
  }
  for(let i=0;i<=segments;i++){
    used[corner(0,i)]=used[corner(segments,i)]=1
    used[corner(i,0)]=used[corner(i,segments)]=1
  }
  for(let z=0;z<segments;z+=8)for(let x=0;x<segments;x+=8)partition(x,z,8)
  for(const {x,z,size:n} of blocks){
    const a=corner(x,z),b=corner(x,z+n),c=corner(x+n,z+n),d=corner(x+n,z)
    if(n===1){
      const face=2*(z*segments+x)
      if(!dropped(face))indices.push(a,b,d)
      if(!dropped(face+1))indices.push(b,c,d)
      continue
    }
    const ring:number[]=[]
    for(let j=0;j<n;j++)if(used[corner(x,z+j)])ring.push(corner(x,z+j))
    for(let j=0;j<n;j++)if(used[corner(x+j,z+n)])ring.push(corner(x+j,z+n))
    for(let j=0;j<n;j++)if(used[corner(x+n,z+n-j)])ring.push(corner(x+n,z+n-j))
    for(let j=0;j<n;j++)if(used[corner(x+n-j,z)])ring.push(corner(x+n-j,z))
    if(ring.length===4)indices.push(a,b,d,b,c,d)
    else{
      // Use the a–c diagonal. Each half has two subdivided perimeter
      // edges. Fan the first edge to the first vertex past its corner,
      // then cover the rest from the start. This keeps every shared edge
      // without the two extra triangles a centre fan would require.
      function half(perimeter:number[],cornerIndex:number){
        const pivot=perimeter[cornerIndex+1]
        for(let i=0;i<cornerIndex;i++)indices.push(perimeter[i],perimeter[i+1],pivot)
        for(let i=cornerIndex+1;i+1<perimeter.length;i++)indices.push(perimeter[0],perimeter[i],perimeter[i+1])
      }
      const diagonal=ring.indexOf(c)
      half(ring.slice(0,diagonal+1),ring.indexOf(b))
      half([...ring.slice(diagonal),a],ring.indexOf(d)-diagonal)
    }
  }
  return indices
}
