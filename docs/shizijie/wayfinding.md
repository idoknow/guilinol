# 十字街 B1 天花板吊挂导视牌（wayfinding）v1

The code lives in `web/src/shizijie/wayfinding/`:

- `graph.ts` builds the corridor graph.
- `index.ts` generates the signs and runs the sign-following simulation.
- `wayfinding.test.mjs` holds the acceptance tests.

The module is pure functions. It does not depend on three.js. It is the single source of data for every ceiling-hung sign in B1:

- Carbon renders the signs from it.
- Hy2 generates the sign-atlas text from it.
- Neon's verify script reuses `followSigns` for acceptance.

Nobody may hard-code sign text or positions anywhere else.

## Usage

```ts
import { SHIZIJIE_B1_LAYOUT } from '../layout/index.ts'
import { buildSzjWayfinding } from '../wayfinding/index.ts'

const wf = buildSzjWayfinding(SHIZIJIE_B1_LAYOUT)
for (const sign of wf.signs) {
  // Lightbox centre (sign.x, bottomY + height/2, sign.z), size width × height × depth.
  // Two suspension rods at local x = ±rodX, running from the top of the lightbox up to rodTopY (the ceiling).
  // faces[0] / faces[1]: on a PlaneGeometry (default normal +Z), set rotation.y = face.yaw and the face points at the reader.
  // face.rows[i].text example: "← NW出口 南方大厦 25m".
  // Structured fields (glyph / code / name / en / shownM) are also available for typesetting.
}
```

The result is deterministic: the same layout always produces bit-identical output.

The current layout (`shizijie-b1.layout.json`) yields:

- 68 nodes, 52 corridor sections, 23 junctions.
- 95 signs: 48 junction signs, 25 run signs, 22 vestibule signs.

## Building the graph (`buildSzjCorridorGraph`)

The graph is built from the corridor polylines:

1. Each segment of each corridor's `points` polyline becomes an edge.
2. Where two segments truly cross, both are split at the crossing and joined there.
3. Where a polyline endpoint lies within `snapTol = 0.6m` of another segment, it counts as a T-junction. The other segment is split at that point.
4. Points within `mergeTol = 0.4m` of each other are merged into one node.
5. The landing points of the 4 stairs, `getStairwell(id).footIndoor` from the contract, are snapped into the graph as exit nodes. Each exit node's coordinates equal the contract's landing point exactly, with error < 1e-9.

Terms used below:

- **Junction (decision node)**: a node of degree ≥ 3.
- **Terminal**: a node of degree ≠ 2, or an exit node.
- **Corridor section (chain)**: the corridor between two terminals, passing only through degree-2 nodes.

## Placing signs (`SZJ_SIGN_SPEC`)

Signs are placed under four rules:

- **Junction signs.** Every incoming corridor at a junction gets a sign `approachM = 3m` before the junction. A section with junctions at both ends that is shorter than `2·approachM + minGapM = 8.5m` gets a single sign at its midpoint instead. That sign's two faces describe the turns at the two junctions.
- **Run signs.** Signs along a corridor are at most `maxSpacingM = 15m` apart. At a dead end or an exit, the nearest sign is at most `endGapM = 7.5m` away.
- **Merging.** Two signs on the same section closer than `minGapM = 2.5m` are merged. Signs on different corridors are never merged, so that every incoming direction keeps its sign.
- **Keep-out.** No sign may sit inside a stairwell footprint plus a 0.5m margin. The ceiling above a stairwell is open.

Signs within 6m of an exit landing point are labelled `vestibule`.

Sign geometry:

| Item | Value |
|---|---|
| Bottom edge above floor | `bottomY = 2.3m` |
| Sign height | `min(0.58, 0.30 + 0.14 × rows, ceiling − 0.12 − bottomY)`, using the face with more rows (0.44–0.58m in current layout, `topY ≤ 2.88m` clearing `2.922m+` ceiling baffles & luminaires) |
| Clearance to ceiling | ≥ 0.12m (ceiling 3.15m) |
| Sign width | `min(2.8, corridor width − 0.8)`, at least 1.2m (2.0–2.8m in the current layout) |
| Lightbox depth | `0.1m` |
| Rod positions | `rodX = width/2 × 0.8` |

## Face content

Each sign has two faces, one for each direction of travel. For a sign at offset `s` on a section, a reader heading toward B uses face `side = +1`, and a reader heading toward A uses face `side = −1`.

For each exit x:

1. Compute the route distance going via A, `s + D_A(x)`, and via B, `L − s + D_B(x)`. The exit goes on the face whose direction gives the shorter distance.
2. **Arrow**: the turn at the next terminal in that direction. It is the signed angle between the arrival heading and the shortest-path departure heading. Both headings are measured 3m along the corridor from the node, so very short segments do not add noise. A right turn is positive. The angle is bucketed into 8 arrows:

   | Angle | Arrow |
   |---|---|
   | ±22.5° | `straight` ↑ |
   | ±67.5° | `slight-*` ↗↖ |
   | ±135° | `left/right` ←→ |
   | beyond 135° | `sharp-*` ↘↙ |

   If the next terminal is the exit itself, the arrow is `straight`.
3. **Distance**: the shortest-path total length. The face shows it rounded to the nearest 5m, never less than 5m.
4. Rows are sorted by distance, nearest first.

If a face has no exit ahead, for example a face pointing into a dead end, it gets one row with `back ↓（掉头）` pointing to the nearest exit behind. No face is ever blank.

Exit names on the signs (`SZJ_EXIT_NAMES`):

| Exit | Chinese | English |
|---|---|---|
| NW | 南方大厦 | Nanfang Bldg |
| NE | 解放东路 | Jiefang Rd E |
| SE | 文化大厦 | Culture Bldg |
| SW | 微笑堂 | Niko Niko Do |

Hy2 may adjust the copy to match reality-spec, but only by changing `SZJ_EXIT_NAMES`.

## Sign-following simulation (`followSigns`)

The simulation walks the way a real person would. It does not read the shortest-path table.

1. From the start point, walk along the corridors to the nearest sign.
2. Read both faces and find the row for the target exit, skipping `back` rows.
3. Walk along the corridor in that face's direction. Re-read every sign passed on the way.
4. On reaching a terminal:
   - If it is the target exit, the walk succeeds.
   - If it is a junction, pick the exit corridor whose heading is closest to the arrow's centre angle. More than 67.5° off fails with `no-match`.
5. After passing a junction, the old instruction is void. Reaching another junction without having seen a new sign fails with `no-sign`. The simulation never guesses.
6. Reading the same face of the same sign twice fails with `loop`.

`maxDistanceToNearestSign` computes the exact maximum along-corridor distance from any point on the corridor network to the nearest sign. It uses a multi-source Dijkstra plus the peak within each piecewise-linear interval.

## Acceptance (`node --test web/src/shizijie/wayfinding/*.test.mjs`)

| Test | Result |
|---|---|
| Layout valid; graph connected; 4 exit nodes equal the contract landing points | pass |
| 200 random points × 4 exits by sign-following | 800/800 arrived, 0 loops |
| Every sign × every face × 4 exits, exhaustive | all arrived |
| Average detour ratio of sign-following vs shortest path (≤ 1.25) | 1.062 |
| Max along-corridor distance to nearest sign (≤ 15m) | 7.50m |
| Every incoming direction at every junction has a sign within the required distance | pass |
| Geometry: sign bottom 2.3m, rods reach ceiling, outside stairwells, within bounds, 1–4 rows per face, normals point at reader, both faces together cover all 4 exits | pass |
| Determinism | pass |

Negative check: the simulation is not trivially passing.

- With every arrow flipped, 298 runs failed with `loop` and 70 with `no-match`.
- With one junction sign flipped, 145 of 192 runs detoured or failed. The detour-ratio test catches this.

## Notes for consumers

- **Carbon:** the old wall-plaque wayfinding signs should be removed. Keep the green safety-exit signs. All 95 signs can be drawn with InstancedMesh: one batch of lightboxes, one batch of rods, one atlas material for the faces.
- **Hy2:** atlas slots can be generated from the set of `row.text` values. Each face has at most 4 rows and each row has a fixed layout (`glyph` + `code出口` + `name` + `shownM`), so the atlas can be split per row and reused.
- **Neon:** verify can call `followSigns` on the in-scene sign data to check that it matches this module's output.
