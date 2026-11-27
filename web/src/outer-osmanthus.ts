// 解放东路 / 中山中路人行道外沿那排方形抬高树池桂花（pipeline `doubleRowSidewalkOsmanthus`）
// 与城建 v1+ 的门头、雨棚、刀旗、围墙挤在同一条临街带，2026-11-26 判定为错树。
// pipeline 配置已置空；已烘焙的世界数据重烘焙前，加载时剔除这排树和它的树池；绿化分隔带的行道树不受影响。
// 折线取自 public/world/atlas.bin（两条路各向车行道中心线，单位米，x 东 z 南）。
const ROADS: readonly (readonly number[])[] = [
  [-299,-10,-507,-79,-872,-168],
  [-836,-150,-511,-70,-303,1],
  [-893,-112,-876,-159],
  [-907,-116,-1018,248],
  [-1018,248,-1030,278,-1050,314],
  [-1039,323,-1029,308,-1005,253,-893,-112],
  [-1083,360,-1208,509,-1246,547],
  [-1242,560,-1198,518,-1072,369],
  [-1586,894,-1540,856,-1507,823,-1351,656,-1242,560],
  [-1251,551,-1359,644,-1516,814,-1550,847,-1594,886],
  [-646,-881,-665,-867,-715,-855,-731,-848,-746,-839,-759,-816,-764,-797,-829,-393,-875,-213],
  [-876,-159,-860,-209,-817,-377,-748,-812,-739,-830,-726,-839,-711,-844,-673,-852,-660,-857,-649,-863,-638,-874],
  [-875,-213,-887,-171],
]
// 实测：分隔带树离中心线 5.5–8.5 m，外沿桂花 10.5–13.5 m。
const BAND: readonly [number, number] = [9.5, 14.5]
const BOX = [-1594 - BAND[1], -881 - BAND[1], -299 + BAND[1], 894 + BAND[1]] as const

function nearest(x: number, z: number) {
  let best = Infinity, heading = 0
  for (const path of ROADS) {
    for (let i = 0; i + 3 < path.length; i += 2) {
      const ax = path[i], az = path[i + 1], dx = path[i + 2] - ax, dz = path[i + 3] - az, norm = dx * dx + dz * dz
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / norm))
      const d = Math.hypot(x - ax - t * dx, z - az - t * dz)
      if (d < best) { best = d; heading = Math.atan2(dz, dx) }
    }
  }
  return {distance: best, heading}
}

const inBox = (x: number, z: number) => x >= BOX[0] && z >= BOX[1] && x <= BOX[2] && z <= BOX[3]

/** 外沿桂花：kind 2、烘焙缩放 92–106、离中心线落在外沿带内。 */
export function isOuterOsmanthus(x: number, z: number, kind: number, scalePercent: number) {
  if (kind !== 2 || scalePercent < 92 || scalePercent > 106 || !inBox(x, z)) return false
  const {distance} = nearest(x, z)
  return distance >= BAND[0] && distance <= BAND[1]
}

/** 外沿桂花的方形树池：与路平行、落在外沿带内（横街树池方向垂直，不受影响）。 */
export function isOuterOsmanthusBed(x: number, z: number, headingRad: number) {
  if (!inBox(x, z)) return false
  const {distance, heading} = nearest(x, z)
  return distance >= BAND[0] && distance <= BAND[1] && Math.abs(Math.cos(headingRad - heading)) > .9
}
