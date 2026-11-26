import {inRing} from './polygon'

/** Rows store station, left/right offsets and edge heights. Oriented rows use absolute levels. */
export interface PlatformGrade {
  along?: [number, number]
  across?: [number, number]
  ring: [number, number][]
  rows: [number, number, number, number, number][]
}

export function platformShift(grades: PlatformGrade[], x: number, z: number, height: number) {
  for (const {ring, rows, along, across: normal} of grades) {
    if (!inRing(x,z,ring)) continue
    const s=along ? x*along[0]+z*along[1] : z
    const lateral=normal ? x*normal[0]+z*normal[1] : x
    let lo=0, hi=rows.length-1
    while (hi-lo>1) {
      const mid=(lo+hi)>>1
      if (rows[mid][0]<=s) lo=mid
      else hi=mid
    }
    const a=rows[lo], b=rows[hi]
    const t=a[0]===b[0]?0:Math.max(0,Math.min(1,(s-a[0])/(b[0]-a[0])))
    const at=(i:number)=>a[i]+t*(b[i]-a[i])
    const left=at(1), width=at(2)-left
    const margin=along ? 0 : Math.min(1,width/4)
    const across=width>.001?Math.max(0,Math.min(1,(lateral-left-margin)/(width-2*margin))):.5
    return at(3)*(1-across)+at(4)*across - (along ? height : 0)
  }
  return 0
}
