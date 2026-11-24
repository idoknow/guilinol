import * as T from 'three'

type Part = {geometry: T.BufferGeometry; material: T.Material | T.Material[]; local: T.Matrix4}
type Slot = {mesh: T.InstancedMesh; part: Part}

export class ParkedBatches {
  readonly view = new T.Group()
  private readonly slots = new Map<string, Slot[]>()
  private readonly previous = new Map<string, T.Object3D[]>()
  private readonly transform = new T.Matrix4()

  invalidate(key: string) { this.previous.delete(key) }

  sync(visible: Map<string, T.Object3D[]>, models: Map<string, Part[]>) {
    for (const [key, slots] of this.slots) {
      if (visible.has(key)) continue
      for (const {mesh} of slots) mesh.count = 0
      this.previous.delete(key)
    }
    for (const [key, records] of visible) {
      const old = this.previous.get(key)
      if (old?.length === records.length && old.every((record, index) => record === records[index])) continue
      let slots = this.slots.get(key)
      if (!slots || slots[0].mesh.instanceMatrix.count < records.length) {
        for (const {mesh} of slots ?? []) { this.view.remove(mesh); mesh.dispose() }
        slots = models.get(key)!.map(part => {
          const mesh = new T.InstancedMesh(part.geometry, part.material, records.length)
          this.view.add(mesh)
          return {part, mesh}
        })
        this.slots.set(key, slots)
      }
      for (const {mesh, part} of slots) {
        mesh.count = records.length
        records.forEach((record, index) => mesh.setMatrixAt(index, this.transform.multiplyMatrices(record.matrix, part.local)))
        mesh.instanceMatrix.needsUpdate = true
        mesh.computeBoundingSphere()
      }
      this.previous.set(key, records)
    }
  }
}

export function parkedParts(template: T.Mesh): Part[] {
  template.updateMatrixWorld(true)
  const parts: Part[] = []
  template.traverse(object => {
    if (object instanceof T.Mesh) parts.push({geometry: object.geometry, material: object.material, local: object.matrixWorld.clone()})
  })
  return parts
}
