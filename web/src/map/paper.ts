import type {Atlas} from './atlas'

export function mapPaper(atlas:Atlas){
  const [left,top,width,depth]=atlas.extent, resolution=.5
  const sheet=document.createElement('canvas');sheet.width=Math.ceil(width*resolution);sheet.height=Math.ceil(depth*resolution)
  const ink=sheet.getContext('2d')!;ink.scale(resolution,resolution);ink.translate(-left,-top)
  ink.fillStyle='#cad2be';ink.fillRect(left,top,width,depth)
  function trace(path:number[]){ink.moveTo(path[0],path[1]);for(let index=2;index<path.length;index+=2)ink.lineTo(path[index],path[index+1])}
  for(const [layer,color] of [[atlas.green,'#a8bda9'],[atlas.water,'#4f7f8a']] as const){ink.fillStyle=color
    for(const rings of layer){ink.beginPath();for(const ring of rings){trace(ring);ink.closePath()}ink.fill('evenodd')}}
  ink.fillStyle='#b5b7ad';for(const building of atlas.buildings){ink.beginPath();trace(building);ink.fill()}
  ink.strokeStyle='#f4efe2';for(const road of atlas.roads){ink.lineWidth=Math.max(2,road.w);ink.beginPath();trace(road.p);ink.stroke()}
  return (ctx:CanvasRenderingContext2D)=>ctx.drawImage(sheet,left,top,width,depth)
}
