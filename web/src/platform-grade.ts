import {inRing} from './polygon'

/** Each row records local z, left/right edge x and the adjacent rails' vertical offsets. */
export interface PlatformGrade {
  ring: [number, number][]
  rows: [number, number, number, number, number][]
}

export function platformShift(grades: PlatformGrade[], x: number, z: number) {
  for (const {ring, rows} of grades) {
    if (!inRing(x,z,ring)) continue
    let lo=0, hi=rows.length-1
    while (hi-lo>1) {
      const mid=(lo+hi)>>1
      if (rows[mid][0]<=z) lo=mid
      else hi=mid
    }
    const a=rows[lo], b=rows[hi]
    const t=a[0]===b[0]?0:Math.max(0,Math.min(1,(z-a[0])/(b[0]-a[0])))
    const at=(i:number)=>a[i]+t*(b[i]-a[i])
    const left=at(1), width=at(2)-left
    const margin=Math.min(1,width/4)
    const across=width>.001?Math.max(0,Math.min(1,(x-left-margin)/(width-2*margin))):.5
    return at(3)*(1-across)+at(4)*across
  }
  return 0
}
