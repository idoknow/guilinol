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
