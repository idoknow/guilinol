import assert from 'node:assert/strict'

// main b9db5e4, 390×844，待 UI 分支修复。面积用未取整的 DOMRect 计算。
const maximumArea = new Map([
  ['.dock|.sky-ui', 5016],
  ['.walk-ui .joystick|output', 175.21875],
])

export function checkOverlaps(pairs) {
  for (const {a, b, area} of pairs) {
    const key = [a, b].sort().join('|')
    assert(area <= (maximumArea.get(key) ?? 0), `${key}: ${area} px² exceeds main (${maximumArea.get(key) ?? 0})`)
  }
}

export function checkBounds(boxes) {
  for (const box of boxes) {
    assert(box.sel === '.sky-ui' && box.left >= 0 && box.right <= 399.1875 && box.top >= 0 && box.bottom <= 844,
      `control outside main bounds: ${JSON.stringify(box)}`)
  }
}
