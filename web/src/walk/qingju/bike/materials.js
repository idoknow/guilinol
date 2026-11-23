/**
 * materials.js — physically based material set for the bike + world.
 * Teal bodywork uses a clear-coated paint shader; the rest is tuned to the
 * reference photographs (satin plastics, chrome fork stanchions, quilted
 * vinyl saddle, ribbed rubber deck mat, tyre tread).
 */
import * as THREE from 'three';
import * as T from '../util/textures.js';

export function createMaterials(renderer) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const paintRough = T.makePaintRoughness();
  const plasticRough = T.makePlasticRoughness();
  const tire = T.makeTireTextures();
  const deck = T.makeDeckMatTextures();
  const quilt = T.makeQuiltTextures();

  const std = (o) => new THREE.MeshStandardMaterial(o);
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);

  const M = {
    /* ---------- painted bodywork ---------- */
    teal: phys({
      color: new THREE.Color('#2bcfbd'),
      metalness: 0.0,
      roughness: 0.40,
      clearcoat: 0.32,
      clearcoatRoughness: 0.30,
      roughnessMap: paintRough,
      envMapIntensity: 0.34,
      sheen: 0.0,
    }),
    tealSolid: phys({
      color: new THREE.Color('#25c9b7'),
      metalness: 0.0,
      roughness: 0.40,
      clearcoat: 0.75,
      clearcoatRoughness: 0.22,
      roughnessMap: paintRough,
      envMapIntensity: 0.62,
      side: THREE.DoubleSide,
    }),
    tealDark: phys({
      color: new THREE.Color('#149c90'),
      metalness: 0.0,
      roughness: 0.44,
      clearcoat: 0.25,
      clearcoatRoughness: 0.32,
      envMapIntensity: 0.32,
    }),
    white: phys({
      color: new THREE.Color('#eaeceb'),
      metalness: 0.0,
      roughness: 0.36,
      clearcoat: 0.35,
      clearcoatRoughness: 0.26,
      envMapIntensity: 0.36,
    }),
    /* ---------- black mouldings ---------- */
    plastic: std({
      color: new THREE.Color('#24282a'),
      metalness: 0.05,
      roughness: 0.55,
      roughnessMap: plasticRough,
      envMapIntensity: 0.85,
    }),
    plasticSoft: std({
      color: new THREE.Color('#1d2022'),
      metalness: 0.02,
      roughness: 0.72,
      roughnessMap: plasticRough,
      envMapIntensity: 0.7,
      side: THREE.DoubleSide,
    }),
    blackGloss: phys({
      color: new THREE.Color('#15181a'),
      metalness: 0.2,
      roughness: 0.22,
      clearcoat: 0.9,
      clearcoatRoughness: 0.10,
      envMapIntensity: 0.9,
    }),
    rubber: std({
      color: new THREE.Color('#141617'),
      metalness: 0.0,
      roughness: 0.92,
      normalMap: tire.normalMap,
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughnessMap: null,
      envMapIntensity: 0.45,
    }),
    gripRubber: std({
      color: new THREE.Color('#1b1e20'),
      metalness: 0.0,
      roughness: 0.82,
      envMapIntensity: 0.5,
    }),
    deckMat: std({
      color: new THREE.Color('#ffffff'),
      map: deck.map,
      normalMap: deck.normalMap,
      normalScale: new THREE.Vector2(1.4, 1.4),
      metalness: 0.05,
      roughness: 0.86,
      envMapIntensity: 0.5,
    }),
    /* ---------- metals ---------- */
    chrome: std({
      color: new THREE.Color('#e6eaec'),
      metalness: 1.0,
      roughness: 0.075,
      envMapIntensity: 1.35,
    }),
    steel: std({
      color: new THREE.Color('#a8b0b4'),
      metalness: 1.0,
      roughness: 0.28,
      envMapIntensity: 1.1,
    }),
    alu: std({
      color: new THREE.Color('#c9ced2'),
      metalness: 1.0,
      roughness: 0.22,
      envMapIntensity: 1.2,
    }),
    darkAlu: std({
      color: new THREE.Color('#5b6266'),
      metalness: 1.0,
      roughness: 0.34,
      envMapIntensity: 1.0,
    }),
    blackMetal: std({
      color: new THREE.Color('#2a2e30'),
      metalness: 0.85,
      roughness: 0.40,
      envMapIntensity: 0.9,
    }),
    springSteel: std({
      color: new THREE.Color('#cfd5d8'),
      metalness: 1.0,
      roughness: 0.18,
      envMapIntensity: 1.2,
    }),
    /* ---------- saddle ---------- */
    seatLeather: phys({
      color: new THREE.Color('#24272a'),
      metalness: 0.05,
      roughness: 0.58,
      clearcoat: 0.35,
      clearcoatRoughness: 0.4,
      normalMap: quilt.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      envMapIntensity: 0.7,
    }),
    seatQuilt: phys({
      color: new THREE.Color('#b9bec2'),
      map: quilt.map,
      normalMap: quilt.normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      metalness: 0.35,
      roughness: 0.44,
      sheen: 0.6,
      sheenColor: new THREE.Color('#ffffff'),
      sheenRoughness: 0.55,
      clearcoat: 0.25,
      clearcoatRoughness: 0.4,
      envMapIntensity: 0.95,
    }),
    /* ---------- lighting / lenses ---------- */
    lensHead: phys({
      color: new THREE.Color('#c9d6db'),
      metalness: 0.15,
      roughness: 0.08,
      transmission: 0.0,
      clearcoat: 1.0,
      emissive: new THREE.Color('#fff4d8'),
      emissiveIntensity: 0.04,
      envMapIntensity: 1.5,
    }),
    lensTail: phys({
      color: new THREE.Color('#a31016'),
      metalness: 0.0,
      roughness: 0.16,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      emissive: new THREE.Color('#ff1d18'),
      emissiveIntensity: 0.55,
      envMapIntensity: 1.0,
    }),
    reflectorRed: std({
      color: new THREE.Color('#c1121f'),
      metalness: 0.1,
      roughness: 0.28,
      emissive: new THREE.Color('#8c0d14'),
      emissiveIntensity: 0.35,
    }),
    reflectorAmber: std({
      color: new THREE.Color('#f3a01b'),
      metalness: 0.1,
      roughness: 0.32,
      emissive: new THREE.Color('#c47300'),
      emissiveIntensity: 0.35,
    }),
    screen: phys({
      color: new THREE.Color('#0a0d0f'),
      metalness: 0.3,
      roughness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.5,
    }),
    displayGlass: phys({
      color: new THREE.Color('#e2f4f4'),
      metalness: 0.0, roughness: 0.03,
      transparent: true, opacity: 0.10,
      clearcoat: 1.0, clearcoatRoughness: 0.01,
      envMapIntensity: 1.6, depthWrite: false,
    }),
    mirrorGlass: std({
      color: new THREE.Color('#dfe6e8'),
      metalness: 1.0,
      roughness: 0.03,
      envMapIntensity: 1.6,
    }),
    /* ---------- misc ---------- */
    cable: std({ color: new THREE.Color('#17191a'), metalness: 0.15, roughness: 0.6 }),
    copper: std({ color: new THREE.Color('#c98b52'), metalness: 1, roughness: 0.3 }),
    bolt: std({ color: new THREE.Color('#9aa0a4'), metalness: 1, roughness: 0.35 }),
    // world
    asphalt: null,
    brick: null,
  };

  // tear-off copies for the tyre: separate materials per wheel so we can
  // rotate the tread independently (front tyre is narrower)
  M.tireFront = M.rubber;
  M.tireRear = M.rubber.clone();
  M.tireRear.normalScale = new THREE.Vector2(1.1, 1.1);

  /* decal material factory */
  M.decal = (map, o = {}) => new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    depthWrite: false,
    roughness: o.roughness ?? 0.34,
    metalness: o.metalness ?? 0.06,
    envMapIntensity: o.envMapIntensity ?? 1.0,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.FrontSide,
    alphaTest: 0.02,
    ...o,
  });

  M.dispose = () => {
    Object.values(M).forEach((m) => { if (m && m.dispose && m !== M) m.dispose(); });
    [paintRough, plasticRough, deck.map, deck.normalMap, quilt.map, quilt.normalMap,
      tire.normalMap, tire.heightMap].forEach((t) => t && t.dispose && t.dispose());
  };
  return M;
}
