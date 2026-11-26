export function encodeRoadEdits(original, collision) {
  if (collision.length <= 4) return JSON.stringify(collision)
  const source = JSON.parse(original, (_key, value, context) =>
    typeof value === 'number' ? JSON.rawJSON(context.source) : value)
  const fields = collision.map((value, index) => index >= 4 && index <= 6 ? source[index] : value)
  return JSON.stringify(fields)
}
