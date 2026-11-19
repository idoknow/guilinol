const latitudeOrigin = 25.280
const longitudeOrigin = 110.300
const metresLatitude = 110574
const metresLongitude = 111320 * Math.cos(latitudeOrigin * Math.PI / 180)

export function ll2xz(lat: number, lon: number) {
  return {x: (lon - longitudeOrigin) * metresLongitude, z: (latitudeOrigin - lat) * metresLatitude}
}

export function xz2ll(x: number, z: number) {
  return {lat: latitudeOrigin - z / metresLatitude, lon: longitudeOrigin + x / metresLongitude}
}
