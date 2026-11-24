const key = 'glol.use'
export function queueCigarette(storage: Storage) { storage.setItem(key, 'cigarette') }
export function takeCigaretteIntent(storage: Storage) {
  if (storage.getItem(key) !== 'cigarette') return false
  storage.removeItem(key)
  return true
}
export const smokeEnabled = () => new URLSearchParams(location.search).get('smoke') !== '0'
