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
