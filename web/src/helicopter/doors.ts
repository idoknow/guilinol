export const cabins=[
  {number:1,seat:'seat_pax_1',door:'door_front_L',side:'L',outward:1},
  {number:2,seat:'seat_pax_2',door:'door_L',side:'L',outward:1},
  {number:3,seat:'seat_pax_3',door:'door_R',side:'R',outward:-1},
] as const
export function closestCabin(distance:(door:string)=>number,occupied:readonly number[]=[]){
  return cabins.filter(cabin=>!occupied.includes(cabin.number)&&Number.isFinite(distance(cabin.door)))
    .sort((left,right)=>distance(left.door)-distance(right.door))[0]
}
