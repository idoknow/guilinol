import * as T from 'three'

/** Three bands of diffuse colour, using the same world-space key in the studio and on the street. */
export function streetShading(material: T.MeshStandardMaterial, garment = false) {
  const clothing = {
    sleeve: {value: 1.0},
    shortHem: {value: 0},
    sandal: {value: 0},
    skinTone: {value: new T.Color()},
  }
  if (garment) material.userData.clothing = clothing
  material.customProgramCacheKey = () => (garment ? 'creator-cloth' : 'creator-solid')
  material.flatShading = true
  material.onBeforeCompile = (shader, renderer) => {
    T.Material.prototype.onBeforeCompile.call(material, shader, renderer)
    if (garment) {
      Object.assign(shader.uniforms, clothing)
      shader.vertexShader =
        'attribute float clothZone; varying float zone; varying vec3 rest;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nzone = clothZone; rest = position;',
        )
      shader.fragmentShader =
        'varying float zone; varying vec3 rest; uniform float sleeve, shortHem, sandal; uniform vec3 skinTone;\n' +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
        float x = abs(rest.x);
        bool neck = sleeve < 0.2 && rest.z > -0.015 && rest.y > 1.365 + 0.102 * pow(min(1.0,x / 0.074),2.0);
        if ((zone == 1.0 && (x > sleeve || neck)) || (zone == 2.0 && rest.y < shortHem)) diffuseColor.rgb = skinTone;
        if (zone == 3.0 && sandal > 0.5 && rest.y > 0.026) {
          float strap = abs(rest.z - 0.10 + abs(x - 0.092)*0.7);
          diffuseColor.rgb = strap < 0.013 ? vec3(.13,.12,.10) : skinTone;
        }`,
        )
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      vec3 keyDir = normalize(mat3(viewMatrix) * vec3(-0.45, 0.86, -0.36));
      float facing = dot(normal, keyDir);
      outgoingLight = diffuseColor.rgb * (0.76 + 0.16 * step(-0.35, facing) + 0.15 * step(0.45, facing));
      #include <opaque_fragment>`,
    )
  }
}

/** A back-facing shell shares the body's skin weights and follows the active clothing index. */
export function addOutline(mesh: T.Mesh, width: number) {
  const ink = new T.MeshBasicMaterial({color: '#1f2326', side: T.BackSide})
  ink.onBeforeCompile = (shader, renderer) => {
    T.Material.prototype.onBeforeCompile.call(ink, shader, renderer)
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed += normalize(normal) * ' +
        width.toFixed(4) +
        (mesh instanceof T.SkinnedMesh
          ? ' * (1.0 - 0.70 * smoothstep(0.72,0.78,abs(position.x))) * (1.0 - 0.78 * smoothstep(1.61,1.68,position.y));'
          : ';'),
    )
  }
  ink.customProgramCacheKey = () => 'creator-outline-' + width
  let shell: T.Mesh
  if (mesh instanceof T.SkinnedMesh) {
    const skinned = new T.SkinnedMesh(mesh.geometry, ink)
    skinned.bind(mesh.skeleton, mesh.bindMatrix)
    shell = skinned
  } else shell = new T.Mesh(mesh.geometry, ink)
  shell.name = mesh instanceof T.SkinnedMesh ? 'creator-body-outline' : 'creator-outline'
  shell.frustumCulled = false
  mesh.add(shell)
}
