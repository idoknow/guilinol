"""Guilin Tian Jiabing Middle School / No. 4 Middle School (桂林市田家炳中学).

Restores the Pingfeng Rd curved crimson gate wall + closed retractable gate +
5F white Tian Jiabing main building (curved glass curtain wall & winged roof
overhang) + skybridge + 4F No.4 Middle wing (ref #00, #12), and extrudes all
Overture & satellite-verified campus footprints (way/658142453).
"""
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from g3_kit import Builder, export_school

SIGNS = [
    dict(key='tjb_gate',  title='桂林市田家炳中学', sub='', fg=(232, 194, 82), bg=(150, 44, 36), sans=False),
    dict(key='tjb_roof',  title='田 家 炳 中 学', sub='田家炳科研楼', fg=(168, 42, 36), bg=(238, 236, 228), sans=False, raised=True),
    dict(key='sizhong',   title='桂 林 市 第 四 中 学', sub='', fg=(42, 92, 148), bg=(238, 236, 228), sans=False, raised=True),
]

PAVE_PTS = [
    (-131.29, -70.47), (-133.13, 9.03), (5.18, 88.46), (48.55, 111.1),
    (97.77, 31.76), (107.19, 10.98), (145.79, -47.23), (142.5, -53.58),
    (56.97, -71.93), (53.34, -53.43), (52.26, -52.47), (-76.12, -53.9),
    (-77.19, -55.11), (-76.81, -83.51), (-127.98, -89.98),
]

# Exact Overture footprints inside way/658142453
OV_TJB_MAIN = [
    (-7.69, 65.2), (-26.77, 65.48), (-26.64, 75.01), (13.65, 74.42),
    (13.3, 50.07), (-28.05, 50.66), (-27.85, 64.43), (-7.71, 64.14),
]
OV_GYM = [(-69.86, 49.1), (-38.04, 49.13), (-37.99, -2.76), (-69.81, -2.79)]
OV_BLDS = [
    ([(120.38, -29.99), (120.46, -38.46), (93.96, -38.73), (93.87, -30.26)], 4, 'white', 'terracotta'),
    ([(80.98, -11.59), (79.58, 6.33), (103.5, 8.19), (104.9, -9.74)], 5, 'white', 'blue_facade'),
    ([(63.01, -58.22), (62.49, -47.75), (43.01, -48.72), (42.12, -30.78), (70.57, -29.35), (72.0, -57.77)], 5, 'white', 'terracotta'),
    ([(52.15, -50.22), (61.29, -55.6), (54.82, -66.55), (45.69, -61.16)], 3, 'cream', 'terracotta'),
    ([(75.26, -13.35), (34.8, -14.76), (34.44, -4.27), (74.9, -2.87)], 5, 'white', 'blue_facade'),
    ([(34.37, -35.66), (33.75, -44.1), (10.49, -42.41), (11.1, -33.96)], 4, 'white', 'terracotta'),
    ([(54.09, 99.72), (56.8, 94.26), (39.59, 85.7), (36.89, 91.16)], 2, 'cream', 'brick_red'),
    ([(3.67, -43.05), (-6.93, -43.16), (-7.05, -32.57), (3.56, -32.47)], 3, 'cream', 'terracotta'),
    ([(-26.56, -21.86), (-26.59, -15.5), (0.98, -15.39), (1.01, -21.74)], 3, 'white', 'blue_facade'),
    ([(-13.94, -31.38), (-13.6, -41.96), (-26.32, -42.36), (-26.65, -31.77)], 3, 'cream', 'terracotta'),
    ([(-73.77, -11.62), (-46.2, -11.67), (-46.23, -28.62), (-73.8, -28.57)], 4, 'white', 'terracotta'),
    ([(-54.84, -44.8), (-54.64, -54.53), (-69.95, -54.61), (-69.95, -45.1)], 3, 'cream', 'gray_tile'),
]

# Satellite-traced east teaching wings clearly visible on World Imagery & ref #00 right half
SAT_SIZHONG_SOUTH = [(29.5, 56.5), (71.5, 56.5), (71.5, 67.2), (29.5, 67.2)]
SAT_EAST_MID = [(32.5, 21.5), (84.5, 21.5), (84.5, 32.5), (32.5, 32.5)]


def _build_pingfeng_gate_and_main(b: Builder):
    """Restore real Pingfeng Rd entrance (ref #00, #12):
    - Curved crimson low screen wall ('红色弧形矮墙') with gold '桂林市田家炳中学' + red flagpole pylon
    - Closed stainless-steel retractable gate + open pedestrian entrance + striped fence wall
    - 5F white Tian Jiabing main building on exact OV_TJB_MAIN footprint with curved glass curtain wall
      and winged curved roof overhang ('弧形挑檐'), connected by skybridge to 4F white No.4 Middle wing."""
    # 1. 5F White Tian Jiabing Main Building on exact OV_TJB_MAIN (-6.76, 62.41)
    b.footprint_building(OV_TJB_MAIN, floors=5, floor_h=3.65, wall='white', accent='white', roof_kind='flat', roof_tile='silver_roof')
    prev = b.pose
    b.pose = (-6.8, 0.0, 74.6, 0.0)
    # Gently bowed front glass curtain wall across central 24m of south facade (floors 1..5)
    segs = 8 if b.detail else 4
    for i in range(segs):
        t0, t1 = -1.0 + 2.0 * i / segs, -1.0 + 2.0 * (i + 1) / segs
        x0, x1 = t0 * 12.5, t1 * 12.5
        z0 = 1.65 * (1.0 - t0 * t0)
        z1 = 1.65 * (1.0 - t1 * t1)
        b.face([(x0, 0.6, z0), (x1, 0.6, z1), (x1, 17.8, z1), (x0, 17.8, z0)],
               ((t0 + t1) * 0.25, 0.0, 1.0), 'glass', tile=2.4, lit=True)
        if b.detail:
            # White horizontal spandrel mullions & vertical frame ribs
            b.box((x0 + x1) / 2, 17.8, (z0 + z1) / 2, abs(x1 - x0) + 0.2, 0.85, 0.6, 'white', tile=2.0)
            b.box(x0, 0.5, z0 + 0.06, 0.22, 17.4, 0.22, 'white', tile=1.8)
    # Iconic winged / arched roof overhang ('楼顶弧形挑檐', ref #00)
    for i in range(-4, 5):
        xc = i * 2.6
        lift = 0.85 * math.cos(i * 0.45) + 0.35 * (abs(i) / 4.0)
        b.box(xc, 19.6 + lift, -1.5, 2.8, 0.36, 6.2, 'white', cap_region='silver_roof', tile=2.0, bottom=True)
    b.box(0.0, 18.4, -1.5, 19.0, 1.35, 3.8, 'white', tile=2.0)
    b.sign_board(0.0, 19.15, 0.48, 13.5, 1.45, 'tjb_roof', backing=None, depth=0)
    b.pose = prev

    # 2. 4F White No.4 Middle Wing (SAT_SIZHONG_SOUTH) + Blue vertical fins + Skybridge (ref #00 right half)
    b.footprint_building(SAT_SIZHONG_SOUTH, floors=4, floor_h=3.60, wall='white', accent='blue_facade', roof_kind='flat', roof_tile='silver_roof')
    if b.detail:
        for fx in (35.0, 44.0, 53.0, 62.0):
            b.box(fx, 0.5, 67.35, 0.55, 14.2, 0.45, 'blue_facade', tile=1.8)
    b.pose = (50.5, 0.0, 67.2, 0.0)
    b.sign_board(0.0, 15.2, 0.15, 13.0, 1.35, 'sizhong', backing='white', depth=0.12)
    b.pose = prev
    # White 2-level skybridge connecting Tian Jiabing Hall and No.4 Middle Wing
    b.box(21.5, 7.2, 61.5, 16.2, 1.25, 3.2, 'white', tile=2.0)
    b.box(21.5, 10.8, 61.5, 16.2, 1.25, 3.2, 'white', tile=2.0)

    # 3. Curved Crimson Gate Wall + Red Flagpole + Closed Retractable Gate facing SSW along Pingfeng Rd
    b.pose = (14.5, 0.0, 83.5, -0.46)
    b.box(2.0, 0.02, 0.0, 36.0, 0.04, 8.0, 'pave_plaza', tile=3.0)
    # Left (-X): curved red low wall rising toward stepped pylon + red flag (ref #00 left foreground)
    arc_segs = 8
    for i in range(arc_segs):
        t0, t1 = i / arc_segs, (i + 1) / arc_segs
        xa, xb = -16.5 + t0 * 13.5, -16.5 + t1 * 13.5
        za = -2.2 * math.sin(t0 * math.pi * 0.75)
        zb = -2.2 * math.sin(t1 * math.pi * 0.75)
        ha = 2.45 + 1.15 * (t0 ** 1.6)
        b.box((xa + xb) / 2, 0.0, (za + zb) / 2, abs(xb - xa) + 0.22, ha, 0.72, 'brick_red', cap_region='white', tile=1.8, collide=True)
    # Stepped red gatehead pylon + flagpole at right end of curved red wall (x = -2.6)
    b.box(-2.5, 0.0, -1.5, 1.8, 4.8, 1.6, 'brick_red', cap_region='white', tile=1.8, collide=True)
    b.cylinder_y(-2.5, 4.8, 5.2, -1.5, 0.08, 'steel', sections=6)
    b.box(-1.6, 8.7, -1.5, 1.75, 1.12, 0.04, 'vermilion', tile=1.0)
    # Gold '桂林市田家炳中学' sign on the curved red wall face
    b.sign_board(-9.5, 1.72, -1.12, 9.6, 1.15, 'tjb_gate', backing=None, depth=0)

    # Closed stainless-steel retractable gate [x = -1.5 .. +6.8] + open pedestrian bay [+7.2 .. +9.8]
    b.retractable_gate(-1.4, 6.6, -1.2, h=1.35)
    b.box(7.0, 0.0, -1.2, 0.85, 2.55, 0.90, 'brick_red', cap_region='white', tile=1.6, collide=True)
    b.box(10.2, 0.0, -1.2, 0.85, 2.55, 0.90, 'brick_red', cap_region='white', tile=1.6, collide=True)
    # Right (+X): vertical red-and-cream striped perimeter wall (matching ref #00 right foreground)
    for k in range(8):
        wx = 11.4 + k * 1.45
        b.box(wx, 0.0, -1.2, 1.42, 2.35, 0.42, 'cream' if k % 2 == 0 else 'brick_red', tile=1.5, collide=(k == 0))
    b.solid_box(16.5, 0.0, -1.2, 11.8, 2.35, 0.45)
    b.pose = prev


def build_tianjiabing(b: Builder):
    # 1. Campus-wide light grey paving + walkways & greenbelts
    b.pave_polygon(PAVE_PTS, y=0.03, region='pave')
    b.walkway((20.0, 78.0), (20.0, -35.0), width=7.0, y=0.045)
    b.walkway((-75.0, 12.0), (85.0, 12.0), width=5.5, y=0.045)
    b.lawn_patch(52.0, 44.5, 0.0, 38.0, 8.5, curb=True)
    b.lawn_patch(54.0, 6.0, 0.0, 36.0, 8.0, curb=True)
    b.lawn_patch(-54.0, -37.0, 0.0, 26.0, 7.0, curb=True)

    # 2. Gate + Tian Jiabing Hall + No.4 Middle Wing + East Middle Wing
    _build_pingfeng_gate_and_main(b)
    b.footprint_building(SAT_EAST_MID, floors=5, floor_h=3.55, wall='white', accent='terracotta', roof_kind='flat', roof_tile='gray_tile')

    # Perimeter fence around rest of campus (gap on Pingfeng Rd gate segment)
    b.perimeter_wall(
        [(-131.0, -70.0), (-132.8, 8.8), (-4.0, 81.5), (34.0, 102.5), (48.2, 110.5),
         (97.4, 31.5), (145.2, -47.0), (57.0, -71.5), (52.5, -52.5), (-76.5, -54.0),
         (-76.8, -83.2), (-127.6, -89.6), (-131.0, -70.0)],
        gap_segments=(2,), h=2.15, wall_mat='white', base_mat='brick_red', cap_mat='gray_tile',
    )

    # 3. Gymnasium (exact Overture 425575f2-0f2: white hall with red low-slope roof & blue skylights, ref #03)
    b.footprint_building(OV_GYM, floors=3, floor_h=4.6, wall='white', accent='terracotta', roof_kind='pitched', roof_tile='red_tile')

    # 4. All remaining 12 exact Overture buildings
    for poly, fl, w_mat, a_mat in OV_BLDS:
        b.footprint_building(poly, floors=fl, floor_h=3.45, wall=w_mat, accent=a_mat, roof_kind='flat', roof_tile='gray_tile')

    # 5. West Running Track & Parallel-Striped Soccer Field + Central Courts (satellite-traced, ref #03)
    b.track_field(-105.0, -32.0, 0.0, straight_len=54.0, inner_r=16.5, track_w=5.2, stand_side=0, y0=0.05)
    b.basketball_court(-21.0, 20.0, 0.0, surface='court_green', apron='track_red', y0=0.05, scale=0.88)
    b.basketball_court(-4.0, 20.0, 0.0, surface='court_green', apron='track_red', y0=0.05, scale=0.88)
    b.basketball_court(-21.0, -2.0, 0.0, surface='court_green', apron='track_red', y0=0.05, scale=0.82)
    b.basketball_court(-4.0, -2.0, 0.0, surface='court_green', apron='track_red', y0=0.05, scale=0.82)
    b.flagpole_plinth(12.0, 20.0, -math.pi / 2, poles=3, height=12.2)

    # 6. Campus Trees in Stone Planters (clear of Pingfeng Rd gate sightline)
    for idx, (tx, tz) in enumerate([(-34, 42), (-34, 6), (30, 42), (30, 6), (82, 42), (-80, 32)]):
        b.campus_tree(tx, tz, h=8.0 + (idx % 3) * 0.8, spread=3.1, seed=idx + 41, planter=True)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'tianjiabing.glb', build_tianjiabing, signs=SIGNS)
