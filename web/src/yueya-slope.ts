export const northCyclewayGrade = (805.6-742.7)/(331.7-152.4)
export const slopeTransition = 54

export function slopeStart(east:number) {
  return 805.6 + northCyclewayGrade*(east-331.7) - 6 - slopeTransition
}

export function onOldSouthSlope(east:number,south:number) {
  return east>=164 && east<=508 && south<=860 && south>=slopeStart(east)
}

export function slopeRatio(distance:number) {
  return slopeTransition/(slopeTransition+distance)
}
