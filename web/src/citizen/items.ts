export const cardUrl=(uid:number)=>new URL(`/id.html?uid=${uid}`,location.origin).href
export interface Keepsake {id:string; name:string; viewUrl:string}
export function backpackItems(uid:number): readonly Keepsake[] {
  return [{id:'citizen-card',name:'市民卡',viewUrl:cardUrl(uid)}]
}
