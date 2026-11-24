export const cardUrl=(uid:number)=>new URL(`/id.html?uid=${uid}`,location.origin).href
export type Keepsake = {id:'citizen-card'; name:string; viewUrl:string} | {id:'cigarette';name:string}
export function backpackItems(uid:number): readonly Keepsake[] {
  return [{id:'citizen-card',name:'市民卡',viewUrl:cardUrl(uid)},{id:'cigarette',name:'香烟'}]
}
