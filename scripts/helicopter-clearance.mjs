import {readFileSync, writeFileSync, readdirSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {Box3, Matrix4, Quaternion, Vector3} from 'three'
import {tourRoute, modes} from '../web/src/helicopter/route.ts'
import {helipad} from '../web/src/helicopter/site.ts'

const json=path=>JSON.parse(readFileSync(path)), manifest=json('public/world/manifest.json')
const cell=12, grid=new Map(), key=(col,row)=>col+row*10000
function stamp(west,north,east,south,top){
  for(let row=Math.floor(north/cell);row<=Math.floor(south/cell);row++)for(let col=Math.floor(west/cell);col<=Math.floor(east/cell);col++){
    const index=key(col,row);grid.set(index,Math.max(grid.get(index)??-Infinity,top))
  }
}
const overrides={}
for(const shard of readdirSync('public/city-upgrade/shards'))Object.assign(overrides,json(`public/city-upgrade/shards/${shard}`).overrides)
for(const tile of manifest.chunks){
  const data=gunzipSync(readFileSync(`public/world/${tile.file}`)), vertexCount=data.readUInt32LE(4), indexCount=data.readUInt32LE(8)
  const offset=24+4225*4+vertexCount*9+indexCount*4
  for(let row=0;row<65;row++)for(let col=0;col<65;col++){
    const east=tile.x+col*4,south=tile.z+row*4
    stamp(east-4,south-4,east+4,south+4,data.readInt16LE(24+(row*65+col)*2)/10)
  }
  const [buildings]=JSON.parse(data.toString('utf8',offset,offset+data.readUInt32LE(12)))
  buildings.forEach(([base,roof,rings],index)=>{
    const eastings=rings.flat().map(point=>tile.x+point[0]/100), northings=rings.flat().map(point=>tile.z+point[1]/100)
    const override=overrides[`${tile.x},${tile.z}:${index}`]
    stamp(Math.min(...eastings),Math.min(...northings),Math.max(...eastings),Math.max(...northings),Math.max(roof/10,base/10+(override?.h??0))+3)
  })
}
const peaks=gunzipSync(readFileSync(`public/world/${manifest.peaks.file}`))
for(const peak of manifest.peaks.entries){
  const level=peak.lods[0];if(!level)continue
  for(let index=0;index<level.indices;index+=3){
    const points=[0,1,2].map(corner=>{
      const offset=level.offset+6*peaks.readUInt16LE(level.indexOffset+2*(index+corner))
      return peak.center.map((axis,component)=>axis+peaks.readInt16LE(offset+component*2)/100)
    })
    const axis=(component)=>points.map(point=>point[component]);stamp(Math.min(...axis(0)),Math.min(...axis(2)),Math.max(...axis(0)),Math.max(...axis(2)),Math.max(...axis(1)))
  }
}
for(const landmark of [...manifest.landmarks,...manifest.peaks.entries.filter(peak=>peak.model).map(peak=>({file:peak.model,rotation:0,position:[peak.center[0],peak.baseHeight,peak.center[2]]}))]){
  const data=readFileSync(`public/${landmark.file}`), gltf=JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)))
  const world=new Matrix4().makeRotationY(landmark.rotation*Math.PI/180).setPosition(...landmark.position)
  function visit(index,parent){
    const node=gltf.nodes[index], mat=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3(...(node.translation??[0,0,0])),new Quaternion(...(node.rotation??[0,0,0,1])),new Vector3(...(node.scale??[1,1,1])))
    mat.premultiply(parent)
    for(const primitive of gltf.meshes?.[node.mesh]?.primitives??[]){
      const bounds=gltf.accessors[primitive.attributes.POSITION], box=new Box3(new Vector3(...bounds.min),new Vector3(...bounds.max)).applyMatrix4(mat)
      stamp(box.min.x,box.min.z,box.max.x,box.max.z,box.max.y)
    }
    for(const child of node.children??[])visit(child,mat)
  }
  for(const root of gltf.scenes[gltf.scene??0].nodes)visit(root,world)
}
function ceiling(x,z){
  let top=-Infinity
  for(let row=Math.floor((z-7)/cell);row<=Math.floor((z+7)/cell);row++)for(let col=Math.floor((x-7)/cell);col<=Math.floor((x+7)/cell);col++){
    const value=grid.get(key(col,row));if(value===undefined)throw Error(`Missing terrain at ${x}, ${z}`);top=Math.max(top,value)
  }return top
}
const profiles={}
for(const mode of Object.keys(modes)){
  const path=tourRoute(helipad,mode,()=>0), heights=Array(path.duration+1).fill(0)
  for(let tick=0;tick<=path.duration*20;tick++){
    const time=tick/20,pos=path.pose(time),level=Math.ceil(ceiling(pos.x,pos.z));for(const index of [Math.floor(time),Math.ceil(time)])heights[index]=Math.max(heights[index],level)
  }
  for(let index=1;index<heights.length;index++)heights[index]=Math.max(heights[index],heights[index-1]-3)
  for(let index=heights.length-2;index>=0;index--)heights[index]=Math.max(heights[index],heights[index+1]-3)
  profiles[mode]=heights
  const route=tourRoute(helipad,mode,(_x,_z,time)=>heights[Math.floor(time)]+(heights[Math.ceil(time)]-heights[Math.floor(time)])*(time%1));let minimum=Infinity,low=Infinity,high=-Infinity,bank=0
  for(let tick=0;tick<=path.duration*20;tick++){const pos=route.pose(tick/20);minimum=Math.min(minimum,pos.y-ceiling(pos.x,pos.z));low=Math.min(low,pos.y);high=Math.max(high,pos.y);bank=Math.max(bank,Math.abs(pos.roll)*180/Math.PI)}
  if(minimum<25)throw Error(`Unsafe ${mode}: ${minimum}`);console.log(mode,{seconds:path.duration,minimumClearance:minimum,minY:low,maxY:high,maximumRoll:bank})
}
writeFileSync('web/src/helicopter/clearance.json',JSON.stringify(profiles)+'\n')
