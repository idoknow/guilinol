type Point = {x:number; z:number}
type Node = Point & {edges:Edge[]}
type Edge = {start:Node; end:Node; banner:boolean; seen:boolean}

export function medianRails(decor:readonly number[][], suppressed:(kind:number,x:number,z:number)=>boolean,
  beam:(start:Point,end:Point,banner:boolean)=>void, post:(point:Point)=>void) {
  const buckets=new Map<string,Node[]>(), nodes:Node[]=[], edges:Edge[]=[]
  function nodeAt(x:number,z:number,tolerance:number){
    const col=Math.floor(x), row=Math.floor(z)
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
      for(const node of buckets.get(`${col+dx}:${row+dz}`)??[])if(Math.hypot(node.x-x,node.z-z)<=tolerance)return node
    }
    const node:Node={x,z,edges:[]},key=`${col}:${row}`
    const bucket=buckets.get(key)??[];bucket.push(node);buckets.set(key,bucket);nodes.push(node);return node
  }
  for(const [kind,east,south,heading,span,ax,az,bx,bz] of decor){
    if((kind!==1&&kind!==2)||suppressed(kind,east/10,south/10))continue
    const exact=bz!==undefined, dx=Math.cos(heading/100)*span/20,dz=Math.sin(heading/100)*span/20
    const start=nodeAt(exact?ax/100:east/10-dx,exact?az/100:south/10-dz,exact?.001:.18)
    const end=nodeAt(exact?bx/100:east/10+dx,exact?bz/100:south/10+dz,exact?.001:.18)
    if(start===end)continue
    const edge={start,end,banner:kind===2,seen:false};edges.push(edge);start.edges.push(edge);end.edges.push(edge)
  }
  const caps=new Set<Node>()
  function trace(first:Edge,start:Node){
    let from=start,edge:Edge|undefined=first,total=0
    const legs=[]
    while(edge&&!edge.seen){
      edge.seen=true
      const to:Node=edge.start===from?edge.end:edge.start,length=Math.hypot(to.x-from.x,to.z-from.z)
      beam(from,to,edge.banner);legs.push({from,to,length});total+=length;from=to
      edge=to.edges.length===2?to.edges.find(candidate=>!candidate.seen):undefined
    }
    caps.add(start);caps.add(from)
    const spacing=total/Math.max(1,Math.round(total));let travelled=0,next=spacing
    for(const {from,to,length} of legs){
      while(next<travelled+length&&next<total-1e-6){
        const fraction=(next-travelled)/length
        post({x:from.x+(to.x-from.x)*fraction,z:from.z+(to.z-from.z)*fraction});next+=spacing
      }
      travelled+=length
    }
  }
  for(const node of nodes)if(node.edges.length!==2)for(const edge of node.edges)if(!edge.seen)trace(edge,node)
  for(const edge of edges)if(!edge.seen)trace(edge,edge.start)
  for(const cap of caps)post(cap)
}
