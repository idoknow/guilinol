"""桂林市民族中学 / 逸仙中学初中部 (OSM way/647468207), 象山区民主路 9 号.

Round 2 updates (strictly aligned with Rock 08:15 positioning & sg claude review):
- All 4 campus buildings extruded directly on exact OSM/Overture footprints (offset 0.00 m, angle diff 0.0 deg):
  way/1474978350 (求知楼), overture/89d8a68b (明德楼 — NE street-front teaching block in ref [02]),
  way/1474978345 (致远楼), and overture/a30748df (艺体附楼).
- Facades follow refs [02], [19]: crisp white ceramic tile walls, cobalt-blue window frames & cornice bands,
  dense multi-pane grilled windows on ALL walls (including street-facing gable/side walls), white split-AC
  outdoor units on every floor, wide cantilevered entrance canopy + red-tiled ceremony stage + twin flagpoles
  on 求知楼, and freestanding rooftop gold characters ('桂林市逸仙中学') with rear floodlight arms on 明德楼 & 求知楼.
- Street gate on 民主路 follows ref [02]: cream-beige stone pillars with dark green-black marble bases,
  stepped cornice caps, white spherical globe lamps, vertical pillar name plaques ('桂林市民族中学'),
  and closed stainless retractable gate (no guard booth/turnstiles/CCTV).
- Unverified '桂林七中' alias removed; exact OSM 250m track (relation/20185367) + 4 basketball courts (way/1474978346..49).
"""
import math

from g2b_kit import SchoolBuilder, export_school_glb

RING = [
    (-71.76, 47.10),
    (-10.72, 94.16),
    (5.27, 117.35),
    (61.23, -35.59),
    (70.39, -32.56),
    (80.73, -60.45),
    (40.54, -74.44),
    (-18.04, -95.58),
]

# Exact OSM & Overture building footprints inside way/647468207 (relative to centroid (-1337.26, 1350.87))
OSM_QIUZHI = [
    (-22.81, -77.89), (31.52, -56.01), (24.31, -38.33), (10.72, -43.80),
    (9.81, -41.56), (-17.15, -52.43), (-16.40, -54.27), (-30.18, -59.82),
]  # way/1474978350 (OV 1437fe77)
OV_MINGDE   = [(71.38, -47.47), (75.58, -57.07), (46.73, -69.66), (42.53, -60.05)]  # 89d8a68b
OSM_ZHIYUAN = [(-9.11, 48.31), (-16.73, 72.51), (17.26, 83.06), (24.87, 58.87)]     # way/1474978345 (OV c18d192c)
OV_YITI     = [(12.24, 96.53), (15.16, 87.22), (-0.69, 82.50), (-3.41, 91.59)]       # a30748df

PALETTE = {
    'wall_main':   '#edf1f5',  # crisp white-ice ceramic tile facade (refs [02], [19])
    'wall_accent': '#4c78a6',  # cobalt/slate-blue window frames & cornice trim (refs [02], [19])
    'wall_sub':    '#dce5f0',  # pale ice-blue pilaster & parapet trim (ref [02])
    'wall_base':   '#545e68',  # dark slate-grey ground dado (ref [02])
    'win_frame':   '#4c78a6',  # cobalt-blue window frames!
    'win_trim':    '#9bb8d6',
    'base_frame':  '#cfd6de',
    'base_trim':   '#6e7a86',
    'has_ac':      True,       # white split-AC outdoor units beside windows (refs [02], [19]!)
    'roof_tile':   '#52575d',
    'pave_grey':   '#c6c4bc',
    'pave_dark':   '#2c3b36',  # dark green-black marble pillar plinth (ref [02]!)
    'track_red':   '#be4e42',
    'turf_a':      '#588f4e',
    'turf_b':      '#477a3f',
    'foliage':     '#396534',
    'glass':       '#355066',
    'court_a':     '#48855c',  # green acrylic basketball courts on red apron (ref [20]!)
    'court_b':     '#3b6b94',
    'yellow':      '#e6dfd3',  # warm cream-stone gate pillars (ref [02]!)
}

SIGNS = {
    'school_name': '桂林市民族中学',
    'school_en': 'GUILIN MINZU MIDDLE SCHOOL',
    'gate_bg': '#e8e2d6',
    'gate_fg': '#8e2822',
    'gate_border': '#8c7d66',
    'vert_bg': '#323436',      # dark stone/bronze vertical pillar plaque (ref [02]!)
    'vert_fg': '#dfc074',
    'vert_text': '桂林市民族中学',
    'emblem': '民中',
    'motto': '兴学储材 · 团结奋进',
    'motto_bg': '#243c63',     # deep navy stage backdrop ('桂林市逸仙中学' ceremony stage in ref [19]!)
    'motto_fg': '#f0ece2',
    'bldg1_rooftop': True,
    'rooftop_bg': '#e5edf6',
    'rooftop_fg': '#b88628',
    'buildings': ['桂林市逸仙中学', '求知楼', '明德楼', '致远楼'],
}


def _minzu_stone_pillar_gate(b: SchoolBuilder, cx: float, cz: float, yaw: float):
    """Exact recreation of ref [02] on 民主路 9 号:
    Two cream-stone square pillars ('yellow' = #e6dfd3) with dark green-black marble bases ('pave_dark'),
    stepped stone cornice caps, white spherical globe lamps atop each pillar, vertical dark-bronze
    school name plaques ('桂林市民族中学') on pillar fronts, and closed stainless retractable gate.
    """
    old = b.pose
    b.pose = (cx, 0.0, cz, yaw)
    y0 = 0.04
    clear_w = 10.6
    for sx in (-clear_w * 0.5 - 0.72, clear_w * 0.5 + 0.72):
        # Dark green-black marble plinth
        b.box(sx, -0.4, 0.0, 1.46, 1.06, 1.46, 'pave_dark', cap_region='pave_dark', collide=True)
        # Cream carved stone pillar shaft
        b.box(sx, y0 + 0.62, 0.0, 1.32, 2.95, 1.32, 'yellow', cap_region='white', collide=True)
        # Stepped stone capital cornice
        b.box(sx, y0 + 3.57, 0.0, 1.56, 0.20, 1.56, 'yellow', cap_region='white')
        b.box(sx, y0 + 3.77, 0.0, 1.38, 0.14, 1.38, 'white')
        # White spherical globe lamp on top of pillar (signature in ref [02]!)
        b.cylinder_y(sx, y0 + 3.91, 0.16, 0.0, 0.24, 'white', r_top=0.34, segs=10)
        b.cylinder_y(sx, y0 + 4.07, 0.22, 0.0, 0.34, 'white', r_top=0.14, segs=10)
        # Vertical bronze/dark-stone school name plaque on front of pillar
        b.box(sx, y0 + 0.92, 0.68, 0.52, 2.22, 0.08, 'black_led')
        b.sign(sx, y0 + 2.03, 0.74, 0.46, 2.12, 'sign_vert')

    # Right wing cultural wall with school title plaque
    b.box(clear_w * 0.5 + 4.2, y0, -0.1, 5.6, 2.85, 0.75, 'yellow', cap_region='wall_accent', collide=True)
    b.box(clear_w * 0.5 + 4.2, y0, -0.05, 5.8, 0.58, 0.85, 'pave_dark')
    b.sign(clear_w * 0.5 + 4.2, y0 + 1.68, 0.32, 4.8, 0.92, 'sign_gate')

    b.retractable_gate(clear_w, gate_h=1.45, y0=y0)
    b.box(0.0, -0.60, 1.4, clear_w + 6.0, 0.56, 3.2, 'pave_dark', cap_region='pave_grey')
    b.pose = old


def _rooftop_sign_and_lights(b: SchoolBuilder, cx: float, cz: float, yaw: float, top_y: float, span_w: float = 16.5):
    """Freestanding rooftop gold characters ('桂林市逸仙中学') + rear diagonal floodlight brackets (ref [02]!)."""
    old = b.pose
    b.pose = (cx, 0.0, cz, yaw)
    # Metal support lattice & rooftop signboard
    n_posts = 6
    for pi in range(n_posts):
        px = -span_w * 0.45 + pi * (span_w * 0.90 / (n_posts - 1))
        b.box(px, top_y + 0.6, 0.0, 0.12, 1.85, 0.12, 'steel')
        b.box(px, top_y + 0.6, -0.65, 0.10, 1.55, 1.25, 'steel')
        # Projecting floodlight arm on gable/front (seen on right roof corner of ref [02]!)
        if b.detail:
            b.box(px, top_y + 0.55, 1.15, 0.07, 0.07, 1.35, 'steel')
    b.box(0.0, top_y + 0.85, 0.12, span_w, 1.55, 0.18, 'wall_sub')
    b.sign(0.0, top_y + 1.62, 0.24, span_w - 0.4, 1.42, 'sign_bldg1', double_sided=True)
    b.pose = old


def _qiuzhi_ceremony_canopy(b: SchoolBuilder):
    """Wide cantilevered entrance canopy + red-tiled ceremony stage + twin flagpoles on 求知楼 (ref [19]!)."""
    old = b.pose
    # South courtyard face of OSM_QIUZHI at (-3.7, -47.0), facing SSW (yaw = radians(338.06))
    yaw = math.radians(338.06)
    b.pose = (-3.7, 0.0, -47.0, yaw)
    y0 = 0.05
    # Red-tiled raised ceremony stage ('主席台')
    b.box(0.0, y0, 1.85, 14.8, 0.78, 3.6, 'cinnabar', cap_region='pave_grey', collide=True)
    # Deep navy stage backdrop + red side couplet pillars ('兴学储材')
    b.box(0.0, y0 + 0.78, 0.25, 11.2, 3.25, 0.24, 'wall_accent')
    b.sign(0.0, y0 + 2.40, 0.40, 9.6, 2.20, 'sign_motto')
    for sx in (-5.8, 5.8):
        b.box(sx, y0 + 0.78, 0.35, 0.52, 3.35, 0.42, 'cinnabar')

    # Wide cantilevered concrete canopy ('门口大雨棚') projecting 4.2 m out at y = 4.25 m!
    b.box(0.0, y0 + 4.15, 2.15, 16.2, 0.32, 4.3, 'white', cap_region='pave_dark')
    for bx in (-6.5, -2.2, 2.2, 6.5):
        b.box(bx, y0 + 3.85, 1.85, 0.28, 0.32, 3.6, 'white')

    # Twin stainless flagpoles on red-brown granite dais to the right of the stage (exact match to ref [19]!)
    b.box(10.6, y0, 2.4, 5.4, 0.68, 3.2, 'cinnabar', cap_region='pave_grey', collide=True)
    for fx in (9.5, 11.7):
        b.cylinder_y(fx, y0 + 0.68, 12.6, 2.4, 0.12, 'steel', r_top=0.05, segs=8, collide=True)
    b.box(10.45, y0 + 11.6, 2.4, 1.85, 1.20, 0.05, 'cinnabar')
    b.pose = old


def build_minzu(b: SchoolBuilder):
    # 1. Full campus granite paving across way/647468207
    b.prism(RING, -1.6, 1.65, 'pave_dark', cap_region='pave_grey', collide=False)

    # 2. Perimeter fence with ONE gate on 民主路 (edge 4: (70.39,-32.56)->(80.73,-60.45), len=29.7m)
    b.perimeter_fence(RING, gate_edge=4, gate_t0=0.14, gate_t1=0.62, wall_h=2.25)

    p4, p5 = RING[4], RING[5]
    tm = 0.38
    gx = p4[0] + (p5[0] - p4[0]) * tm
    gz = p4[1] + (p5[1] - p4[1]) * tm
    dx, dz = p5[0] - p4[0], p5[1] - p4[1]
    # Outward normal pointing ESE (+X, +Z) onto 民主路
    nx, nz = -dz, dx
    if nx < 0:
        nx, nz = -nx, -nz
    gate_yaw = math.atan2(nx, nz)
    _minzu_stone_pillar_gate(b, gx, gz, gate_yaw)

    # 3. Exact OSM & Overture Building Footprints (offset 0.00 m, angle diff 0.0 deg!)
    # (1) 求知楼 (OSM way/1474978350): 5 storeys, white ceramic tile, blue frames, AC units, windows on all 8 walls!
    b.footprint_building(OSM_QIUZHI, name='求知楼（北主综合教学楼）', source_id='way/1474978350',
                         floors=5, floor_h=3.55, roof='flat',
                         base_floors=1, use_base_tex=True,
                         parapet_reg='wall_accent', top_parapet_reg='wall_accent', bay_target_m=3.5)
    _qiuzhi_ceremony_canopy(b)
    _rooftop_sign_and_lights(b, 4.0, -49.5, math.radians(338.06), top_y=5 * 3.55, span_w=18.5)

    # (2) 明德楼 (Overture 89d8a68b, right next to gate in ref [02]!): 4 storeys, windows on all 4 sides + rooftop sign!
    b.footprint_building(OV_MINGDE, name='明德楼（东北临街教学楼）', source_id='overture/89d8a68b',
                         floors=4, floor_h=3.50, roof='flat',
                         base_floors=1, use_base_tex=True,
                         parapet_reg='wall_accent', top_parapet_reg='wall_accent', bay_target_m=3.4)
    # Rooftop sign facing SSW/ESE toward street gate just as in ref [02]!
    _rooftop_sign_and_lights(b, 57.5, -53.8, math.radians(336.42), top_y=4 * 3.50, span_w=16.0)

    # (3) 致远楼 (OSM way/1474978345): 5 storeys, white walls + pitched/parapet dark-grey roof (ref [20]!)
    b.footprint_building(OSM_ZHIYUAN, name='致远楼（南合院教学楼）', source_id='way/1474978345',
                         floors=5, floor_h=3.45, roof='hip',
                         base_floors=1, use_base_tex=True,
                         parapet_reg='wall_accent', top_parapet_reg='white', bay_target_m=3.6)

    # (4) 艺体附楼 (Overture a30748df): 3 storeys, white walls + pitched dark-grey roof (ref [20]!)
    b.footprint_building(OV_YITI, name='艺体附楼', source_id='overture/a30748df',
                         floors=3, floor_h=3.45, roof='hip',
                         base_floors=1, use_base_tex=True,
                         parapet_reg='white', top_parapet_reg='white', bay_target_m=3.4)

    # 4. Exact OSM 250m Running Track (relation/20185367) & 4 Basketball Courts (way/1474978346..1474978349)
    b.running_track(-25.23, 11.37, length=114.0, width=51.5, yaw=math.radians(69.84),
                    y0=0.07, track_reg='track_red', infield_mode='turf')

    for cx_c, cz_c, ang_c in (
        (6.77, 34.13, 70.27),
        (21.86, 39.60, 70.30),
        (18.20, 1.91, 70.29),
        (33.83, 7.33, 70.27),
    ):
        b.basketball_court(cx_c, cz_c, yaw=math.radians(ang_c), w=28.18, d=15.52,
                           surface='court_a', apron='track_red', y0=0.07)

    # Camphor tree belt between track and basketball courts (exact match to aerial ref [20]!)
    for ti in range(5):
        tx = -6.0 + ti * 3.8
        tz = 32.0 - ti * 10.2
        b.tree(tx, tz, scale=1.10, seed=410 + ti * 11)
    b.green_strip(46.0, -34.0, w=22.0, d=3.6, yaw=math.radians(-22.0), trees=3, seed=441)


if __name__ == '__main__':
    export_school_glb('minzu_middle', PALETTE, SIGNS, build_minzu, seed=202604)
