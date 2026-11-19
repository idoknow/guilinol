import { parse } from 'exifr'
import { views } from '../../../lib/feedback-contract'

async function prepare(file: File, report: (stage: string) => void) {
  report('正在读取拍摄信息')
  const tags = await parse(await file.arrayBuffer(), { gps: true }).catch(() => null)
  report('正在解码')
  let blob: Blob = file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch (error) {
    if (!/hei[cf]/i.test(file.type + file.name)) throw new Error('无法读取这张照片')
    const converted = await (await import('heic2any')).default({ blob, toType: 'image/jpeg' })
    blob = Array.isArray(converted) ? converted[0] : converted
    bitmap = await createImageBitmap(blob)
  }
  const canvas = document.createElement('canvas'),
    scale = Math.min(1, 3072 / Math.max(bitmap.width, bitmap.height))
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  report('正在压缩')
  const jpeg = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(Error('压缩失败'))), 'image/jpeg', 0.84),
  )
  return {
    jpeg,
    meta: {
      exif_lat: tags?.latitude,
      exif_lon: tags?.longitude,
      exif_dir: tags?.GPSImgDirection,
      exif_time: tags?.DateTimeOriginal,
    },
  }
}
export function photoPicker(
  container: HTMLElement,
  used: number[],
  warn: (message: string) => void,
  currentId: () => string | undefined,
  run: (work: () => Promise<void>) => Promise<void>,
  onChange?: (count: number) => void,
) {
  const picker = document.createElement('input'),
    grid = document.createElement('div'),
    zone = document.createElement('label')
  picker.type = 'file'
  picker.multiple = true
  picker.accept = 'image/jpeg,image/png,image/webp,image/heic,.heic,.heif'
  picker.setAttribute('aria-label', '添加照片')
  grid.className = 'fb-grid'
  zone.className = 'fb-drop'
  zone.innerHTML = `<b>拖入、粘贴或点此选择照片</b><span>最多 20 张 · 电脑可直接 Ctrl/⌘ + V 粘贴截图</span>`
  zone.prepend(picker)
  container.append(zone, grid)
  const sync = () => {
    const total = used.length + entries.size
    zone.classList.toggle('fb-drop--compact', total > 0)
    container.dataset.count = String(total)
    onChange?.(total)
  }
  const entries = new Map<number, { done: boolean; upload: (id: string) => Promise<void> }>(),
    urls: string[] = []
  function wireRemove(button: HTMLButtonElement, slot: number, cell: HTMLElement) {
    button.type = 'button'
    button.className = 'fb-remove'
    button.textContent = '×'
    button.setAttribute('aria-label', '移除这张照片')
    button.onclick = () =>
      void run(async () => {
        const id = currentId()
        if (id) {
          const result = await fetch(`/api/feedback/${id}/photos/${slot}`, { method: 'DELETE' })
          if (!result.ok && result.status !== 404) throw Error((await result.json()).error.message)
        }
        const index = used.indexOf(slot)
        if (index >= 0) used.splice(index, 1)
        entries.delete(slot)
        cell.remove()
        sync()
      })
  }
  for (const slot of used) {
    const cell = document.createElement('div'),
      image = document.createElement('img'),
      remove = document.createElement('button')
    cell.className = 'fb-photo fb-photo--done'
    image.src = `/api/feedback/${currentId()}/photos/${slot}`
    image.alt = `照片 ${slot}`
    wireRemove(remove, slot, cell)
    cell.append(image, remove)
    grid.append(cell)
  }
  function add(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      let slot = 1
      while (used.includes(slot) || entries.has(slot)) slot++
      if (slot > 20) {
        warn('最多 20 张照片')
        break
      }
      if (file.size > 12 * 1024 * 1024) {
        warn('单张照片不能超过 12 MB')
        continue
      }
      const cell = document.createElement('div'),
        image = document.createElement('img'),
        view = document.createElement('select'),
        progress = document.createElement('progress'),
        remove = document.createElement('button'),
        note = document.createElement('small')
      cell.className = 'fb-photo fb-photo--new'
      progress.className = 'fb-progress'
      note.className = 'fb-photo-note'
      view.setAttribute('aria-label', '拍摄视角')
      view.add(new Option('视角', ''))
      views.forEach((label) => view.add(new Option(label)))
      progress.max = 100
      progress.value = 0
      image.alt = file.name
      image.src = URL.createObjectURL(file)
      urls.push(image.src)
      wireRemove(remove, slot, cell)
      cell.append(image, view, progress, note, remove)
      grid.append(cell)
      const entry = {
        done: false,
        async upload(id: string) {
          if (entry.done) return
          note.textContent = '正在处理'
          try {
            const { jpeg, meta } = await prepare(file, (stage) => {
              note.textContent = stage
            })
            note.textContent = '正在上传'
            await new Promise<void>((resolve, reject) => {
              const xhr = new XMLHttpRequest()
              xhr.open('PUT', `/api/feedback/${id}/photos/${slot}`)
              xhr.setRequestHeader('Content-Type', 'image/jpeg')
              xhr.setRequestHeader(
                'X-Photo-Meta',
                encodeURIComponent(JSON.stringify({ ...meta, view_label: view.value })),
              )
              xhr.upload.onprogress = (event) => {
                progress.value = event.total ? (100 * event.loaded) / event.total : 0
              }
              xhr.responseType = 'json'
              xhr.onload = () =>
                xhr.status === 200 ? resolve() : reject(Error(xhr.response?.error?.message || '上传失败'))
              xhr.onerror = () => reject(Error('网络异常'))
              xhr.send(jpeg)
            })
            entry.done = true
            progress.value = 100
            note.textContent = '已上传'
            cell.classList.add('fb-photo--done')
            view.disabled = true
          } catch (error) {
            note.textContent = '失败，重新提交可重试'
            cell.classList.add('fb-photo--error')
            throw error
          }
        },
      }
      entries.set(slot, entry)
    }
    sync()
  }
  picker.onchange = () => {
    add(picker.files)
    picker.value = ''
  }
  container.ondragover = (event) => {
    event.preventDefault()
    zone.classList.add('fb-drop--over')
  }
  container.ondragleave = () => zone.classList.remove('fb-drop--over')
  container.ondrop = (event) => {
    event.preventDefault()
    zone.classList.remove('fb-drop--over')
    if (!picker.disabled) add(event.dataTransfer?.files ?? null)
  }
  sync()
  return {
    add: (files: File[]) => add(files as unknown as FileList),
    pending: () => [...entries.values()].filter((entry) => !entry.done).length,
    count: () => used.length + entries.size,
    async upload(id: string) {
      for (const entry of entries.values()) await entry.upload(id)
    },
    dispose: () => urls.forEach((url) => URL.revokeObjectURL(url)),
  }
}
