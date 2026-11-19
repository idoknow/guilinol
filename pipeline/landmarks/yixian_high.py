"""桂林市逸仙中学 / 原桂林市第二中学 (OSM way/647471576), 雉山路尚智巷 15 号.

Round 2 updates (strictly aligned with Rock 08:15 positioning & sg claude review):
- All 17 campus buildings extruded directly on exact Overture footprints (offset 0.00 m, angle diff 0.0 deg).
- North gate on 尚智巷 follows ref [01]: 6 pale celadon-green cylindrical columns (3+3) with dark bases/capitals,
  terracotta-orange waist band, black motto sub-plaque, sloped white pediment with crimson '桂林市逸仙中学',
  and closed stainless retractable gate (no guardhouse/turnstiles/CCTV).
- 厚德楼 (cf7fd883) follows ref [06]: dark slate-grey ground base, 2-storey central open portal, central blue
  curtain window, warm khaki-sandstone windowed facade, flat roof with railing, and signature Twin Corner
  Pavilion Towers ('双角亭' — 6-storey corner shafts crowned with 4-column overhanging pavilion roofs).
- 科创楼组团 (7fd618fe, 7ab7e364, d9376a46) follows ref [13]: 1F open teal-green piloti columns ('底层架空柱'),
  2F teal-green windowed podium ('青绿色裙墙'), 3F-6F warm beige gridded balcony facade, and rooftop stair tower.
- Running track (relation/20185381) uses disjoint side-by-side grass strips (zero triangle Z-fighting artifacts).
"""
import math

from g2b_kit import SchoolBuilder, export_school_glb

RING = [
    (-92.25, 109.59),
    (116.85, 106.65),
    (114.26, -27.16),
    (55.42, -27.90),
    (54.30, -122.01),
    (52.57, -125.18),
    (47.95, -128.02),
    (-18.89, -126.39),
    (-24.01, -126.27),
    (-24.66, -142.23),
    (-80.12, -135.45),
    (-77.70, -67.25),
    (-98.84, -64.84),
    (-99.15, 60.06),
    (-92.70, 60.11),
]

# Exact Overture footprints inside way/647471576 (relative to campus centroid (-1791.60, 1760.16))
OV_HOUDE = [
    (-33.55, 16.19), (-86.56, 16.97), (-86.45, 24.37), (-34.51, 23.62),
    (-34.17, 46.92), (-22.51, 46.74), (-22.81, 25.57), (-33.41, 25.72),
]  # cf7fd883
OV_HOUDE_S  = [(-83.23, 51.25), (-82.84, 58.66), (-30.96, 56.00), (-31.34, 48.59)]  # 8ec9a3bb
OV_KECHUANG_S = [(115.73, 55.53), (116.35, 39.07), (78.89, 37.67), (78.27, 54.13)]  # 7fd618fe
OV_KECHUANG_M = [(81.98, 24.24), (106.35, 23.59), (106.02, 10.88), (81.64, 11.54)]  # 7ab7e364
OV_KECHUANG_N = [(118.85, 9.20), (118.73, -11.98), (79.51, -11.77), (79.62, 9.41)]  # d9376a46

OV_SHIYAN_N = [(-12.25, -100.99), (52.31, -104.71), (51.71, -115.28), (-12.87, -111.57)]  # 4a31afc8
OV_SHIYAN_S = [
    (40.82, -87.52), (1.60, -87.07), (1.69, -78.59),
    (54.71, -79.20), (54.44, -101.45), (40.66, -101.28),
]  # 0490bee8
OV_SHIYAN_E = [(38.06, -67.27), (56.92, -67.38), (56.93, -78.44), (38.07, -78.55)]  # 2c5ac658

OV_OTHER = [
    ('博学楼', 'overture/a22a5e84', [(-25.09, -50.90), (-25.58, -65.72), (-64.93, -64.65), (-65.13, -55.25), (-41.34, -55.69), (-40.95, -50.50)], 5),
    ('西教学综合楼', 'overture/69c6d285', [(-58.99, -4.72), (-64.28, -4.44), (-65.26, -23.48), (-85.38, -22.44), (-84.23, -0.24), (-48.24, -2.09), (-48.51, -7.37), (-59.10, -6.83)], 5),
    ('北公寓甲楼', 'overture/df88b022', [(-64.38, -111.66), (-32.06, -112.80), (-32.45, -122.99), (-64.88, -121.62)], 5),
    ('北公寓乙楼', 'overture/c6bec02b', [(-83.73, -127.76), (-57.24, -128.64), (-57.52, -137.11), (-84.01, -136.23)], 5),
    ('北门辅楼', 'overture/b8ac1474', [(-39.07, -135.56), (-25.22, -136.51), (-25.71, -143.59), (-39.66, -142.42)], 3),
    ('西侧辅楼', 'overture/3ee1d71b', [(-81.19, -54.08), (-66.74, -54.91), (-67.23, -63.20), (-81.69, -62.59)], 4),
    ('中心连廊楼', 'overture/3b1440be', [(-69.60, -26.75), (-48.63, -25.77), (-48.49, -28.77), (-69.46, -29.74)], 3),
    ('东南体育用房', 'overture/ee97146d', [(109.67, 83.29), (118.30, 82.68), (117.41, 67.86), (108.78, 68.36)], 3),
    ('南端看台用房', 'overture/ada9b9b6', [(86.89, 93.59), (101.53, 93.28), (101.54, 86.10), (86.79, 86.41)], 2),
]

PALETTE = {
    'wall_main':   '#d5c3a3',  # warm khaki-sandstone facade of 厚德楼 & 科创楼 upper floors (refs [06], [13])
    'wall_accent': '#cf6c44',  # terracotta-orange gate waist band & gridded balcony trim (refs [01], [13])
    'wall_sub':    '#2e7f79',  # jade/teal-green 1F piloti columns & 2F podium of 科创楼 (ref [13]!)
    'wall_base':   '#47514f',  # dark slate-grey ground base of 厚德楼 (ref [06]!)
    'win_frame':   '#dedcd4',
    'win_trim':    '#ece6d8',
    'base_frame':  '#cfd4d6',
    'base_trim':   '#66706e',
    'roof_tile':   '#596066',
    'pave_grey':   '#c7c4bb',
    'pave_dark':   '#3d4347',
    'track_red':   '#be4e42',
    'turf_a':      '#578e4e',
    'turf_b':      '#467a3f',
    'foliage':     '#396534',
    'glass':       '#385468',
    'court_a':     '#679c73',  # light sage-green athletic apron seen in ref [06]!
    'court_b':     '#3a6a92',
    'lime':        '#92bda6',  # pale celadon-green cylindrical gate columns & soffit (ref [01]!)
}

SIGNS = {
    'school_name': '桂林市逸仙中学',
    'school_en': '',
    'gate_bg': '#f4f5f2',
    'gate_fg': '#a42620',
    'gate_outline': False,
    'emblem': '逸仙',
    'motto': '天下为公 · 勤学创新',
    'motto_bg': '#222526',     # black horizontal sub-plaque under orange waist band (ref [01]!)
    'motto_fg': '#d8b04c',
    'motto_border': True,
    'buildings': ['厚德楼', '科创楼', '实验楼', '博学楼'],
}


def _yixian_north_gate(b: SchoolBuilder, cx: float, cz: float, yaw: float):
    """Exact recreation of ref [01]:
    - 6 pale celadon-green cylindrical columns (3 left + 3 right) with dark bases & capitals
    - Pale celadon-green lower beam soffit + terracotta-orange horizontal waist band
    - Long black motto sub-plaque underneath the orange waist band
    - Sloped white sculptural pediment rising toward right with crimson '桂林市逸仙中学'
    - Closed stainless retractable gate underneath (zero guard booth/turnstiles/CCTV).
    """
    old = b.pose
    b.pose = (cx, 0.0, cz, yaw)
    y0 = 0.04
    # Six pale celadon-green ('lime' = #92bda6) cylindrical columns (3 on left, 3 on right)
    col_xs = (-7.5, -5.9, -4.3, 4.3, 5.9, 7.5)
    col_h = 3.85
    for sx in col_xs:
        b.cylinder_y(sx, y0, 0.28, 0.0, 0.42, 'pave_dark', segs=12, collide=True)
        b.cylinder_y(sx, y0 + 0.28, col_h - 0.56, 0.0, 0.34, 'lime', segs=12, collide=True)
        b.cylinder_y(sx, y0 + col_h - 0.28, 0.28, 0.0, 0.44, 'pave_dark', segs=12)

    # Pale celadon-green lower soffit beam + black motto sub-plaque
    beam_w = 18.6
    b.box(0.0, y0 + col_h, 0.0, beam_w, 0.86, 1.85, 'lime', cap_region='lime')
    b.box(0.0, y0 + col_h + 0.22, 0.88, 11.4, 0.54, 0.16, 'black_led')
    b.sign(0.0, y0 + col_h + 0.49, 0.98, 10.8, 0.46, 'sign_motto')

    # Bold terracotta-orange waist band ('橙红色腰带', ref [01]!)
    waist_y = y0 + col_h + 0.86
    b.box(0.0, waist_y, 0.08, beam_w + 0.6, 0.52, 2.10, 'wall_accent', cap_region='wall_accent')

    # Sloped white sculptural pediment rising from left to right + crimson '桂林市逸仙中学'
    ped_y0 = waist_y + 0.52
    # Wedge polygon in X-Y extruded across Z
    z_f, z_b = 0.82, -0.65
    x_l, x_m, x_r = -6.8, 4.2, 8.4
    y_l, y_m, y_r = ped_y0 + 0.45, ped_y0 + 2.35, ped_y0 + 1.15
    # Front, back, and top sloped quads
    b.add_quad((x_l, ped_y0, z_f), (x_r, ped_y0, z_f), (x_r, y_r, z_f), (x_l, y_l, z_f), 'white', full_rect=False)
    b.add_quad((x_l, y_l, z_f), (x_r, y_r, z_f), (x_m, y_m, z_f), (x_l, y_l, z_f), 'white', full_rect=False)
    b.add_quad((x_r, ped_y0, z_b), (x_l, ped_y0, z_b), (x_l, y_l, z_b), (x_r, y_r, z_b), 'white', full_rect=False)
    b.add_quad((x_r, y_r, z_b), (x_l, y_l, z_b), (x_m, y_m, z_b), (x_r, y_r, z_b), 'white', full_rect=False)
    b.add_quad((x_l, y_l, z_f), (x_m, y_m, z_f), (x_m, y_m, z_b), (x_l, y_l, z_b), 'white', full_rect=False)
    b.add_quad((x_m, y_m, z_f), (x_r, y_r, z_f), (x_r, y_r, z_b), (x_m, y_m, z_b), 'white', full_rect=False)
    # Crimson school title plaque integrated flush on the white pediment
    b.sign(-0.4, ped_y0 + 0.92, z_f + 0.05, 8.6, 1.18, 'sign_gate')

    # Closed stainless retractable gate between inner columns
    b.retractable_gate(8.0, gate_h=1.45, y0=y0)
    b.box(0.0, -0.45, 1.8, beam_w + 1.2, 0.50, 4.6, 'pave_dark', cap_region='pave_grey')
    b.pose = old


def _houde_twin_pavilions_and_portal(b: SchoolBuilder):
    """Add signature architectural features of 厚德楼 (ref [06]) onto its East track-facing facade:
    - Twin 6-storey Corner Towers with dark slate-grey 1F base, vertical glass curtain strips,
      and 4-column overhanging square pavilion roofs ('双角亭'!)
    - 2-storey central open colonnade portal + large 3F-4F framed blue-glass curtain window.
    """
    old = b.pose
    # East wing of OV_HOUDE runs along x ~ -22.66 from z = 25.57 to z = 46.74, facing East (+X, yaw = pi/2)
    b.pose = (-22.65, 0.0, 36.15, math.pi * 0.5)
    y0 = 0.05
    tower_h = 20.6

    # 1. Twin Corner Towers ('双角亭') at z_world = 47.4 (local x = -11.25) and z_world = 24.9 (local x = +11.25)
    for tx in (-11.25, 11.25):
        # Dark slate-grey 1F stone base (ref [06]!)
        b.box(tx, -0.8, 0.35, 5.8, 0.8 + y0 + 3.85, 5.8, 'wall_base', cap_region='wall_base', collide=True)
        # Khaki-sandstone 2F-6F tower shaft
        b.box(tx, y0 + 3.85, 0.35, 5.5, tower_h - 3.85, 5.5, 'wall_main', cap_region='white', collide=True)
        # Vertical glass window strip on front (+Z), outer side, and back
        for wy_fl in range(5):
            wy = y0 + 1.1 + wy_fl * 3.65
            b.add_quad((tx - 1.15, wy, 3.16), (tx + 1.15, wy, 3.16),
                       (tx + 1.15, wy + 2.55, 3.16), (tx - 1.15, wy + 2.55, 3.16), 'glass', full_rect=True)
        # Tower cornice collar
        pav_y = y0 + tower_h
        b.box(tx, pav_y, 0.35, 6.2, 0.42, 6.2, 'white')
        # 4 corner pavilion columns + lattice window core ('亭子式塔冠'!)
        for cx_p in (-2.25, 2.25):
            for cz_p in (-1.90, 2.60):
                b.box(tx + cx_p, pav_y + 0.42, cz_p, 0.44, 2.55, 0.44, 'wall_main')
        b.box(tx, pav_y + 0.42, 0.35, 3.6, 2.45, 3.6, 'glass')
        # Bold wide-overhanging pavilion eaves slab (bottom=True so shaded underside reads crisply from track!) + hipped cap
        b.box(tx, pav_y + 2.85, 0.35, 8.4, 0.36, 8.4, 'wall_base', cap_region='white', bottom=True)
        b.box(tx, pav_y + 3.21, 0.35, 6.2, 0.52, 6.2, 'white', cap_region='roof_tile')
        b.cylinder_y(tx, pav_y + 3.73, 1.35, 0.35, 0.10, 'steel', r_top=0.03, segs=6)

    # 2. Central 2-storey colonnaded portal + 3F-4F large dark-framed blue curtain window (ref [06]!)
    # Recessed dark lobby backdrop + 4 square columns + dark horizontal cornice beam
    b.box(0.0, y0, 0.15, 13.6, 7.15, 0.55, 'pave_dark')
    for px in (-6.2, -2.4, 2.4, 6.2):
        b.box(px, y0, 0.95, 0.72, 7.15, 0.72, 'wall_main', collide=True)
    b.box(0.0, y0 + 7.15, 0.75, 14.8, 0.48, 1.35, 'wall_base', cap_region='white')

    # Large square central blue-glass curtain window on 3F-4F
    b.box(0.0, y0 + 8.35, 0.28, 5.6, 5.8, 0.32, 'wall_base')
    b.add_quad((-2.55, y0 + 8.60, 0.48), (2.55, y0 + 8.60, 0.48),
               (2.55, y0 + 13.90, 0.48), (-2.55, y0 + 13.90, 0.48), 'glass', full_rect=True)
    b.sign(0.0, y0 + 7.80, 0.95, 3.8, 0.85, 'sign_bldg1')
    b.pose = old


def _kechuang_teal_podium_overlay(b: SchoolBuilder, ring_xz: list[tuple[float, float]], stair_xz: tuple[float, float]):
    """Reinforce 2F jade/teal-green windowed podium band & rooftop stair penthouse on 科创楼 (ref [13]!)."""
    pts = b._clean_ring_ccw(ring_xz)
    n = len(pts)
    old = b.pose
    # 2F teal-green spandrel & pier band (y = 3.55 .. 7.10) + 3F-6F warm gridded balcony frames
    for i in range(n):
        x0, z0 = pts[i]
        x1, z1 = pts[(i + 1) % n]
        dx, dz = x1 - x0, z1 - z0
        elen = math.hypot(dx, dz)
        if elen < 2.0:
            continue
        nx, nz = -dz / elen, dx / elen
        eyaw = math.atan2(-dz, dx)
        b.pose = ((x0 + x1) * 0.5 + nx * 0.08, 0.0, (z0 + z1) * 0.5 + nz * 0.08, eyaw)
        # 2F teal-green sill & lintel bands
        b.box(0.0, 3.55, 0.0, elen + 0.2, 0.95, 0.22, 'wall_sub')
        b.box(0.0, 6.65, 0.0, elen + 0.2, 0.48, 0.24, 'wall_sub')
        n_bays = max(1, round(elen / 3.8))
        for bi in range(n_bays + 1):
            px = -elen * 0.5 + bi * (elen / n_bays)
            b.box(px, 3.55, 0.0, 0.42, 3.55, 0.24, 'wall_sub')
            if b.detail:
                b.box(px, 7.10, 0.0, 0.36, 14.2, 0.26, 'wall_accent')
    # Rooftop stair/elevator penthouse with overhanging flat slab (ref [13]!)
    b.pose = (stair_xz[0], 0.0, stair_xz[1], 0.0)
    b.box(0.0, 21.3, 0.0, 6.8, 3.1, 6.8, 'wall_main', cap_region='white')
    b.box(0.0, 24.4, 0.0, 7.8, 0.32, 7.8, 'pave_dark', cap_region='white')
    b.pose = old


def _sun_yatsen_plaza(b: SchoolBuilder, cx: float, cz: float):
    """Sun Yat-sen bronze memorial statue & 4 white commemorative pillars in central courtyard."""
    old = b.pose
    b.pose = (cx, 0.0, cz, 0.0)
    y0 = 0.06
    b.box(0.0, y0, 0.0, 12.6, 0.24, 12.6, 'pave_dark', cap_region='white', collide=False)
    b.box(0.0, y0 + 0.24, 0.0, 3.2, 0.45, 3.2, 'cinnabar', cap_region='white', collide=True)
    b.box(0.0, y0 + 0.69, 0.0, 1.65, 2.25, 1.65, 'cinnabar', cap_region='gold', collide=True)
    b.cylinder_y(0.0, y0 + 2.94, 2.05, 0.0, 0.42, 'pave_dark', r_top=0.32, segs=8)
    b.cylinder_y(0.0, y0 + 4.99, 0.46, 0.0, 0.25, 'pave_dark', r_top=0.20, segs=8)
    for sx in (-4.8, 4.8):
        for sz in (-4.8, 4.8):
            b.cylinder_y(sx, y0 + 0.24, 4.2, sz, 0.32, 'white', segs=8, collide=True)
            b.box(sx, y0 + 4.44, sz, 0.85, 0.22, 0.85, 'gold')
    b.pose = old


def build_yixian(b: SchoolBuilder):
    # 1. Full campus granite paving across way/647471576
    b.prism(RING, -1.6, 1.65, 'pave_dark', cap_region='pave_grey', collide=False)

    # 2. Perimeter fence with ONE north gate on 尚智巷 (edge 6: (47.95,-128.02)->(-18.89,-126.39), len=66.9m)
    b.perimeter_fence(RING, gate_edge=6, gate_t0=0.35, gate_t1=0.65, wall_h=2.25)

    p6, p7 = RING[6], RING[7]
    gx = p6[0] + (p7[0] - p6[0]) * 0.50
    gz = p6[1] + (p7[1] - p6[1]) * 0.50
    _yixian_north_gate(b, gx, gz, yaw=math.pi)

    # 3. Exact Overture Buildings (offset 0.00 m, angle diff 0.0 deg!)
    # (a) 厚德楼 + Twin Corner Pavilions ('双角亭') & dark slate-grey ground base (ref [06])
    b.footprint_building(OV_HOUDE, name='厚德楼（双角亭主教学楼）', source_id='overture/cf7fd883',
                         floors=5, floor_h=3.65, roof='flat_rail',
                         base_floors=1, use_base_tex=True, parapet_reg='wall_main', top_parapet_reg='white')
    _houde_twin_pavilions_and_portal(b)

    b.footprint_building(OV_HOUDE_S, name='厚德楼南翼', source_id='overture/8ec9a3bb',
                         floors=5, floor_h=3.55, roof='flat_rail',
                         base_floors=1, use_base_tex=True, parapet_reg='wall_main', top_parapet_reg='white')

    # (b) 科创楼东侧三栋组团: 1F open teal-green piloti columns + 2F teal-green podium + 3F-6F beige grid (ref [13]!)
    b.footprint_building(OV_KECHUANG_S, name='科创南楼', source_id='overture/7fd618fe',
                         floors=6, floor_h=3.55, roof='flat',
                         piloti_first_floor=True, base_floors=1, use_base_tex=False,
                         parapet_reg='wall_accent', top_parapet_reg='white')
    _kechuang_teal_podium_overlay(b, OV_KECHUANG_S, (83.0, 40.5))

    b.footprint_building(OV_KECHUANG_M, name='科创中连楼', source_id='overture/7ab7e364',
                         floors=5, floor_h=3.55, roof='flat',
                         piloti_first_floor=True, base_floors=1, use_base_tex=False,
                         parapet_reg='wall_accent', top_parapet_reg='white')

    b.footprint_building(OV_KECHUANG_N, name='科创北楼', source_id='overture/d9376a46',
                         floors=6, floor_h=3.55, roof='flat',
                         piloti_first_floor=True, base_floors=1, use_base_tex=False,
                         parapet_reg='wall_accent', top_parapet_reg='white')
    _kechuang_teal_podium_overlay(b, OV_KECHUANG_N, (84.0, 4.5))

    # (c) 综合实验大楼北组团 & 博学楼西组团
    b.footprint_building(OV_SHIYAN_N, name='综合实验大楼北翼', source_id='overture/4a31afc8',
                         floors=5, floor_h=3.55, roof='flat_rail',
                         base_floors=1, use_base_tex=True, parapet_reg='white', top_parapet_reg='white')
    b.footprint_building(OV_SHIYAN_S, name='综合实验大楼南翼', source_id='overture/0490bee8',
                         floors=5, floor_h=3.55, roof='flat_rail',
                         base_floors=1, use_base_tex=True, parapet_reg='white', top_parapet_reg='white')
    b.footprint_building(OV_SHIYAN_E, name='实验附楼', source_id='overture/2c5ac658',
                         floors=4, floor_h=3.50, roof='flat',
                         base_floors=1, use_base_tex=True, parapet_reg='white', top_parapet_reg='white')

    for bname, bsrc, bring, bfl in OV_OTHER:
        b.footprint_building(bring, name=bname, source_id=bsrc,
                             floors=bfl, floor_h=3.45, roof='flat',
                             base_floors=1, use_base_tex=True, parapet_reg='white', top_parapet_reg='white')

    # 4. Memorial Plaza & Exact OSM Sports Fields (zero grass triangle artifacts!)
    _sun_yatsen_plaza(b, -8.0, -32.0)
    b.flagpole_plaza(-16.0, 20.0, yaw=math.pi * 0.5, y0=0.06, with_motto_wall=False)

    # OSM relation/20185381 running track at (21.82, 41.80), 122.47 x 67.05 m, ang=90.67 deg
    b.running_track(21.82, 41.80, length=116.0, width=63.0, yaw=math.radians(90.67),
                    y0=0.07, track_reg='track_red', infield_mode='turf', stand_side=0)
    # Sage-green northern D-zone court apron visible in ref [06]
    b.box(21.5, 0.21, -2.5, 34.0, 0.03, 14.0, 'court_a', cap_region='court_a')

    # Exact OSM 3 side-by-side basketball courts (way/1474979896..1474979898)
    for cx_c, cz_c in ((70.11, 77.43), (86.74, 76.94), (105.34, 76.58)):
        b.basketball_court(cx_c, cz_c, yaw=math.radians(90.49), w=27.15, d=15.50,
                           surface='court_a', apron='court_b', y0=0.07)

    # Exact OSM SW multi-sport pitch (way/1036824396 at (-56.76, 81.18), 55.99 x 46.21 m)
    b.box(-56.76, 0.06, 81.18, 54.0, 0.04, 44.0, 'track_red', cap_region='track_red')
    for bx_sw in (-68.0, -45.5):
        b.basketball_court(bx_sw, 81.18, yaw=math.pi * 0.5, w=26.0, d=14.5,
                           surface='court_a', apron='court_b', y0=0.10)

    # Lush row of camphor trees + green fence along East side of running track (exact match to ref [13]!)
    for ti in range(8):
        tz = -4.0 + ti * 9.5
        b.tree(59.5, tz, scale=1.12, seed=310 + ti * 7)
    b.green_strip(4.0, -118.0, w=24.0, d=3.6, yaw=0.0, trees=4, seed=351)


if __name__ == '__main__':
    export_school_glb('yixian_high', PALETTE, SIGNS, build_yixian, seed=202603)
