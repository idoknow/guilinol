import * as T from 'three'

/** Three bands of diffuse colour, using the same world-space key in the studio and on the street. */
export function streetShading(material: T.MeshStandardMaterial, garment = false) {
  const clothing = {
    sleeve: {value: 1.0},
    shortHem: {value: 0},
    sandal: {value: 0},
    schoolTop: {value: 0},
    schoolBlue: {value: new T.Color('#536e90')},
    skinTone: {value: new T.Color()},
    // IDOK-229 starter patterns: 0 none, 1 open front, 2 plaid open overshirt, 3 track stripes, 4 shell yoke, 5 hoodie
    pattern: {value: 0},
    legStripe: {value: 0},
    patA: {value: new T.Color()},
    patB: {value: new T.Color()},
  }
  if (garment) material.userData.clothing = clothing
  material.customProgramCacheKey = () => (garment ? 'creator-cloth' : 'creator-solid')
  // Facet normals keep coincident garment/skin layers identical (smooth normals z-fight). Hard bands on
  // facets read as a patchwork, so the key light is a soft ramp instead.
  material.flatShading = true
  material.onBeforeCompile = (shader, renderer) => {
    T.Material.prototype.onBeforeCompile.call(material, shader, renderer)
    if (garment) {
      Object.assign(shader.uniforms, clothing)
      // A zone is a per-face ID. Interpolating it can turn e.g. 1 into 0.99999994
      // between vertices and make fragments switch between cloth and skin.
      shader.vertexShader =
        'attribute float clothZone; flat out float zone; varying vec3 rest;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nzone = clothZone; rest = position;',
        )
      shader.fragmentShader =
        'flat in float zone; varying vec3 rest; uniform float sleeve, shortHem, sandal, schoolTop, pattern, legStripe; uniform vec3 skinTone, schoolBlue, patA, patB;\n' +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
        #define PAT_ARM_TOP 1.475
        #define PAT_LEG_OUT 0.15
        #define PAT_LEG_Z -0.014
        float x = abs(rest.x);
        if (schoolTop > 0.5 && zone == 1.0 && (x > 0.19 || rest.y > 1.37)) diffuseColor.rgb = schoolBlue;
        if (pattern > 0.5) {
          int pat = int(pattern + 0.5);
          bool front = rest.z > 0.0 && x < 0.2;
          if (zone == 1.0) {
            if (pat == 2) {
              vec2 q = vec2(rest.x + rest.z, rest.y) * 13.0;
              float lx = step(abs(fract(q.x) - 0.5), 0.1), ly = step(abs(fract(q.y) - 0.5), 0.1);
              diffuseColor.rgb = mix(diffuseColor.rgb, patB, 0.5 * max(lx, ly)) * (1.0 - 0.16 * lx * ly);
            }
            if ((pat == 1 || pat == 2) && front && rest.y < 1.4) {
              if (x < 0.05) diffuseColor.rgb = patA;
              else if (x < 0.062) diffuseColor.rgb *= 0.78;
            }
            if (pat == 3 && ((x > 0.2 && rest.y > PAT_ARM_TOP) || (front && x < 0.006))) diffuseColor.rgb = patA;
            if (pat == 4 && ((rest.y > 1.31 && x < 0.34) || (front && x < 0.007))) diffuseColor.rgb = patA;
            if (pat == 5 && front && x < 0.105 && rest.y > 1.0 && rest.y < 1.13) diffuseColor.rgb *= rest.y > 1.118 ? 0.7 : 0.88;
          }
        }
        if (legStripe > 0.5 && zone == 2.0 && x > PAT_LEG_OUT && abs(rest.z - PAT_LEG_Z) < 0.022) diffuseColor.rgb = vec3(0.93, 0.93, 0.9);
        bool neck = sleeve < 0.2 && rest.z > -0.015 && rest.y > 1.365 + 0.102 * pow(min(1.0,x / 0.074),2.0);
        if ((zone == 1.0 && (x > sleeve || neck)) || (zone == 2.0 && rest.y < shortHem)) diffuseColor.rgb = skinTone;
        if (zone == 3.0 && sandal > 0.5 && rest.y > 0.026) {
          float strap = abs(rest.z - 0.10 + abs(x - 0.092)*0.7);
          diffuseColor.rgb = strap < 0.013 ? vec3(.13,.12,.10) : skinTone;
        }`,
        )
    }
    shader.fragmentShader = 'uniform float uNight;\n' + shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      vec3 keyDir = normalize(mat3(viewMatrix) * vec3(-0.45, 0.86, -0.36));
      float facing = dot(normal, keyDir);
      float band = 0.80 + 0.22 * smoothstep(-0.55, 0.85, facing);
      outgoingLight = diffuseColor.rgb * band * mix(1.0, 0.38, uNight);
      #include <opaque_fragment>`,
    )
  }
}

/** Compute position-welded smooth normals so inverted-hull outlines never crack open along color seams (ankles/waist). */
function ensureWeldedOutlineNormals(geometry: T.BufferGeometry) {
  if (geometry.hasAttribute('aOutlineNormal')) return
  const pos = geometry.getAttribute('position')
  if (!pos) return
  const count = pos.count
  const accum = new Map<string, [number, number, number]>()
  const keys = new Array<string>(count)
  for (let i = 0; i < count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`
    keys[i] = k
    if (!accum.has(k)) accum.set(k, [0, 0, 0])
  }
  const index = geometry.getIndex()
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3()
  const ab = new T.Vector3(), ac = new T.Vector3(), fn = new T.Vector3()
  const triCount = index ? index.count : count
  for (let t = 0; t + 2 < triCount; t += 3) {
    const ia = index ? index.getX(t) : t
    const ib = index ? index.getX(t + 1) : t + 1
    const ic = index ? index.getX(t + 2) : t + 2
    a.fromBufferAttribute(pos, ia)
    b.fromBufferAttribute(pos, ib)
    c.fromBufferAttribute(pos, ic)
    ab.subVectors(b, a)
    ac.subVectors(c, a)
    fn.crossVectors(ab, ac)
    if (fn.lengthSq() < 1e-14) continue
    for (const vi of [ia, ib, ic]) {
      const bucket = accum.get(keys[vi])!
      bucket[0] += fn.x
      bucket[1] += fn.y
      bucket[2] += fn.z
    }
  }
  const out = new Float32Array(count * 3)
  const fallback = geometry.getAttribute('normal')
  for (let i = 0; i < count; i++) {
    const bucket = accum.get(keys[i])!
    const len = Math.hypot(bucket[0], bucket[1], bucket[2])
    if (len > 1e-8) {
      out[i * 3] = bucket[0] / len
      out[i * 3 + 1] = bucket[1] / len
      out[i * 3 + 2] = bucket[2] / len
    } else if (fallback) {
      out[i * 3] = fallback.getX(i)
      out[i * 3 + 1] = fallback.getY(i)
      out[i * 3 + 2] = fallback.getZ(i)
    } else {
      out[i * 3 + 1] = 1
    }
  }
  geometry.setAttribute('aOutlineNormal', new T.BufferAttribute(out, 3))
}

/** A back-facing shell shares the body's skin weights and follows the active clothing index. */
export function addOutline(mesh: T.Mesh, width: number) {
  ensureWeldedOutlineNormals(mesh.geometry)
  const ink = new T.MeshBasicMaterial({color: '#1f2326', side: T.BackSide})
  ink.onBeforeCompile = (shader, renderer) => {
    T.Material.prototype.onBeforeCompile.call(ink, shader, renderer)
    shader.vertexShader =
      'attribute vec3 aOutlineNormal;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
          (mesh instanceof T.SkinnedMesh
            ? `float _olHand = 1.0 - 0.78 * smoothstep(0.68, 0.76, abs(position.x));
               float _olHead = 1.0 - 0.68 * smoothstep(1.44, 1.56, position.y);
               float _olAnkle = 0.36 + 0.64 * smoothstep(0.08, 0.16, position.y);
               float _olElbow = 1.0 - 0.38 * smoothstep(0.40, 0.46, abs(position.x)) * (1.0 - smoothstep(0.48, 0.54, abs(position.x)));
               transformed += normalize(aOutlineNormal) * ${width.toFixed(4)} * _olHand * _olHead * _olAnkle * _olElbow;`
            : `transformed += normalize(aOutlineNormal) * ${width.toFixed(4)};`),
      )
  }
  ink.customProgramCacheKey = () => 'creator-outline-v2-' + width
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
