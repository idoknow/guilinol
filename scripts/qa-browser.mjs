// Linux CI uses SwiftShader. Headless Chromium on Mac can render on the Metal GPU.
export function browserOptions(nativeMac = process.env.QA_NATIVE_GPU === '1') {
  return {
    executablePath: process.env.CHROMIUM,
    args:
      nativeMac && process.platform === 'darwin'
        ? ['--enable-gpu', '--use-angle=metal']
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  }
}

// Record a short sample before route assertions so failed runs retain their baseline.
export async function recordFrames(page) {
  if (!process.env.QA_METRICS) return
  const sample = await page.evaluate(async () => {
    const { stats } = window.viewer
    let calls = 0
    for (let frame = 0; frame < 12; frame++) {
      await new Promise(requestAnimationFrame)
      calls += stats.calls
    }
    return { firstMs: stats.firstMs, meanCalls: calls / 12 }
  })
  console.log('QA_FRAME', JSON.stringify(sample))
}

export async function applyCpuThrottle(page, fallback = 1) {
  const rate = Number(process.env.GLOL_CPU_THROTTLE ?? fallback)
  if (!Number.isFinite(rate) || rate < 1) throw Error('CPU throttle rate must be at least 1')
  if (rate === 1) return
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate', {rate})
  console.log(`CDP CPU throttle: ${rate}x`)
}
