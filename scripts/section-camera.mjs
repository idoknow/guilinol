const offsets = {
  'IMG_1299.jpg': [3.2, 0.4],
  'IMG_1365.jpg': [-6.05, 12.06],
  'IMG_1380.jpg': [-1.47, 9.14],
}

export function sectionCamera(key, location) {
  if (!Object.hasOwn(offsets, key)) return location
  const [east, south] = offsets[key]
  const metres = Math.hypot(east, south)
  if (!(metres <= location.hAccuracy)) throw Error(`${key}: offset exceeds GPS accuracy`)
  return {...location, x: location.x + east, z: location.z + south, offsetLabel: `${metres.toFixed(2)} m (E ${east}, S ${south})`}
}
