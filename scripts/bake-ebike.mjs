import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs'
import {resolve, dirname} from 'node:path'
import {pathToFileURL} from 'node:url'
import * as THREE from 'three'
import {bakeShells} from './ebike-shells.mjs'

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
  for(const far of [false,true]){
    const encoded=bakeShells(bike,far)
    writeFileSync(`web/src/walk/ebike-${far?'far':'rig'}.json`,JSON.stringify(encoded)+'\n')
  }
} finally {rmSync(scratch,{recursive:true,force:true})}
