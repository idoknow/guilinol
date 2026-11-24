import * as THREE from 'three'
import type { AvatarRig } from '../../walk/avatar-rig.ts'

export interface StaffUniformPalette {
  readonly shirtBlackHex: string
  readonly apronBlackHex: string
  readonly capBlackHex: string
  readonly mixueRedHex: string
  readonly badgeWhiteHex: string
  readonly badgeGoldHex: string
}

export const DEFAULT_STAFF_UNIFORM_PALETTE: StaffUniformPalette = {
  shirtBlackHex: '#15171b',
  apronBlackHex: '#191b20',
  capBlackHex: '#141518',
  mixueRedHex: '#e60012',
  badgeWhiteHex: '#fffcf7',
  badgeGoldHex: '#f6c33e',
}

export interface StaffUniformController {
  equip(figure: THREE.Object3D, rigOverride?: AvatarRig | null): boolean
  unequip(): void
  isEquipped(): boolean
  getRootObjects(): readonly THREE.Object3D[]
  getTriangles(): number
  dispose(): void
}

function createApronChestBadgeTexture(palette: StaffUniformPalette): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 192
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = palette.apronBlackHex
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Red woven top hem trim
  ctx.fillStyle = palette.mixueRedHex
  ctx.fillRect(0, 0, canvas.width, 16)

  // Center Snow-King emblem circle + crown silhouette
  const cx = canvas.width * 0.5
  ctx.fillStyle = palette.badgeWhiteHex
  ctx.beginPath()
  ctx.arc(cx, 66, 30, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = palette.mixueRedHex
  ctx.beginPath()
  ctx.arc(cx, 66, 26, 0, Math.PI * 2)
  ctx.fill()

  // Crown inside badge
  ctx.fillStyle = palette.badgeWhiteHex
  ctx.beginPath()
  ctx.moveTo(cx - 14, 72)
  ctx.lineTo(cx - 15, 56)
  ctx.lineTo(cx - 5, 62)
  ctx.lineTo(cx, 50)
  ctx.lineTo(cx + 5, 62)
  ctx.lineTo(cx + 15, 56)
  ctx.lineTo(cx + 14, 72)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = palette.badgeGoldHex
  ctx.fillRect(cx - 12, 74, 24, 4)

  // Crisp brand + role lettering below badge
  ctx.fillStyle = palette.badgeWhiteHex
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  ctx.fillText('蜜雪冰城', cx, 124)

  ctx.fillStyle = palette.mixueRedHex
  ctx.beginPath()
  ctx.roundRect(cx - 48, 146, 96, 28, 10)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  ctx.fillText('值班店员', cx, 161)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

function createCapCrestTexture(palette: StaffUniformPalette): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.clearRect(0, 0, 128, 128)
  ctx.fillStyle = palette.mixueRedHex
  ctx.beginPath()
  ctx.arc(64, 64, 48, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 5
  ctx.strokeStyle = palette.badgeWhiteHex
  ctx.stroke()

  ctx.fillStyle = palette.badgeWhiteHex
  ctx.beginPath()
  ctx.moveTo(40, 76)
  ctx.lineTo(38, 46)
  ctx.lineTo(54, 58)
  ctx.lineTo(64, 36)
  ctx.lineTo(74, 58)
  ctx.lineTo(90, 46)
  ctx.lineTo(88, 76)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = palette.badgeGoldHex
  ctx.fillRect(42, 79, 44, 7)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

/**
 * 独立于 `walk/outfits.ts` 自建的玩家员工服穿戴器：
 * 依据 `docs/drinks-refs/recruit/recruit_uniform_11.jpg` & `12.jpg` 实拍，
 * 为玩家角色叠加纯黑鸭舌帽（正中皇冠徽章）与黑色系工装护裙 + 红标围裙，严禁修改 `walk/outfits.ts`。
 */
export function createStaffUniformController(palettePatch?: Partial<StaffUniformPalette>): StaffUniformController {
  const palette: StaffUniformPalette = { ...DEFAULT_STAFF_UNIFORM_PALETTE, ...(palettePatch ?? {}) }
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []

  const ownGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g)
    return g
  }
  const ownMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m)
    return m
  }
  const ownTex = <T extends THREE.Texture | null>(t: T): T => {
    if (t) textures.push(t)
    return t
  }

  const shirtBlackMat = ownMat(new THREE.MeshStandardMaterial({ color: palette.shirtBlackHex, roughness: 0.85, flatShading: true }))
  const apronBlackMat = ownMat(new THREE.MeshStandardMaterial({ color: palette.apronBlackHex, roughness: 0.78, flatShading: true }))
  const capBlackMat = ownMat(new THREE.MeshStandardMaterial({ color: palette.capBlackHex, roughness: 0.74, flatShading: true }))
  const redAccentMat = ownMat(new THREE.MeshStandardMaterial({ color: palette.mixueRedHex, roughness: 0.56, flatShading: true }))

  const apronTex = ownTex(createApronChestBadgeTexture(palette))
  const apronChestMat = ownMat(
    new THREE.MeshStandardMaterial({
      ...(apronTex ? { map: apronTex } : { color: palette.apronBlackHex }),
      roughness: 0.65,
      emissive: new THREE.Color('#ffffff'),
      emissiveMap: apronTex ?? null,
      emissiveIntensity: 0.14,
    }),
  )
  const capCrestTex = ownTex(createCapCrestTexture(palette))
  const capCrestMat = ownMat(
    new THREE.MeshStandardMaterial({
      ...(capCrestTex ? { map: capCrestTex, transparent: true } : { color: palette.mixueRedHex }),
      roughness: 0.5,
      emissive: new THREE.Color('#ffffff'),
      emissiveMap: capCrestTex ?? null,
      emissiveIntensity: 0.18,
    }),
  )

  // Head assembly: matches `walk/outfits.ts` head-bone origin ~(0, 1.5685, -0.0114), -Z forward
  const headUniform = new THREE.Group()
  headUniform.name = 'drinks-staff-uniform-head'
  const capCrownGeo = ownGeo(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.54))
  capCrownGeo.scale(0.121, 0.114, 0.14)
  capCrownGeo.translate(0, 0.112, 0.014)
  const capCrown = new THREE.Mesh(capCrownGeo, capBlackMat)

  const capBandGeo = ownGeo(new THREE.CylinderGeometry(0.122, 0.123, 0.024, 16))
  capBandGeo.scale(1, 1, 1.15)
  capBandGeo.translate(0, 0.11, 0.014)
  const capBand = new THREE.Mesh(capBandGeo, capBlackMat)

  const capVisorGeo = ownGeo(new THREE.BoxGeometry(0.16, 0.012, 0.098))
  capVisorGeo.rotateX(-0.08)
  capVisorGeo.translate(0, 0.104, -0.146)
  const capVisor = new THREE.Mesh(capVisorGeo, capBlackMat)

  const capCrest = new THREE.Mesh(ownGeo(new THREE.PlaneGeometry(0.058, 0.058)), capCrestMat)
  capCrest.position.set(0, 0.145, -0.126)
  capCrest.rotation.y = Math.PI // face forward (-Z normal)
  headUniform.add(capCrown, capBand, capVisor, capCrest)

  // Torso assembly: full black short-sleeve crew-neck tee + black bib apron + front pocket + tidy back straps
  const torsoUniform = new THREE.Group()
  torsoUniform.name = 'drinks-staff-uniform-torso'

  // Full black tee torso & short-sleeve shell enclosing walker torso + upper arms without clipping
  const workTeeShell = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.386, 0.566, 0.226)), shirtBlackMat)
  workTeeShell.position.set(0, 0.0, 0.0)
  const collarTrim = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.088, 0.095, 0.032, 14)), shirtBlackMat)
  collarTrim.position.set(0, 0.285, 0.0)
  const sleeveL = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.122, 0.228, 0.126)), shirtBlackMat)
  sleeveL.position.set(-0.242, 0.145, 0.0)
  const sleeveR = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.122, 0.228, 0.126)), shirtBlackMat)
  sleeveR.position.set(0.242, 0.145, 0.0)
  torsoUniform.add(workTeeShell, collarTrim, sleeveL, sleeveR)

  // Apron chest bib (-Z is character front; sits cleanly outside black tee front z = -0.113)
  const apronBib = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.256, 0.285, 0.022)), apronBlackMat)
  apronBib.position.set(0, 0.025, -0.126)
  const apronChestPrint = new THREE.Mesh(ownGeo(new THREE.PlaneGeometry(0.22, 0.17)), apronChestMat)
  apronChestPrint.position.set(0, 0.045, -0.139)
  apronChestPrint.rotation.y = Math.PI

  // Apron waist skirt + front pocket + shoulder straps + back waist tie & badge
  const apronWaist = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.34, 0.275, 0.024)), apronBlackMat)
  apronWaist.position.set(0, -0.22, -0.128)
  const apronPocket = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.24, 0.112, 0.018)), apronBlackMat)
  apronPocket.position.set(0, -0.215, -0.143)
  const pocketTrim = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.24, 0.018, 0.02)), redAccentMat)
  pocketTrim.position.set(0, -0.158, -0.144)

  const strapL = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.028, 0.15, 0.022)), redAccentMat)
  strapL.position.set(-0.088, 0.215, -0.112)
  strapL.rotation.x = 0.22
  const strapR = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.028, 0.15, 0.022)), redAccentMat)
  strapR.position.set(0.088, 0.215, -0.112)
  strapR.rotation.x = 0.22

  const waistBand = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.398, 0.032, 0.238)), apronBlackMat)
  waistBand.position.set(0, -0.105, 0.0)

  const backStrapL = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.024, 0.34, 0.014)), apronBlackMat)
  backStrapL.position.set(-0.04, 0.08, 0.119)
  backStrapL.rotation.z = -0.26
  const backStrapR = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.024, 0.34, 0.014)), apronBlackMat)
  backStrapR.position.set(0.04, 0.08, 0.119)
  backStrapR.rotation.z = 0.26

  torsoUniform.add(
    apronBib,
    apronChestPrint,
    apronWaist,
    apronPocket,
    pocketTrim,
    strapL,
    strapR,
    waistBand,
    backStrapL,
    backStrapR,
  )

  let equipped = false
  let disposed = false

  function equip(figure: THREE.Object3D, rigOverride?: AvatarRig | null): boolean {
    if (disposed) return false
    const rig = rigOverride ?? (figure.userData.avatarRig as AvatarRig | undefined)
    const headTarget = rig?.attachments?.head ?? figure.getObjectByName('Head') ?? figure
    const torsoTarget = rig?.attachments?.torso ?? figure.getObjectByName('Torso') ?? figure

    const usingFallbackRootHead = headTarget === figure
    const usingFallbackRootTorso = torsoTarget === figure
    headUniform.position.set(0, usingFallbackRootHead ? 1.568 : 0.0, 0)
    torsoUniform.position.set(0, usingFallbackRootTorso ? 1.15 : 0.0, 0)

    if (headUniform.parent !== headTarget) {
      headUniform.removeFromParent()
      headTarget.add(headUniform)
    }
    if (torsoUniform.parent !== torsoTarget) {
      torsoUniform.removeFromParent()
      torsoTarget.add(torsoUniform)
    }
    headUniform.visible = true
    torsoUniform.visible = true
    equipped = true
    return true
  }

  function unequip(): void {
    headUniform.removeFromParent()
    torsoUniform.removeFromParent()
    equipped = false
  }

  function getTriangles(): number {
    let tris = 0
    for (const root of [headUniform, torsoUniform]) {
      root.traverse(obj => {
        const m = obj as THREE.Mesh
        if (m.isMesh && m.geometry) {
          const idx = m.geometry.index
          tris += idx ? idx.count / 3 : m.geometry.attributes.position.count / 3
        }
      })
    }
    return Math.round(tris)
  }

  return {
    equip,
    unequip,
    isEquipped: () => equipped,
    getRootObjects: () => [headUniform, torsoUniform],
    getTriangles,
    dispose() {
      if (disposed) return
      disposed = true
      unequip()
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
      for (const t of textures) t.dispose()
    },
  }
}
