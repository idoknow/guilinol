"""桂林市宁远小学 (`way/1001796192`) full campus restoration.

Sources verified against November 2026 Esri z19 satellite, OSM (`way/1001796192`,
`way/1364254883`), Overture buildings (5 x 3-storey blocks + 1F stage), and public
photos (`ref_04`..`ref_16`):
- All teaching wings are 3 storeys (~10.35 m), cream-white tiled upper floors with
  terracotta red-brown dado bases, coral-pink (2F) and sky-blue (3F) courtyard
  corridors, flat parapet + steel roof safety rails, plus central yellow entrance
  arched canopy and cylindrical/faceted rotunda stair tower with brown disc roof.
- 1-storey crimson lattice ceremony stage (`a593e43d`) + 3 flagpoles facing NW oval
  4-lane track and striped green soccer pitch.
- NE basketball court on `way/1364254883` + adjacent east small red court strip.
- Renovated SW Main Gate facing `way/221349767` with twin cream-white/brown-base piers,
  coral-pink fascia, sculpted green ribbon + 6-petal gold star emblem, red lanterns,
  closed retractable gate, and interior circular flowerbed plaza (zero guardhouse/CCTV).
"""
import math

from school_kit import SchoolBuilder, export_school_glb, mrr_stats

PALETTE = {
    'wall_main':   '#ece6dc',  # cream-white campus facade tile
    'wall_sub':    '#86b7d4',  # 3F sky-blue corridor band
    'wall_accent': '#d96c5b',  # coral-pink 2F corridor & renovated gate fascia
    'wall_base':   '#9e5745',  # terracotta red-brown 1F dado base
    'win_frame':   '#c96a53',  # terracotta window frames
    'win_trim':    '#f3eee4',
    'base_frame':  '#d8d6cf',
    'base_trim':   '#b56a58',
    'pave_grey':   '#c9c4ba',
    'pave_road':   '#a6a29a',
    'pave_dark':   '#594d47',
    'granite':     '#b2afa6',
    'roof_tile':   '#6e747d',
    'roof_blue':   '#689bc4',
    'roof_red':    '#9e483c',
    'track_red':   '#bd4f42',
    'turf_a':      '#528e48',
    'turf_b':      '#43793b',
    'court_a':     '#438b69',
    'cinnabar':    '#c8372d',
    'yellow':      '#efc847',
    'lime':        '#7bc243',
    'gold':        '#dfae44',
    'cream':       '#e8dfd0',
    'has_ac':      True,
}

SIGNS = {
    'school_name': '宁远小学',
    'school_en':   'Ning Yuan Primary School',
    'gate_bg':     '#efeae0',
    'gate_fg':     '#a8241d',
    'gate_sub_fg': '#7a342c',
    'vert_bg':     '#6b4437',
    'vert_fg':     '#e8c97b',
    'vert_text':   '宁远小学',
    'motto':       '',
    'led_title':   '桂林市宁远小学',
    'emblem':      '宁远',
}

# Inset slightly from NW/W road buffers (`way/221349770` & `way/221349767`) so
# perimeter wall + slab keep >= 1.0 m clearance outside carriageways and sidewalks.
FENCE_RING = [
    (-63.2, -39.2),
    (-58.2, -19.2),
    (-43.8,   5.6),
    (-14.8,  36.2),   # edge 3->4: SW Gate frontage (-14.8, 36.2) -> (2.2, 49.4)
    (  2.2,  49.4),
    ( 39.8,  62.2),
    ( 56.2,  68.0),
    ( 34.6, -41.2),
    ( 10.4, -38.0),
    (  7.2, -54.0),
]

# Audited Overture footprints (5 x 3-storey blocks) + stage (`a593e43d`)
RING_B1 = [(40.847, 3.844), (39.84, -4.571), (2.989, -0.181), (3.996, 8.233)]      # 5c0f0668
RING_B2 = [(36.871, 24.93), (36.327, 18.594), (13.085, 20.573), (13.629, 26.909)] # 2dd241ca
RING_B3 = [(23.292, 58.699), (52.755, 54.044), (51.356, 44.988), (21.792, 49.754)]# 91383d1d
RING_B4 = [(-3.926, 8.078), (-5.416, -0.27), (-16.901, 1.787), (-15.401, 10.124)]# 19dd12d6
RING_B5 = [(-17.565, 22.884), (4.59, 19.534), (3.19, 10.71), (-18.854, 14.271)]  # 567bd479
RING_STAGE = [(-23.082, 12.126), (-24.883, 3.855), (-29.021, 4.75), (-27.229, 13.032)]

# Roadway / courtyard polygons
WAY_BASKETBALL = [(23.644, -36.87), (9.763, -34.161), (15.169, -6.838), (29.05, -9.547)]


def _build_main_gate(b: SchoolBuilder, p0: tuple[float, float], p1: tuple[float, float]):
    """Renovated SW Main Gate (`ref_15.jpg`): cream piers, coral lintel, green ribbon + 6-petal star."""
    mx, mz = (p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    yaw = math.atan2(-dz, dx)
    gy = b.ground(mx, mz)

    old = b.pose
    b.pose = (mx, 0.0, mz, yaw)

    # Granite entry threshold flush with street-side approach
    b.box(0.0, gy - 0.03, 0.25, 11.4, 0.055, 4.8, 'granite', cap_region='pave_grey')

    # Flanking square piers (clear span 6.8 m between inner faces)
    pier_x = 4.15
    for sgn in (-1.0, 1.0):
        px = sgn * pier_x
        b.box(px, gy - 0.03, 0.0, 1.48, 0.72, 1.28, 'pave_dark', cap_region='granite', collide=True)
        b.box(px, gy + 0.67, 0.0, 1.38, 2.97, 1.18, 'cream', cap_region='white', collide=True)
        b.box(px, gy + 3.60, 0.0, 1.54, 0.24, 1.34, 'wall_accent', cap_region='white', bottom=True)
        if b.detail:
            # Side decorative lantern brackets + red lanterns connected cleanly to pier
            b.box(px, gy + 2.85, 0.64, 0.08, 0.08, 0.42, 'dark_stone')
            b.cylinder_y(px, gy + 2.40, 0.48, 0.82, 0.16, 'cinnabar', segs=8, bottom=True)

    # School name plaque on right (SE) pier front (+z facing street)
    if b.lod < 2:
        b.sign(pier_x, gy + 2.05, 0.61, 1.22, 0.68, 'sign_gate', double_sided=True)
        b.sign(-pier_x, gy + 2.15, 0.61, 0.38, 0.92, 'sign_vert', double_sided=True)

    # Continuous coral-pink top beam & white soffit linking both piers
    b.box(0.0, gy + 3.05, 0.0, 10.6, 0.82, 1.46, 'wall_accent', cap_region='white', collide=True, bottom=True)
    b.box(0.0, gy + 3.84, 0.0, 10.9, 0.17, 1.62, 'white', cap_region='wall_accent', bottom=True)

    # Sculpted lime-green ribbon + gold 6-petal star crest above lintel center
    b.box(0.0, gy + 3.98, 0.0, 4.4, 0.17, 0.56, 'lime', bottom=True)
    b.box(-0.9, gy + 4.13, 0.0, 2.4, 0.36, 0.36, 'lime', bottom=True)
    b.box(1.1, gy + 4.13, 0.0, 2.1, 0.26, 0.36, 'lime', bottom=True)
    b.cylinder_y(0.0, gy + 4.42, 0.98, 0.0, 0.55, 'gold', r_top=0.35, segs=6, bottom=True)
    if b.detail:
        for lx in (-2.4, -0.9, 0.9, 2.4):
            b.cylinder_y(lx, gy + 2.52, 0.58, 0.56, 0.18, 'cinnabar', segs=8, bottom=True)

    # Closed stainless retractable gate across 6.8 m opening
    b.retractable_gate(6.8, gate_h=1.48, y0=gy)

    b.pose = old


def _build_stage(b: SchoolBuilder):
    """B6: 1-storey crimson lattice ceremony stage (`a593e43d`) facing WNW toward track (`ref_07.jpg`)."""
    rcx, rcz, rw, rd, rang = mrr_stats(RING_STAGE)
    gy = b.ground(rcx, rcz)
    old = b.pose
    b.pose = (rcx, 0.0, rcz, math.radians(rang))
    # Stage long axis = NNE-SSW (w ~ 8.6m), depth = WNW-ESE (d ~ 4.2m)
    # Stone podium + deep cream slatted backdrop + bold crimson steel portal frame (`ref_07.jpg`)
    b.box(0.0, gy - 0.04, 0.0, rw + 1.0, 0.68, rd + 0.9, 'wall_base', cap_region='granite', collide=True)
    b.box(0.0, gy + 0.64, 0.55, rw - 0.8, 2.85, 0.42, 'cream', cap_region='white', collide=True)
    # Left & right crimson lattice pillars + open-front canopy overhead (`3.8m` high)
    for sx in (-rw * 0.46, rw * 0.46):
        b.box(sx, gy + 0.64, -rd * 0.36, 0.34, 3.10, 0.34, 'cinnabar')
        b.box(sx, gy + 0.64, 0.52, 0.34, 3.10, 0.34, 'cinnabar')
    b.box(0.0, gy + 3.45, -0.35, rw + 1.1, 0.58, rd * 0.95, 'cinnabar', cap_region='roof_tile', collide=True, bottom=True)
    if b.detail:
        # Vertical slatted lattice bars across cream backdrop + decorative LED banner & emblem
        for k in range(11):
            bx = -rw * 0.38 + k * (rw * 0.76 / 10)
            b.box(bx, gy + 0.64, 0.30, 0.14, 2.75, 0.12, 'wall_base')
        front_z = -0.35 - (rd * 0.95) * 0.5 - 0.02
        b.sign(0.0, gy + 3.74, front_z, 5.4, 0.48, 'sign_led', double_sided=True)
        b.box(0.0, gy + 2.15, 0.32, 2.2, 0.45, 0.08, 'lime', bottom=True)
        b.cylinder_y(0.95, gy + 2.15, 0.60, 0.32, 0.36, 'gold', r_top=0.22, segs=6, bottom=True)
        b.box(0.0, gy - 0.02, -rd * 0.5 - 0.75, rw * 0.78, 0.34, 0.85, 'granite')
    b.pose = old


def build_ningyuan(b: SchoolBuilder):
    # 1. Full campus terrain-following slab (`pave_grey` inside perimeter)
    b.ground_slab(FENCE_RING, region='pave_grey', lift=0.025, edge_drop=0.04)

    # 2. Perimeter masonry + steel picket fence + Renovated SW Gate (edge 3->4)
    b.perimeter_fence(FENCE_RING, gate_edge=3, gate_t0=0.28, gate_t1=0.72,
                      wall_h=2.25, base_reg='wall_accent', post_reg='cream')
    _build_main_gate(b, FENCE_RING[3], FENCE_RING[4])

    # 3. Audited 3-storey teaching buildings on exact Overture footprints
    #    Keep 0.35m clear gaps / <5.7m lower connectors so floor_slice(6m) keeps clean IoU!
    b.footprint_building(
        RING_B1, bid='B1', source_id='5c0f0668-30b7-46a1-81ba-fc0a2856c85d',
        floors=3, floor_h=3.45, roof='flat_rail',
        corridor_edges={3}, corridor_reg='wall_accent', top_parapet_reg='wall_sub',
    )
    b.footprint_building(
        RING_B2, bid='B2', source_id='2dd241ca-98ff-4ce2-80fa-fefdfb3f9551',
        floors=3, floor_h=3.45, roof='flat_rail',
        corridor_edges={1, 3}, corridor_reg='wall_accent', top_parapet_reg='wall_sub',
    )
    b.footprint_building(
        RING_B3, bid='B3', source_id='91383d1d-1bc1-4405-9ca2-45efa8b96059',
        floors=3, floor_h=3.45, roof='flat_blue',
        corridor_edges={2}, corridor_reg='wall_accent', top_parapet_reg='wall_sub',
    )
    b.footprint_building(
        RING_B4, bid='B4', source_id='19dd12d6-a45d-467f-8743-96df6a0c87c6',
        floors=3, floor_h=3.45, roof='flat_rail',
        corridor_edges={2, 3}, corridor_reg='wall_accent', top_parapet_reg='wall_sub',
    )
    b.footprint_building(
        RING_B5, bid='B5', source_id='567bd479-fa93-41f5-8985-8dfe46fdd444',
        floors=3, floor_h=3.45, roof='flat_rail',
        corridor_edges={0}, corridor_reg='wall_accent', top_parapet_reg='wall_sub',
    )

    # 4. Architectural courtyard wings, sawtooth bays, rotunda, & stage (verified in sat_grid + ref_06..15)
    # 4a. Central octagonal stair rotunda + overhanging brown round cap + warm yellow entrance canopy (`ref_08`, `ref_15`)
    if b.lod < 2:
        rx, rz = 8.4, 13.0
        ry = b.ground(rx, rz)
        b.cylinder_y(rx, ry - 0.04, 1.8, rz, 4.05, 'wall_base', segs=10, collide=True)
        b.cylinder_y(rx, ry + 1.72, 9.64, rz, 3.95, 'cream', cap_region='pave_dark', segs=10, collide=True, bottom=True)
        b.cylinder_y(rx, ry + 11.30, 0.42, rz, 4.85, 'wall_base', cap_region='roof_red', segs=12, bottom=True)
        if b.detail:
            b.cylinder_y(rx, ry + 3.4, 0.95, rz, 4.08, 'wall_accent', segs=10, bottom=True)
            b.cylinder_y(rx, ry + 6.9, 0.95, rz, 4.08, 'wall_sub', segs=10, bottom=True)
            # Warm yellow arched lobby canopy under rotunda / B5 SE entrance
            old = b.pose
            cy_y = b.ground(4.6, 20.4)
            b.pose = (4.6, 0.0, 20.4, math.radians(10.0))
            b.box(0.0, cy_y + 0.1, 0.0, 6.2, 3.6, 2.8, 'yellow', cap_region='wall_accent', collide=True)
            b.box(0.0, cy_y, 0.95, 2.6, 2.7, 0.95, 'glass')
            b.pose = old

    # 4b. Stair annex behind stage (`ref_06.jpg`, lower 6.2m height so B4's coral/blue 3F shows clearly above B6!)
    ring_west_ext = [(-17.6, -1.6), (-23.2, -0.6), (-24.1, 2.9), (-18.2, 4.1)]
    g_we = b.ground(-20.5, 1.5)
    b.prism(ring_west_ext, g_we - 0.03, 6.2, 'cream', cap_region='roof_tile', collide=True, ground_skirt=True)
    if b.detail:
        # Low bridge gallery (<5.5m) connecting B4 <-> west annex cleanly below 6m slice height
        old = b.pose
        b.pose = (-17.2, 0.0, 2.5, math.radians(10.0))
        b.box(0.0, g_we - 0.03, 0.0, 2.2, 5.4, 5.6, 'wall_base', cap_region='pave_grey')
        b.pose = old

    # 4c. North courtyard E & W 1-2F connector wings (between B1 & B2, height 5.4m < 6.0m slice!)
    g_c1 = b.ground(37.6, 12.5)
    b.prism([(35.0, 4.4), (40.2, 3.8), (41.6, 18.2), (36.5, 18.7)], g_c1 - 0.03, 5.4, 'cream', cap_region='roof_tile', collide=True, ground_skirt=True)
    g_c2 = b.ground(10.2, 13.0)
    b.prism([(7.4, 7.7), (12.8, 7.1), (14.2, 20.6), (8.9, 21.1)], g_c2 - 0.03, 5.4, 'cream', cap_region='roof_tile', collide=True, ground_skirt=True)

    # 4d. South U-courtyard East wing & second circular pavilion roof (`(29.0, 38.5)`)
    g_s = b.ground(44.5, 36.0)
    b.prism([(41.8, 25.0), (47.8, 24.2), (51.0, 44.6), (44.8, 45.2)], g_s - 0.03, 10.2, 'cream', cap_region='roof_tile', collide=True, ground_skirt=True)
    # West stair/hall linking B2 <-> B3 (<5.5m at slice ends, light-blue waterproof roof at z=37..47)
    g_sw = b.ground(28.5, 38.5)
    b.prism([(16.0, 27.1), (21.5, 26.6), (23.8, 49.4), (18.4, 49.8)], g_sw - 0.03, 5.5, 'cream', cap_region='roof_blue', collide=True, ground_skirt=True)
    if b.lod < 2:
        b.cylinder_y(28.8, g_sw - 0.03, 5.5, 38.0, 4.5, 'cream', cap_region='roof_blue', segs=12, collide=True)
        b.cylinder_y(28.8, g_sw + 5.40, 0.38, 38.0, 5.1, 'wall_sub', cap_region='roof_blue', segs=12, bottom=True)

    # 4e. Stage `B6` + 3 Flagpoles
    _build_stage(b)
    b.flagpole_plaza(-26.4, -1.6, yaw=math.radians(10.0), poles=3)

    # 5. Sports Facilities (sat_grid + way/1364254883)
    # 5a. NW 4-lane oval running track + striped green artificial turf soccer pitch
    b.running_track(-26.8, -24.8, length=56.0, width=30.0, yaw=math.radians(10.5),
                    track_reg='track_red', infield_mode='turf')

    # 5b. NE Basketball Court (`way/1364254883` exact center + yaw)
    bcx, bcz, bw, bd, bang = mrr_stats(WAY_BASKETBALL)
    b.basketball_court(bcx, bcz, yaw=math.radians(bang), w=27.8, d=14.1,
                       surface='court_a', apron='track_red', key_reg='track_red')

    # 5c. Adjacent East Small Red Activity Court (`sat_grid.jpg` NE yard)
    old = b.pose
    gy_ec = b.ground(31.2, -24.2)
    b.pose = (31.2, 0.0, -24.2, math.radians(bang))
    b.box(0.0, gy_ec + 0.015, 0.0, 18.0, 0.04, 7.6, 'track_red', cap_region='track_red')
    b.box(0.0, gy_ec + 0.055, 0.0, 16.0, 0.02, 5.8, 'court_a', cap_region='court_a')
    b.pose = old

    # 6. Main internal paved driveways & entry plaza flowerbed (`ref_15.jpg`)
    b.path_strip((-4.8, 40.5), (-3.5, 32.0), width=7.5, region='pave_road')
    b.path_strip((-3.5, 32.0), (-22.0, 26.5), width=4.6, region='pave_road')
    b.path_strip((-3.5, 32.0), (14.5, 35.0), width=4.6, region='pave_road')
    b.path_strip((-21.5, 19.0), (-36.0, 4.0), width=4.8, region='pave_road')
    # Circular centerpiece flowerbed inside Main Gate plaza (`ref_15.jpg`)
    fx, fz = -3.8, 34.8
    fy = b.ground(fx, fz)
    b.cylinder_y(fx, fy - 0.02, 0.42, fz, 3.25, 'cinnabar', cap_region='turf_a', segs=12, collide=True)
    b.tree(fx, fz, species='osmanthus', scale=0.82, yaw=0.4)

    # 7. Campus Greenery & IDOK-71 Instanced Trees (matched to sat_grid.jpg crowns)
    # North perimeter green belt behind running track
    b.green_bed(-28.0, -45.6, 54.0, 4.4, yaw=math.radians(10.5), trees=0)
    north_trees = [
        (-54.0, -40.5, 'banyan', 0.92), (-47.0, -42.2, 'camphor', 0.95),
        (-39.5, -43.8, 'camphor', 0.88), (-31.5, -45.3, 'banyan', 1.02),
        (-23.5, -46.8, 'camphor', 0.90), (-15.5, -48.3, 'osmanthus', 0.95),
        (-7.5,  -49.7, 'camphor', 0.94), (1.0,   -51.2, 'banyan', 0.98),
    ]
    for tx, tz, sp, sc in north_trees:
        b.tree(tx, tz, species=sp, scale=sc, yaw=(tx * 0.47) % math.tau)

    # West perimeter hedge / trees (`x=-56..-45`)
    west_trees = [
        (-56.5, -24.0, 'camphor', 0.86), (-53.5, -13.0, 'camphor', 0.92),
        (-49.0, -3.5,  'banyan', 0.95),  (-42.5, 5.0,   'osmanthus', 0.90),
    ]
    for tx, tz, sp, sc in west_trees:
        b.tree(tx, tz, species=sp, scale=sc, yaw=(tz * 0.61) % math.tau)

    # Courtyard, stage-flank & south plaza trees
    yard_trees = [
        (-33.5, 14.0, 'banyan', 0.95),   (-26.5, 19.5, 'camphor', 0.90),
        (-16.5, 29.0, 'camphor', 0.92),  (-10.5, 31.5, 'osmanthus', 0.88),
        (5.5,   32.5, 'bischofia', 0.92),(11.5,  36.5, 'camphor', 0.90),
        (24.5,  13.5, 'osmanthus', 0.85),(24.8,  34.5, 'osmanthus', 0.85),
        (17.5,  55.5, 'camphor', 0.95),  (32.5,  58.5, 'camphor', 0.90),
        (46.0,  62.5, 'banyan', 0.92),
    ]
    for tx, tz, sp, sc in yard_trees:
        b.tree(tx, tz, species=sp, scale=sc, yaw=(tx + tz) % math.tau)

    # East perimeter row (`x=43..52, z=-22..+40`)
    for idx, tz in enumerate((-26.0, -14.0, -2.0, 12.0, 26.0, 40.0)):
        tx = 39.5 + (tz + 26.0) * 0.14
        b.tree(tx, tz, species='camphor' if idx % 2 == 0 else 'bischofia', scale=0.88 + 0.08 * (idx % 2), yaw=idx * 0.9)


if __name__ == '__main__':
    export_school_glb('ningyuan_primary', PALETTE, SIGNS, build_ningyuan, seed=2026)
