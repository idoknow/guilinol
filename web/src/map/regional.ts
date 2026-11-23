import {inRegion} from '../../../lib/play-region'
import {ll2xz} from '../../../lib/projection'
import type {Manifest} from '../world'

export const northwest = ll2xz(25.39,110.00), southeast = ll2xz(25.09,110.41)

export function builtBoundary(manifest:Manifest) {
  const [south,west,north,east] = manifest.bbox
  const rings = (manifest.region ? [manifest.region.geographic] : manifest.builtArea?.coordinates) ?? [[[west,north],[east,north],[east,south],[west,south]]]
  const path = new Path2D()
  for(const ring of rings){ring.forEach(([lon,lat],index)=>{
    const {x,z} = ll2xz(lat,lon); if(index) path.lineTo(x,z); else path.moveTo(x,z)
  }); path.closePath()}
  const context = document.createElement('canvas').getContext('2d')!
  return {path, contains:(x:number,z:number)=>manifest.region ? inRegion(manifest,x,z) : context.isPointInPath(path,x,z,'evenodd')}
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
  // One label per public name: OSM often carries both a place node and an admin-centre node for a district.
  const seen = new Set<string>(), labels = data.labels.filter(([kind,name])=>kind==='peak'&&!name||!seen.has(name)&&!!seen.add(name))
  const css = (style:CSSStyleDeclaration,name:string)=>style.getPropertyValue(name).trim()
  return {paint(g:CanvasRenderingContext2D,left:number,top:number,right:number,bottom:number,scale:number,style:CSSStyleDeclaration){
    const far=scale<.09
    layers.forEach((layer,index)=>{if(far&&!distant.has(layer))return
      const water=index<2; g.fillStyle=css(style,'--region-water'); g.strokeStyle=css(style,layer==='ring'?'--region-ring':'--region-road')
      g.lineWidth=(layer==='ring'?parseFloat(css(style,'--region-ring-width')):index>=4?1.3:.8)/scale
      for(const batch of groups[index].values()) if(batch.right>=left&&batch.bottom>=top&&batch.left<=right&&batch.top<=bottom){if(water)g.fill(batch.path);else g.stroke(batch.path)}
    })
    // Karst peaks as small ink mounds (same vocabulary as the detailed map), drawn under the mask.
    if(!far){g.fillStyle=css(style,'--region-peak'); g.beginPath()
      for(const [kind,,x,z] of labels){if(kind!=='peak'||x<left||x>right||z<top||z>bottom)continue
        const r=4/scale; g.moveTo(x-r,z+r*.35); g.quadraticCurveTo(x-r*.55,z-r*1.5,x,z-r*1.35); g.quadraticCurveTo(x+r*.6,z-r*1.4,x+r,z+r*.35); g.closePath()}
      g.fill()}
  },
  // Names go above the mask with a paper halo so they stay legible; `skip` hides those the detailed map already names.
  labels(g:CanvasRenderingContext2D,left:number,top:number,right:number,bottom:number,scale:number,style:CSSStyleDeclaration,skip:(x:number,z:number)=>boolean){
    const far=scale<.09, size=parseFloat(css(style,'--region-font-size'))
    g.textAlign='center'; g.textBaseline='alphabetic'; g.lineJoin='round'; g.strokeStyle=css(style,'--region-halo'); g.lineWidth=3/scale
    for(const [kind,name,x,z] of labels){if(!name||x<left||x>right||z<top||z>bottom||(far?kind!=='district':skip(x,z)))continue
      const district=kind==='district'
      g.font=`${district?600:400} ${(district?size+2:size)/scale}px ${css(style,'--region-font')}`
      g.fillStyle=css(style,district?'--region-label':'--region-label-soft')
      const y=kind==='peak'?z-7/scale:z+4/scale
      g.strokeText(name,x,y); g.fillText(name,x,y)
    }
  }}
}
