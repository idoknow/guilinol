import * as THREE from 'three'
import { validView, type FeedbackView } from '../../../lib/feedback-contract'
import { xz2ll } from '../../../lib/projection'
import type { Host } from './host'

export function setView(host: Host, view: unknown) {
  if (!validView(view)) throw Error('无效的反馈视角')
  host.fly()
  const camera = host.camera
  camera.position.set(view.x, view.y, view.z)
  camera.rotation.set(THREE.MathUtils.degToRad(view.pitch), THREE.MathUtils.degToRad(view.yaw), 0, 'YXZ')
  camera.fov = view.fov
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
}

export async function capture(host: Host) {
  host.draw()
  const canvas = host.renderer.domElement,
    scale = Math.min(1, 1600 / Math.max(canvas.width, canvas.height)),
    copy = document.createElement('canvas')
  copy.width = Math.max(1, Math.round(canvas.width * scale))
  copy.height = Math.max(1, Math.round(canvas.height * scale))
  copy.getContext('2d')!.drawImage(canvas, 0, 0, copy.width, copy.height)
  const camera = host.camera,
    ray = new THREE.Raycaster(),
    meshes: THREE.Object3D[] = [],
    ids = new Map<THREE.Object3D, string>()
  ray.setFromCamera(new THREE.Vector2(), camera)
  const add = (root: THREE.Object3D, id?: string) =>
    root.traverseVisible((node) => {
      if (node instanceof THREE.Mesh) {
        meshes.push(node)
        if (id) ids.set(node, id)
      }
    })
  for (const [entry, root] of host.stream.landmarks) add(root, entry.id)
  for (const tile of host.stream.loaded.values()) add(tile.groundMesh)
  for (const mesh of host.stream.batches.feedbackMeshes()) add(mesh)
  add(host.peaks)
  add(host.stream.overviewMesh())
  const hit = ray.intersectObjects(meshes, false)[0],
    point = hit?.point
  const { x, y, z } = camera.position,
    angle = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'),
    yaw = THREE.MathUtils.radToDeg(angle.y)
  const view: FeedbackView = {
    mode: host.walker()?.active ? 'walk' : 'fly',
    x,
    y,
    z,
    ...xz2ll(x, z),
    alt: y,
    yaw,
    pitch: THREE.MathUtils.radToDeg(angle.x),
    heading: (360 - yaw) % 360,
    fov: camera.fov,
    target:
      point && Math.abs(point.x) <= 3072 && Math.abs(point.z) <= 3328
        ? { x: point.x, y: point.y, z: point.z, ...xz2ll(point.x, point.z), distance: hit.distance }
        : null,
    landmark_id: null,
    build: '',
  }
  if (view.target) view.landmark_id = ids.get(hit.object) ?? null
  const [shot, version] = await Promise.all([
    new Promise<Blob>((resolve, reject) =>
      copy.toBlob((blob) => (blob ? resolve(blob) : reject(Error('截图失败'))), 'image/jpeg', 0.85),
    ),
    fetch('/version.json').then((response) => response.json()),
  ])
  view.build = version.sha
  if (!validView(view)) throw Error('视角不在反馈范围内')
  return { view, shot }
}
