"""桂林技师学院 (`way/646911647`, 五里店路) full campus restoration.

Evidence: docs/layout/schools/guilin_technical.md (Esri z19 imagery, OSM, Overture, official photos).
- `GT1..GT5` five identical 6F blocks west of the track (OSM `way/1488496926..30`).
- `GT0` east main complex (OSM `relation/20317489` with its two courtyards kept open),
  6F white tile with blue banding and an 8F blue-glass centre tower facing the north gate
  (`ref_06`, `ref_01`), plus small annexes (`d089c8d7`, `ede69944`, `33c94f8e`, `bc83beb6`).
- 400 m track around a turf pitch (`relation/20192391`), terrain-following surfaces on a
  flatten patch limited to the track.
- Closed north gate off 五里店路 on the campus drive (`way/1475480315`): blue-white canopy and
  red curved name wall (`ref_06`). The gate booths in Overture are removed and not rebuilt;
  no turnstile or camera; building uses are unlabelled.
"""
import math

from shapely.geometry import Point, Polygon

from school_kit import (SchoolBuilder, export_school_glb, hole_free, stadium_polygon,
                        terrain_track)

PALETTE = {
    'wall_main':   '#f0efea',  # white tile (`ref_06`)
    'wall_sub':    '#2f6db8',  # blue glass / bands (`ref_06`, `ref_01`)
    'wall_accent': '#3a72b8',
    'wall_base':   '#7c838a',
    'win_frame':   '#3a6aa6',
    'win_trim':    '#f4f3ef',
    'base_frame':  '#bdc4ca',
    'base_trim':   '#2f6db8',
    'pave_grey':   '#c7c4bc',
    'pave_road':   '#94928c',
    'pave_dark':   '#56595d',
    'granite':     '#b5b2aa',
    'roof_tile':   '#6c7279',
    'roof_blue':   '#6f97c7',
    'track_red':   '#a9503f',
    'turf_a':      '#5a8f4a',
    'turf_b':      '#4d7f40',
    'court_a':     '#3d7f5c',
    'court_b':     '#3b63a8',
    'cinnabar':    '#b8302a',  # red curved name wall (`ref_06`)
    'cream':       '#e6e2d8',
    'white':       '#f4f3ef',
    'dark_stone':  '#565a5f',
    'steel':       '#aab1b7',
    'has_ac':      True,
}

SIGNS = {
    'school_name': '桂林技师学院',
    'school_en':   'Guilin Technicians College',
    'gate_bg':     '#f2f1ec',
    'gate_fg':     '#b0242a',
    'gate_sub_fg': '#55585c',
    'vert_bg':     '#b8302a',
    'vert_fg':     '#f5f0e6',
    'vert_text':   '桂林技师学院',
    'motto':       '',
    'led_title':   '桂林技师学院',
    'emblem':      '技师',
}

# Campus inset 0.8 m, clear of 五里店路 / 穿山东路 sidewalks and notched round house `217a6b45`.
FENCE_RING = [(-155.71, -47.63), (-149.79, -48.41), (-149.28, -48.16), (-147.78, -37.34), (-148.03, -36.83), (-148.83, -36.65), (-145.7, -31.67), (-113.73, 9.78), (-35.28, 98.92), (43.79, 179.08), (42.55, 96.12), (106.01, 93.83), (108.19, 20.77), (113.21, 12.03), (116.95, 2.65), (125.18, -15.2), (121.17, -100.1), (60.56, -96.78), (-175.07, -78.49)]
# The world grid ends at local z = +84.7 (world z 3328): the south wedge and the track's
# south bend lie beyond it, so everything is clipped to WORLD_EDGE.
WORLD_EDGE = Polygon([(-400.0, -400.0), (400.0, -400.0), (400.0, 83.5), (-400.0, 83.5)])
FENCE_RING = [(round(x, 2), round(z, 2)) for x, z in
              list(Polygon(FENCE_RING).intersection(WORLD_EDGE).exterior.coords)[:-1]]
GATE_EDGE = ((121.17, -100.1), (60.56, -96.78))

R = {
    '3f7b60a2-ec22-4779-b0df-1e920067b699': [(-65.93, -9.13), (-93.98, -7.75), (-93.39, 4.35), (-87.25, 4.05), (-87.01, 8.79), (-91.54, 9.01), (-90.89, 22.04), (-65.14, 20.77), (-65.85, 6.59), (-71.74, 6.89), (-71.89, 4.03), (-65.3, 3.7)],
    'ed88be17-d337-4395-9571-5384ddff9525': [(-58.01, -90.34), (-86.07, -88.95), (-85.47, -76.86), (-79.33, -77.16), (-79.1, -72.41), (-83.63, -72.19), (-82.97, -59.17), (-57.21, -60.44), (-57.93, -74.61), (-63.83, -74.31), (-63.97, -77.18), (-57.37, -77.51)],
    'ef9e584d-71d9-4591-81f6-50bfc3e5efd5': [(-88.01, -87.81), (-116.06, -86.43), (-115.45, -74.32), (-109.32, -74.63), (-109.08, -69.89), (-113.61, -69.67), (-112.96, -56.64), (-87.21, -57.92), (-87.91, -72.08), (-93.81, -71.79), (-93.95, -74.66), (-87.36, -74.98)],
    'c02745ff-ff9c-43ce-bc79-3db672ae7192': [(-122.77, -84.31), (-150.83, -82.93), (-150.22, -70.82), (-144.08, -71.13), (-143.85, -66.39), (-148.38, -66.16), (-147.73, -53.14), (-121.97, -54.41), (-122.68, -68.57), (-128.58, -68.29), (-128.72, -71.15), (-122.13, -71.47)],
    'ede69944-9b65-47de-b2af-03fb050c182d': [(-149.93, -51.29), (-149.77, -64.0), (-162.48, -64.16), (-162.65, -51.46)],
    '33c94f8e-b055-4594-8108-1e0712cdeffe': [(-121.67, -12.1), (-123.21, -22.59), (-135.79, -20.73), (-134.25, -10.25)],
    'c6af27ec-3b54-4c87-be0d-c3f24c3825be': [(-95.28, -43.53), (-123.34, -42.16), (-122.73, -30.05), (-116.6, -30.35), (-116.36, -25.62), (-120.89, -25.38), (-120.24, -12.36), (-94.49, -13.64), (-95.19, -27.81), (-101.09, -27.52), (-101.23, -30.38), (-94.65, -30.7)],
    'bc83beb6-a0b0-4d4f-8b43-8a4728f1601a': [(-97.41, 22.62), (-98.48, 14.21), (-104.8, 15.02), (-103.71, 23.42)],
    '5a203276-3e34-4b50-8023-75f3b0e01ebd': [(69.53, -23.6), (67.17, -23.58), (67.46, 3.44), (74.76, 3.36), (74.84, 10.74), (72.27, 10.76), (72.5, 38.03), (55.13, 38.17), (55.43, 75.47), (57.4, 75.45), (57.42, 78.59), (67.03, 78.52), (67.02, 75.92), (86.62, 75.82), (86.63, 77.53), (98.93, 77.48), (98.82, 46.8), (101.29, 46.79), (101.16, 11.69), (98.78, 11.7), (98.74, 4.13), (106.8, 4.08), (106.68, -20.39), (112.7, -20.42), (112.6, -37.43), (97.3, -37.34), (97.33, -32.04), (93.0, -32.02), (92.82, -56.48), (104.19, -56.57), (104.24, -50.29), (112.79, -50.36), (112.73, -56.67), (108.27, -56.62), (108.21, -61.79), (113.98, -61.85), (113.87, -71.18), (104.92, -71.08), (104.97, -67.51), (99.12, -67.45), (99.09, -70.18), (77.75, -69.86), (77.79, -67.25), (71.67, -67.15), (71.6, -71.26), (61.17, -71.1), (61.31, -62.91), (58.77, -62.87), (58.8, -61.13), (66.17, -61.27), (66.24, -57.43), (60.81, -57.34), (60.92, -50.44), (72.05, -50.63), (71.95, -57.08), (82.99, -57.25), (83.03, -54.47), (79.96, -54.42), (80.27, -33.85), (76.11, -33.8), (76.17, -29.66), (69.46, -29.58)],
    'd089c8d7-f5af-4619-9853-73e40b418a94': [(112.56, -76.83), (120.17, -76.96), (120.18, -92.67), (112.57, -92.76)],
    '00ec2820-cbd0-4a97-a7de-3a72e93021ac': [(89.56, -86.19), (95.66, -86.29), (95.57, -90.16), (89.36, -90.06)],
    '09ab27ac-a425-4c2f-9114-5ba3050bdf06': [(83.65, -82.89), (89.26, -83.2), (89.05, -89.29), (83.26, -88.85)],
    'fef754d9-5c28-48a8-a9ef-4aae430f4ac9': [(76.45, -86.97), (80.26, -87.15), (80.06, -90.57), (76.25, -90.51)],
    'main_outer': [(55.43, 75.47), (57.4, 75.45), (57.42, 78.59), (67.03, 78.52), (67.02, 75.92), (86.62, 75.82), (86.63, 77.53), (98.93, 77.48), (98.82, 46.8), (101.29, 46.79), (101.16, 11.69), (98.78, 11.7), (98.74, 4.13), (106.8, 4.08), (106.68, -20.39), (112.7, -20.42), (112.6, -37.43), (97.3, -37.34), (97.33, -32.04), (93.0, -32.02), (92.82, -56.48), (104.19, -56.57), (104.24, -50.29), (112.79, -50.36), (112.73, -56.67), (108.27, -56.62), (108.21, -61.79), (113.98, -61.85), (113.87, -71.18), (104.92, -71.08), (104.97, -67.51), (99.12, -67.45), (99.09, -70.18), (77.75, -69.86), (77.79, -67.25), (71.67, -67.15), (71.6, -71.26), (61.17, -71.1), (61.31, -62.91), (58.77, -62.87), (58.8, -61.13), (66.17, -61.27), (66.24, -57.43), (60.81, -57.34), (60.92, -50.44), (72.05, -50.63), (71.95, -57.08), (82.99, -57.25), (83.03, -54.47), (79.96, -54.42), (80.27, -33.85), (76.11, -33.8), (76.17, -29.66), (69.46, -29.58), (69.53, -23.6), (67.17, -23.58), (67.46, 3.44), (74.76, 3.36), (74.84, 10.74), (72.27, 10.76), (72.5, 38.03), (55.13, 38.17)],
    'main_hole0': [(76.81, -18.29), (79.79, -21.86), (94.93, -21.99), (97.54, -16.93), (96.79, -6.21), (76.94, -6.58)],
    'main_hole1': [(65.88, 49.3), (87.46, 49.22), (87.51, 65.01), (65.94, 65.08)],
}

DORMS = ['c02745ff-ff9c-43ce-bc79-3db672ae7192', 'ef9e584d-71d9-4591-81f6-50bfc3e5efd5',
         'ed88be17-d337-4395-9571-5384ddff9525', 'c6af27ec-3b54-4c87-be0d-c3f24c3825be',
         '3f7b60a2-ec22-4779-b0df-1e920067b699']
SMALL = [('d089c8d7-f5af-4619-9853-73e40b418a94', 2), ('ede69944-9b65-47de-b2af-03fb050c182d', 2),
         ('33c94f8e-b055-4594-8108-1e0712cdeffe', 2), ('bc83beb6-a0b0-4d4f-8b43-8a4728f1601a', 1)]
TRACK_C = (-14.5, 5.3)
TOWER = [(78.0, -69.6), (92.0, -69.6), (92.0, -58.0), (78.0, -58.0)]


def _gate(b: SchoolBuilder):
    p0, p1 = GATE_EDGE
    t = 0.63
    mx, mz = p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t
    yaw = math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0])
    gy = b.ground(mx, mz)
    old = b.pose
    b.pose = (mx, 0.0, mz, yaw)
    b.box(0.0, gy - 0.03, -2.3, 12.0, 0.055, 4.0, 'granite', cap_region='pave_grey')
    for sgn in (-1.0, 1.0):
        b.box(sgn * 4.7, gy - 0.03, -1.3, 0.7, 4.1, 0.7, 'white', cap_region='white', collide=True)
    b.box(0.0, gy + 4.05, -1.3, 11.0, 0.4, 3.0, 'wall_sub', cap_region='white', collide=True, bottom=True)
    # Red curved name wall west of the gate (`ref_06`)
    for k in range(5):
        a = -0.5 + k * 0.25
        b.box(-8.6 - 2.2 * math.sin(a), gy - 0.03, -0.6 - 2.2 * (1 - math.cos(a)), 1.25, 3.6 - abs(k - 2) * 0.35, 0.5,
              'cinnabar', cap_region='white', collide=True)
    if b.lod < 2:
        b.sign(-8.6, gy + 1.9, -0.34, 0.55, 2.2, 'sign_vert', double_sided=True)
        b.sign(0.0, gy + 4.25, 0.21, 7.5, 0.36, 'sign_gate', double_sided=True)
    b.retractable_gate(8.6, gate_h=1.6, y0=gy)
    b.pose = old


def _inside(ring):
    """Footprint clipped 0.6 m inside the fence (the north row reaches the 五里店路 carriageway)."""
    q = Polygon(ring).intersection(Polygon(FENCE_RING).buffer(-0.6, join_style=2))
    q = max(q.geoms, key=lambda g: g.area) if q.geom_type != 'Polygon' else q
    return [(round(x, 2), round(z, 2)) for x, z in list(q.exterior.coords)[:-1]]


def build_technical(b: SchoolBuilder):
    core = Polygon(FENCE_RING).buffer(-2.0, join_style=2)
    track_hole = stadium_polygon(TRACK_C[0], TRACK_C[1], 49.0, 40.5)
    for q in hole_free(core.difference(track_hole)):
        b.ground_slab(q, region='pave_grey', lift=0.025, edge_drop=0.04)
    ring = b._clean_ring_ccw(FENCE_RING)
    ge = next(i for i in range(len(ring)) if {ring[i], ring[(i + 1) % len(ring)]} == set(GATE_EDGE))
    t0 = 0.56 if ring[ge] == GATE_EDGE[0] else 0.30
    b.perimeter_fence(FENCE_RING, gate_edge=ge, gate_t0=t0, gate_t1=t0 + 0.14,
                      wall_h=2.3, base_reg='wall_base', post_reg='white')
    _gate(b)

    common = dict(wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
                  parapet_reg='wall_accent', top_parapet_reg='white')
    main = Polygon(R['main_outer'], [R['main_hole0'], R['main_hole1']])
    for i, piece in enumerate(hole_free(main)):
        b.footprint_building(piece, bid=f'GT0{i}', source_id='5a203276-3e34-4b50-8023-75f3b0e01ebd',
                             floors=6, floor_h=3.5, roof='flat_rail', **common)
    if b.lod < 2:
        top = min(b.ground(x, z) for x, z in R['main_outer']) + 21.0  # sits into the 6F roof
        b.prism(TOWER, top - 1.5, 8.5, 'wall_sub', cap_region='roof_tile', collide=False)
        b.prism([(x + (0.5 if x < 85 else -0.5), z + (0.5 if z < -63 else -0.5)) for x, z in TOWER],
                top + 7.0, 0.6, 'white', cap_region='white')
    for n, oid in enumerate(DORMS, 1):
        b.footprint_building(_inside(R[oid]), bid=f'GT{n}', source_id=oid, floors=6, floor_h=3.1, roof='flat_rail', **common)
    for n, (oid, floors) in enumerate(SMALL, 6):
        b.footprint_building(_inside(R[oid]), bid=f'GT{n}', source_id=oid, floors=floors, floor_h=3.3, roof='flat',
                             wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame', instanced_windows=False)

    terrain_track(b, TRACK_C[0], TRACK_C[1], r=48.5, h=40.5, r_in=40.0, clip=WORLD_EDGE.buffer(-0.5))

    # Campus drive (`way/1475480315/16`), grounded 2.5 m pieces.
    drive = [(82.94, -96.0), (82.94, -77.98), (46.66, -75.84), (47.52, 76.52), (48.09, 92.03)]
    inside = core.buffer(-3.0)
    for p0, p1 in zip(drive, drive[1:]):
        n = max(1, int(math.dist(p0, p1) / 2.5))
        for j in range(n):
            a = (p0[0] + (p1[0] - p0[0]) * j / n, p0[1] + (p1[1] - p0[1]) * j / n)
            c = (p0[0] + (p1[0] - p0[0]) * (j + 1) / n, p0[1] + (p1[1] - p0[1]) * (j + 1) / n)
            if not inside.contains(Point((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)):
                continue
            gs = [b.ground(x + dx, z) for x, z in (a, c) for dx in (-3.0, 0.0, 3.0)]
            if max(gs) - min(gs) <= 0.1:
                b.path_strip(a, c, width=6.0, region='pave_road')

    keep_out = [Polygon(R[o]).buffer(4.0) for o in DORMS + [s for s, _ in SMALL]]
    keep_out += [Polygon(R['main_outer']).buffer(4.0), track_hole.buffer(2.0)]
    picked = 0
    for x in range(-170, 125, 16):
        for z in range(-95, 180, 16):
            p = Point(x, z)
            if (x // 16 + z // 16) % 2 or not inside.contains(p) or any(k.contains(p) for k in keep_out):
                continue
            b.tree(x, z, species=('camphor', 'osmanthus', 'banyan')[picked % 3], scale=0.85 + 0.1 * (picked % 3),
                   yaw=(x * 0.37 + z * 0.21) % math.tau)
            picked += 1


if __name__ == '__main__':
    export_school_glb('guilin_technical', PALETTE, SIGNS, build_technical, seed=2034)
