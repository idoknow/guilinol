/**
 * Campus quiet-zone registry & deterministic 2D point-in-polygon + outer gate buffer check.
 * Generated from pipeline/landmarks.json (all 21 schoolGround:true campuses + libin_middle, guilin_middle,
 * glmu_dongcheng, and wangcheng_teaching inner teaching courtyard = 25 zones total).
 * Aligned with docs/plan-2.md & IDOK-121/122/123: shops, missions, vehicle summon, and test-rides never enter quiet zones.
 */

export interface QuietZonePolygon {
  readonly id: string
  readonly name: string
  /** Axis-aligned bounding box [minX, minZ, maxX, maxZ] in world meters (unbuffered). */
  readonly bbox: readonly [number, number, number, number]
  /** Closed polygon vertices [x, z] in world meters. */
  readonly polygon: readonly (readonly [number, number])[]
}

/** Mandatory outer campus gate buffer (meters) per IDOK-121 / IDOK-123 / IDOK-128. */
export const QUIET_ZONE_BUFFER_M = 5

export const QUIET_ZONES: readonly QuietZonePolygon[] = [{"id":"chuanshan_tourism","name":"桂林市旅游职业中等专业学校（穿山校区）","bbox":[214.9,2122.7,580.5,2508.3],"polygon":[[502.1,2502.7],[580.5,2478.3],[551.1,2283.9],[552.3,2242.3],[557.9,2207.4],[560.6,2171.7],[529.7,2169.7],[529.6,2164.5],[527.1,2163.7],[528.9,2143.2],[524.9,2142.1],[527.0,2128.6],[528.4,2128.2],[528.2,2122.7],[454.8,2143.9],[446.2,2125.9],[273.1,2209.2],[279.4,2247.8],[266.4,2248.4],[259.9,2251.0],[217.5,2251.1],[214.9,2364.1],[251.0,2477.6],[232.4,2411.6],[234.2,2408.0],[343.7,2364.7],[346.6,2367.5],[344.8,2412.2],[402.8,2411.2],[405.6,2413.4],[404.9,2437.2],[417.1,2469.6],[390.4,2485.5],[391.5,2501.2],[390.1,2503.7],[330.6,2504.2],[258.9,2502.3],[259.6,2504.6],[466.0,2508.3]]},{"id":"guilin_technical","name":"桂林技师学院","bbox":[911.0,3157.1,1014.4,3340.5],"polygon":[[996.6,3330.2],[996.5,3334.0],[1013.6,3334.0],[1014.4,3175.2],[999.4,3175.0],[996.5,3170.9],[988.3,3163.9],[979.4,3159.5],[971.1,3157.1],[953.4,3157.5],[936.5,3163.4],[925.9,3170.5],[920.6,3176.9],[913.4,3191.6],[911.0,3202.1],[911.2,3303.3],[916.2,3316.8],[926.3,3328.2],[936.4,3334.5],[945.2,3337.9],[958.9,3340.5],[968.9,3340.2],[988.6,3335.7]]},{"id":"guilin_thirteen","name":"桂林市第十三中学","bbox":[-1063.7,-819.4,-953.3,-677.3],"polygon":[[-1063.7,-725.9],[-998.9,-677.3],[-966.7,-728.2],[-959.2,-745.1],[-953.3,-819.4],[-1003.7,-773.2],[-1038.9,-746.4],[-1052.5,-738.7]]},{"id":"lequn_primary","name":"乐群小学","bbox":[-1132.0,-577.0,-1038.5,-465.6],"polygon":[[-1132.0,-483.5],[-1072.3,-465.6],[-1065.2,-471.0],[-1038.5,-555.9],[-1098.5,-577.0]]},{"id":"baoxian_school","name":"宝贤中学","bbox":[-862.9,-1201.7,-607.5,-914.3],"polygon":[[-862.9,-1186.5],[-777.0,-1087.1],[-773.5,-1073.3],[-773.2,-1058.5],[-776.6,-1033.5],[-778.1,-1025.7],[-794.4,-943.7],[-764.1,-937.7],[-769.6,-914.3],[-719.3,-1047.1],[-672.6,-1034.1],[-667.5,-1052.8],[-613.8,-1038.8],[-607.5,-1062.4],[-622.5,-1073.5],[-618.5,-1086.7],[-641.9,-1092.8],[-637.6,-1113.9],[-689.2,-1125.8],[-703.0,-1126.4],[-744.3,-1132.7],[-793.2,-1184.4],[-814.2,-1198.1],[-829.5,-1201.7],[-846.2,-1200.4]]},{"id":"zhonghua_primary","name":"桂林市中华小学","bbox":[-345.8,-452.9,-270.4,-345.2],"polygon":[[-345.8,-352.4],[-323.0,-347.3],[-314.0,-345.2],[-312.9,-356.7],[-300.8,-368.4],[-291.6,-366.0],[-288.5,-369.6],[-277.0,-367.8],[-272.6,-391.6],[-270.4,-407.5],[-279.5,-409.8],[-277.3,-429.2],[-278.7,-445.9],[-329.0,-452.9],[-338.6,-404.5],[-341.3,-405.0],[-343.3,-393.6]]},{"id":"guilin_fifth","name":"桂林市第五中学","bbox":[-1136.3,-2464.7,-867.6,-2222.7],"polygon":[[-1136.3,-2336.6],[-1101.2,-2272.6],[-1057.4,-2222.7],[-1047.5,-2230.8],[-1038.2,-2240.9],[-1000.7,-2241.1],[-968.5,-2252.6],[-941.0,-2271.8],[-925.4,-2286.9],[-908.7,-2300.4],[-887.2,-2300.1],[-869.0,-2292.8],[-867.6,-2380.9],[-906.8,-2401.0],[-980.8,-2464.7],[-1016.7,-2428.9],[-1032.1,-2444.2]]},{"id":"lequn_medical","name":"桂林医科大学（乐群校区）","bbox":[-1260.9,-725.5,-998.9,-483.5],"polygon":[[-1260.9,-544.4],[-1234.3,-527.2],[-1190.2,-503.5],[-1132.0,-483.5],[-1098.5,-577.0],[-1038.5,-555.9],[-1016.7,-619.2],[-998.9,-677.3],[-1066.8,-725.5],[-1132.0,-664.4]]},{"id":"kuiguang_school","name":"桂林市奎光学校","bbox":[-1477.0,-247.4,-1308.3,-118.3],"polygon":[[-1417.5,-247.4],[-1426.5,-225.2],[-1455.7,-236.8],[-1477.0,-184.1],[-1426.4,-164.0],[-1431.1,-152.1],[-1345.9,-118.3],[-1340.1,-132.6],[-1317.4,-123.6],[-1312.6,-135.5],[-1308.3,-146.2],[-1327.3,-153.7],[-1312.5,-190.3],[-1333.4,-198.6],[-1328.0,-211.8]]},{"id":"guilin_middle","name":"桂林中学解西校区","bbox":[-1375.2,-444.0,-1143.7,-250.4],"polygon":[[-1311.5,-422.3],[-1324.4,-428.4],[-1375.2,-332.9],[-1342.9,-315.9],[-1251.3,-266.5],[-1172.2,-250.4],[-1151.9,-298.3],[-1165.4,-304.5],[-1144.2,-354.6],[-1171.5,-366.2],[-1143.7,-433.6],[-1167.9,-444.0],[-1190.0,-405.5],[-1204.5,-403.8],[-1252.7,-427.1],[-1261.0,-409.6],[-1307.8,-429.8]]},{"id":"libin_middle","name":"桂林市中山中学漓滨校区","bbox":[-608.9,-4.3,-474.6,168.2],"polygon":[[-608.9,150.4],[-505.1,168.2],[-485.0,62.9],[-474.6,8.2],[-578.9,-4.3],[-593.0,68.2]]},{"id":"ronghu_primary","name":"榕湖小学","bbox":[-1232.6,140.4,-1179.9,187.4],"polygon":[[-1179.9,140.4],[-1232.6,140.4],[-1232.6,187.4],[-1179.9,187.4]]},{"id":"minzhu_primary","name":"民主小学","bbox":[-1269.3,1163.7,-1228.9,1198.5],"polygon":[[-1228.9,1163.7],[-1269.3,1163.7],[-1269.3,1198.5],[-1228.9,1198.5]]},{"id":"ningyuan_primary","name":"桂林市宁远小学","bbox":[-1100.6,1647.1,-974.7,1773.5],"polygon":[[-1100.6,1661.2],[-1094.8,1682.9],[-1080.0,1712.4],[-1048.6,1740.3],[-1030.8,1753.8],[-992.0,1767.4],[-974.7,1773.5],[-996.7,1661.3],[-1022.4,1665.4],[-1025.6,1647.1]]},{"id":"peizhi_special","name":"桂林市培智学校","bbox":[-1730.0,1614.1,-1487.5,1755.6],"polygon":[[-1730.0,1619.6],[-1726.2,1702.3],[-1725.1,1719.4],[-1721.6,1722.9],[-1711.9,1725.2],[-1617.7,1721.4],[-1614.7,1740.6],[-1579.4,1740.3],[-1577.7,1754.2],[-1559.6,1755.6],[-1559.0,1748.1],[-1553.4,1747.2],[-1551.1,1715.0],[-1494.2,1726.9],[-1487.5,1717.1],[-1487.8,1705.2],[-1491.8,1684.0],[-1526.6,1681.7],[-1527.8,1659.4],[-1564.2,1657.9],[-1564.8,1614.1]]},{"id":"yixian_high","name":"桂林市逸仙中学","bbox":[-1890.7,1618.3,-1674.8,1869.8],"polygon":[[-1676.7,1767.2],[-1677.5,1765.5],[-1679.4,1734.8],[-1717.5,1734.8],[-1725.9,1732.4],[-1736.2,1732.3],[-1736.5,1704.4],[-1737.1,1697.8],[-1739.1,1637.2],[-1740.8,1633.9],[-1742.4,1632.9],[-1747.4,1632.2],[-1805.1,1634.3],[-1815.6,1633.9],[-1815.7,1631.2],[-1816.8,1629.5],[-1818.3,1624.2],[-1818.8,1618.3],[-1871.7,1624.7],[-1869.3,1692.9],[-1890.4,1695.3],[-1890.5,1734.0],[-1888.7,1734.0],[-1888.4,1734.5],[-1888.6,1745.1],[-1888.9,1745.5],[-1890.6,1745.5],[-1890.7,1781.8],[-1889.8,1781.9],[-1889.5,1782.3],[-1889.7,1790.8],[-1890.7,1791.2],[-1890.7,1806.0],[-1889.4,1805.9],[-1889.1,1806.3],[-1888.8,1814.8],[-1889.1,1815.3],[-1890.7,1815.3],[-1890.7,1820.2],[-1884.3,1820.3],[-1883.8,1869.8],[-1681.0,1866.9],[-1680.6,1865.8],[-1674.8,1865.7]]},{"id":"minzu_middle","name":"桂林市民族中学","bbox":[-1409.0,1255.3,-1256.5,1468.2],"polygon":[[-1409.0,1398.0],[-1348.0,1445.0],[-1332.0,1468.2],[-1276.0,1315.3],[-1266.9,1318.3],[-1256.5,1290.4],[-1296.7,1276.4],[-1355.3,1255.3]]},{"id":"nanxishan_primary","name":"桂林市南溪山小学","bbox":[-2044.0,2267.6,-1914.0,2390.6],"polygon":[[-2026.3,2286.5],[-2027.0,2320.1],[-2043.4,2319.8],[-2044.0,2345.8],[-2013.8,2346.4],[-2014.7,2388.5],[-1916.6,2390.6],[-1914.0,2268.9],[-1974.0,2267.6],[-1974.4,2287.6]]},{"id":"glmu_dongcheng","name":"桂林医科大学（东城校区）","bbox":[566.2,-1705.9,866.3,-1075.3],"polygon":[[866.1,-1250.0],[728.0,-1265.8],[727.9,-1441.7],[768.0,-1447.1],[768.9,-1586.9],[653.6,-1705.9],[639.0,-1691.1],[597.2,-1691.1],[588.7,-1670.4],[580.5,-1632.9],[566.2,-1314.3],[643.0,-1311.1],[654.4,-1276.7],[655.8,-1158.2],[759.7,-1142.3],[866.3,-1075.3]]},{"id":"glut_primary","name":"桂林理工大学附属小学","bbox":[935.4,-441.8,1026.8,-329.5],"polygon":[[961.7,-441.8],[935.4,-350.1],[994.0,-329.5],[1026.8,-418.9]]},{"id":"tianjiabing","name":"桂林市田家炳中学","bbox":[941.9,-1132.3,1223.4,-928.3],"polygon":[[943.8,-1111.6],[941.9,-1031.3],[1080.9,-951.5],[1125.2,-928.3],[1175.1,-1008.7],[1184.4,-1029.4],[1223.4,-1088.2],[1219.6,-1095.7],[1132.3,-1114.4],[1128.4,-1094.7],[1000.3,-1096.1],[1000.7,-1125.6],[947.3,-1132.3]]},{"id":"chenshan_primary","name":"桂林市辰山小学","bbox":[1053.6,-2455.8,1219.8,-2254.2],"polygon":[[1053.6,-2339.5],[1064.0,-2326.4],[1082.7,-2311.3],[1083.3,-2254.2],[1158.7,-2256.7],[1158.9,-2336.7],[1164.7,-2337.0],[1168.7,-2373.7],[1183.4,-2395.2],[1219.8,-2412.7],[1163.0,-2455.8],[1116.6,-2405.4],[1094.6,-2394.0]]},{"id":"lijiang_primary","name":"漓江小学","bbox":[1084.8,11.5,1164.0,99.7],"polygon":[[1084.8,81.4],[1137.6,99.7],[1164.0,31.2],[1117.1,11.5]]},{"id":"longyin_primary","name":"龙隐小学","bbox":[802.0,996.9,980.4,1118.6],"polygon":[[827.3,1053.0],[873.4,1118.6],[934.6,1088.6],[941.6,1094.6],[976.8,1096.8],[980.4,1003.0],[970.2,999.4],[943.5,996.9],[867.9,1013.2],[868.3,1020.6],[854.6,1024.5],[818.7,1027.8],[802.0,1041.0],[816.1,1059.8]]},{"id":"wangcheng_teaching","name":"广西师范大学（王城校区教学内院）","bbox":[-703.6,-640.6,-619.6,-568.6],"polygon":[[-703.6,-640.6],[-619.6,-640.6],[-619.6,-568.6],[-703.6,-568.6]]}] as const

function pointInPolygon(x: number, z: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1]
    const xj = poly[j][0], zj = poly[j][1]
    const intersects = ((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / ((zj - zi) || 1e-12) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

function pointToSegmentDistSq(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax, abz = bz - az
  const lenSq = abx * abx + abz * abz
  if (lenSq <= 1e-12) return (px - ax) ** 2 + (pz - az) ** 2
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / lenSq))
  const cx = ax + abx * t, cz = az + abz * t
  return (px - cx) ** 2 + (pz - cz) ** 2
}

function withinBufferOfPolygon(x: number, z: number, poly: readonly (readonly [number, number])[], bufferM: number): boolean {
  if (bufferM <= 0) return false
  const limSq = bufferM * bufferM
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (pointToSegmentDistSq(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]) <= limSq) return true
  }
  return false
}

function orientation2D(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
}

function onSegment2D(ax: number, az: number, bx: number, bz: number, px: number, pz: number): boolean {
  return (
    px >= Math.min(ax, bx) - 1e-9 &&
    px <= Math.max(ax, bx) + 1e-9 &&
    pz >= Math.min(az, bz) - 1e-9 &&
    pz <= Math.max(az, bz) + 1e-9
  )
}

function segmentsIntersect2D(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const o1 = orientation2D(ax, az, bx, bz, cx, cz)
  const o2 = orientation2D(ax, az, bx, bz, dx, dz)
  const o3 = orientation2D(cx, cz, dx, dz, ax, az)
  const o4 = orientation2D(cx, cz, dx, dz, bx, bz)
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true
  if (Math.abs(o1) <= 1e-9 && onSegment2D(ax, az, bx, bz, cx, cz)) return true
  if (Math.abs(o2) <= 1e-9 && onSegment2D(ax, az, bx, bz, dx, dz)) return true
  if (Math.abs(o3) <= 1e-9 && onSegment2D(cx, cz, dx, dz, ax, az)) return true
  if (Math.abs(o4) <= 1e-9 && onSegment2D(cx, cz, dx, dz, bx, bz)) return true
  return false
}

export function normalizeQuietZones(
  zones: readonly {id: string; name?: string; bbox?: readonly [number, number, number, number]; polygon: readonly (readonly [number, number])[]}[],
): QuietZonePolygon[] {
  const out: QuietZonePolygon[] = []
  for (const zone of zones) {
    if (!zone?.polygon || zone.polygon.length < 3) continue
    let bbox = zone.bbox
    if (!bbox || bbox.length !== 4) {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
      for (const [px, pz] of zone.polygon) {
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (pz < minZ) minZ = pz
        if (pz > maxZ) maxZ = pz
      }
      bbox = [minX, minZ, maxX, maxZ]
    }
    out.push({id: zone.id, name: zone.name ?? zone.id, bbox, polygon: zone.polygon})
  }
  return out
}

export function getQuietZoneAt(
  x: number,
  z: number,
  bufferM = QUIET_ZONE_BUFFER_M,
  zones: readonly QuietZonePolygon[] = QUIET_ZONES,
): QuietZonePolygon | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  const pad = Math.max(0, bufferM)
  for (const zone of zones) {
    const [minX, minZ, maxX, maxZ] = zone.bbox
    if (x < minX - pad || x > maxX + pad || z < minZ - pad || z > maxZ + pad) continue
    if (pointInPolygon(x, z, zone.polygon) || withinBufferOfPolygon(x, z, zone.polygon, pad)) {
      return zone
    }
  }
  return null
}

export function isPointInQuietZone(
  x: number,
  z: number,
  bufferM = QUIET_ZONE_BUFFER_M,
  zones: readonly QuietZonePolygon[] = QUIET_ZONES,
): boolean {
  return getQuietZoneAt(x, z, bufferM, zones) !== null
}

export function segmentHitsQuietZone(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  bufferM = QUIET_ZONE_BUFFER_M,
  zones: readonly QuietZonePolygon[] = QUIET_ZONES,
): boolean {
  if (!zones.length || !Number.isFinite(ax) || !Number.isFinite(az) || !Number.isFinite(bx) || !Number.isFinite(bz)) {
    return false
  }
  const pad = Math.max(0, bufferM)
  const segMinX = ax < bx ? ax : bx
  const segMaxX = ax > bx ? ax : bx
  const segMinZ = az < bz ? az : bz
  const segMaxZ = az > bz ? az : bz
  const len = Math.hypot(bx - ax, bz - az)
  const steps = Math.max(2, Math.ceil(len / 4))
  for (const zone of zones) {
    const [minX, minZ, maxX, maxZ] = zone.bbox
    if (segMaxX < minX - pad || segMinX > maxX + pad || segMaxZ < minZ - pad || segMinZ > maxZ + pad) continue
    const poly = zone.polygon
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const px = ax + (bx - ax) * t
      const pz = az + (bz - az) * t
      if (pointInPolygon(px, pz, poly) || withinBufferOfPolygon(px, pz, poly, pad)) return true
    }
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (segmentsIntersect2D(ax, az, bx, bz, poly[j][0], poly[j][1], poly[i][0], poly[i][1])) return true
    }
  }
  return false
}

// Stage 1B compatibility aliases (IDOK-123)
export const QUIET_BUFFER_METERS = QUIET_ZONE_BUFFER_M
export const findQuietZoneAt = getQuietZoneAt
export const isPointInQuietZones = isPointInQuietZone
