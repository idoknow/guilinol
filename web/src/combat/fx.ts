import { look } from './look'
let audio: AudioContext | undefined
export function unlockAudio() {
  audio ??= new AudioContext()
  void audio.resume().catch(() => {})
}
export function impact(
  x: number,
  y: number,
  strength: number,
  hook: boolean,
  distance: number,
  self: boolean,
  canvas: HTMLElement,
) {
  const size = look.radius * (0.55 + strength),
    time = look.duration * (hook ? 1.5 : 1)
  const spawn = (style: Partial<CSSStyleDeclaration>) => {
    const node = document.createElement('i')
    Object.assign(node.style, { position: 'fixed', pointerEvents: 'none', zIndex: '4' }, style)
    document.body.append(node)
    return node
  }
  const disc = (d: number, style: Partial<CSSStyleDeclaration>) =>
    spawn({ left: x - d / 2 + 'px', top: y - d / 2 + 'px', width: d + 'px', height: d + 'px', borderRadius: '50%', ...style })
  // 闪光：纸白径向渐隐，迅速收掉
  const flash = disc(size, { background: `radial-gradient(circle, ${look.flash} 0, rgba(251,248,240,.45) 38%, transparent 70%)` })
  flash.animate([{ transform: 'scale(.4)', opacity: 1 }, { transform: 'scale(1.05)', opacity: 0 }], {
    duration: time * 0.6,
    easing: 'ease-out',
  }).onfinish = () => flash.remove()
  // 冲击环：细线向外扩，重击再追一圈朱砂
  const rings = hook ? [look.ring, look.heavyRing] : [look.ring]
  rings.forEach((color, i) => {
    const ring = disc(size * 1.1, { border: `${hook ? 1.5 : 1}px solid ${color}` })
    ring.animate([{ transform: 'scale(.25)', opacity: 0.9 }, { transform: `scale(${1.5 + i * 0.5})`, opacity: 0 }], {
      duration: time,
      delay: i * 60,
      easing: 'cubic-bezier(.2,.8,.2,1)',
      fill: 'backwards',
    }).onfinish = () => ring.remove()
  })
  // 尘屑：短线状，随机角度往外甩
  const count = look.sparks + (hook ? 3 : 0)
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.8,
      reach = size * (0.7 + Math.random() * 0.6),
      len = look.dustSize * (2 + strength * 2)
    const dot = spawn({
      left: x + 'px',
      top: y - look.dustSize / 4 + 'px',
      width: len + 'px',
      height: look.dustSize / 2 + 1 + 'px',
      borderRadius: '2px',
      background: look.dust,
      transformOrigin: '0 50%',
    })
    const deg = (a * 180) / Math.PI
    dot.animate(
      [
        { transform: `rotate(${deg}deg) translateX(${size * 0.15}px) scaleX(1)`, opacity: 0.95 },
        { transform: `rotate(${deg}deg) translateX(${reach}px) scaleX(.3)`, opacity: 0 },
      ],
      { duration: time * (0.8 + Math.random() * 0.4), easing: 'ease-out' },
    ).onfinish = () => dot.remove()
  }
  if (self)
    canvas.animate(
      [
        { translate: look.shake * strength + 'px 0' },
        { translate: -look.shake * strength * 0.5 + 'px 0' },
        { translate: '0 0' },
      ],
      time * 0.6,
    )
  if (!audio || audio.state !== 'running') return
  const osc = audio.createOscillator(),
    gain = audio.createGain(),
    t = audio.currentTime
  osc.type = hook ? 'triangle' : 'sine'
  osc.frequency.setValueAtTime(self ? 90 : hook ? 145 : 220, t)
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.12)
  gain.gain.setValueAtTime(0.2 / (1 + distance * 0.35), t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14)
  osc.connect(gain).connect(audio.destination)
  osc.start(t)
  osc.stop(t + 0.15)
}
