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

function ramp(value:number) {
  const amount=Math.max(0,Math.min(1,value))
  return amount*amount*(3-2*amount)
}

export function yueyaShoulderHeight(east:number,height:number,south:number) {
  if(height<=158 || east<164 || east>508 || south<536 || south>860)return height
  const west=ramp((east-252)/34), southRidge=1-ramp((south-672)/132)
  const blend=ramp((south-550)/55)*ramp((east-164)/30)*ramp((508-east)/65)*ramp((860-south)/30)
  return height-(height-158)*blend*(1-west*southRidge)*.94
}
