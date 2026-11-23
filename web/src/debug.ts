// Dev-only ablation switches. They exist so a performance change can be measured by removing it
// again at runtime: with no query string every flag is false and the render path is identical to
// the one without this module.
const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search)

const enabled = (name: string) => query.get(name) === '1'

const bucketTiles = Number.parseInt(query.get('buckets') ?? '', 10)

export const flags = {
  /** Tiles per bucket side; ?buckets=N overrides the default for draw-call / rebuild ablation. */
  bucketTiles: Number.isFinite(bucketTiles) ? Math.min(8, Math.max(1, bucketTiles)) : 3,
  /** Skip the planar reflection pass entirely. */
  noMirror: enabled('nomirror'),
  /** Merge every loaded tile into one batch instead of per-bucket batches. */
  noBatch: enabled('nobatch'),
  /**
   * 退回流式加载的旧行为：一次只排一块、同时只解两块、地标按清单顺序下、
   * 不缓存已下载的块、加载屏期间不预热。只用于对比测量（scripts/load-audit.mjs）。
   */
  legacyStream: enabled('legacy'),
}
