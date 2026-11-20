// Dev-only ablation switches. They exist so a performance change can be measured by removing it
// again at runtime: with no query string every flag is false and the render path is identical to
// the one without this module.
const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search)

const enabled = (name: string) => query.get(name) === '1'

export const flags = {
  /** Skip the planar reflection pass entirely. */
  noMirror: enabled('nomirror'),
  /** Merge every loaded tile into one batch instead of per-bucket batches. */
  noBatch: enabled('nobatch'),
}
