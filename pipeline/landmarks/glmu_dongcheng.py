"""Guilin Medical University - Dongcheng Campus (桂林医科大学东城校区).

University landmark restored against official photos and exact OSM/Overture
footprints (way/627526148), without guardhouses, turnstiles, or CCTV.
"""
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from g3_kit import Builder, export_school

SIGNS = [
    dict(key='glmu_gate',  title='桂 林 医 科 大 学', sub='GUILIN MEDICAL UNIVERSITY', fg=(232, 194, 88), bg=(136, 44, 38), sans=False),
    dict(key='bld_lib',    title='图 书 馆', sub='LIBRARY', fg=(44, 52, 60), bg=(236, 234, 226), sans=True, raised=True),
    dict(key='bld_hongde', title='弘 德 楼', sub='', fg=(234, 196, 86), bg=(128, 44, 38), sans=False),
    dict(key='glmu_motto', title='弘 德 善 医', sub='', fg=(172, 38, 34), bg=(184, 182, 174), sans=False),
    dict(key='bld_kejiao', title='科 教 楼', sub='', fg=(168, 40, 36), bg=(236, 234, 226), sans=True),
]

PAVE_PTS = [
    (170.91, 147.23), (33.94, 131.57), (33.08, 131.04), (32.75, -45.67),
    (33.79, -46.75), (72.85, -51.97), (73.74, -190.24), (-40.4, -308.05),
    (-54.6, -293.78), (-95.97, -293.71), (-104.06, -273.88), (-112.21, -236.56),
    (-126.46, 80.66), (-50.87, 83.81), (-49.88, 84.41), (-38.34, 119.33),
    (-36.98, 236.91), (66.18, 252.75), (171.13, 318.71),
]

# Exact OSM footprints
LIB_459580291 = [
    (64.62, -162.59), (30.48, -162.92), (26.26, -175.82), (19.49, -186.3),
    (8.88, -195.7), (-4.12, -201.75), (-19.72, -203.48), (-20.1, -235.38),
    (0.69, -234.13), (14.72, -229.24), (31.13, -219.11), (46.08, -205.61),
    (54.37, -193.93), (61.31, -179.77),
]
HONGDE_671760495 = [
    (30.48, -162.92), (30.11, -126.43), (69.74, -126.04), (70.1, -162.54), (64.62, -162.59),
]
COLLEGE_671790070 = [
    (20.97, -119.46), (21.17, -102.09), (61.52, -101.65), (61.77, -95.96),
    (56.31, -96.08), (56.47, -90.44), (61.9, -90.47), (61.93, -83.68),
    (21.15, -83.06), (21.62, -68.71), (69.75, -68.77), (69.69, -84.31),
    (66.04, -83.61), (65.06, -101.59), (70.07, -101.62), (69.99, -119.68),
]
KEJIAO_672633239 = [
    (-108.15, -150.47), (-63.9, -150.37), (-63.92, -142.52), (-50.39, -142.48),
    (-50.4, -141.25), (-16.72, -141.18), (-16.72, -142.64), (-6.73, -142.63),
    (-6.73, -141.15), (0.67, -141.12), (0.68, -147.01), (11.19, -146.99),
    (11.14, -122.27), (-1.56, -122.3), (-1.58, -113.09), (2.75, -113.08),
    (8.42, -107.37), (8.43, -93.58), (2.27, -93.58), (2.28, -77.44),
    (8.3, -77.44), (8.31, -62.96), (3.22, -58.56), (-11.78, -58.65),
    (-11.76, -61.08), (-14.31, -61.09), (-14.23, -74.39), (-30.69, -74.48),
    (-30.54, -101.15), (-13.27, -101.06), (-13.21, -111.14), (-14.43, -111.14),
    (-14.4, -118.41), (-79.01, -118.64), (-78.98, -127.94), (-108.29, -128.04),
    (-108.27, -136.25), (-110.1, -136.25), (-110.08, -141.97), (-108.17, -141.96),
]
OV_WEST_QUAD = [
    (-44.64, -72.3), (-44.63, -74.81), (-55.85, -74.86), (-55.74, -103.22),
    (-76.21, -103.3), (-76.22, -100.75), (-89.53, -100.81), (-89.38, -118.52),
    (-79.34, -118.5), (-79.32, -121.31), (-91.77, -121.34), (-91.93, -101.97),
    (-91.95, -97.04), (-103.53, -97.07), (-103.56, -87.71), (-96.46, -87.68),
    (-96.47, -84.52), (-92.87, -84.5), (-92.88, -83.51), (-98.58, -83.55),
    (-98.61, -78.06), (-97.04, -78.05), (-97.06, -74.05), (-93.3, -74.03),
    (-93.3, -72.57), (-104.68, -72.62), (-104.7, -69.44), (-102.65, -69.43),
    (-102.69, -61.61), (-93.29, -61.57), (-92.49, -63.04), (-87.27, -63.05),
    (-86.6, -61.52), (-69.14, -61.44), (-69.13, -63.29), (-46.63, -63.2),
    (-46.59, -72.31),
]
WEST_COURTYARD = [
    (-58.55, -74.48), (-88.44, -74.48), (-88.44, -84.4), (-83.78, -84.4),
    (-83.78, -87.09), (-58.55, -87.09),
]
DORM_672633244 = [
    (-114.14, -47.4), (-114.96, -37.86), (-100.65, -36.66), (-100.45, -39.06),
    (-44.44, -34.36), (-43.62, -44.02), (-99.86, -48.74), (-100.07, -46.22),
]
DORM_672633246 = [
    (-116.76, -25.85), (-117.51, -16.79), (-46.74, -10.98), (-45.98, -20.03),
]
DORM_672633248 = [
    (-113.54, -4.72), (-49.24, -0.83), (-49.9, 9.87), (-111.21, 6.16),
    (-110.98, 2.29), (-113.95, 2.1),
]
UNIV_672633249 = [
    (-112.01, 21.88), (-87.15, 23.61), (-88.08, 36.76), (-112.93, 35.03),
]
DORM_672633251 = [
    (-108.88, 49.79), (-87.16, 49.61), (-87.07, 59.9), (-102.0, 60.03),
    (-105.18, 62.3), (-105.12, 69.81), (-102.28, 72.58), (-87.29, 72.45),
    (-87.2, 83.14), (-109.0, 83.34), (-116.53, 82.19), (-116.81, 51.77),
]
UNIV_672633450 = [
    (-80.12, 47.78), (-79.91, 58.46), (-43.72, 57.79), (-43.92, 47.11),
]
UNIV_672633451 = [
    (-80.94, 71.1), (-80.87, 82.0), (-44.99, 81.77), (-45.06, 70.87),
]
SOUTH_GYM_672659167 = [
    (59.55, 195.57), (103.32, 195.72), (103.16, 246.25), (51.48, 246.03),
    (51.36, 236.12), (48.82, 232.21), (47.98, 222.31), (48.77, 213.38),
    (51.29, 208.3), (51.32, 197.89),
]
SOUTH_LAB_672659168 = [
    (119.76, 195.69), (165.96, 195.69), (165.96, 211.04), (163.44, 211.04),
    (163.44, 248.4), (119.83, 248.4), (119.83, 231.71), (147.59, 231.71),
    (147.55, 225.29), (144.01, 221.0), (147.49, 216.71), (147.46, 212.22),
    (119.76, 212.49),
]
OV_SOUTH_LINK = [(112.97, 229.29), (133.12, 229.12), (133.07, 222.78), (112.92, 222.93)]
OV_SE_ANNEX = [(135.15, 170.18), (135.12, 192.64), (163.62, 192.68), (163.64, 170.21)]
OV_SW_PAV = [(-17.26, 226.2), (-32.08, 226.92), (-31.68, 235.38), (-16.85, 234.67)]


def _build_main_gate(b: Builder):
    """Huancheng North 2nd Rd main gate (ref #00): facing NE (+0.707, -0.707), yaw = 3*pi/4.
    From street NE looking SW: left (-X) has white cantilevered V-canopy portal,
    right (+X) has long dark-red granite '桂林医科大学' monument wall & low hedge."""
    prev = b.pose
    b.pose = (-27.5, 0.0, -291.5, 3.0 * math.pi / 4.0)
    # Entrance apron
    b.box(0.0, 0.02, 0.0, 34.0, 0.04, 14.0, 'pave_plaza', tile=3.0)
    # Left (-X): white cantilevered modern canopy & twin piers (no guardhouse/turnstiles)
    b.box(-10.8, 0.0, -0.5, 2.2, 5.4, 2.4, 'white', tile=2.0, collide=True)
    b.box(-2.2, 0.0, -0.5, 1.4, 4.8, 1.8, 'white', tile=2.0, collide=True)
    b.box(-6.4, 0.0, -0.5, 7.15, 1.6, 0.16, 'steel', tile=1.4, collide=True)
    # Upward-tilted white cantilevered V-wing canopy on left
    b.box(-8.2, 4.8, 0.2, 11.6, 0.52, 4.6, 'white', cap_region='silver_roof', tile=2.0)
    b.box(-12.6, 5.1, 0.5, 4.8, 0.45, 4.8, 'silver_roof', tile=2.0)
    # Right (+X): long crimson granite monument wall ('桂林医科大学 / GUILIN MEDICAL UNIVERSITY')
    b.box(7.8, 0.0, 0.4, 15.6, 0.58, 2.2, 'dark_stone', tile=1.8, collide=True)
    b.box(7.8, 0.58, 0.4, 14.8, 2.35, 1.15, 'brick_red', tile=2.0, collide=True)
    b.box(7.8, 2.93, 0.4, 15.2, 0.18, 1.35, 'granite', tile=1.6,bottom=True)
    b.sign_board(7.8, 1.78, 1.02, 12.6, 1.62, 'glmu_gate', backing=None, depth=0)
    # Low green hedge strip in front of monument wall (matching ref #00)
    b.lawn_patch(7.8, 2.1, 0.0, 14.6, 1.5, y=0.04, curb=True, shrubs=True)
    b.pose = prev


def _build_library_portal(b: Builder):
    """East City Library (way/459580291, ref #03): 6-storey terracotta curved wings +
    7-storey white monumental '图书馆 / LIBRARY' portal centered on concave SW arc."""
    b.footprint_building(LIB_459580291, floors=6, floor_h=3.65, wall='terracotta', accent='white', roof_kind='flat', roof_tile='silver_roof')
    # Vertical white colonnade ribs along the concave SW inner arc
    inner_arc = [(-19.72, -203.48), (-4.12, -201.75), (8.88, -195.7), (19.49, -186.3), (26.26, -175.82), (30.48, -162.92)]
    if b.detail:
        for i in range(len(inner_arc) - 1):
            p0, p1 = inner_arc[i], inner_arc[i + 1]
            for frac in (0.0, 0.33, 0.67):
                px = p0[0] + (p1[0] - p0[0]) * frac
                pz = p0[1] + (p1[1] - p0[1]) * frac
                b.box(px - 0.25, 0.0, pz + 0.25, 0.55, 22.2, 0.55, 'white', tile=2.0)
        # Top white cornice ribbon along concave arc
        for i in range(len(inner_arc) - 1):
            p0, p1 = inner_arc[i], inner_arc[i + 1]
            ln = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
            yaw = math.atan2(-(p1[0] - p0[0]), -(p1[1] - p0[1])) + math.pi / 2
            b.pose = ((p0[0] + p1[0]) / 2, 0.0, (p0[1] + p1[1]) / 2, yaw)
            b.box(0, 21.8, 0.35, ln + 0.4, 0.75, 0.9, 'white', tile=2.0)
            b.pose = (0.0, 0.0, 0.0, 0.0)

    # Central 7-storey white portal tower at middle of SW concave arc, facing SW (yaw = -0.76 rad)
    prev = b.pose
    b.pose = (10.5, 0.0, -193.5, -0.76)
    b.box(0, 0.0, 1.6, 13.8, 25.8, 5.2, 'white', cap_region='silver_roof', tile=2.2, collide=True)
    # Recessed full-height blue-teal glass curtain wall inside white frame
    b.box(0, 4.4, 4.28, 8.6, 17.6, 0.16, 'glass', tile=2.2, lit=True)
    # Sculptural curved roof wave crown above '图书馆'
    if b.detail:
        b.box(0, 25.8, 1.2, 10.6, 1.35, 3.6, 'white', tile=2.0)
        b.box(0, 27.15, 1.4, 12.2, 0.35, 4.4, 'silver_roof', tile=2.0,bottom=True)
    # Grand entrance steps + silver-framed glass canopy (matching ref #03)
    for st in range(4):
        b.box(0, st * 0.22, 6.8 - st * 0.7, 11.4, 0.24, 1.4, 'pave_plaza', tile=2.0)
    b.box(0, 4.25, 6.2, 10.6, 0.24, 4.4, 'glass', cap_region='silver_roof', tile=2.0)
    for sx in (-3.8, 3.8):
        b.cylinder_y(sx, 0.04, 4.21, 7.4, 0.28, 'steel', sections=8)
    b.pose = prev


def build_glmu(b: Builder):
    # 1. Campus-wide light grey paving + main plazas & greenbelts (zero bare dirt)
    b.pave_polygon(PAVE_PTS, y=0.03, region='pave')

    # Greenbelts & landscape lawns
    b.lawn_patch(-62.0, -276.0, 0.0, 42.0, 18.0, curb=True)
    b.lawn_patch(-32.0, -175.0, 0.0, 34.0, 18.0, curb=True)
    b.lawn_patch(-82.0, -54.0, 0.07, 56.0, 6.5, curb=True)
    b.lawn_patch(-82.0, -29.0, 0.07, 56.0, 6.0, curb=True)
    b.lawn_patch(-82.0, 15.0, 0.05, 52.0, 6.5, curb=True)
    b.lawn_patch(-62.0, 64.5, 0.0, 32.0, 6.5, curb=True)
    b.lawn_patch(8.0, 218.0, 0.0, 34.0, 24.0, curb=True)

    # 2. North main gate + perimeter fence (gap at NE gate)
    _build_main_gate(b)
    perim = [
        (-54.6, -293.8), (-96.0, -293.7), (-112.2, -236.6), (-126.5, 80.7),
        (-50.9, 83.8), (-38.3, 119.3), (-37.0, 236.9), (66.2, 252.8),
        (171.1, 318.7), (170.9, 147.2), (33.1, 131.0), (32.8, -45.7),
        (72.8, -52.0), (73.7, -190.2), (-10.0, -276.5),
    ]
    b.perimeter_wall(perim, h=2.15, wall_mat='white', base_mat='granite', cap_mat='terracotta')

    # 3. Library (way/459580291) + Hongde Building (way/671760495) + Motto Boulder (ref #04)
    _build_library_portal(b)
    b.footprint_building(HONGDE_671760495, floors=7, floor_h=3.6, wall='white', accent='terracotta', roof_kind='flat', roof_tile='silver_roof')
    # '弘德善医' natural boulder in circular flowerbed in front of Hongde Building west plaza
    b.motto_stone(17.5, -153.5, -1.35, 'glmu_motto', w=4.8, h=2.55)

    # 4. Second Teaching Building (way/671790070)
    b.footprint_building(COLLEGE_671790070, floors=6, floor_h=3.55, wall='cream', accent='terracotta', roof_kind='flat', roof_tile='gray_tile')

    # 5. Kejiao Quadrangle (way/672633239 + Overture c584f92b-490 + octagonal auditorium, ref #01)
    b.footprint_building(KEJIAO_672633239, floors=6, floor_h=3.55, wall='white', accent='terracotta', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building(OV_WEST_QUAD, floors=5, floor_h=3.50, wall='cream', accent='terracotta', roof_kind='flat', roof_tile='gray_tile', holes=[WEST_COURTYARD])
    b.cylinder_y(-45.0, 0.0, 8.6, -92.0, 10.2, 'terracotta', sections=8, collide=True)
    b.cylinder_y(-45.0, 8.6, 0.55, -92.0, 10.7, 'white', sections=8)

    # 6. All 7 West Dormitory & University OSM buildings (exact polygons)
    b.footprint_building(DORM_672633244, floors=6, floor_h=3.25, wall='white', accent='terracotta', roof_kind='pitched', roof_tile='red_tile')
    b.footprint_building(DORM_672633246, floors=6, floor_h=3.25, wall='white', accent='terracotta', roof_kind='pitched', roof_tile='red_tile')
    b.footprint_building(DORM_672633248, floors=6, floor_h=3.25, wall='white', accent='ochre', roof_kind='pitched', roof_tile='gray_tile')
    b.footprint_building(UNIV_672633249, floors=4, floor_h=3.40, wall='cream', accent='terracotta', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building(DORM_672633251, floors=6, floor_h=3.25, wall='white', accent='ochre', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building(UNIV_672633450, floors=5, floor_h=3.30, wall='white', accent='terracotta', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building(UNIV_672633451, floors=5, floor_h=3.30, wall='white', accent='terracotta', roof_kind='flat', roof_tile='gray_tile')

    # 7. Standard 400m Stadium (way/672634658, ref #02) + Flagpoles + Iconic Water Tower
    b.track_field(-5.8, 46.9, 0.008, straight_len=76.0, inner_r=17.5, track_w=6.2, stand_side=-1, y0=0.05)
    b.flagpole_plinth(-5.8, -19.5, 0.0, poles=3, height=13.5)
    # Tall white water tower visible in ref #02 NW of track
    b.cylinder_y(-33.5, 0.0, 23.5, -2.5, 1.55, 'white', sections=10, collide=True)
    b.cylinder_y(-33.5, 23.5, 3.8, -2.5, 3.9, 'white', sections=12, bottom=True)
    b.cylinder_y(-33.5, 27.3, 0.8, -2.5, 4.2, 'terracotta', sections=12, bottom=True)

    # 8. NW Sports Courts (way/671760725, 671760840, 671763132)
    b.basketball_court(-62.3, -216.5, 0.0, surface='court_green', apron='track_red', y0=0.05)
    b.basketball_court(-97.2, -206.0, 0.0, surface='court_green', apron='track_red', y0=0.05)
    b.basketball_court(-73.0, -246.0, math.pi / 2, surface='court_blue', apron='track_red', y0=0.05)

    # 9. South Zone Courts & Buildings (way/672638634, 672638635, 672659167, 672659168 + Overture annexes)
    b.basketball_court(2.0, 175.9, 0.0, surface='court_blue', apron='court_green', y0=0.05)
    b.basketball_court(20.5, 175.9, 0.0, surface='court_blue', apron='court_green', y0=0.05)
    b.basketball_court(56.0, 172.5, 0.0, surface='court_green', apron='track_red', y0=0.05)
    b.basketball_court(82.0, 172.5, 0.0, surface='court_green', apron='track_red', y0=0.05)
    b.basketball_court(118.0, 174.0, 0.0, surface='court_blue', apron='track_red', y0=0.05)

    b.footprint_building(SOUTH_GYM_672659167, floors=4, floor_h=4.1, wall='white', accent='blue_facade', roof_kind='flat', roof_tile='silver_roof')
    b.footprint_building(SOUTH_LAB_672659168, floors=5, floor_h=3.6, wall='white', accent='terracotta', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building(OV_SOUTH_LINK, floors=2, floor_h=3.6, wall='white', accent='terracotta', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building(OV_SE_ANNEX, floors=3, floor_h=3.5, wall='cream', accent='terracotta', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building(OV_SW_PAV, floors=2, floor_h=3.4, wall='white', accent='gray_tile', roof_kind='pitched', roof_tile='gray_tile')

    # 10. Campus Trees in Stone Planters (kept clear of gate & library sightlines!)
    trees = [
        (-74, -276), (-50, -276), (-42, -175), (-22, -175),
        (-39, -20), (-39, 18), (-39, 55), (-39, 92),
        (24, 15), (24, 50), (24, 85),
        (8, 218), (112, 205),
    ]
    for idx, (tx, tz) in enumerate(trees):
        b.campus_tree(tx, tz, h=8.2 + (idx % 3) * 0.9, spread=3.2, seed=idx + 11, planter=True)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'glmu_dongcheng.glb', build_glmu, signs=SIGNS)
