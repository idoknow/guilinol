import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs'
import {resolve, dirname} from 'node:path'
import {pathToFileURL} from 'node:url'
import * as THREE from 'three'
import {MeshoptSimplifier} from 'meshoptimizer'

// Rebuild the two untextured meshes from the approved idoknow reference commit.
const source = 'f7fa02e:web/src/walk/qingju/'
const scratch = mkdtempSync(resolve('node_modules/.bake-bike-'))
const read = file => execFileSync('git', ['show', source + file], {encoding: 'utf8'})
const write = (file, text) => { mkdirSync(dirname(scratch+'/'+file), {recursive:true}); writeFileSync(scratch+'/'+file,text) }
try {
  write('package.json','{"type":"module"}')
  for (const file of ['bike/bike.js','bike/chassis.js','bike/steering.js','bike/saddle.js','bike/wheels.js','bike/dims.js','bike/materials.js','util/geom.js']) {
    write(file,read(file).replace('if (labels)', 'if (false)'))
  }
  write('vehicle.js','export const getVehicle = () => ({})')
  const names = [...read('util/textures.js').matchAll(/export function (make\w+)/g)].map(match=>match[1])
  write('util/textures.js',names.map(name=>`export const ${name} = () => ({})`).join('\n'))
  const load = file => import(pathToFileURL(scratch+'/bike/'+file))
  const mats = (await load('materials.js')).createMaterials({capabilities:{getMaxAnisotropy:()=>1}})
  const decal = new THREE.MeshBasicMaterial()
  mats.decal = () => decal
  const bike = (await load('bike.js')).buildBike(mats,{noLights:true})
  bike.root.updateMatrixWorld(true)
  await MeshoptSimplifier.ready
  MeshoptSimplifier.useExperimentalFeatures = true
  const groups = [bike.parts.frontWheel,bike.rearWheel.spin,bike.steering.group,bike.body]
  for (const [label, grid, budget] of [['rig',.009,1250],['near',.016,370],['far',.05,110]]) {
    const bins = new Map()
    bike.body.traverse(mesh=>{
      if (!mesh.isMesh || mesh.material===decal || mesh.material.transparent) return
      let parent=mesh
      while (!groups.includes(parent)) parent=parent.parent
      const paint=[mats.teal,mats.tealSolid,mats.tealDark].includes(mesh.material)
      const shade=mesh.material.color
      const color=paint?'paint':label!=='far'?shade.getHexString():shade.r+shade.g+shade.b>.75?'b6bec4':'303234'
      const key=groups.indexOf(parent)+':'+color
      if (!bins.has(key)) bins.set(key,{vertices:new Map(),positions:[],indices:[]})
      const bin=bins.get(key), geom=mesh.geometry, pos=geom.attributes.position, remap=[]
      for(let index=0;index<pos.count;index++){
        const point=new THREE.Vector3().fromBufferAttribute(pos,index).applyMatrix4(mesh.matrixWorld)
        const coords=[-point.x,point.y,-point.z].map(value=>Math.round(value/grid)), hash=coords.join(',')
        if(!bin.vertices.has(hash)){bin.vertices.set(hash,bin.positions.length/3);bin.positions.push(...coords.map(value=>value*grid))}
        remap.push(bin.vertices.get(hash))
      }
      const indices=geom.index?.array??remap.keys()
      const mapped=Array.from(indices,index=>remap[index]); for(let n=0;n<mapped.length;n+=3){const [a,b,c]=mapped.slice(n,n+3);if(a!==b&&a!==c&&b!==c)bin.indices.push(a,b,c)}
    })
    const output=[]
    const total=[...bins.values()].reduce((sum,bin)=>sum+bin.indices.length,0)
    for(const [key,bin] of bins){
      if(!bin.indices.length)continue
      const [indices]=MeshoptSimplifier.simplify(new Uint32Array(bin.indices),new Float32Array(bin.positions),3,3*Math.floor(budget*bin.indices.length/total),1,['Prune'])
      if(!indices.length)continue
      const [remap,count]=MeshoptSimplifier.compactMesh(indices),positions=new Int16Array(count*3)
      for(let old=0;old<remap.length;old++)if(remap[old]<count)for(let axis=0;axis<3;axis++)positions[remap[old]*3+axis]=Math.round(bin.positions[old*3+axis]*1000)
      output.push({key,positions:Buffer.from(positions.buffer).toString('base64'),indices:Buffer.from(new Uint16Array(indices).buffer).toString('base64')})
    }
    writeFileSync(`web/src/walk/ebike-${label}.json`,JSON.stringify(output)+'\n')
  }
} finally {rmSync(scratch,{recursive:true,force:true})}
