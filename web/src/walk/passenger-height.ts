import {Mesh, Vector3, type Object3D} from 'three'

const vertex = new Vector3()

export function passengerTop(figure: Object3D): number {
  let top = -Infinity
  for (const child of figure.children) child.traverseVisible(part => {
    if (!(part instanceof Mesh)) return
    const count = part.geometry.getAttribute('position').count
    for (let index = 0; index < count; index++) {
      part.getVertexPosition(index, vertex).applyMatrix4(part.matrixWorld)
      top = Math.max(top, vertex.y)
    }
  })
  if (!Number.isFinite(top)) throw Error('Missing passenger geometry')
  return top
}
