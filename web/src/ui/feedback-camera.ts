// IDOK-205: 反馈专属拍照。反馈弹窗先收起（表单原样保留），全屏取景器用网页内相机拍一张，
// 拍完自动存到本机（可关）并交回反馈弹窗上传。不跳系统相机，手机浏览器不会因切后台丢失已填写的内容。

export type CameraShot = {
  file: File
  meta: { exif_lat?: number; exif_lon?: number; exif_dir?: number; exif_time?: string }
}

const SAVE_KEY = 'glol.fb.camSave'

export const cameraSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext

function stamp(date = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

function save(file: File) {
  const a = document.createElement('a'),
    url = URL.createObjectURL(file)
  a.href = url
  a.download = file.name
  a.hidden = true
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Opens the full-screen feedback camera. Resolves with the shot, or null when cancelled. */
export function shootFeedbackPhoto(): Promise<CameraShot | null> {
  return new Promise((resolve, reject) => {
    const root = document.createElement('div'),
      video = document.createElement('video'),
      top = document.createElement('div'),
      bar = document.createElement('div'),
      cancel = document.createElement('button'),
      shutter = document.createElement('button'),
      flip = document.createElement('button'),
      keep = document.createElement('label'),
      keepBox = document.createElement('input'),
      status = document.createElement('p'),
      flash = document.createElement('i')
    root.className = 'fb-cam'
    // div, not header/footer: hud.css styles bare <footer> (attribution pill) globally.
    top.className = 'fb-cam-top'
    bar.className = 'fb-cam-bar'
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', '反馈拍照')
    video.playsInline = true
    video.muted = true
    video.setAttribute('playsinline', '')
    top.innerHTML = '<b>反馈拍照</b><span>对准要反馈的建筑或街景，拍完自动回到反馈</span>'
    keepBox.type = 'checkbox'
    keepBox.checked = localStorage.getItem(SAVE_KEY) !== '0'
    keepBox.onchange = () => localStorage.setItem(SAVE_KEY, keepBox.checked ? '1' : '0')
    keep.className = 'fb-cam-keep'
    keep.append(keepBox, document.createTextNode('同时存到本机'))
    top.append(keep)
    for (const [node, label, cls] of [
      [cancel, '取消', 'fb-cam-side'],
      [shutter, '', 'fb-cam-shutter'],
      [flip, '翻转', 'fb-cam-side'],
    ] as const) {
      node.type = 'button'
      node.className = cls
      node.textContent = label
    }
    shutter.setAttribute('aria-label', '拍摄')
    shutter.disabled = true
    flip.hidden = true
    status.className = 'fb-cam-status'
    status.setAttribute('role', 'status')
    status.textContent = '正在打开相机…'
    flash.className = 'fb-cam-flash'
    bar.append(cancel, shutter, flip)
    root.append(video, flash, top, status, bar)
    document.body.append(root)
    requestAnimationFrame(() => root.classList.add('fb-cam--open'))

    let stream: MediaStream | undefined,
      facing: 'environment' | 'user' = 'environment',
      done = false,
      position: GeolocationPosition | undefined
    // 位置只在已授权时顺手带上，不额外弹权限框。
    void navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((state) => {
        if (state.state === 'granted')
          navigator.geolocation.getCurrentPosition(
            (value) => (position = value),
            () => {},
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
          )
      })
      .catch(() => {})

    let startupTimer: number | undefined
    const previewError = () => Error('摄像头没有可用画面，请检查摄像头或选择已有照片。反馈游戏场景可用「重新取景」。')
    const stop = () => {
      window.clearTimeout(startupTimer)
      stream?.getTracks().forEach((track) => track.stop())
      video.srcObject = null
    }
    const finish = (value: CameraShot | null, error?: unknown) => {
      if (done) return
      done = true
      stop()
      removeEventListener('keydown', onKey, true)
      root.classList.remove('fb-cam--open')
      setTimeout(() => root.remove(), 200)
      if (error) reject(error)
      else resolve(value)
    }
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation()
      if (event.key === 'Escape') finish(null)
      else if ((event.key === ' ' || event.key === 'Enter') && !shutter.disabled) {
        event.preventDefault()
        shutter.click()
      }
    }
    addEventListener('keydown', onKey, true)
    for (const name of ['keyup', 'pointerdown', 'wheel', 'touchstart'])
      root.addEventListener(name, (event) => event.stopPropagation())

    async function open() {
      stop()
      shutter.disabled = true
      flip.hidden = true
      status.textContent = '正在打开设备摄像头，请允许浏览器使用相机…'
      startupTimer = window.setTimeout(() => finish(null, previewError()), 15000)
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1920 } },
        })
      } catch (error) {
        const name = (error as DOMException)?.name
        finish(
          null,
          Error(
            name === 'NotAllowedError'
              ? '没有相机权限：请在浏览器设置里允许本站使用相机，或点「拖入、粘贴或点此选择照片」从相册添加'
              : '无法打开相机，请改用「点此选择照片」',
          ),
        )
        return
      }
      if (done) return stop()
      video.srcObject = stream
      try {
        await video.play()
      } catch {
        return finish(null, previewError())
      }
      if (done) return
      if (!video.videoWidth || !video.videoHeight || video.readyState < video.HAVE_CURRENT_DATA)
        return finish(null, previewError())
      window.clearTimeout(startupTimer)
      root.classList.toggle('fb-cam--mirror', facing === 'user')
      status.textContent = ''
      shutter.disabled = false
      const cams = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'videoinput')
      flip.hidden = cams.length < 2
    }
    cancel.onclick = () => finish(null)
    flip.onclick = () => {
      facing = facing === 'environment' ? 'user' : 'environment'
      void open()
    }
    shutter.onclick = async () => {
      if (!video.videoWidth) return
      shutter.disabled = true
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const g = canvas.getContext('2d')!
      if (facing === 'user') {
        g.translate(canvas.width, 0)
        g.scale(-1, 1)
      }
      g.drawImage(video, 0, 0)
      flash.classList.remove('go')
      void flash.offsetWidth
      flash.classList.add('go')
      video.pause()
      try {
        const blob = await new Promise<Blob>((ok, fail) =>
          canvas.toBlob((value) => (value ? ok(value) : fail(Error('拍摄失败'))), 'image/jpeg', 0.9),
        )
        const now = new Date(),
          file = new File([blob], `网上桂林-反馈-${stamp(now)}.jpg`, { type: 'image/jpeg' })
        if (keepBox.checked)
          try {
            save(file)
          } catch {
            /* 存本机失败不影响上传 */
          }
        const c = position?.coords
        await new Promise((ok) => setTimeout(ok, 260))
        finish({
          file,
          meta: {
            exif_lat: c?.latitude,
            exif_lon: c?.longitude,
            exif_dir: c?.heading ?? undefined,
            exif_time: now.toISOString(),
          },
        })
      } catch (error) {
        finish(null, error)
      }
    }
    void open()
  })
}
