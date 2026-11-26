import {BufferAttribute,BufferGeometry,Group,Points,PointsMaterial} from 'three'

export function padDownwash(){
  const root=new Group(),count=96
  function layer(grass:boolean){
    const geometry=new BufferGeometry(),position=new BufferAttribute(new Float32Array(3*count),3)
    geometry.setAttribute('position',position)
    const material=new PointsMaterial({color:grass?0x697444:0xc1af91,size:grass?.055:.14,transparent:true,depthWrite:false})
    const points=new Points(geometry,material);points.frustumCulled=false;root.add(points)
    return (clock:number,strength:number)=>{
      material.opacity=strength*(grass?.72:.32)
      for(let index=0;index<count;index++){
        const phase=(index*.618034+clock*(grass?.55:.33))%1
        const angle=index*2.39996+phase*.22,radius=(grass?7.5:2)+phase*(grass?2.2:6.2)
        position.setXYZ(index,radius*Math.sin(angle),.05+Math.sin(Math.PI*phase)*strength*(grass?.42:.84),radius*Math.cos(angle))
      }
      position.needsUpdate=true
    }
  }
  const dust=layer(false),leaves=layer(true)
  return {root,update(clock:number,strength:number){root.visible=strength>.01;if(root.visible){dust(clock,strength);leaves(clock,strength)}}}
}
