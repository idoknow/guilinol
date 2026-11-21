import {ll2xz} from '../../../lib/projection'
import type {Manifest} from '../world'

export const northwest = ll2xz(25.39,110.09), southeast = ll2xz(25.09,110.41)

export function builtBoundary(manifest:Manifest) {
  const [south,west,north,east] = manifest.bbox
  const rings = manifest.builtArea?.coordinates ?? [[[west,north],[east,north],[east,south],[west,south]]]
  const path = new Path2D()
  for(const ring of rings){ring.forEach(([lon,lat],index)=>{
    const {x,z} = ll2xz(lat,lon); if(index) path.lineTo(x,z); else path.moveTo(x,z)
  }); path.closePath()}
  const context = document.createElement('canvas').getContext('2d')!
  return {path, contains:(x:number,z:number)=>context.isPointInPath(path,x,z,'evenodd')}
}

type Label = [string,string,number,number]
type Payload = {version:number; paths:[string,number[][]][];labels:Label[]}
const layers = ['lake','pond','secondary','primary','trunk','motorway','ring']
const distant = new Set(['lake','primary','trunk','motorway','ring'])
export async function loadRegional(file:string){
  const response = await fetch(`./world/${file}`)
  if(!response.ok || !response.body) throw Error(`Cannot load ${file}`)
  const data:Payload = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json()
  if(data.version!==1) throw Error('Unsupported regional map')
  const groups = layers.map(()=>new Map<string,{path:Path2D;left:number;top:number;right:number;bottom:number}>())
  for(const [layer,rings] of data.paths){
    const first = rings[0], key = `${Math.floor(first[0]/1500)},${Math.floor(first[1]/1500)}`
    const group = groups[layers.indexOf(layer)]; let batch = group.get(key)
    if(!batch) group.set(key,batch={path:new Path2D(),left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity})
    for(const coords of rings){batch.path.moveTo(coords[0],coords[1]); for(let i=0;i<coords.length;i+=2){
      const x=coords[i],z=coords[i+1]; if(i) batch.path.lineTo(x,z)
      batch.left=Math.min(batch.left,x);batch.right=Math.max(batch.right,x);batch.top=Math.min(batch.top,z);batch.bottom=Math.max(batch.bottom,z)
    } if(layer==='lake'||layer==='pond') batch.path.closePath()}
  }
  return {paint(g:CanvasRenderingContext2D,left:number,top:number,right:number,bottom:number,scale:number,style:CSSStyleDeclaration){
    const far=scale<.09
    layers.forEach((layer,index)=>{if(far&&!distant.has(layer))return
      const water=index<2; g.fillStyle=style.getPropertyValue('--region-water'); g.strokeStyle=style.getPropertyValue(layer==='ring'?'--region-ring':'--region-road')
      g.lineWidth=(layer==='ring'?2:index>=4?1.3:.8)/scale
      for(const batch of groups[index].values()) if(batch.right>=left&&batch.bottom>=top&&batch.left<=right&&batch.top<=bottom){if(water)g.fill(batch.path);else g.stroke(batch.path)}
    })
    g.fillStyle=style.getPropertyValue('--region-label'); g.font=`${parseFloat(style.getPropertyValue('--region-font-size'))/scale}px ${style.getPropertyValue('--region-font')}`; g.textAlign='center'
    for(const [kind,name,x,z] of data.labels){if(x<left||x>right||z<top||z>bottom||(far&&kind!=='district'))continue
      if(kind==='peak'){g.beginPath();g.moveTo(x-4/scale,z);g.lineTo(x,z-5/scale);g.lineTo(x+4/scale,z);g.strokeStyle=g.fillStyle;g.lineWidth=1/scale;g.stroke()}
      if(name)g.fillText(name,x,z-6/scale)
    }
  }}
}
