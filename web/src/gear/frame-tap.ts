// 录像抓帧钩子（IDOK-383）。主渲染器没开 preserveDrawingBuffer，WebGL 画布一旦 present，
// drawing buffer 就被清空；在渲染循环外（setInterval / 点击回调）drawImage 拿到的是空 buffer → 全黑。
// 所以抓帧必须在同一个任务里、renderer.render 刚结束时做：main.ts 的 drawMain() 每画完一帧调 tapFrame()。
// 没在录像时集合为空，只多一次 size 判断。单独成文件，免得 main 包把整个录像模块拉进来。

export type FrameTap = (canvas: HTMLCanvasElement) => void

const taps = new Set<FrameTap>()

export function addFrameTap(tap: FrameTap): () => void {
  taps.add(tap)
  return () => taps.delete(tap)
}

export function tapFrame(canvas: HTMLCanvasElement): void {
  if (!taps.size) return
  for (const tap of taps) tap(canvas)
}
