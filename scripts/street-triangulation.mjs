import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {gunzipSync} from 'node:zlib'
import {ShapeUtils, Vector2} from 'three'

export function measurePath([, ...rings]) {
  const loops = rings.map(ring => ring.map(([x,z]) => new Vector2(x/100, z/100)))
  const [shell, ...holes] = loops
  // Triangulate in metres exactly like street-worker, but measure integer
  // twice-areas on the stored grid so even tiny slivers have an exact bound.
  const twiceArea = ring => Math.abs(ring.reduce((sum, [x,z], i) => {
    const [nextX,nextZ] = ring[(i+1)%ring.length]
    return sum + x*nextZ - z*nextX
  }, 0))
  const ringTwiceArea = twiceArea(rings[0]) - rings.slice(1).reduce((sum, h) => sum + twiceArea(h), 0)
  const triangles = ShapeUtils.triangulateShape(shell, holes)
  // ShapeUtils removes duplicate closing vertices in place.
  const points = rings.flatMap((ring, i) => ring.slice(0, loops[i].length))
  let triangleTwiceArea = 0
  for (const [a,b,c] of triangles) {
    const p = points[a], q = points[b], r = points[c]
    triangleTwiceArea += Math.abs((q[0]-p[0])*(r[1]-p[1]) - (q[1]-p[1])*(r[0]-p[0]))
  }
  return {
    ringArea: ringTwiceArea/20000,
    triangleArea: triangleTwiceArea/20000,
    exceedsTolerance: triangleTwiceArea*200 > ringTwiceArea*201,
  }
}

export function streetAreaFindings(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json')))
  const findings = []
  for (const {x,z,file} of manifest.chunks) {
    const data = gunzipSync(readFileSync(join(directory, file)))
    const start = 24 + 4*(manifest.chunkSize/manifest.grid+1)**2 + 9*data.readUInt32LE(4) + 4*data.readUInt32LE(8)
    const streets = JSON.parse(data.toString('utf8', start, start+data.readUInt32LE(12)))[1]
    for (const [index,path] of streets[0].entries()) {
      // The pipeline topology audit reports malformed rings separately.
      if (path.length < 2 || path.slice(1).some(ring => ring.length < 3)) continue
      const {ringArea, triangleArea, exceedsTolerance} = measurePath(path)
      if (exceedsTolerance) findings.push({x,z,index,kind:path[0],ringArea,triangleArea})
    }
  }
  return findings
}
