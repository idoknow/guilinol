import * as THREE from 'three'
import type { DrinksSiteCandidate, DrinksSiteId } from '../site.ts'
import { buildPlotMeshes, type BuiltPlotMeshes } from './plot-mesh.ts'
import {
  analyzePlotTerrain,
  type PlotCornerSample,
  type SampledPlotTerrain,
} from './plot-sampler.ts'

export type { PlotCornerSample }

export interface FitDrinksPlotOptions {
  readonly site: DrinksSiteCandidate
  readonly scene?: THREE.Scene
  readonly parent?: THREE.Object3D
  readonly shopGroup?: THREE.Object3D
  readonly sampleGroundY?: (x: number, z: number) => number
  readonly streetElevationY?: number
  readonly width?: number
  readonly interiorDepth?: number
  readonly patioDepth?: number
  readonly apronMargin?: number
}

export interface PlotCollider {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
  readonly label: string
}

export interface FitDrinksPlotResult {
  readonly siteId: DrinksSiteId
  readonly plotY: number
  readonly groundMinY: number
  readonly groundMaxY: number
  readonly fillHeightM: number
  readonly plinthGroup: THREE.Group
  readonly colliders: readonly PlotCollider[]
  readonly corners: readonly PlotCornerSample[]
  readonly sidewalkSamples: readonly PlotCornerSample[]
  readonly outerSeamSamples: readonly PlotCornerSample[]
  readonly maxCornerGapM: number
  readonly maxSidewalkGapM: number
  readonly maxOuterSeamGapM: number
  samplePlotSurfaceY(worldX: number, worldZ: number): number
  refit(sampleGroundY?: (x: number, z: number) => number, streetElevationY?: number): void
  dispose(): void
}

/**
 * 适配正阳路/王城商厦鲜饮地块标高与地形衔接：
 * 生成齐平店铺四角与门前人行道的承重台基（plinth）+ 无缝衔接周边路面的渐变坡面（apron slope），
 * 消除底层 DEM 下陷坑与山坡悬空缝隙；零新建 THREE.Light。
 */
export function fitDrinksPlot(options: FitDrinksPlotOptions): FitDrinksPlotResult {
  const { site, scene, parent, shopGroup } = options
  const width = options.width ?? 12.2
  const interiorDepth = options.interiorDepth ?? 7.4
  const patioDepth = options.patioDepth ?? 2.4
  const apronMargin = options.apronMargin ?? 2.6

  const plinthGroup = new THREE.Group()
  plinthGroup.name = `drinks.terrain.${site.id}`

  let currentSampled: SampledPlotTerrain = analyzePlotTerrain(
    site,
    width,
    interiorDepth,
    patioDepth,
    apronMargin,
    options.sampleGroundY,
    options.streetElevationY,
  )
  let currentMeshes: BuiltPlotMeshes | null = null

  const syncVisuals = () => {
    if (currentMeshes) {
      plinthGroup.remove(currentMeshes.apronMesh, currentMeshes.plinthMesh, currentMeshes.curbTrimMesh)
      currentMeshes.dispose()
    }
    plinthGroup.position.set(site.worldX, currentSampled.plotY, site.worldZ)
    plinthGroup.rotation.y = site.worldYaw

    currentMeshes = buildPlotMeshes(site, currentSampled)
    plinthGroup.add(currentMeshes.apronMesh, currentMeshes.plinthMesh, currentMeshes.curbTrimMesh)

    if (shopGroup) {
      shopGroup.position.set(site.worldX, currentSampled.plotY, site.worldZ)
      shopGroup.rotation.y = site.worldYaw
    }
  }

  syncVisuals()

  const host = parent ?? scene
  if (host) host.add(plinthGroup)

  return {
    get siteId() {
      return site.id
    },
    get plotY() {
      return currentSampled.plotY
    },
    get groundMinY() {
      return currentSampled.groundMinY
    },
    get groundMaxY() {
      return currentSampled.groundMaxY
    },
    get fillHeightM() {
      return currentSampled.fillHeightM
    },
    plinthGroup,
    colliders: Object.freeze([]),
    get corners() {
      return currentSampled.corners
    },
    get sidewalkSamples() {
      return currentSampled.sidewalkSamples
    },
    get outerSeamSamples() {
      return currentSampled.outerSeamSamples
    },
    get maxCornerGapM() {
      return currentSampled.maxCornerGapM
    },
    get maxSidewalkGapM() {
      return currentSampled.maxSidewalkGapM
    },
    get maxOuterSeamGapM() {
      return currentSampled.maxOuterSeamGapM
    },
    samplePlotSurfaceY(worldX: number, worldZ: number): number {
      return currentSampled.sampleSurfaceAt(worldX, worldZ)
    },
    refit(nextSampleGroundY?: (x: number, z: number) => number, nextStreetElevationY?: number): void {
      currentSampled = analyzePlotTerrain(
        site,
        width,
        interiorDepth,
        patioDepth,
        apronMargin,
        nextSampleGroundY ?? options.sampleGroundY,
        nextStreetElevationY ?? options.streetElevationY,
      )
      syncVisuals()
    },
    dispose(): void {
      plinthGroup.removeFromParent()
      if (currentMeshes) {
        currentMeshes.dispose()
        currentMeshes = null
      }
    },
  }
}
