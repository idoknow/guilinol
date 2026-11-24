import {getPlayMode} from '../game/play-mode'
import * as THREE from 'three'
import { validView, type FeedbackView } from '../../../lib/feedback-contract'
import {nearestPlayable} from '../../../lib/play-region'
import { xz2ll } from '../../../lib/projection'
import type { Host } from './host'
import {describeHit,dynamicPick} from './pick-diagnostic'

let build: string | undefined
async function currentBuild(): Promise<string> {
  if (build !== undefined) return build
  const sha = (await (await fetch('/version.json')).json()).sha
  build = typeof sha === 'string' ? sha : ''
  return build
}

export function setView(host: Host, view: unknown) {
  if (getPlayMode()==='solo')throw Error('FLIGHT_DISABLED_IN_SOLO')
  if (!validView(view,host.manifest.region ? 'saved' : 'feedback')) throw Error('无效的反馈视角')
  const {lat,lon} = xz2ll(view.x,view.z)
  const [south,west,north,east] = host.manifest.bbox
  if(!host.manifest.region && (lat<south || lat>north || lon<west || lon>east)) throw Error('反馈视角位于开放区域外')
  host.fly()
  const camera = host.camera
  const point=nearestPlayable(host.manifest,view.x,view.z)
  camera.position.set(point.x, view.y, point.z)
  camera.rotation.set(THREE.MathUtils.degToRad(view.pitch), THREE.MathUtils.degToRad(view.yaw), 0, 'YXZ')
  camera.fov = view.fov
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
}

// Saved positions use the current world's coordinates and only need a pose.
// Feedback captures also describe the object at the centre of the frame.
export async function currentView(host: Host, area: 'feedback' | 'saved' = 'feedback'): Promise<FeedbackView> {
  const build=await currentBuild(),camera = host.camera
  if (area === 'feedback') host.draw()
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
    target: null,
    landmark_id: null,
    build,
  }
  if (area === 'feedback') {
    const ray = new THREE.Raycaster(),
      meshes: THREE.Object3D[] = [],
      ids = new Map<THREE.Object3D, string>()
    ray.setFromCamera(new THREE.Vector2(), camera)
    const sources=new Map<THREE.Object3D,[string,string]>()
    const add = (root: THREE.Object3D, layer:string,owner:string,id?: string) =>
      root.traverseVisible((node) => {
        if (node instanceof THREE.Mesh) {
          meshes.push(node)
          sources.set(node,[layer,owner])
          if (id) ids.set(node, id)
        }
      })
    for (const [entry, root] of host.stream.landmarks) add(root,'landmark',entry.id,entry.id)
    for (const [tile,item] of host.stream.loaded) add(item.groundMesh,'terrain',tile.file)
    for (const mesh of host.stream.batches.feedbackMeshes()) add(mesh,'chunk','batch')
    add(host.peaks,'peak','peaks')
    add(host.stream.overviewMesh(),'overview',host.manifest.overview.underlay.file)
    const hits=ray.intersectObjects(meshes,false)
    for(const mesh of meshes)if(mesh instanceof THREE.Mesh && mesh.userData.peakSource)THREE.Mesh.prototype.raycast.call(mesh,ray,hits)
    const hit = hits.sort((left,right)=>left.distance-right.distance)[0],
      point = hit?.point
    const [layer,owner]=sources.get(hit?.object)??['unknown','unknown']
    const vertex=hit?.face?.a
    view.diagnostic={static:describeHit(hit,layer,hit?.object.userData.sourceTile?.(vertex)?.file??hit?.object.userData.peakSource?.(vertex)?.name??owner),dynamic:dynamicPick(host.scene,ray)}
    if (point && Math.abs(point.x) <= 3072 && Math.abs(point.z) <= 3328) {
      view.target = { x: point.x, y: point.y, z: point.z, ...xz2ll(point.x, point.z), distance: hit.distance }
      view.landmark_id = ids.get(hit.object) ?? null
    }
  }
  if (!validView(view,area)) throw Error('视角不在反馈范围内')
  return view
}

export async function capture(host: Host) {
  const view = await currentView(host)
  const canvas = host.renderer.domElement,
    scale = Math.min(1, 1600 / Math.max(canvas.width, canvas.height)),
    copy = document.createElement('canvas')
  copy.width = Math.max(1, Math.round(canvas.width * scale))
  copy.height = Math.max(1, Math.round(canvas.height * scale))
  copy.getContext('2d')!.drawImage(canvas, 0, 0, copy.width, copy.height)
  const shot = await new Promise<Blob>((resolve, reject) =>
    copy.toBlob((blob) => (blob ? resolve(blob) : reject(Error('截图失败'))), 'image/jpeg', 0.85),
  )
  return { view, shot }
}
