"""桂林市旅游职业中等专业学校（穿山校区）(`way/647468198`) full campus restoration.

Evidence: .ops-docs/layout/schools/chuanshan_tourism.md (Esri z19 imagery, OSM, Overture, public photo).
- 20 teaching/office/hall blocks on their OSM/Overture footprints (all mapped as `building`),
  heights from imagery shadows; the large NE complex (`f49f6caa` = `relation/20180296`) keeps
  its open courtyard.
- 400 m athletics track with turf pitch (`relation/9035639`, `way/378650266`), the court column
  west of it (`way/1474590953..61`) and two SW basketball courts (`way/1474590962/63`).
- The 毅峰 wooded hill (`way/997468644`) stays natural: no paving, no clearing.
- Closed east gate on the service road off 穿山东路 (`ref_00`): white sail pylon, teal-white
  canopy and a closed retractable gate. The gatehouse in the photo is deliberately not built;
  no turnstile or camera; building uses are unlabelled.
"""
import math

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import split

from school_kit import SchoolBuilder, export_school_glb, mrr_stats, hole_free as _hole_free, stadium_polygon as _stadium, terrain_track

PALETTE = {
    'wall_main':   '#eeede8',
    'wall_sub':    '#45a6a3',  # teal accent of the gate canopy (`ref_00`)
    'wall_accent': '#9aa3ab',
    'wall_base':   '#6f767d',
    'win_frame':   '#5c6f80',
    'win_trim':    '#f4f3ef',
    'base_frame':  '#b9c0c6',
    'base_trim':   '#6c737a',
    'pave_grey':   '#c6c3bb',
    'pave_road':   '#8f8d88',
    'pave_dark':   '#55595d',
    'granite':     '#b4b1a9',
    'roof_tile':   '#6b7178',
    'roof_blue':   '#7b9fc4',
    'track_red':   '#ad4d3e',
    'turf_a':      '#4c8b45',
    'turf_b':      '#3f7a3a',
    'court_a':     '#3d7f5c',
    'court_b':     '#3b63a8',
    'cinnabar':    '#c4513f',
    'cream':       '#e4e0d6',
    'white':       '#f4f3ef',
    'dark_stone':  '#565a5f',
    'steel':       '#aab1b7',
    'has_ac':      True,
}

SIGNS = {
    'school_name': '桂林市旅游职业中等专业学校',
    'school_en':   'Guilin Vocational Secondary School of Tourism',
    'gate_bg':     '#f2f1ec',
    'gate_fg':     '#a3251f',
    'gate_sub_fg': '#55585c',
    'vert_bg':     '#c9ccd0',
    'vert_fg':     '#1e1e1e',
    'vert_text':   '桂林市旅游职业中等专业学校',
    'motto':       '',
    'led_title':   '桂林市旅游职业中等专业学校',
    'emblem':      '旅职',
}

# Campus inset 0.8 m, notched around the kept NE houses (`163da141`, `04ca60c8`, `204ae674`);
# the south edges by the track stand 7 m in, clear of the terrain trough along 毅峰路.
FENCE_RING = [(75.0, 163.5), (99.06, 158.0), (113.8, 151.0), (157.6, 139.0), (168.0, 136.0), (161.87, 43.79), (148.03, -50.92), (149.25, -92.5), (154.77, -127.36), (157.49, -163.05), (126.67, -165.08), (126.49, -170.32), (124.43, -170.48), (123.99, -171.04), (124.97, -184.6), (125.32, -185.05), (126.01, -185.07), (125.79, -191.58), (122.23, -192.16), (121.78, -192.72), (123.95, -206.21), (124.39, -206.64), (125.3, -206.54), (125.12, -212.04), (96.73, -203.33), (51.73, -190.91), (43.16, -208.83), (-129.94, -125.54), (-123.69, -86.97), (-136.67, -86.38), (-138.72, -84.58), (-143.17, -83.73), (-185.63, -83.69), (-188.2, 29.37), (-143.5, 169.81), (62.9, 173.5)]
GATE_EDGE = ((149.25, -92.5), (154.77, -127.36))
WOOD = [(-61.41, 80.56), (-29.17, 79.25), (-0.34, 79.42), (-0.79, 91.28), (-1.2, 102.9), (11.08, 134.21),
        (-15.85, 149.08), (-14.61, 166.39), (-32.78, 166.23), (-72.38, 166.39), (-142.75, 164.93),
        (-167.79, 76.0), (-59.44, 32.92)]   # way/997468644, left natural

R = {
'a54eabab-75d0-476e-b89b-44ff65c8f967': [(132.62, -157.07), (130.66, -145.25), (138.06, -144.03), (140.01, -155.85)],
'f49f6caa-f8a5-4db7-9178-28d811b1e0a8': [(105.95, -192.21), (102.75, -200.06), (88.36, -196.6), (70.19, -188.95), (51.81, -182.16), (37.55, -176.77), (42.18, -167.36), (58.22, -172.59), (58.5, -170.19), (68.19, -164.6), (69.61, -164.53), (72.32, -155.54), (73.32, -151.51), (64.63, -151.36), (49.66, -151.93), (50.1, -141.17), (69.33, -139.61), (68.48, -137.42), (68.62, -120.0), (70.68, -120.15), (69.83, -116.82), (69.78, -113.99), (70.32, -111.87), (71.47, -109.95), (68.48, -109.89), (69.26, -90.14), (53.59, -89.43), (-10.89, -64.65), (2.14, -31.73), (40.76, -32.3), (40.68, -36.91), (49.17, -36.76), (49.47, -42.37), (59.21, -42.92), (59.05, -47.28), (77.31, -49.36), (77.1, -57.14), (81.25, -57.12), (81.09, -72.93), (76.1, -73.0), (76.25, -77.61), (94.77, -77.68), (103.31, -78.74), (107.45, -79.87), (108.17, -88.65), (111.82, -88.99), (111.8, -90.7), (103.17, -89.92), (95.19, -89.0), (86.43, -88.29), (78.45, -88.86), (78.24, -93.95), (86.43, -94.03), (86.36, -107.83), (88.78, -111.58), (89.86, -115.61), (89.35, -118.59), (88.5, -120.65), (86.29, -122.83), (86.43, -135.15), (78.31, -134.94), (78.31, -141.02), (85.86, -141.31), (94.12, -141.02), (103.38, -140.81), (107.94, -140.81), (107.02, -149.31), (99.61, -149.31), (99.9, -151.65), (98.54, -151.72), (86.79, -152.21), (76.32, -151.36), (80.09, -154.69), (74.31, -169.41), (68.12, -167.14), (60.93, -171.47), (59.86, -174.09), (89.42, -184.91)],
'042bfbf6-b433-4bcb-baf7-aa7aa7313e3d': [(-7.39, -143.04), (-59.84, -142.96), (-59.82, -129.91), (-18.31, -129.98), (-18.25, -94.8), (-63.93, -94.74), (-63.91, -82.36), (-4.94, -82.45), (-4.96, -93.33), (25.33, -93.38), (25.28, -130.81), (-7.37, -130.76)],
'a93ff043-546e-4909-9b4b-8c7451f51330': [(42.71, -158.14), (3.88, -171.37), (2.75, -168.06), (-0.47, -169.14), (-3.97, -158.99), (38.06, -144.67)],
'82f9bf7e-5ab2-4e00-8bfb-443b74de33c8': [(-36.36, -70.84), (-52.7, -70.36), (-51.96, -45.67), (-83.51, -44.74), (-83.09, -30.58), (-35.19, -32.01)],
'66e2ceb1-84dc-4524-99ad-c05ad828583f': [(-96.91, -28.52), (-96.66, 17.42), (-71.11, 17.42), (-37.02, -0.96), (-36.79, -30.63)],
'7f627ba3-1427-4bd3-adc3-c1f0e49d8a78': [(-92.89, -36.05), (-123.62, -35.88), (-123.55, -22.32), (-126.36, -22.31), (-126.17, 14.19), (-123.34, 14.18), (-123.27, 25.58), (-96.62, 25.43), (-96.66, 17.42), (-96.91, -28.52), (-92.85, -28.54)],
'0ccf0efc-e02b-4430-8b5e-8bb549f53b4a': [(-86.25, -65.94), (-114.78, -66.33), (-114.78, -55.01), (-103.52, -55.52), (-100.96, -52.34), (-73.44, -53.36), (-64.61, -55.01), (-64.49, -65.06), (-78.95, -66.33), (-78.82, -73.45), (-85.73, -73.71)],
'5a1b142d-81bd-47af-a61c-a7f5dd7535f3': [(-94.64, -37.53), (-94.56, -48.12), (-123.19, -48.32), (-123.26, -37.73)],
'ce4e79d1-9f20-4bc0-9e36-6a98382ccaa9': [(-115.98, -123.72), (-120.12, -125.49), (-123.08, -118.61), (-118.94, -116.84)],
'7626a7c4-2a8d-433d-8441-4f8e8f3f1eb6': [(-92.99, -105.53), (-119.37, -105.99), (-119.56, -96.24), (-115.5, -96.18), (-115.6, -90.28), (-119.88, -90.36), (-120.1, -78.33), (-93.48, -77.85), (-93.26, -89.86), (-96.13, -89.91), (-96.0, -97.19), (-93.14, -97.14)],
'5e535918-8d7f-4a0a-91f8-4bd466ae4760': [(-69.25, -133.67), (-108.38, -132.03), (-107.85, -119.4), (-83.27, -120.41), (-83.06, -115.43), (-68.5, -116.03)],
'b0f27740-dfbd-4fd7-9ff1-18d4dd04b59e': [(-81.02, -150.32), (-82.51, -142.98), (-78.1, -142.09), (-76.61, -149.43)],
'c2b6eee4-fc5a-4733-b2bf-ba19a170fa72': [(-42.44, -106.55), (-61.89, -107.94), (-62.63, -97.49), (-43.2, -96.1)],
'c4b87ad2-eb89-4249-bd0f-a4f9a95b6066': [(-139.29, -82.85), (-181.76, -82.96), (-181.81, -65.12), (-176.81, -65.1), (-176.82, -61.68), (-143.8, -61.59), (-143.79, -65.46), (-139.35, -65.45)],
'50f01248-d1f5-4e91-b09f-f016762f89c1': [(-139.68, -48.47), (-152.05, -48.42), (-152.02, -42.62), (-158.77, -42.59), (-158.65, -18.71), (-153.64, -18.73), (-153.62, -13.94), (-139.52, -14.01)],
'40ef61ea-e9b8-4e8f-90d3-e17f27c4e39d': [(-148.88, 10.67), (-186.53, 22.04), (-180.03, 43.67), (-137.08, 30.92), (-140.05, 21.03), (-138.63, 19.75), (-141.07, 11.65), (-144.71, 12.73), (-145.59, 9.81)],
'3e520072-a451-42a6-88fd-c7241b6fd668': [(-140.94, -7.97), (-152.96, -4.84), (-148.88, 10.67), (-145.59, 9.81), (-136.86, 7.54)],
'a3ab5d9c-a0fa-420b-a0aa-a6d3ccab7a2d': [(-188.78, -39.23), (-188.93, -33.24), (-176.94, -32.94), (-176.79, -38.92)],
'way/1474590953': [(2.96, 7.23), (2.84, 106.32), (13.63, 116.56), (15.86, 163.88), (34.34, 163.26), (33.71, 145.64), (37.71, 145.5), (37.02, 110.9), (36.92, 106.22), (34.6, -9.21), (2.96, 7.23)],
'way/1474590954': [(7.83, 11.98), (8.21, 40.57), (23.55, 40.37), (23.16, 11.78), (7.83, 11.98)],
'way/1474590955': [(8.99, 76.92), (9.38, 105.51), (24.71, 105.3), (24.32, 76.71), (8.99, 76.92)],
'way/1474590956': [(17.2, 108.67), (17.58, 137.27), (32.92, 137.06), (32.53, 108.46), (17.2, 108.67)],
'way/1474590957': [(20.76, 140.39), (20.98, 159.32), (30.32, 159.21), (30.1, 140.28), (20.76, 140.39)],
'way/1474590958': [(8.72, 44.21), (8.78, 51.41), (8.84, 57.33), (15.09, 57.28), (14.98, 44.15), (8.72, 44.21)],
'way/1474590959': [(17.24, 44.44), (17.29, 51.65), (17.35, 57.57), (23.59, 57.52), (23.48, 44.39), (17.24, 44.44)],
'way/1474590960': [(8.92, 59.68), (8.98, 66.89), (9.03, 72.8), (15.28, 72.76), (15.17, 59.62), (8.92, 59.68)],
'way/1474590961': [(17.56, 59.57), (17.61, 66.78), (17.67, 72.7), (23.91, 72.65), (23.81, 59.52), (17.56, 59.57)],
'way/1474590962': [(-51.92, 46.55), (-51.53, 75.15), (-36.2, 74.94), (-36.59, 46.34), (-51.92, 46.55)],
'way/1474590963': [(-34.0, 46.65), (-33.6, 75.25), (-18.27, 75.05), (-18.67, 46.45), (-34.0, 46.65)],
'way/378650266': [(49.66, 14.32), (118.35, 13.26), (120.02, 119.32), (51.33, 120.38), (49.66, 14.32)],
'way/1474590964': [(174.61, -113.73), (167.41, -113.5), (118.35, -111.97), (117.51, -65.37), (48.28, -28.15), (-0.05, -4.02), (-70.06, 32.48), (-130.1, 50.97), (-134.07, -61.68), (-115.22, -71.29), (-91.4, -74.99), (-86.44, -74.99), (-86.68, -104.81), (-62.94, -107.92)],
'way/1474590965': [(118.35, -111.97), (117.9, -172.22)],
'way/1474590966': [(-62.94, -107.92), (-66.58, -147.57), (-28.28, -169.2), (6.52, -178.08), (39.49, -184.81), (52.26, -188.7), (106.78, -205.3), (116.89, -207.2), (117.9, -172.22)],
'way/1474590967': [(-0.05, -4.02), (-18.34, -61.58)],
}

# (overture id, floors, floor height, roof)
BLOCKS = [
    ('042bfbf6-b433-4bcb-baf7-aa7aa7313e3d', 5, 3.5, 'flat_rail'),
    ('a93ff043-546e-4909-9b4b-8c7451f51330', 4, 3.4, 'flat_rail'),
    ('82f9bf7e-5ab2-4e00-8bfb-443b74de33c8', 4, 3.4, 'flat_rail'),
    ('66e2ceb1-84dc-4524-99ad-c05ad828583f', 2, 4.6, 'flat'),
    ('7f627ba3-1427-4bd3-adc3-c1f0e49d8a78', 2, 4.2, 'flat_rail'),
    ('0ccf0efc-e02b-4430-8b5e-8bb549f53b4a', 4, 3.4, 'flat_rail'),
    ('5a1b142d-81bd-47af-a61c-a7f5dd7535f3', 3, 3.4, 'flat'),
    ('7626a7c4-2a8d-433d-8441-4f8e8f3f1eb6', 4, 3.4, 'flat_rail'),
    ('5e535918-8d7f-4a0a-91f8-4bd466ae4760', 4, 3.4, 'flat_blue'),
    ('c2b6eee4-fc5a-4733-b2bf-ba19a170fa72', 2, 3.3, 'flat'),
    ('c4b87ad2-eb89-4249-bd0f-a4f9a95b6066', 4, 3.4, 'flat_rail'),
    ('50f01248-d1f5-4e91-b09f-f016762f89c1', 4, 3.4, 'flat_rail'),
    ('40ef61ea-e9b8-4e8f-90d3-e17f27c4e39d', 5, 3.4, 'flat_rail'),
    ('3e520072-a451-42a6-88fd-c7241b6fd668', 3, 3.3, 'flat'),
    ('b0f27740-dfbd-4fd7-9ff1-18d4dd04b59e', 1, 3.2, 'flat'),
    ('ce4e79d1-9f20-4bc0-9e36-6a98382ccaa9', 1, 3.2, 'flat'),
    ('a54eabab-75d0-476e-b89b-44ff65c8f967', 2, 3.3, 'flat'),
    ('a3ab5d9c-a0fa-420b-a0aa-a6d3ccab7a2d', 2, 3.3, 'flat'),
]
MAIN = 'f49f6caa-f8a5-4db7-9178-28d811b1e0a8'
MAIN_COURT = [(8.0, -58.0), (40.0, -58.0), (40.0, -40.0), (8.0, -40.0)]


def _pieces(ring, court):
    """Footprint minus courtyard, split into hole-free rings."""
    poly = Polygon(ring).difference(Polygon(court))
    out = []
    for p in ([poly] if poly.geom_type == 'Polygon' else list(poly.geoms)):
        if p.interiors:
            cx = Polygon(p.interiors[0]).centroid.x
            out.extend(split(p, LineString([(cx, -1e4), (cx, 1e4)])).geoms)
        else:
            out.append(p)
    return [[(round(x, 2), round(z, 2)) for x, z in list(q.exterior.coords)[:-1]] for q in out if q.area > 20]


def _gate(b: SchoolBuilder):
    p0, p1 = GATE_EDGE
    mx, mz = (p0[0] + p1[0]) * 0.5 + (p1[0] - p0[0]) * 0.088, (p0[1] + p1[1]) * 0.5 + (p1[1] - p0[1]) * 0.088
    yaw = math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0])
    gy = b.ground(mx, mz)
    old = b.pose
    b.pose = (mx, 0.0, mz, yaw)
    b.box(0.0, gy - 0.03, -2.4, 12.0, 0.055, 4.4, 'granite', cap_region='pave_grey')
    for sgn in (-1.0, 1.0):
        b.box(sgn * 4.7, gy - 0.03, -1.2, 0.9, 4.3, 0.9, 'white', cap_region='white', collide=True)
    # Teal-white canopy slab over the gate (`ref_00`)
    b.box(0.0, gy + 4.25, -1.2, 11.2, 0.45, 3.6, 'wall_sub', cap_region='white', collide=True, bottom=True)
    # White sail pylon on the north side (`ref_00`)
    b.box(-6.4, gy - 0.03, -1.2, 1.1, 11.5, 1.6, 'white', cap_region='white', collide=True)
    b.box(-6.4, gy + 11.4, -1.4, 0.7, 1.6, 1.0, 'white', cap_region='white', bottom=True)
    if b.lod < 2:
        b.sign(0.0, gy + 4.47, 0.61, 8.0, 0.42, 'sign_gate', double_sided=True)
    b.retractable_gate(8.6, gate_h=1.6, y0=gy)
    b.pose = old


def build_chuanshan(b: SchoolBuilder):
    dev = Polygon(FENCE_RING).difference(Polygon(WOOD).buffer(1.0))
    dev = max(dev.geoms, key=lambda p: p.area) if dev.geom_type != 'Polygon' else dev
    core = dev.buffer(-2.0, join_style=2)
    core = max(core.geoms, key=lambda p: p.area) if core.geom_type != 'Polygon' else core
    # Sports surfaces sit on their own flat bases: keep the campus slab out from under them.
    pcx, pcz, _, _, _ = mrr_stats(R['way/378650266'][:-1])
    holes = [_stadium(pcx, pcz + 0.4, 46.85), Polygon(R['way/1474590953'][:-1])]
    for q in _hole_free(core.difference(holes[0].union(holes[1]))):
        b.ground_slab(q, region='pave_grey', lift=0.025, edge_drop=0.04)
    ring = b._clean_ring_ccw(FENCE_RING)
    ge = next(i for i in range(len(ring)) if {ring[i], ring[(i + 1) % len(ring)]} == set(GATE_EDGE))
    b.perimeter_fence(FENCE_RING, gate_edge=ge, gate_t0=0.465, gate_t1=0.71,
                      wall_h=2.3, base_reg='wall_base', post_reg='white')
    _gate(b)

    common = dict(wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
                  parapet_reg='wall_accent', top_parapet_reg='white')
    for i, piece in enumerate(_pieces(R[MAIN], MAIN_COURT)):
        b.footprint_building(piece, bid=f'CS0{i}', source_id=MAIN, floors=5, floor_h=3.5, roof='flat_rail', **common)
    for n, (oid, floors, fh, roof) in enumerate(BLOCKS, 1):
        kw = common if floors >= 3 else dict(wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
                                              instanced_windows=floors > 1)
        b.footprint_building(R[oid], bid=f'CS{n}', source_id=oid, floors=floors, floor_h=fh, roof=roof, **kw)

    # 400 m track + turf pitch (`relation/9035639`, `way/378650266`).
    pcx, pcz, _, _, _ = mrr_stats(R['way/378650266'][:-1])
    terrain_track(b, pcx, pcz + 0.4, r=46.5, h=42.0, r_in=38.0)
    # Court column west of the track (`way/1474590953`), terrain-following blue base.
    b.ground_slab(R['way/1474590953'][:-1], region='court_b', lift=0.03, edge_drop=0.04)
    for k in ('way/1474590954', 'way/1474590955', 'way/1474590956', 'way/1474590962', 'way/1474590963'):
        cx, cz, w, d, ang = mrr_stats(R[k][:-1])
        b.basketball_court(cx, cz, yaw=math.radians(ang), w=w - 1.0, d=d - 1.0, surface='court_b',
                           apron=None if k < 'way/1474590960' else 'court_a', key_reg='cinnabar', lift=0.05)
    for k in ('way/1474590957', 'way/1474590958', 'way/1474590959', 'way/1474590960', 'way/1474590961'):
        cx, cz, w, d, ang = mrr_stats(R[k][:-1])
        old = b.pose
        b.pose = (cx, 0.0, cz, math.radians(ang))
        g = b.ground(cx, cz) + 0.075
        b.box(0.0, g, 0.0, w - 0.6, 0.02, d - 0.6, 'court_a', cap_region='court_a')
        if b.detail:
            b.box(0.0, g + 0.02, 0.0, 0.08, 0.012, d - 0.6, 'white')
        b.pose = old

    # Campus drives (`way/1474590964..67`) in short grounded pieces inside the developed area.
    for k in ('way/1474590964', 'way/1474590965', 'way/1474590966', 'way/1474590967'):
        pts = R[k]
        for p0, p1 in zip(pts, pts[1:]):
            n = max(1, int(math.dist(p0, p1) / 2.5))
            for j in range(n):
                a = (p0[0] + (p1[0] - p0[0]) * j / n, p0[1] + (p1[1] - p0[1]) * j / n)
                c = (p0[0] + (p1[0] - p0[0]) * (j + 1) / n, p0[1] + (p1[1] - p0[1]) * (j + 1) / n)
                mid = Point((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)
                ux, uz = (c[1] - a[1]) / max(1e-6, math.dist(a, c)) * 3.0, -(c[0] - a[0]) / max(1e-6, math.dist(a, c)) * 3.0
                gs = [b.ground(q[0] + sx * ux, q[1] + sx * uz) for q in (a, c, (mid.x, mid.y)) for sx in (-1.0, 0.0, 1.0)]
                if max(gs) - min(gs) <= 0.1 and dev.buffer(-4.0).contains(mid) and not any(Polygon(R[o]).buffer(3.5).contains(mid) for o, *_ in BLOCKS + [(MAIN,)]):
                    b.path_strip(a, c, width=6.0, region='pave_road')

    trees = [(x, z) for x in range(-120, 150, 18) for z in range(-200, 175, 18)]
    keep_out = [Polygon(R[o]).buffer(4.0) for o, *_ in BLOCKS + [(MAIN,)]]
    keep_out.append(Polygon([(36.0, -26.0), (136.0, -26.0), (136.0, 160.0), (36.0, 160.0)]))   # track
    keep_out.append(Polygon(R['way/1474590953'][:-1]).buffer(2.0))
    keep_out.extend(Polygon(R[k][:-1]).buffer(2.0) for k in ('way/1474590962', 'way/1474590963'))
    inside = dev.buffer(-3.0)
    picked = 0
    for i, (x, z) in enumerate(trees):
        if (i * 7) % 3:
            continue
        p = Point(x, z)
        if inside.contains(p) and not any(k.contains(p) for k in keep_out):
            b.tree(x, z, species=('camphor', 'osmanthus', 'banyan', 'ginkgo')[picked % 4],
                   scale=0.85 + 0.1 * (picked % 3), yaw=(x * 0.37 + z * 0.21) % math.tau)
            picked += 1


if __name__ == '__main__':
    export_school_glb('chuanshan_tourism', PALETTE, SIGNS, build_chuanshan, seed=2033)
