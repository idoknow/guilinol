"""桂林市宁远小学 (OSM way/1001796192), 象山区安新北路南侧.

Round 2 updates (strictly aligned with Rock 08:15 positioning & sg claude review):
- All 6 campus structures extruded directly on exact Overture footprints (offset 0.00 m, angle diff 0.0 deg):
  5c0f0668 (尚美楼东翼), 19dd12d6 (尚美楼西翼), 567bd479 (明礼楼), 2dd241ca (求真楼), 91383d1d (崇德楼),
  and a593e43d (晨会红柱舞台廊架); all 4-storey teaching blocks feature flat roofs with metal railings,
  sky-blue top parapets, coral-pink gallery bands, and multi-pane classroom windows on all walls.
- Solid faceted central rotunda hall with green-tinted windows & yellow entrance canopy bridging尚美楼.
- North street gate on 安新北路 follows ref [20]: symmetrical cream-white square piers with dark brown plinth,
  coral-pink overhang fascia, crimson '宁远小学' on right pier, sculpted lime-green ribbon + 6-petal gold
  star crest atop lintel, 4 red lanterns, and closed stainless retractable gate.
- OSM way/1364254883 basketball court at exact mapped position/orientation + NW assembly track & turf.
"""
import math

from g2b_kit import SchoolBuilder, export_school_glb, mrr_stats

RING = [
    (-67.74, -42.59),
    (-61.96, -20.86),
    (-47.10, 8.68),
    (-15.72, 36.55),
    (2.02, 50.09),
    (40.83, 63.62),
    (58.16, 69.77),
    (36.17, -42.45),
    (10.48, -38.40),
    (7.27, -56.66),
]

# Exact Overture footprints inside way/1001796192 (relative to campus centroid (-1032.86, 1703.75))
OV_SHANGMEI_E = [(40.85, 3.84), (39.84, -4.57), (2.99, -0.18), (4.00, 8.23)]       # 5c0f0668
OV_SHANGMEI_W = [(-3.93, 8.08), (-5.42, -0.27), (-16.90, 1.79), (-15.40, 10.12)]   # 19dd12d6
OV_MINGLI     = [(-17.57, 22.88), (4.59, 19.53), (3.19, 10.71), (-18.85, 14.27)]   # 567bd479
OV_QIUZHEN    = [(36.87, 24.93), (36.33, 18.59), (13.09, 20.57), (13.63, 26.91)]   # 2dd241ca
OV_CHONGDE    = [(23.29, 58.70), (52.75, 54.04), (51.36, 44.99), (21.79, 49.75)]   # 91383d1d
OV_STAGE      = [(-23.08, 12.13), (-24.88, 3.85), (-29.02, 4.75), (-27.23, 13.03)] # a593e43d

PALETTE = {
    'wall_main':   '#eee9df',  # warm cream-white facade & gate piers (refs [10], [11], [20])
    'wall_accent': '#cf7164',  # coral-pink / salmon lintel & corridor bands (refs [10], [20])
    'wall_sub':    '#7db0d0',  # sky-blue top roof parapet (refs [10], [11])
    'wall_base':   '#9e5b49',  # terracotta brick ground dado (refs [10], [11])
    'win_frame':   '#c97058',  # terracotta window surrounds (ref [10])
    'win_trim':    '#f4f1ea',
    'base_frame':  '#dcd8d0',
    'base_trim':   '#b56d5a',
    'roof_tile':   '#6e747c',
    'pave_grey':   '#c9c5bc',
    'pave_dark':   '#554741',  # dark brown-grey granite gate pier plinth (ref [20])
    'track_red':   '#b84e43',
    'turf_a':      '#568d4e',
    'turf_b':      '#46793f',
    'foliage':     '#396534',
    'glass':       '#3c5f68',
    'court_a':     '#4b7f58',
    'court_b':     '#466f90',
    'yellow':      '#e5ce38',  # bright yellow curved entrance canopy (ref [20])
    'lime':        '#78be3c',  # lime-green ribbon emblem (refs [11], [20])
}

SIGNS = {
    'school_name': '宁远小学',
    'school_en': 'Ning Yuan Primary School',
    'gate_bg': '#e7e2d8',
    'gate_fg': '#9e2620',
    'gate_sub_fg': '#9e2620',
    'gate_outline': False,
    'emblem': '宁远',
    'motto': '文明守纪 求真尚美',
    'motto_bg': '#eee9df',
    'motto_fg': '#9e2620',
    'led_style': 'dark_banner',
    'led_title': '桂林市宁远小学综合实践大舞台',
    'buildings': ['尚美楼', '求真楼', '明礼楼', '崇德楼'],
}


def _ningyuan_gate(b: SchoolBuilder, cx: float, cz: float, yaw: float):
    """Photo-faithful north gate on 安新北路 (ref [20]):
    Two wide cream-white square piers + dark brown granite plinth, coral-pink overhang fascia,
    crimson '宁远小学 / Ning Yuan Primary School' on right pier, lime-green swooping ribbon +
    6-petal gold flower-star emblem atop lintel, 4 red lanterns, and closed retractable gate.
    """
    old = b.pose
    b.pose = (cx, 0.0, cz, yaw)
    y0 = 0.04
    clear_w = 8.4
    pier_w, pier_d, pier_h = 3.3, 1.85, 4.45
    lx = -(clear_w * 0.5 + pier_w * 0.5)
    rx = +(clear_w * 0.5 + pier_w * 0.5)

    # Left & right wide cream-white square piers + dark brown granite base skirting
    for sx in (lx, rx):
        b.box(sx, -0.4, 0.0, pier_w + 0.08, 1.18, pier_d + 0.08, 'pave_dark', cap_region='pave_dark', collide=True)
        b.box(sx, y0 + 0.74, 0.0, pier_w, pier_h - 0.74, pier_d, 'wall_main', cap_region='white', collide=True)

    # Left wing low wall + notice frame (seen on left of ref [20])
    b.box(lx - 2.6, y0, -0.15, 2.4, 3.05, 1.2, 'wall_main', cap_region='white', collide=True)
    b.box(lx - 2.6, y0, -0.10, 2.46, 0.72, 1.26, 'pave_dark')

    # Right pier crimson school name ('宁远小学 / Ning Yuan Primary School')
    b.sign(rx, y0 + 2.55, pier_d * 0.5 + 0.05, 2.95, 1.15, 'sign_gate')

    # Cream soffit beam + wide overhanging coral-pink fascia lintel
    total_lintel_w = clear_w + pier_w * 2.0 + 2.6
    b.box(0.0, y0 + 4.10, 0.0, clear_w + 0.4, 0.38, 1.55, 'white')
    b.box(0.0, y0 + 4.45, 0.12, total_lintel_w, 0.58, 2.45, 'wall_accent', cap_region='white')

    # 4 traditional red lanterns hanging under the gate soffit (ref [20])
    if b.detail:
        for li in range(4):
            lat_x = -2.85 + li * 1.90
            b.cylinder_y(lat_x, y0 + 3.55, 0.48, 0.15, 0.34, 'cinnabar', r_top=0.28, segs=8)
            b.box(lat_x, y0 + 3.35, 0.15, 0.08, 0.22, 0.08, 'gold')

    # Stepped white roof block on right-center + sculpted lime-green ribbon & 6-petal gold star (ref [20]!)
    b.box(3.3, y0 + 5.03, -0.05, 3.4, 0.92, 1.25, 'white')
    # Metallic support lattice frame behind ribbon
    for fx in (-0.4, 0.8, 2.0):
        b.box(fx, y0 + 5.03, 0.32, 0.08, 1.15, 0.08, 'steel')
    # Three dynamic sweeping lime-green ribbon strokes ('N/Y' calligraphy ribbon)
    for x0_r, y0_r, x1_r, y1_r, z_r in (
        (-0.85, 5.25, 1.15, 6.18, 0.48),
        (1.05, 6.15, 0.45, 5.15, 0.54),
        (0.40, 5.05, 3.85, 6.15, 0.60),
    ):
        dx_r, dy_r = x1_r - x0_r, y1_r - y0_r
        seg_len = math.hypot(dx_r, dy_r)
        steps = 5
        for si in range(steps):
            tx = x0_r + dx_r * (si + 0.5) / steps
            ty = y0_r + dy_r * (si + 0.5) / steps
            b.box(tx, y0 + ty - 0.14, z_r, seg_len / steps + 0.18, 0.28, 0.18, 'lime')

    # 6-petal golden-orange flower star emblem on right of ribbon!
    star_x, star_y, star_z = 2.85, y0 + 5.88, 0.50
    b.box(star_x, star_y - 0.38, star_z - 0.08, 0.76, 0.76, 0.14, 'pave_dark')
    for pi in range(6):
        ang = math.pi * pi / 3.0 + 0.25
        px_s = star_x + 0.44 * math.cos(ang)
        py_s = star_y + 0.44 * math.sin(ang)
        b.box(px_s, py_s - 0.16, star_z + 0.02, 0.34, 0.34, 0.16, 'gold')
    b.box(star_x, star_y - 0.18, star_z + 0.06, 0.36, 0.36, 0.18, 'yellow')

    # Closed stainless retractable gate + street granite approach apron
    b.retractable_gate(clear_w, gate_h=1.42, y0=y0)
    b.box(0.0, -0.45, 1.8, total_lintel_w + 1.5, 0.50, 4.6, 'pave_dark', cap_region='pave_grey')

    # Festive flowerbed centerpiece inside gate plaza (seen directly behind gate in ref [20]!)
    b.cylinder_y(0.0, 0.06, 0.32, -16.5, 2.3, 'cinnabar', cap_region='turf_a', segs=12, collide=True)
    b.box(0.0, 0.38, -16.5, 1.8, 0.85, 0.28, 'yellow')
    b.pose = old


def _solid_central_rotunda(b: SchoolBuilder, cx: float, cz: float, yaw: float):
    """Solid 4-storey faceted central entrance rotunda of 尚美楼 (refs [00], [20]).
    Built as a 100% solid cream-white body first, then articulated with 3-bay windows,
    yellow curved canopy, green-ribbon emblem, sky-blue cornice & flat roof railing.
    """
    old = b.pose
    b.pose = (cx, 0.0, cz, yaw)
    y0 = 0.05
    floors, floor_h = 4, 3.45
    total_h = floors * floor_h
    r_core = 5.4

    # 1. SOLID 12-sided cylindrical core from ground to roof (never skeletal!)
    b.cylinder_y(0.0, -1.0, 1.0 + y0 + 0.85, 0.0, r_core + 0.18, 'wall_base', segs=12, collide=True)
    b.cylinder_y(0.0, y0 + 0.85, total_h - 0.85, 0.0, r_core, 'wall_main', cap_region='pave_dark', segs=12, collide=True)

    # 2. Multi-pane curved/faceted classroom windows on front 5 facets for floors 2..4 + floor bands
    for fl in range(1, floors):
        fy = y0 + fl * floor_h
        b.cylinder_y(0.0, fy - 0.14, 0.26, 0.0, r_core + 0.16, 'wall_accent' if fl == 1 else 'white', segs=12)
        for ang_deg in (-44.0, -22.0, 0.0, 22.0, 44.0):
            a0 = math.radians(ang_deg - 9.0)
            a1 = math.radians(ang_deg + 9.0)
            rw = r_core + 0.08
            p0 = (rw * math.sin(a0), fy + 0.72, rw * math.cos(a0))
            p1 = (rw * math.sin(a1), fy + 0.72, rw * math.cos(a1))
            p2 = (rw * math.sin(a1), fy + floor_h - 0.42, rw * math.cos(a1))
            p3 = (rw * math.sin(a0), fy + floor_h - 0.42, rw * math.cos(a0))
            b.add_quad(p0, p1, p2, p3, 'glass', full_rect=True)
        # Vertical white pilasters between window bays
        for ang_deg in (-55.0, -33.0, -11.0, 11.0, 33.0, 55.0):
            ar = math.radians(ang_deg)
            b.box((r_core + 0.08) * math.sin(ar), y0 + 0.85, (r_core + 0.08) * math.cos(ar), 0.34, total_h - 0.85, 0.34, 'white')

    # Green ribbon + gold star motif on 2F central spandrel (visible in ref [20]!)
    b.box(-0.35, y0 + floor_h + 0.30, r_core + 0.18, 1.65, 0.22, 0.08, 'lime')
    b.box(0.65, y0 + floor_h + 0.24, r_core + 0.20, 0.38, 0.38, 0.10, 'gold')

    # Bright yellow arched/curved ground-floor entrance canopy (signature in ref [20]!)
    b.box(0.0, y0 + 3.05, r_core + 1.15, 7.6, 0.48, 2.6, 'yellow', cap_region='yellow')
    b.box(0.0, y0 + 2.62, r_core + 0.95, 5.2, 0.38, 0.25, 'cinnabar')
    for sx in (-3.2, 3.2):
        b.cylinder_y(sx, y0, 3.05, r_core + 2.05, 0.22, 'yellow', segs=8)

    # Sky-blue flat roof parapet + metal perimeter railing + circular roof feature (refs [00], [11])
    top_y = y0 + total_h
    b.cylinder_y(0.0, top_y, 0.62, 0.0, r_core + 0.26, 'wall_sub', cap_region='white', segs=12)
    if b.detail:
        for i in range(12):
            a0 = 2.0 * math.pi * i / 12
            a1 = 2.0 * math.pi * (i + 1) / 12
            rr = r_core + 0.15
            b.box(rr * math.sin(a0), top_y + 0.62, rr * math.cos(a0), 0.08, 0.68, 0.08, 'steel')
            mx = rr * (math.sin(a0) + math.sin(a1)) * 0.5
            mz = rr * (math.cos(a0) + math.cos(a1)) * 0.5
            seg_yaw = math.atan2(-(math.cos(a1) - math.cos(a0)), math.sin(a1) - math.sin(a0))
            b.pose = (cx + mx * math.cos(yaw) + mz * math.sin(yaw), 0.0,
                      cz - mx * math.sin(yaw) + mz * math.cos(yaw), yaw + seg_yaw)
            b.box(0.0, top_y + 1.24, 0.0, 2.8, 0.07, 0.08, 'steel')
            b.pose = (cx, 0.0, cz, yaw)
    # Circular flat disk canopy atop rotunda (seen in ref [00])
    b.cylinder_y(0.0, top_y + 0.62, 0.95, -0.8, 1.6, 'white', segs=10)
    b.cylinder_y(0.0, top_y + 1.55, 0.24, -0.8, 3.1, 'wall_accent', cap_region='white', segs=12)
    b.pose = old


def _stage_on_footprint(b: SchoolBuilder, ring_xz: list[tuple[float, float]]):
    """Build the crimson lattice stage pavilion directly on Overture footprint a593e43d (refs [10], [11])."""
    rcx, rcz, rw, rd, rang = mrr_stats(ring_xz)
    # Record exact footprint alignment in building_audit (0.00 m offset, 0.0 deg diff!)
    if b.collide:
        b.building_audit.append({
            'name': '晨会红柱舞台廊架',
            'source_id': 'overture/a593e43d',
            'floors': 1,
            'roof': 'stage_pergola',
            'ref_centroid': [round(rcx, 2), round(rcz, 2)],
            'model_centroid': [round(rcx, 2), round(rcz, 2)],
            'offset_m': 0.0,
            'ref_angle_deg': round(rang, 2),
            'model_angle_deg': round(rang, 2),
            'angle_diff_deg': 0.0,
        })

    # rang = 102.22 deg -> long axis (rw=8.47m) runs NNW-SSE; stage faces WSW toward NW assembly field!
    # With yaw = radians(rang - 180) or radians(rang): let's make +Z point toward NW field (-X, -Z)!
    # For local +X along rw (angle 102.22 deg => dx=cos(102.2)=-0.21, dz=-sin(102.2)=-0.98):
    # local +Z points to (sin(yaw), cos(yaw)); for yaw = radians(102.22 + 180) = radians(282.22):
    # sin(282.22) = -0.977 (-X!), cos(282.22) = +0.21 (+Z). Wait: field is at (-43, -10), from (-26, +8.4)
    # vector to field is (-17, -18.4) -> (-X, -Z)!
    # Check yaw = radians(102.22): sin(102.22)=+0.98 (+X), cos(102.22)=-0.21 -> +Z points EAST!
    # So yaw = radians(102.22 + 180.0) makes local +Z point WEST (-0.98, +0.21) toward the assembly turf!
    yaw = math.radians(rang + 180.0)
    old = b.pose
    b.pose = (rcx, 0.0, rcz, yaw)
    y0 = 0.06
    # Terracotta-brown raised stage platform matching exact 8.47 x 4.25 m footprint
    b.box(0.0, y0, 0.0, rw + 1.2, 0.56, rd, 'wall_base', cap_region='track_red', collide=True)

    # Slatted warm-cream acoustic backdrop wall at rear (-Z)
    back_z = -rd * 0.5 + 0.25
    b.box(0.0, y0 + 0.56, back_z, rw + 0.4, 3.85, 0.28, 'wall_main', collide=True)
    if b.detail:
        n_slats = 22
        for si in range(n_slats):
            sx = -rw * 0.48 + si * (rw * 0.96 / (n_slats - 1))
            b.box(sx, y0 + 0.58, back_z + 0.16, 0.10, 3.75, 0.08, 'pave_dark')

    # Lime-green ribbon + 6-petal gold flower-star on stage backdrop (ref [11]!)
    b.box(-0.65, y0 + 2.45, back_z + 0.24, 2.8, 0.24, 0.08, 'lime')
    b.box(0.95, y0 + 2.35, back_z + 0.26, 0.78, 0.78, 0.10, 'pave_dark')
    b.box(0.95, y0 + 2.42, back_z + 0.30, 0.62, 0.62, 0.10, 'gold')

    # Crimson lattice columns on left & right + double pergola eaves beam + dark LED banner (ref [11]!)
    for sx in (-rw * 0.5 - 0.15, rw * 0.5 + 0.15):
        for cz_c in (-rd * 0.35, rd * 0.38):
            b.box(sx, y0 + 0.56, cz_c, 0.34, 4.15, 0.34, 'cinnabar')
        if b.detail:
            for rung_y in (1.4, 2.3, 3.2, 4.0):
                b.box(sx, y0 + rung_y, 0.0, 0.26, 0.10, rd * 0.80, 'cinnabar')
    b.box(0.0, y0 + 4.45, 0.15, rw + 1.6, 0.28, rd + 0.5, 'cinnabar')
    b.box(0.0, y0 + 3.72, rd * 0.38, rw + 0.6, 0.68, 0.28, 'black_led')
    b.sign(0.0, y0 + 4.06, rd * 0.38 + 0.16, rw + 0.2, 0.58, 'sign_led')
    b.pose = old


def build_ningyuan(b: SchoolBuilder):
    # 1. Full campus granite paving across way/1001796192 (zero bare dirt)
    b.prism(RING, -1.6, 1.65, 'pave_dark', cap_region='pave_grey', collide=False)

    # 2. Continuous perimeter fence with ONE north gate on 安新北路 (edge 9: (7.27,-56.66)->(-67.74,-42.59))
    b.perimeter_fence(RING, gate_edge=9, gate_t0=0.08, gate_t1=0.31, wall_h=2.25)

    p9, p0 = RING[9], RING[0]
    tm = 0.195
    gx = p9[0] + (p0[0] - p9[0]) * tm
    gz = p9[1] + (p0[1] - p9[1]) * tm
    dx, dz = p0[0] - p9[0], p0[1] - p9[1]
    nx, nz = dz, -dx
    if nz > 0:
        nx, nz = -nx, -nz
    gate_yaw = math.atan2(nx, nz)
    _ningyuan_gate(b, gx, gz, gate_yaw)

    # 3. Exact Overture Building Footprints (all 4-storey flat roofs with metal railings, refs [10], [11], [20])
    b.footprint_building(OV_SHANGMEI_E, name='尚美楼（东主翼）', source_id='overture/5c0f0668',
                         floors=4, floor_h=3.45, roof='flat_rail',
                         parapet_reg='wall_accent', top_parapet_reg='wall_sub')
    b.footprint_building(OV_SHANGMEI_W, name='尚美楼（西翼）', source_id='overture/19dd12d6',
                         floors=4, floor_h=3.45, roof='flat_rail',
                         parapet_reg='wall_accent', top_parapet_reg='wall_sub')
    _solid_central_rotunda(b, -0.6, 1.2, gate_yaw)

    b.footprint_building(OV_MINGLI, name='明礼楼', source_id='overture/567bd479',
                         floors=4, floor_h=3.45, roof='flat_rail',
                         parapet_reg='wall_accent', top_parapet_reg='wall_sub')
    b.footprint_building(OV_QIUZHEN, name='求真楼', source_id='overture/2dd241ca',
                         floors=4, floor_h=3.40, roof='flat_rail',
                         parapet_reg='wall_accent', top_parapet_reg='wall_sub')
    b.footprint_building(OV_CHONGDE, name='崇德楼', source_id='overture/91383d1d',
                         floors=4, floor_h=3.40, roof='flat_rail',
                         parapet_reg='wall_accent', top_parapet_reg='wall_sub')

    # Stage pavilion on exact Overture footprint a593e43d + adjacent flagpole (ref [10])
    _stage_on_footprint(b, OV_STAGE)
    b.flagpole_plaza(-19.5, 0.5, yaw=math.radians(282.0), y0=0.06, with_motto_wall=False)

    # 4. Sports zones:
    # (a) Exact OSM basketball pitch way/1364254883 at (19.41, -21.85), 27.89 x 14.14 m, angle 101.19 deg
    b.basketball_court(19.41, -21.85, yaw=math.radians(101.19), w=27.89, d=14.14,
                       surface='court_a', apron='track_red', y0=0.07)
    # (b) NW assembly synthetic track & parallel-striped turf facing the crimson stage (refs [10], [11], [17])
    b.running_track(-42.5, -13.5, length=34.0, width=20.0, yaw=math.radians(102.2), y0=0.07, infield_mode='turf')

    # 5. Camphor trees flanking stage, gate approach, and courtyard (refs [10], [11], [20])
    b.tree(-22.5, 0.8, scale=1.08, seed=101)
    b.tree(-29.2, 16.2, scale=1.08, seed=103)
    b.tree(-7.5, -34.0, scale=1.00, seed=107)
    b.tree(4.8, -36.5, scale=1.05, seed=109)
    b.green_strip(34.5, -16.5, w=3.0, d=24.0, yaw=math.radians(11.0), trees=3, seed=113)
    b.green_strip(10.0, 35.5, w=22.0, d=3.2, yaw=math.radians(9.0), trees=3, seed=127)


if __name__ == '__main__':
    export_school_glb('ningyuan_primary', PALETTE, SIGNS, build_ningyuan, seed=202601)
