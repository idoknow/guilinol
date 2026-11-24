import * as T from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import near from './ebike-near.json'
import far from './ebike-far.json'
import rig from './ebike-rig.json'

function bytes(encoded: string) {
  return Uint8Array.from(atob(encoded), char => char.charCodeAt(0)).buffer
}

export function bikeGeometry(paint: number, distant = false, joint?: number, paintedOnly?: boolean) {
  const parts: T.BufferGeometry[] = []
  for (const entry of joint !== undefined ? rig : distant ? far : near) {
    const [part, shade] = entry.key.split(':')
    if (joint !== undefined && Number(part) !== joint) continue
    if (paintedOnly !== undefined && paintedOnly !== (shade === 'paint')) continue
    const geom = new T.BufferGeometry()
    const pos = Float32Array.from(new Int16Array(bytes(entry.positions)), value => value / 1000)
    geom.setAttribute('position', new T.BufferAttribute(pos, 3))
    geom.setIndex(new T.BufferAttribute(new Uint16Array(bytes(entry.indices)), 1))
    geom.computeVertexNormals()
    const tint = new T.Color(shade === 'paint' ? paint : parseInt(shade, 16))
    const colors = new Float32Array(pos.length)
    for (let offset = 0; offset < colors.length; offset += 3) tint.toArray(colors, offset)
    geom.setAttribute('color', new T.BufferAttribute(colors, 3))
    parts.push(geom)
  }
  const merged = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  return merged
}
