import * as THREE from 'three'

// Bake three orthogonal views of a proxy. The horizontal card keeps the canopy
// visible in the overview camera. Each view has its own leaf and trunk outline.
export function treeCards(mesh:THREE.BufferGeometry, material:THREE.MeshStandardMaterial) {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size * 4
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const normalCanvas = canvas.cloneNode() as HTMLCanvasElement
  const normalCtx = normalCanvas.getContext('2d')!
  const position = mesh.getAttribute('position'), color = mesh.getAttribute('color')
  const normal = mesh.getAttribute('normal')
  mesh.computeBoundingBox()
  const box = mesh.boundingBox!, center = box.getCenter(new THREE.Vector3())
  const lo = box.min.toArray(), hi = box.max.toArray()
  let canopyY = 0
  for (let i=0; i<position.count; i++) canopyY += position.getY(i)/position.count
  const coords:number[] = [], uv:number[] = [], normals:number[] = []
  const rgb = new THREE.Color()
  for (const [view, [u,v,depth]] of [[0,1,2],[2,1,0],[0,2,1]].entries()) {
    const start = view * size
    const faces = []
    for (let i=0; i<position.count; i+=3) {
      const points = [i,i+1,i+2].map(j => [position.getX(j),position.getY(j),position.getZ(j)])
      faces.push({i,points,depth:points.reduce((sum,p)=>sum+p[depth],0)})
    }
    faces.sort((a,b) => a.depth-b.depth)
    for (const {i,points} of faces) {
      ctx.fillStyle = rgb.fromBufferAttribute(color,i).getStyle()
      const path = new Path2D()
      for (const [j,p] of points.entries()) {
        const x = start+2+(size-4)*(p[u]-lo[u])/(hi[u]-lo[u])
        const y = size-2-(size-4)*(p[v]-lo[v])/(hi[v]-lo[v])
        if (j===0) path.moveTo(x,y)
        else path.lineTo(x,y)
      }
      path.closePath()
      ctx.fill(path)
      const n = [normal.getX(i),normal.getY(i),normal.getZ(i)]
      if (n[depth] < 0) for (let k=0; k<3; k++) n[k] = -n[k]
      normalCtx.fillStyle = 'rgb('+n.map(value=>Math.round((value+1)*127.5)).join(',')+')'
      normalCtx.fill(path)
    }
    for (const [x,y] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]) {
      const p=center.toArray()
      if (depth === 1) p[1] = canopyY
      p[u]=x?hi[u]:lo[u]
      p[v]=y?hi[v]:lo[v]
      coords.push(...p)
      uv.push((start+2+x*(size-4))/canvas.width,(2+y*(size-4))/size)
      normals.push(0,1,0)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(coords,3))
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3))
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2))
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace=THREE.SRGBColorSpace
  const leaves = material.clone()
  // Light the projected facets with their original model-space normals. Include
  // the instance rotation so the sun still tracks each planted tree's azimuth.
  const normalMap = new THREE.CanvasTexture(normalCanvas)
  leaves.onBeforeCompile = (shader,renderer) => {
    material.onBeforeCompile(shader,renderer)
    shader.uniforms.treeNormals = {value:normalMap}
    shader.vertexShader = 'varying mat3 treeNormalToView;\n'+shader.vertexShader.replace(
      '#include <defaultnormal_vertex>',
      `#include <defaultnormal_vertex>
       mat3 m = mat3(instanceMatrix);
       treeNormalToView = normalMatrix * mat3(m[0]/dot(m[0],m[0]),m[1]/dot(m[1],m[1]),m[2]/dot(m[2],m[2]));`)
    shader.fragmentShader = 'varying mat3 treeNormalToView;\nuniform sampler2D treeNormals;\n'+
      shader.fragmentShader.replace('#include <normal_fragment_maps>',
        'normal = normalize(treeNormalToView * (texture2D(treeNormals,vMapUv).xyz*2.0-1.0));')
  }
  leaves.vertexColors=false
  leaves.flatShading=false
  leaves.map=map
  leaves.alphaTest=0.35
  return {geometry,material:leaves}
}
