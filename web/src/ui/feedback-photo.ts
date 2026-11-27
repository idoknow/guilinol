import { parse } from 'exifr'
import { inline } from './loading'
import { views } from '../../../lib/feedback-contract'
import type { CameraShot } from './feedback-camera'

export interface PhotoPickerOptions {
  compact?: boolean
}

async function prepare(file: File, report: (stage: string) => void, known?: CameraShot['meta']) {
  report('正在读取拍摄信息')
  const tags = known ? null : await parse(await file.arrayBuffer(), { gps: true }).catch(() => null)
  report('正在解码')
  let blob: Blob = file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
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
    meta: known ?? {
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
  shoot?: () => Promise<CameraShot | null>,
  options?: PhotoPickerOptions,
) {
  const compact = !!options?.compact
  const picker = document.createElement('input'),
    grid = document.createElement('div'),
    zone = document.createElement('label')
  picker.type = 'file'
  picker.multiple = true
  picker.accept = 'image/jpeg,image/png,image/webp,image/heic,.heic,.heif'
  picker.setAttribute('aria-label', '添加照片')
  grid.className = compact ? 'fb-grid fb-grid--compact' : 'fb-grid'
  if (compact) {
    picker.hidden = true
    container.append(picker, grid)
  } else {
    zone.className = 'fb-drop'
    zone.innerHTML = `<b>拖入、粘贴或点此选择照片</b><span>最多 20 张 · 支持 Ctrl/⌘ + V 粘贴</span>`
    zone.prepend(picker)
    container.append(zone)
    if (shoot) {
      // IDOK-205: 网页内相机，拍完直接回到这里并上传。
      const cam = document.createElement('button')
      cam.type = 'button'
      cam.className = 'fb-shoot'
      cam.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="13.2" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><b>现场拍照</b><span>拍完自动回到这里</span>'
      cam.onclick = async () => {
        const shot = await shoot()
        if (!shot) return
        add([shot.file] as unknown as FileList, shot.meta)
        const id = currentId()
        if (id) void run(() => upload(id))
      }
      const row = document.createElement('div')
      row.className = 'fb-pick-row'
      zone.replaceWith(row)
      row.append(cam, zone)
    }
    container.append(grid)
  }

  const entries = new Map<
      number,
      { done: boolean; url: string; reset: () => void; upload: (id: string) => Promise<void> }
    >(),
    urls = new Set<string>()
  const revokeUrl = (url?: string) => {
    if (!url) return
    URL.revokeObjectURL(url)
    urls.delete(url)
  }
  const sync = () => {
    const total = used.length + entries.size
    if (!compact) zone.classList.toggle('fb-drop--compact', total > 0)
    container.dataset.count = String(total)
    onChange?.(total)
  }

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
        const removed = entries.get(slot)
        if (removed) revokeUrl(removed.url)
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

  function add(files: FileList | null, known?: CameraShot['meta']) {
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
        remove = document.createElement('button'),
        note = document.createElement('small')
      cell.className = 'fb-photo fb-photo--new'
      note.className = 'fb-photo-note'
      view.setAttribute('aria-label', '拍摄视角')
      view.add(new Option('视角', ''))
      views.forEach((label) => view.add(new Option(label)))
      image.alt = file.name
      const previewUrl = URL.createObjectURL(file)
      image.src = previewUrl
      urls.add(previewUrl)
      wireRemove(remove, slot, cell)
      cell.append(image, view, note, remove)
      grid.append(cell)
      const entry = {
        done: false,
        url: previewUrl,
        reset() {
          entry.done = false
          note.textContent = ''
          cell.classList.remove('fb-photo--done', 'fb-photo--error')
          view.disabled = false
        },
        async upload(id: string) {
          if (entry.done) return
          note.textContent = '正在处理'
          try {
            const { jpeg, meta } = await prepare(
              file,
              (stage) => {
                note.textContent = stage
              },
              known,
            )
            inline(note, { label: '正在上传' })
            await new Promise<void>((resolve, reject) => {
              const xhr = new XMLHttpRequest()
              xhr.open('PUT', `/api/feedback/${id}/photos/${slot}`)
              xhr.setRequestHeader('Content-Type', 'image/jpeg')
              xhr.setRequestHeader(
                'X-Photo-Meta',
                encodeURIComponent(JSON.stringify({ ...meta, view_label: view.value })),
              )
              xhr.upload.onprogress = (event) => {
                inline(note, {
                  label: '正在上传',
                  progress: event.lengthComputable ? event.loaded / event.total : undefined,
                })
              }
              xhr.responseType = 'json'
              xhr.onload = () =>
                xhr.status === 200 ? resolve() : reject(Error(xhr.response?.error?.message || '上传失败'))
              xhr.onerror = () => reject(Error('网络异常'))
              xhr.send(jpeg)
            })
            entry.done = true
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
    if (!compact) grid.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  async function upload(id: string) {
    for (const entry of entries.values()) await entry.upload(id)
  }

  function clear() {
    if (!entries.size) return
    for (const entry of entries.values()) revokeUrl(entry.url)
    entries.clear()
    for (const node of Array.from(grid.querySelectorAll('.fb-photo--new'))) node.remove()
    sync()
  }

  function resetDone() {
    for (const entry of entries.values()) entry.reset()
  }

  picker.onchange = () => {
    add(picker.files)
    picker.value = ''
  }
  if (!compact) {
    container.ondragover = (event) => {
      event.preventDefault()
      zone.classList.add('fb-drop--over')
    }
    container.ondragleave = () => zone.classList.remove('fb-drop--over')
    container.ondrop = (event) => {
      event.preventDefault()
      event.stopPropagation()
      zone.classList.remove('fb-drop--over')
      if (!picker.disabled) add(event.dataTransfer?.files ?? null)
    }
  }
  sync()
  return {
    open: () => picker.click(),
    add: (files: File[]) => add(files as unknown as FileList),
    clear,
    resetDone,
    pending: () => [...entries.values()].filter((entry) => !entry.done).length,
    count: () => used.length + entries.size,
    upload,
    dispose: () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    },
  }
}
