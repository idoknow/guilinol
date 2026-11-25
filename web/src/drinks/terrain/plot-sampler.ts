import { shopLocalToWorld, worldToShopLocal, type DrinksSiteCandidate } from '../site.ts'

export interface PlotCornerSample {
  readonly id: string
  readonly localX: number
  readonly localZ: number
  readonly worldX: number
  readonly worldZ: number
  readonly plotSurfaceY: number
  readonly terrainGroundY: number
  readonly clearanceM: number
}

export interface PlotLayoutSpec {
  readonly halfW: number
  readonly zBack: number
  readonly zFront: number
  readonly zPatioEnd: number
  /** Level pad bounds for the shop & front patio. */
  readonly corePadHalfW: number
  /** Smooth shoulder width transitioning from core patio front to lateral forecourt wing edge. */
  readonly shoulderW: number
  /** Lateral wing bounds along Wangcheng north wall when filling a sunken forecourt bay. */
  readonly padXMin: number
  readonly padXMax: number
  readonly padZMin: number
  readonly padZMax: number
  /** Front Z limit of the lateral forecourt wings (stops cleanly south of yellow tactile sidewalk). */
  readonly wingZMax: number
  /** Outer apron slope perimeter bounds where edges tie seamlessly down to raw terrain / sidewalk grade. */
  readonly outerXMin: number
  readonly outerXMax: number
  readonly outerZMin: number
  readonly outerZMax: number
  /** Front outer seam Z limit on lateral wings (stops strictly inside `[9]` south of `[39]` tactile strip). */
  readonly wingOuterZMax: number
}

export interface SampledPlotTerrain {
  readonly plotY: number
  readonly groundMinY: number
  readonly groundMaxY: number
  readonly fillHeightM: number
  readonly spec: PlotLayoutSpec
  readonly corners: readonly PlotCornerSample[]
  readonly sidewalkSamples: readonly PlotCornerSample[]
  readonly outerSeamSamples: readonly PlotCornerSample[]
  readonly maxCornerGapM: number
  readonly maxSidewalkGapM: number
  readonly maxOuterSeamGapM: number
  maxLevelZForX(lx: number): number
  outerZForX(lx: number): number
  sampleTerrainAt(worldX: number, worldZ: number): number
  sampleSurfaceAt(worldX: number, worldZ: number): number
}

export function buildPlotLayoutSpec(
  width: number,
  interiorDepth: number,
  patioDepth: number,
  apronMargin: number,
  wingEastM = 0,
  wingWestM = 0,
): PlotLayoutSpec {
  const halfW = width * 0.5
  const zFront = 2.8
  const zBack = zFront - interiorDepth
  const zPatioEnd = zFront + patioDepth
  const padSide = 0.65
  const padRear = 0.35
  const padFront = 0.14
  const corePadHalfW = halfW + padSide
  const shoulderW = 1.6

  // 局部坐标 +X 朝西（正阳步行街），-X 朝东（王城商厦东段）
  const padXMin = -(corePadHalfW + wingEastM)
  const padXMax = corePadHalfW + wingWestM
  const padZMin = zBack - padRear
  const padZMax = zPatioEnd + padFront
  const wingZMax = wingEastM > 0 || wingWestM > 0 ? zFront + 1.25 : padZMax

  const frontMargin = Math.min(apronMargin, 0.16)
  const sideSlope = Math.max(apronMargin, 2.6)
  const rearSlope = Math.max(1.4, apronMargin * 0.55)
  const outerZMax = padZMax + frontMargin
  const wingOuterZMax = wingEastM > 0 || wingWestM > 0 ? zFront + 1.95 : outerZMax

  return {
    halfW,
    zBack,
    zFront,
    zPatioEnd,
    corePadHalfW,
    shoulderW,
    padXMin,
    padXMax,
    padZMin,
    padZMax,
    wingZMax,
    outerXMin: padXMin - sideSlope,
    outerXMax: padXMax + sideSlope,
    outerZMin: padZMin - rearSlope,
    outerZMax,
    wingOuterZMax,
  }
}

export function analyzePlotTerrain(
  site: DrinksSiteCandidate,
  width: number,
  interiorDepth: number,
  patioDepth: number,
  apronMargin: number,
  sampleGroundY?: (x: number, z: number) => number,
  streetElevationY?: number,
): SampledPlotTerrain {
  const rawSample = (wx: number, wz: number): number => {
    if (!sampleGroundY) return streetElevationY ?? site.fallbackGroundY
    const v = sampleGroundY(wx, wz)
    return typeof v === 'number' && Number.isFinite(v) ? v : streetElevationY ?? site.fallbackGroundY
  }

  const probeSpec = buildPlotLayoutSpec(width, interiorDepth, patioDepth, apronMargin)
  const probeLocal = (lx: number, lz: number): number => {
    const w = shopLocalToWorld(site, lx, lz)
    return rawSample(w.x, w.z)
  }

  const buildingXs = [-probeSpec.halfW, 0, probeSpec.halfW]
  const buildingZs = [probeSpec.zBack, (probeSpec.zBack + probeSpec.zFront) * 0.5, probeSpec.zFront, probeSpec.zPatioEnd]
  const frontCurbZs = [probeSpec.padZMax, probeSpec.outerZMax, probeSpec.padZMax + 4.2, probeSpec.padZMax + 7.5]

  const allFootprintY: number[] = []
  const frontY: number[] = []
  const streetCrownY: number[] = []

  for (const lx of buildingXs) {
    for (const lz of buildingZs) {
      const y = probeLocal(lx, lz)
      allFootprintY.push(y)
      if (lz >= probeSpec.zFront) frontY.push(y)
    }
    for (const lz of frontCurbZs) {
      const y = probeLocal(lx, lz)
      streetCrownY.push(y)
      if (lz <= probeSpec.outerZMax) frontY.push(y)
    }
  }

  const groundMinY = Math.min(...allFootprintY, ...frontY)
  const frontMaxY = Math.max(...frontY)
  const streetMaxY = Math.max(...frontY, ...streetCrownY)
  const footprintMaxY = Math.max(...allFootprintY, frontMaxY)

  const wangchengSunkenBowl =
    site.id === 'wangcheng_mall' &&
    Boolean(sampleGroundY) &&
    (streetMaxY - groundMinY >= 1.5 ||
      (site.fallbackGroundY - groundMinY >= 1.8 && site.fallbackGroundY - groundMinY <= 6.5))

  let plotY = footprintMaxY
  if (typeof streetElevationY === 'number' && Number.isFinite(streetElevationY)) {
    plotY = Math.max(plotY, streetElevationY)
  } else if (wangchengSunkenBowl) {
    plotY = Math.max(plotY, streetMaxY, site.fallbackGroundY)
  } else if (!sampleGroundY) {
    plotY = site.fallbackGroundY
  }

  // 贴合 shop 实际左右侧翼范围 (东至 -11.95m, 西至 +14.05m)，并在街面边界处自然收坡
  const wingWestM = wangchengSunkenBowl ? 7.3 : 0
  const wingEastM = wangchengSunkenBowl ? 5.2 : 0
  const spec = buildPlotLayoutSpec(width, interiorDepth, patioDepth, apronMargin, wingEastM, wingWestM)

  const groundMaxY = Math.max(footprintMaxY, plotY)
  const fillHeightM = Math.max(0, plotY - groundMinY)

  const spanXNeg = Math.max(0.01, spec.padXMin - spec.outerXMin)
  const spanXPos = Math.max(0.01, spec.outerXMax - spec.padXMax)
  const spanZNeg = Math.max(0.01, spec.padZMin - spec.outerZMin)

  const wingBlend = (lx: number): number => {
    const over = Math.max(0, Math.abs(lx) - spec.corePadHalfW)
    const u = Math.min(1, over / Math.max(0.01, spec.shoulderW))
    return u * u * (3 - 2 * u)
  }

  const maxLevelZForX = (lx: number): number => {
    const w = wingBlend(lx)
    return spec.padZMax + (spec.wingZMax - spec.padZMax) * w
  }

  const outerZForX = (lx: number): number => {
    const w = wingBlend(lx)
    return spec.outerZMax + (spec.wingOuterZMax - spec.outerZMax) * w
  }

  const computeSeamFactor = (lx: number, lz: number): { t: number; rimX: number; rimZ: number } => {
    const localZMax = maxLevelZForX(lx)
    const localOuterZ = outerZForX(lx)
    const cx = Math.max(spec.padXMin, Math.min(spec.padXMax, lx))
    const cz = Math.max(spec.padZMin, Math.min(localZMax, lz))
    const dx = lx - cx
    const dz = lz - cz
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) {
      return { t: 0, rimX: lx, rimZ: lz }
    }
    const localZPosSpan = Math.max(0.01, localOuterZ - localZMax)
    const tx = dx > 0 ? dx / spanXPos : dx < 0 ? -dx / spanXNeg : 0
    const tz = dz > 0 ? dz / localZPosSpan : dz < 0 ? -dz / spanZNeg : 0
    const radial = Math.hypot(tx, tz)
    const t = Math.min(1, radial)
    const inv = radial > 1e-6 ? 1 / radial : 1
    return {
      t,
      rimX: cx + dx * inv,
      rimZ: cz + dz * inv,
    }
  }

  const sampleSurfaceAt = (worldX: number, worldZ: number): number => {
    const local = worldToShopLocal(site, worldX, worldZ)
    const { t, rimX, rimZ } = computeSeamFactor(local.x, local.z)
    if (t <= 0) return plotY
    const rimWorld = shopLocalToWorld(site, rimX, rimZ)
    const rimTerrainY = rawSample(rimWorld.x, rimWorld.z)
    if (t >= 1) return rimTerrainY
    const smooth = t * t * (3 - 2 * t)
    return plotY + (rimTerrainY - plotY) * smooth
  }

  const evaluateLocal = (id: string, lx: number, lz: number, targetRefY: number): PlotCornerSample => {
    const w = shopLocalToWorld(site, lx, lz)
    const plotSurfaceY = sampleSurfaceAt(w.x, w.z)
    const terrainGroundY = rawSample(w.x, w.z)
    return {
      id,
      localX: lx,
      localZ: lz,
      worldX: Math.round(w.x * 1000) / 1000,
      worldZ: Math.round(w.z * 1000) / 1000,
      plotSurfaceY: Math.round(plotSurfaceY * 1000) / 1000,
      terrainGroundY: Math.round(terrainGroundY * 1000) / 1000,
      clearanceM: Math.round(Math.abs(plotSurfaceY - targetRefY) * 1000) / 1000,
    }
  }

  const corners: PlotCornerSample[] = [
    evaluateLocal('shop:sw-back', -spec.halfW, spec.zBack, plotY),
    evaluateLocal('shop:se-back', spec.halfW, spec.zBack, plotY),
    evaluateLocal('shop:ne-front', spec.halfW, spec.zFront, plotY),
    evaluateLocal('shop:nw-front', -spec.halfW, spec.zFront, plotY),
    evaluateLocal('shop:door-center', 0.2, spec.zFront, plotY),
  ]

  const sidewalkSamples: PlotCornerSample[] = [
    evaluateLocal('sidewalk:door-sill', 0.2, spec.zFront + 0.05, plotY),
    evaluateLocal('sidewalk:patio-west', -3.3, 4.28, plotY),
    evaluateLocal('sidewalk:patio-east', 3.1, 4.28, plotY),
    evaluateLocal('sidewalk:patio-sw', -spec.halfW, spec.zPatioEnd, plotY),
    evaluateLocal('sidewalk:patio-se', spec.halfW, spec.zPatioEnd, plotY),
  ]

  const outerRingCoords: Array<[string, number, number]> = [
    ['rim:front-west', spec.padXMin, outerZForX(spec.padXMin)],
    ['rim:front-center', 0, outerZForX(0)],
    ['rim:front-east', spec.padXMax, outerZForX(spec.padXMax)],
    ['rim:east-mid', spec.outerXMax, 0.2],
    ['rim:west-mid', spec.outerXMin, 0.2],
    ['rim:rear-west', spec.padXMin, spec.outerZMin],
    ['rim:rear-center', 0, spec.outerZMin],
    ['rim:rear-east', spec.padXMax, spec.outerZMin],
  ]

  const outerSeamSamples: PlotCornerSample[] = outerRingCoords.map(([id, lx, lz]) => {
    const w = shopLocalToWorld(site, lx, lz)
    const rimTerrainY = rawSample(w.x, w.z)
    return evaluateLocal(id, lx, lz, rimTerrainY)
  })

  return {
    plotY: Math.round(plotY * 1000) / 1000,
    groundMinY: Math.round(groundMinY * 1000) / 1000,
    groundMaxY: Math.round(groundMaxY * 1000) / 1000,
    fillHeightM: Math.round(fillHeightM * 1000) / 1000,
    spec,
    corners,
    sidewalkSamples,
    outerSeamSamples,
    maxCornerGapM: Math.max(...corners.map(c => c.clearanceM)),
    maxSidewalkGapM: Math.max(...sidewalkSamples.map(s => s.clearanceM)),
    maxOuterSeamGapM: Math.max(...outerSeamSamples.map(o => o.clearanceM)),
    maxLevelZForX,
    outerZForX,
    sampleTerrainAt: rawSample,
    sampleSurfaceAt,
  }
}
