import {readFile,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const [input,output]=process.argv.slice(2)
const sample=JSON.parse(await readFile(input))['682893309'].centerline
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions());const page=await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=256`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  await page.evaluate(()=>{const {camera,stream}=window.viewer;camera.position.set(-32,149,56);camera.lookAt(-46,148,79);stream.tick(camera.position)})
  await page.waitForFunction(()=>{const {stream}=window.viewer;return [...stream.landmarks.keys()].some(e=>e.id==='jiefang_bridge')&&[...stream.loaded.keys()].some(e=>e.x===-256&&e.z===0)},null,{timeout:90000})
  const result=await page.evaluate(sample=>{
    const {stream,camera}=window.viewer, root=[...stream.landmarks].find(([entry])=>entry.id==='jiefang_bridge')[1]
    const tile=[...stream.loaded].find(([entry])=>entry.x===-256&&entry.z===0)[1]
    const roads=[],surfaces=[],colliders=[]
    function collect(geometry,matrix,name,list){
      const pos=geometry.attributes.position,index=geometry.index,vec=camera.position.clone(),vertices=[]
      for(let i=0;i<pos.count;i++){vec.fromBufferAttribute(pos,i);if(matrix)vec.applyMatrix4(matrix);vertices.push(vec.toArray())}
      for(let i=0;i<(index?.count??pos.count);i+=3){const tri=[0,1,2].map(k=>vertices[index?index.getX(i+k):i+k]);if(tri.every(p=>p[0]<-66)||tri.every(p=>p[0]>-27)||tri.every(p=>p[2]<56)||tri.every(p=>p[2]>106))continue;list.push([tri,name])}
    }
    collect(tile.batch.streetSurface,null,'GL04',roads)
    root.updateMatrixWorld(true);root.traverseVisible(mesh=>{if(mesh.isMesh)collect(mesh.geometry,mesh.matrixWorld,mesh.name,surfaces)})
    root.traverse(mesh=>{if(!mesh.isMesh)return;for(let parent=mesh;parent&&parent!==root;parent=parent.parent){if(/^collision/i.test(parent.name)){collect(mesh.geometry,mesh.matrixWorld,mesh.name,colliders);break}}})
    function hits(x,z,triangles){const result=[];for(const [[a,b,c],name] of triangles){
      const ux=b[0]-a[0],uz=b[2]-a[2],vx=c[0]-a[0],vz=c[2]-a[2],det=ux*vz-uz*vx
      if(Math.abs(det)<1e-8)continue;const dx=x-a[0],dz=z-a[2],u=(dx*vz-dz*vx)/det,v=(ux*dz-uz*dx)/det
      if(u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6)result.push([a[1]+u*(b[1]-a[1])+v*(c[1]-a[1]),name])
    }return result.sort((a,b)=>a[0]-b[0])}
    const rows=[];for(let step=-20;step<=10*(sample.length-1)+20;step++){
      const alpha=step/10,idx=Math.max(0,Math.min(sample.length-2,Math.floor(alpha))),fraction=alpha-idx
      const [x,z]=sample[idx],dx=sample[idx+1][0]-x,dz=sample[idx+1][1]-z,len=Math.hypot(dx,dz)
      for(const offset of [-1.5,0,1.5]){const px=x+fraction*dx+offset*dz/len,pz=z+fraction*dz-offset*dx/len
        const street=hits(px,pz,roads).at(-1),levels=[...hits(px,pz,surfaces),...hits(px,pz,colliders)].sort((first,second)=>first[0]-second[0]);if(!levels.length)continue;if(!street)throw Error(`missing street ${px},${pz}`)
        const over=levels.find(([y])=>y>=street[0]);if(!over)continue
        rows.push({x:px,z:pz,offset,street:street[0],lowest:levels[0][0],over:over[0],object:over[1],clearance:over[0]-street[0]})
      }
    }return rows
  },sample)
  const minimum=rows=>rows.reduce((a,b)=>a.clearance<b.clearance?a:b)
  const report={minimum:minimum(result),centerMinimum:minimum(result.filter(row=>!row.offset)),north:result.find(row=>!row.offset&&Math.hypot(row.x+34.170,row.z-62.049)<.001),rows:result}
  if(!report.north)throw Error('Missing north entrance')
  await writeFile(output,JSON.stringify(report));console.log(report.minimum,report.north)
  if(report.minimum.clearance<2.5)process.exitCode=1
}finally{await browser?.close();await server.close()}
