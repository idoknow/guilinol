type Tile = HTMLImageElement | null
const listeners = new Set<(tile: Tile) => void>()
let tile: Tile = null, uid: number | null = null, timer = 0
let request: AbortController | undefined

function publish(next: Tile) {
  const old = tile
  tile = next
  for (const listen of listeners) listen(next)
  if (old) URL.revokeObjectURL(old.src)
}

export function onTile(listen: (tile: Tile) => void) {
  listeners.add(listen)
  listen(tile)
}

export function markSession(next: number | null) {
  if (uid === next) return
  uid = next
  clearTimeout(timer); request?.abort(); publish(null)
  if (!uid) return
  const controller = request = new AbortController()
  async function refresh() {
    let delay = 15000, url = ''
    try {
      const response = await fetch(`/api/trace/tile?seed=${Math.floor(Date.now()/300000)}`, {signal: controller.signal, cache:'no-store'})
      if (controller.signal.aborted) return
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { markSession(null); return }
        throw Error('tile unavailable')
      }
      const image = new Image()
      image.src = url = URL.createObjectURL(await response.blob())
      await image.decode()
      if (controller.signal.aborted) return
      publish(image); url = ''
      delay = Math.max(1, Math.min(300, Number(response.headers.get('x-next')) || 300))*1000
    } catch { if (!controller.signal.aborted) publish(null) }
    finally {
      if (url) URL.revokeObjectURL(url)
      if (!controller.signal.aborted) timer = window.setTimeout(refresh, delay)
    }
  }
  void refresh()
}

export function markSurface(parent: HTMLElement) {
  const layer = document.createElement('div')
  layer.setAttribute('aria-hidden','true')
  layer.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647;opacity:.12;image-rendering:pixelated'
  onTile(image => {
    if (!image) { layer.remove(); return }
    layer.style.backgroundImage=`url("${image.src}")`
    parent.append(layer)
  })
}
