type WaterCell={water:Int16Array,bed:Int16Array,ground:(index:number)=>number,corner:number}
type CellAt=(x:number,z:number)=>WaterCell|undefined

export function openWater(x:number,z:number,cellAt:CellAt,covered:(x:number,z:number,height:number)=>boolean){
  let height:number|null=null,lowest=Infinity
  for(let west=Math.floor((x-1)/4)*4;west<=x+1;west+=4){
    for(let north=Math.floor((z-1)/4)*4;north<=z+1;north+=4){
      const cell=cellAt(west,north)
      if(!cell)return null
      const {corner,water,bed,ground}=cell,level=water[corner]
      if(level===-32768)return null
      for(const offset of [0,1,65,66]){
        const index=corner+offset
        if(water[index]!==level||bed[index]>=level||!(ground(index)<level/10-.02))return null
      }
      lowest=Math.min(lowest,level/10)
      if(x>=west&&x<west+4&&z>=north&&z<north+4)height=level/10
    }
  }
  return height!==null&&!covered(x,z,lowest)?height:null
}
