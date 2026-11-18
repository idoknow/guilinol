import type {PerspectiveCamera} from 'three'

type Point = [number,number,number]
const presets:Record<string,[Point,Point]> = {
  lijiang:[[85,173,-340],[-110,180,-810]],
  palace:[[-490,171,-485],[-513,194,-679]],
  elephant:[[-740,171,868],[-855,179,1098]],
  overview:[[-500,1100,2600],[-500,180,-300]],
  south:[[-300,181,3090],[-287,202,2780]],
  foot:[[-448,158.3,-728],[-499,166,-687]],
}
export function setPreset(camera:PerspectiveCamera,name:string|null) {
  if(name && Object.hasOwn(presets,name)) {
    const [eye,target]=presets[name]
    camera.position.set(...eye); camera.lookAt(...target)
  }
}
