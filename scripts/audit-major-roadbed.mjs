import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'

globalThis.self=globalThis
await import(process.env.AUDIT_WORKER??'../web/src/street-worker.ts')
const directory=process.env.WORLD_DIR??'public/world'
const manifest=JSON.parse(readFileSync(`${directory}/manifest.json`))
const buckets=new Map(manifest.chunks.map(tile=>[`${tile.x},${tile.z}`,{tile,probes:[]}]))
const stations=JSON.parse(execFileSync('uv',['run','--locked','python','pipeline/major_road_stations.py'],{maxBuffer:128e6}))
const bounds=process.env.AUDIT_BBOX?.split(',').map(Number)
if(bounds&&(bounds.length!==4||!bounds.every(Number.isFinite)||bounds[0]>=bounds[2]||bounds[1]>=bounds[3]))throw Error('AUDIT_BBOX expects minEast,minSouth,maxEast,maxSouth')
const stats={},causes={},tiles={},landmarks=new Map();let metres=0,stationCount=0
for(const [id,[way,x,z,nx,nz,width,length,structure]] of stations.entries()){
  if(bounds&&(x<bounds[0]||z<bounds[1]||x>=bounds[2]||z>=bounds[3]))continue
  stationCount++
  metres+=length
  for(const side of [-1,0,1]){
    const east=x+side*nx*(width/2-.03),south=z+side*nz*(width/2-.03)
    const bucket=buckets.get(`${Math.floor(east/256)*256},${Math.floor(south/256)*256}`)
    const probe={id,way,east,south,side,structure}
    if(bucket)bucket.probes.push(probe)
    else record('missingTile',probe,0)
  }
}
function record(name,probe,delta){
  const key=probe.structure+'.'+name,data=stats[key]??={samples:0,affected:new Set(),worst:[]};data.samples++;data.affected.add(probe.id)
  const severity=name==='overlap'?-Math.abs(delta):Math.abs(delta)
  if(probe.structure==='ground'&&['overlap','openEdge','voidCandidate'].includes(name)){
    const tileKey=[Math.floor(probe.east/256)*256,Math.floor(probe.south/256)*256].join(',')
    const counts=tiles[tileKey]??={};counts[name]=(counts[name]??0)+1
    const cause=Number.isFinite(probe.deck)?'deck intersection':Number.isFinite(probe.landmark)?'landmark intersection':Number.isFinite(probe.building)?'building intersection':probe.section??'unmapped section'
    const item=causes[name+'.'+cause]??={samples:0,affected:new Set(),worst:[]};item.samples++;item.affected.add(probe.id)
    if(!item.worst.some(point=>point.way===probe.way)){item.worst.push({...probe,delta,severity});item.worst.sort((left,right)=>right.severity-left.severity);item.worst.splice(3)}
  }
  if(data.worst.length<20||severity>data.worst.at(-1).severity){data.worst.push({...probe,delta,severity});data.worst.sort((left,right)=>right.severity-left.severity);data.worst.splice(20)}
}
for(const entry of manifest.landmarks.filter(entry=>entry.collision==='mesh')){
  const buf=execFileSync(process.execPath,['pipeline/glb-triangles.mjs',(process.env.AUDIT_PUBLIC??'public')+'/'+entry.file,'--collision'],{maxBuffer:128e6}),angle=entry.rotation*Math.PI/180
  const triangles=new Float32Array(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.length))
  for(let at=0;at<triangles.length;at+=9){
    const points=[]
    for(let j=at;j<at+9;j+=3){const [x,y,z]=triangles.subarray(j,j+3);points.push(entry.position[0]+Math.cos(angle)*x+Math.sin(angle)*z,entry.position[1]+y,entry.position[2]-Math.sin(angle)*x+Math.cos(angle)*z)}
    for(let x=Math.floor(Math.min(points[0],points[3],points[6])/256)*256;x<=Math.max(points[0],points[3],points[6]);x+=256)for(let z=Math.floor(Math.min(points[2],points[5],points[8])/256)*256;z<=Math.max(points[2],points[5],points[8]);z+=256){const key=`${x},${z}`;if(!landmarks.has(key))landmarks.set(key,[]);landmarks.get(key).push(...points.map((v,i)=>v-(i%3===0?x:i%3===2?z:0)))}
  }
}
function decode(tile){
  const raw=gunzipSync(readFileSync(`${directory}/${tile.file}`))
  if(raw.toString('ascii',0,4)!=='GL04')throw Error(tile.file)
  const offset=24+16900+9*raw.readUInt32LE(4)+4*raw.readUInt32LE(8),end=offset+raw.readUInt32LE(12)
  const [,paths,,,rails=[],signs=[],railCuts=[]]=JSON.parse(raw.subarray(offset,end))
  const tail=end+raw.readUInt32LE(16)+raw.readUInt32LE(20)*18
  const base=raw.length===tail?24:tail, wet=(col,row)=>raw.readInt16LE(8474+2*(65*row+col))!==-32768
  const sample=(col,row)=>raw.readInt16LE(base+2*(65*row+col))/10
  const edges=Array.from({length:4},(_,side)=>Array.from({length:65},(_,at)=>wet(...[[0,at],[64,at],[at,0],[at,64]][side])).some(Boolean))
  const step=raw.subarray(8474,16924).every((value,index)=>value===(index%2?128:0))?8:4,stride=256/step+1
  const grid=Float32Array.from({length:stride*stride},(_,index)=>{
    const col=index%stride*step/4,row=Math.floor(index/stride)*step/4
    if((col===0&&!edges[0])||(col===64&&!edges[1]))return sample(col,row&~7)+(sample(col,Math.min(64,(row&~7)+8))-sample(col,row&~7))*(row%8)/8
    if((row===0&&!edges[2])||(row===64&&!edges[3]))return sample(col&~7,row)+(sample(Math.min(64,(col&~7)+8),row)-sample(col&~7,row))*(col%8)/8
    return sample(col,row)
  })
  let data;self.postMessage=result=>{if(result.error)throw Error(result.error);data=result.data}
  self.onmessage({data:{paths,rails,signs,railCuts,paving:tile.stationPaving,roadbeds:tile.roadbeds,step,elevations:grid}})
  for(const [index,cm] of railCuts)grid[index]=cm/100
  const foundation=[],buildings=[],decks=[],walls=[]
  const vertexCount=raw.readUInt32LE(4),indexCount=raw.readUInt32LE(8)
  for(let i=0;i<indexCount;i++){
    const pos=16924+6*raw.readUInt32LE(16924+9*vertexCount+4*i)
    buildings.push(raw.readInt16LE(pos)/100,raw.readInt16LE(pos+2)/10,raw.readInt16LE(pos+4)/100)
  }
  for(let i=0;i<data.positions.length;i+=9){const p=data.positions.subarray(i,i+9);if(Math.abs((p[3]-p[0])*(p[8]-p[2])-(p[5]-p[2])*(p[6]-p[0]))<1e-6)walls.push(...p)}
  for(let offset=0;offset<data.positions.length;offset+=9)if(data.kinds[offset/3]===3)foundation.push(...data.positions.subarray(offset,offset+9))
  const deckOffset=end+raw.readUInt32LE(16)
  for(let offset=deckOffset;offset<tail;offset+=2)decks.push(raw.readInt16LE(offset)/100)
  const tags=new Set(tile.roadbeds),sections=new Map(paths[0].map((path,index)=>[path,tags.has(-1-index)?'bridge transition':tags.has(index)?'ground bed':path[0]===5?'cycle join':'untagged paving']))
  return {road:data.road,foundation,buildings,decks,walls,sections,rings:paths[0].filter(path=>path[0]===0||path[0]===5),grid,step,stride}
}
const probeCell=(x,z)=>Math.floor(x/8)+32*Math.floor(z/8)
function inFootprint(x,z,rings){
  return rings.some(([, ...loops])=>{
    let inside=false
    for(const loop of loops)for(let i=0,j=loop.length-1;i<loop.length;j=i++){
      const [ax,az]=loop[i],[bx,bz]=loop[j]
      if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)inside=!inside
    }
    return inside
  })
}
for(const {tile,probes} of buckets.values()){
  if(!probes.length)continue
  const {grid,road,foundation,buildings,decks,walls,rings,sections,step,stride}=decode(tile), cells=new Map()
  for(const probe of probes){const x=probe.east-tile.x,z=probe.south-tile.z,key=probeCell(x,z);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(Object.assign(probe,{x,z,top:-Infinity}))}
  const edgeProbes=[]
  for(const probe of probes.filter(p=>p.side)){
    const [,cx,cz,nx,nz,width]=stations[probe.id],dx=nx*probe.side,dz=nz*probe.side,originX=cx-tile.x,originZ=cz-tile.z
    let best=Infinity,travel
    for(const [, ...loops] of rings)for(const loop of loops)for(let i=0;i<loop.length;i++){
      const [a,b]=[loop[i],loop[(i+1)%loop.length]],ax=a[0]/100,az=a[1]/100,bx=b[0]/100,bz=b[1]/100
      if(ax===bx&&(ax===0||ax===256)||az===bz&&(az===0||az===256))continue
      const ex=bx-ax,ez=bz-az,det=dx*ez-dz*ex,ox=ax-originX,oz=az-originZ,t=(ox*ez-oz*ex)/det,s=(ox*dz-oz*dx)/det
      if(t>0&&s>=0&&s<=1&&Math.abs(t-width/2)<best&&t<=width){best=Math.abs(t-width/2);travel=t}
    }
    if(travel===undefined)continue
    const x=originX+dx*(travel-.002),z=originZ+dz*(travel-.002);if(x<0||z<0||x>=256||z>=256)continue
    const p={...probe,x,z,east:x+tile.x,south:z+tile.z,edge:true},key=probeCell(x,z);edgeProbes.push(p);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(p)
  }
  for(const [layer,triangles] of [['top',road],['foundation',foundation],['building',buildings],['deck',decks],['landmark',landmarks.get(`${tile.x},${tile.z}`)??[]],['wall',walls]])for(let at=0;at<triangles.length;at+=9){
    const ax=triangles[at],az=triangles[at+2],bx=triangles[at+3],bz=triangles[at+5],cx=triangles[at+6],cz=triangles[at+8],det=(bx-ax)*(cz-az)-(bz-az)*(cx-ax)
    if(Math.abs(det)<1e-9){
      for(let col=Math.floor((Math.min(ax,bx,cx)-.025)/8);col<=Math.floor((Math.max(ax,bx,cx)+.025)/8);col++)for(let row=Math.floor((Math.min(az,bz,cz)-.025)/8);row<=Math.floor((Math.max(az,bz,cz)+.025)/8);row++)for(const p of cells.get(col+32*row)??[]){if(!p.edge||!Number.isFinite(p.top)||p.sealed)continue
        const levels=[]
        for(let corner=0;corner<3;corner++){
          const start=at+corner*3,end=at+(corner+1)%3*3,dx=triangles[end]-triangles[start],dz=triangles[end+2]-triangles[start+2]
          const along=((p.x-triangles[start])*dx+(p.z-triangles[start+2])*dz)/(dx*dx+dz*dz)
          if(along>=0&&along<=1&&Math.hypot(p.x-triangles[start]-along*dx,p.z-triangles[start+2]-along*dz)<.025)levels.push(triangles[start+1]+along*(triangles[end+1]-triangles[start+1]))
        }
        if(levels.length>=2){const spans=p.wallSpans??=[];spans.push([Math.min(...levels),Math.max(...levels)]);let low=p.top
          for(const [bottom,top] of spans.sort((a,b)=>b[1]-a[1]))if(top>=low-.005)low=Math.min(low,bottom)
          p.sealed=low<=p.top-.10}
      }continue}
    for(let col=Math.floor(Math.min(ax,bx,cx)/8);col<=Math.floor(Math.max(ax,bx,cx)/8);col++)for(let row=Math.floor(Math.min(az,bz,cz)/8);row<=Math.floor(Math.max(az,bz,cz)/8);row++)for(const probe of cells.get(col+32*row)??[]){
      const dx=probe.x-ax,dz=probe.z-az,u=(dx*(cz-az)-dz*(cx-ax))/det,v=((bx-ax)*dz-(bz-az)*dx)/det
      if(u>=0&&v>=0&&u+v<=1){
        const height=triangles[at+1]+u*(triangles[at+4]-triangles[at+1])+v*(triangles[at+7]-triangles[at+1])
        if(layer==='top'||!Number.isFinite(probe.top)||height<=probe.top+.02)probe[layer]=Math.max(probe[layer]??-Infinity,height)
      }
    }
  }
  for(const probe of [...probes,...edgeProbes]){
    if(!Number.isFinite(probe.top)){if(!probe.edge)record(Number.isFinite(probe.deck)?'deckInsteadOfRoad':Number.isFinite(probe.landmark)?'landmarkAtMiss':inFootprint(probe.x*100,probe.z*100,rings)?'polygonWithoutTop':probe.side?'outsideNativeFootprint':'missingAxisSurface',probe,0);continue}
    const col=Math.min(stride-2,Math.floor(probe.x/step)),row=Math.min(stride-2,Math.floor(probe.z/step)),u=probe.x/step-col,v=probe.z/step-row,at=col+stride*row
    const a=grid[at],b=grid[at+1],c=grid[at+stride],d=grid[at+stride+1]
    const delta=probe.top-Math.max(probe.foundation??-Infinity,probe.building??-Infinity,probe.landmark??-Infinity,probe.deck??-Infinity,u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v))
    if(probe.structure==='ground'&&(Math.abs(delta)<.02||delta>(probe.edge?.10:.30))){const path=rings.find(path=>inFootprint(probe.x*100,probe.z*100,[path]));probe.section=sections.get(path);if(probe.section==='ground bed'&&Math.max(a,b,c,d)-Math.min(a,b,c,d)>step*.10)probe.section='steep ground bed'}
    if(probe.edge){if(delta>.10&&!probe.sealed)record('openEdge',probe,delta);continue}
    if(Math.abs(delta)<.02)record('overlap',probe,delta)
    if(delta<-.02)record('buried',probe,delta)
    if(delta>.30)record('voidCandidate',probe,delta)
  }
}
for(const key of ['ground.overlap','ground.openEdge','ground.voidCandidate'])stats[key]??={samples:0,affected:new Set(),worst:[]}
for(const data of [...Object.values(stats),...Object.values(causes)]){data.length=[...data.affected].reduce((sum,id)=>sum+stations[id][6],0);data.fraction=data.length/metres;delete data.affected}
const output={scope:'Native carriageways; building shell, landmark collision, deck, foundation and terrain supports. Open edges sampled at intersections with native polygon rings, excluding tile cuts. Non-ground structures reported separately. Missing-axis and landmark-at-miss counts require semantic review.',metres,stations:stations.length,stats}
writeFileSync(process.argv[2]??'roadbed-report.json',JSON.stringify({...output,stations:stationCount,bounds,causes,tiles},null,2)+'\n')
console.table(Object.entries(stats).map(([name,{samples,length,fraction}])=>({name,samples,length,fraction})))
