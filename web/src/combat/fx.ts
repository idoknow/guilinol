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
  const size = look.radius * (0.55 + strength)
  const ring = document.createElement('i')
  Object.assign(ring.style, {
    pointerEvents: 'none',
    position: 'fixed',
    border: '1px solid ' + look.ring,
    borderRadius: '50%',
    background: look.flash,
    left: x - size / 2 + 'px',
    top: y - size / 2 + 'px',
    width: size + 'px',
    height: size + 'px',
  })
  document.body.append(ring)
  ring.animate(
    [
      { transform: 'scale(.18)', opacity: 0.8 },
      { transform: 'scale(1.4)', opacity: 0 },
    ],
    look.duration,
  ).onfinish = () => ring.remove()
  for (let i = 0; i < 4; i++) {
    const dot = document.createElement('i')
    Object.assign(dot.style, {
      position: 'fixed',
      pointerEvents: 'none',
      background: look.dust,
      width: look.dustSize + 'px',
      height: look.dustSize + 'px',
      left: x + 'px',
      top: y + 'px',
    })
    document.body.append(dot)
    dot.animate(
      [
        { opacity: 0.8 },
        {
          transform: 'translate(' + Math.cos(i * 1.57) * size + 'px,' + Math.sin(i * 1.57) * size + 'px)',
          opacity: 0,
        },
      ],
      look.duration,
    ).onfinish = () => dot.remove()
  }
  if (self)
    canvas.animate([{ translate: look.shake * strength + 'px 0' }, { translate: '0 0' }], look.duration / 2)
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
