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

// Use the same random sequence in the two production builds of a paired run.
export async function seedBenchmark(context){
  if(process.env.PERF_PEDESTRIANS==='0'){
    // The baseline must run unmodified. Apply the same sidewalk-track control
    // after the production decoder reads each cell, keeping motor lanes intact.
    await context.addInitScript(()=>{
      const parse=JSON.parse
      JSON.parse=function(text,reviver){
        const value=parse(text,reviver)
        if(Array.isArray(value?.lanes)&&Array.isArray(value.nodes)&&Array.isArray(value.signals)){
          for(const lane of value.lanes)delete lane.npcWalks
        }
        return value
      }
    })
  }
  if(!process.env.PERF_SEED)return
  await context.addInitScript(initial=>{
    let state=initial>>>0
    Math.random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296}
  },Number(process.env.PERF_SEED))
}
