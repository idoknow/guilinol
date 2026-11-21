"""Guilin Longyin Primary School (桂林市龙隐小学).

Restores the Qixing Rd stepped green-glazed-eave gate with vertical
gold '桂林市龙隐小学' lettering, all 8 exact OSM + 2 Overture building
footprints, and exact OSM pitches (way/1027048356).
"""
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from g3_kit import Builder, export_school

SIGNS = [
    dict(key='ly_vert', title='桂林市龙隐小学', sub='', fg=(186, 142, 34), bg=(227, 217, 193), orient='v', sans=False, raised=True),
]

PAVE_PTS = [
    (-78.84, -0.41), (-77.24, -0.07), (-31.69, 64.67), (28.84, 35.03),
    (36.6, 41.0), (70.1, 43.14), (73.68, -48.57), (64.46, -51.79),
    (38.05, -54.27), (-36.36, -38.21), (-36.01, -31.73), (-36.47, -30.83),
    (-50.6, -26.73), (-86.35, -23.42), (-101.86, -11.23), (-89.12, 5.77),
]

# All 8 exact OSM + 2 exact Overture footprints
OSM_1488495381 = [(16.79, -1.28), (28.13, -3.33), (32.27, 19.32), (-1.87, 25.48), (-4.34, 11.98), (3.71, 10.52), (3.96, 11.91), (18.72, 9.25)]
OSM_1488495382 = [(-14.73, -20.1), (-9.37, 7.97), (-0.87, 6.38), (-6.23, -21.7)]
OSM_1488495383 = [(-4.33, -19.91), (27.05, -26.4), (28.83, -17.89), (-2.55, -11.4)]
OSM_1488495384 = [(1.55, -8.78), (29.52, -14.84), (31.57, -5.45), (3.62, 0.6)]
OSM_1488495385 = [(-57.93, 5.57), (-56.12, 14.84), (-26.09, 9.05), (-27.9, -0.23)]
OSM_1488495386 = [(-63.06, -26.09), (-61.62, -16.19), (-28.7, -20.91), (-30.14, -30.82)]
OSM_1488495387 = [(20.67, -47.36), (22.44, -39.02), (36.78, -42.02), (35.0, -50.35)]
OSM_1488495388 = [(-52.69, 29.27), (-50.96, 38.91), (-18.68, 33.21), (-20.4, 23.58)]
OV_B3F9 = [(-10.59, -22.36), (3.81, -25.91), (1.32, -36.16), (-13.29, -32.6)]
OV_CB0F = [(5.81, -28.27), (19.32, -31.15), (16.73, -42.16), (3.33, -39.29)]


def _build_qixing_gate(b: Builder):
    """Qixing Rd entrance gate at west entrance (-93.5, -4.5), facing SW (yaw = -0.92 rad):
    - Left (-X): tall main pillar with vertical gold '桂林市龙隐小学' and green glazed-tile eave.
    - Closed stainless-steel gate across vehicle driveway and pedestrian archway."""
    prev = b.pose
    b.pose = (-93.5, 0.0, -4.5, -0.92)
    b.box(0.0, 0.02, 0.0, 15.6, 0.04, 6.2, 'pave_plaza', tile=2.5)

    # Tall beige ceramic-tile left main pillar (x = -4.6) + vertical gold school name
    b.box(-4.6, 0.0, 0.0, 2.05, 0.45, 1.55, 'granite', tile=1.4)
    b.box(-4.6, 0.45, 0.0, 1.88, 4.35, 1.38, 'cream', tile=1.5, collide=True)
    b.box(-4.6, 4.80, 0.0, 2.30, 0.28, 1.78, 'white', tile=1.4)
    b.pitched_roof(-4.6, 5.08, 0.0, 2.45, 1.85, 0.82, overhang=0.45, tile_region='green_glaze', fascia_region='white')
    b.sign_board(-4.6, 2.65, 0.72, 0.68, 3.15, 'ly_vert', backing=None, depth=0)

    # Pedestrian side archway [-3.6 .. -1.3] (closed gate)
    b.box(-1.05, 0.0, 0.0, 0.82, 3.35, 1.10, 'cream', tile=1.5, collide=True)
    b.box(-2.45, 3.05, 0.0, 3.35, 0.36, 1.22, 'cream', cap_region='white', tile=1.5)
    b.pitched_roof(-2.45, 3.41, 0.0, 3.55, 1.35, 0.65, overhang=0.38, tile_region='green_glaze', fascia_region='white')
    b.box(-2.45, 0.0, 0.0, 2.0, 2.8, 0.16, 'steel', tile=1.0, collide=True)

    # Closed retractable gate across main vehicle driveway [-0.55 .. +5.15] + right pier
    b.retractable_gate(-0.52, 5.12, 0.0, h=1.32)
    b.box(5.68, 0.0, 0.0, 1.25, 2.85, 1.25, 'cream', cap_region='white', tile=1.5, collide=True)
    b.pitched_roof(5.68, 2.85, 0.0, 1.45, 1.45, 0.48, overhang=0.28, tile_region='green_glaze', fascia_region='white')
    b.pose = prev


def _build_dragon_sculpture(b: Builder, cx, cz):
    """Stainless-steel dragon sculpture in circular flowerbed."""
    prev = b.pose
    b.pose = (cx, 0.0, cz, 0.0)
    b.cylinder_y(0, 0.02, 0.26, 0, 3.1, 'granite', sections=14)
    b.cylinder_y(0, 0.28, 0.14, 0, 2.7, 'lawn', sections=14)
    b.box(0, 0.32, 0, 1.5, 0.68, 1.5, 'brick_red', tile=1.2, collide=True)
    pts = [
        (0.0, 1.0, 0.0), (0.65, 1.85, 0.35), (-0.55, 2.75, 0.45),
        (0.45, 3.65, -0.30), (-0.15, 4.55, 0.10), (0.35, 5.15, 0.25),
    ]
    for i in range(len(pts) - 1):
        b.tube(pts[i], pts[i + 1], 0.28 - i * 0.025, 'steel', sections=8 if b.detail else 5)
    b.pose = prev


def build_longyin(b: Builder):
    # 1. Campus-wide paving and greenbelts
    b.pave_polygon(PAVE_PTS, y=0.03, region='pave')
    b.lawn_patch(-44.0, -7.5, -0.18, 24.0, 6.5, curb=True)
    b.lawn_patch(-38.0, 19.5, -0.18, 22.0, 6.0, curb=True)
    b.lawn_patch(12.0, 32.0, -0.18, 24.0, 6.5, curb=True)

    # 2. Gate + Sculpture + Perimeter Wall
    _build_qixing_gate(b)
    _build_dragon_sculpture(b, -70.5, -10.5)
    b.perimeter_wall(
        [(-89.1, 5.8), (-78.8, -0.4), (-31.7, 64.7), (28.8, 35.0), (36.6, 41.0),
         (70.1, 43.1), (73.7, -48.6), (38.0, -54.3), (-36.4, -38.2), (-36.5, -30.8),
         (-86.3, -23.4), (-101.8, -11.2)],
        h=2.10, wall_mat='cream', base_mat='granite', cap_mat='green_glaze',
    )

    # 3. All 8 exact OSM + 2 Overture buildings
    b.footprint_building(OSM_1488495386, floors=4, floor_h=3.45, wall='yellow_wall', accent='white', roof_kind='pitched', roof_tile='gray_tile')
    b.footprint_building(OSM_1488495385, floors=3, floor_h=3.45, wall='pink_wall', accent='blue_facade', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building(OSM_1488495388, floors=4, floor_h=3.45, wall='cream', accent='terracotta', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building(OSM_1488495382, floors=3, floor_h=3.45, wall='white', accent='ochre', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building(OSM_1488495383, floors=4, floor_h=3.45, wall='white', accent='terracotta', roof_kind='pitched', roof_tile='red_tile')
    b.footprint_building(OSM_1488495384, floors=4, floor_h=3.45, wall='white', accent='terracotta', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building(OSM_1488495381, floors=4, floor_h=3.50, wall='white', accent='terracotta', roof_kind='flat', roof_tile='red_tile')
    b.footprint_building(OSM_1488495387, floors=2, floor_h=3.40, wall='cream', accent='terracotta', roof_kind='pitched', roof_tile='gray_tile')
    b.footprint_building(OV_B3F9, floors=3, floor_h=3.40, wall='cream', accent='ochre', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building(OV_CB0F, floors=3, floor_h=3.40, wall='cream', accent='ochre', roof_kind='flat', roof_tile='gray_tile')

    # 4. Exact OSM Pitches (way/1474986237 track + way/1474986236 court)
    b.track_field(53.3, 13.9, 0.01, straight_len=24.0, inner_r=10.2, track_w=4.6, stand_side=0, y0=0.05)
    b.basketball_court(53.3, -24.5, 0.01, surface='court_green', apron='track_red', y0=0.05, scale=0.82)
    b.flagpole_plinth(38.0, 2.0, math.pi / 2, poles=1, height=11.0)

    # 5. Trees in Stone Planters
    for idx, (tx, tz) in enumerate([(-79, -17), (-66, -2), (-54, -8), (-24, -12), (37, -12), (-32, 46)]):
        b.campus_tree(tx, tz, h=8.4 + (idx % 3) * 0.8, spread=3.3, seed=idx + 71, planter=True)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'longyin_primary.glb', build_longyin, signs=SIGNS)
