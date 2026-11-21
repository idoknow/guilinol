"""Guilin Chenshan Primary School (桂林市辰山小学).

Restores the warm-yellow gate pillars + vertical plaque +
closed red iron grille gate, extruding exact OSM buildings
way/1475475421 & way/1475475422 (way/671777304).
"""
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from g3_kit import Builder, export_school

SIGNS = [
    dict(key='cs_vert',  title='桂林市辰山小学', sub='', fg=(32, 36, 40), bg=(194, 200, 206), orient='v', sans=False, border=(136, 142, 148)),
]

PAVE_PTS = [
    (-76.55, 14.6), (-66.74, 26.87), (-47.76, 42.39), (-47.17, 98.61),
    (25.92, 96.22), (26.07, 17.26), (26.99, 16.21), (31.99, 15.96),
    (36.01, -20.1), (51.02, -42.11), (85.91, -58.88), (31.52, -100.07),
    (-14.18, -50.41), (-36.21, -38.95),
]

OSM_MAIN_1475475421 = [
    (-16.64, -25.73), (-35.12, -1.57), (-32.65, 0.68), (-37.18, 6.8),
    (-42.04, 3.36), (-56.4, 21.7), (-49.27, 26.53), (-50.9, 29.1),
    (-28.0, 46.8), (-5.43, 47.33), (-5.75, 69.54), (-41.82, 69.43),
    (-41.93, 84.66), (22.76, 84.12), (23.41, 69.11), (7.54, 68.9),
    (7.1, 45.83), (26.32, 47.55), (26.74, 32.55), (11.48, 32.18),
    (11.42, 29.53), (-8.73, 29.84), (-8.8, 32.93), (-22.81, 32.8),
    (-35.52, 22.94), (-28.46, 13.21), (-32.3, 10.57), (-27.34, 4.65),
    (-21.95, 8.22), (-16.67, 1.57), (-12.51, 4.34), (-6.37, -4.78),
    (-9.98, -7.06), (-3.53, -16.17),
]
OSM_AUX_1475475422 = [(71.55, -69.95), (72.40, -60.10), (80.65, -60.80), (79.75, -70.45)]


def _build_yellow_pillar_gate(b: Builder):
    """NW street gate facing NW (-0.73, -0.68 -> yaw = -2.39 rad):
    Warm yellow wall pillars, vertical plaque '桂林市辰山小学' on right pillar,
    closed red iron grille double gate across opening."""
    prev = b.pose
    b.pose = (-16.5, 0.0, -47.5, -2.39)
    b.box(0.5, 0.02, 0.0, 14.5, 0.04, 5.0, 'pave_plaza', tile=2.5)

    # Warm yellow gate pillars
    for px, pw, ph in ((-3.6, 1.25, 3.15), (2.8, 1.35, 3.15), (5.6, 0.95, 2.75)):
        b.box(px, 0.0, 0.0, pw + 0.16, 0.42, 1.26, 'granite', tile=1.4)
        b.box(px, 0.42, 0.0, pw, ph - 0.42, 1.10, 'yellow_wall', tile=1.6, collide=True)
        b.box(px, ph, 0.0, pw + 0.22, 0.18, 1.28, 'terracotta', tile=1.2, bottom=True)

    # Vertical plaque on right main yellow pillar
    b.sign_board(2.65, 1.82, 0.58, 0.56, 2.15, 'cs_vert', backing='steel', depth=0.05)

    # Closed red painted iron grille gate
    span_x0, span_x1 = -2.92, 2.08
    xc = (span_x0 + span_x1) / 2.0
    gw = span_x1 - span_x0
    for ry in (0.18, 1.15, 2.42, 2.72):
        b.box(xc, ry, 0.0, gw, 0.06, 0.08, 'brick_red', tile=0.8)
    for sx in (span_x0 + 0.04, xc - 0.04, xc + 0.04, span_x1 - 0.04):
        b.box(sx, 0.08, 0.0, 0.07, 2.70, 0.09, 'brick_red', tile=0.8)
    if b.detail:
        for bx in [span_x0 + 0.26 + k * 0.24 for k in range(int((gw - 0.4) / 0.24))]:
            b.box(bx, 0.18, 0.0, 0.035, 2.55, 0.045, 'brick_red', tile=0.8)
    b.solid_box(xc, 0.0, 0.0, gw, 2.75, 0.28)
    # Closed pedestrian opening
    b.box(4.2, 0.0, 0.0, 1.8, 2.70, 0.14, 'brick_red', tile=0.8, collide=True)
    b.pose = prev


def build_chenshan(b: Builder):
    # 1. Campus-wide grey hard paving + greenbelts
    b.pave_polygon(PAVE_PTS, y=0.03, region='pave')
    b.lawn_patch(-42.0, 62.0, 0.0, 8.0, 28.0, curb=True)
    b.lawn_patch(52.0, -64.0, -0.62, 18.0, 8.0, curb=True)

    # 2. NW Yellow-Pillar Gate + Perimeter Fence
    _build_yellow_pillar_gate(b)
    b.perimeter_wall(
        [(-36.2, -38.9), (-23.5, -45.5), (-9.5, -52.5), (31.5, -100.0), (85.9, -58.9),
         (51.0, -42.1), (36.0, -20.1), (32.0, 16.0), (26.1, 17.3), (25.9, 96.2),
         (-47.2, 98.6), (-47.8, 42.4), (-76.5, 14.6), (-36.2, -38.9)],
        gap_segments=(1,), h=2.15, wall_mat='yellow_wall', base_mat='granite', cap_mat='terracotta',
    )

    # 3. Exact OSM multi-wing school building way/1475475421 + central 5F terracotta section
    b.footprint_building(OSM_MAIN_1475475421, floors=4, floor_h=3.50, wall='white', accent='terracotta', roof_kind='flat', roof_tile='gray_tile')
    b.pose = (0.8, 0.0, 39.0, 0.0)
    b.box(0, 0.55, 0, 18.2, 17.8, 13.6, 'terracotta', tile=2.2, collide=True)
    for fl in range(1, 5):
        wy = fl * 3.55 + 1.15
        for kx in (-5.6, -1.9, 1.9, 5.6):
            b.box(kx, wy, -6.88, 2.6, 2.0, 0.10, 'glass', tile=1.8, lit=True)
            b.box(kx, wy, 6.88, 2.6, 2.0, 0.10, 'glass', tile=1.8, lit=True)
    b.pitched_roof(0, 18.35, 0, 18.6, 13.8, 2.1, 0.55, 'gray_tile', 'white')
    b.pose = (0.0, 0.0, 0.0, 0.0)

    # Exact OSM auxiliary school building way/1475475422
    b.footprint_building(OSM_AUX_1475475422, floors=2, floor_h=3.40, wall='cream', accent='terracotta', roof_kind='pitched', roof_tile='gray_tile')

    # Flagpole
    b.flagpole_plinth(-6.0, 16.0, math.pi, poles=1, height=11.2)

    # 4. Campus Trees in Stone Planters
    for idx, (tx, tz) in enumerate([(-48, 18), (-18, 18), (22, 10), (22, -15), (-38, 90), (14, 90)]):
        b.campus_tree(tx, tz, h=7.8 + (idx % 2) * 0.8, spread=3.0, seed=idx + 51, planter=True)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'chenshan_primary.glb', build_chenshan, signs=SIGNS)
