"""Primary School Attached to Guilin University of Technology (桂林理工大学附属小学).

Restores Jiangan Rd flat-canopy gate with raised grey lettering,
and extrudes exact OSM/Overture campus buildings & pitches (way/473969804).
"""
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from g3_kit import Builder, export_school

SIGNS = [
    dict(key='glut_gate',   title='桂林理工大学附属小学', sub='', fg=(90, 96, 100), bg=(238, 236, 228), sans=False, raised=True),
    dict(key='glut_plaque', title='桂林理工大学附属小学', sub='PRIMARY SCHOOL ATTACHED TO GLUT', fg=(168, 42, 36), bg=(228, 214, 176), sans=True),
]

PAVE_PTS = [(-16.96, -54.39), (-42.6, 34.98), (13.86, 54.83), (45.81, -32.32)]

# Exact Overture & OSM footprints
OV_MAIN_253E = [(36.47, -36.54), (-9.36, -49.73), (-21.52, -8.0), (24.32, 5.17)]
OSM_SOUTH_473969842 = [(-13.28, 27.67), (15.5, 37.87), (11.06, 50.48), (-17.83, 39.86)]
OSM_SW_473969841 = [(-34.45, 22.84), (-18.68, 28.41), (-22.07, 37.45), (-37.41, 31.88)]
OSM_NW_692355779 = [(-15.85, -33.04), (-21.87, -35.48), (-19.89, -40.53), (-13.91, -38.27)]


def _build_jiangan_gate(b: Builder):
    """Jiangan Rd main gate at OSM node/4679984928 (-31.0, -6.8), facing WNW (yaw = -1.85 rad):
    wide flat white canopy, thick white fascia with raised characters,
    and closed retractable gate across vehicle and pedestrian bays (ref #01, #03)."""
    prev = b.pose
    gate_gy = b.surface.ground(-30.6, -6.8) if b.surface else 0.0
    b.pose = (-30.6, gate_gy, -6.8, -1.85)
    b.box(0.0, -0.15, 0.0, 16.0, 0.20, 5.2, 'pave_plaza', tile=2.5, bottom=True)
    # Main pillars supporting flat canopy
    for px, pw in ((-5.2, 1.15), (2.8, 1.15), (5.8, 0.90)):
        b.box(px, -0.20, 0.0, pw + 0.18, 0.70, 1.35, 'dark_stone', tile=1.4, bottom=True)
        b.box(px, 0.50, 0.0, pw, 3.80, 1.15, 'white', tile=1.8, collide=True)
    # Thick flat-roofed white canopy overhang
    b.box(0.3, 4.30, 0.15, 13.6, 1.26, 3.6, 'white', cap_region='silver_roof', tile=2.0, bottom=True)
    b.box(0.3, 5.56, 0.15, 13.9, 0.14, 3.8, 'granite', tile=1.6, bottom=True)
    b.sign_board(-1.0, 4.98, 1.98, 10.2, 0.98, 'glut_gate', backing=None, depth=0)
    # Closed stainless-steel retractable gate across opening
    b.retractable_gate(-4.55, 2.15, 0.0, h=1.32)
    b.box(4.35, -0.15, 0.0, 1.9, 1.47, 0.16, 'steel', tile=1.0, collide=True, bottom=True)
    # Flanking warm-ochre & cream stone nameplate planter wall on left
    b.box(-8.4, -0.20, 0.4, 4.6, 2.25, 0.65, 'ochre', cap_region='cream', tile=1.8, collide=True, bottom=True)
    b.sign_board(-8.4, 1.18, 0.76, 3.6, 0.92, 'glut_plaque', backing='cream', depth=0.06)
    b.lawn_patch(-8.4, 1.45, 0.0, 4.2, 1.0, y=0.04, curb=True, shrubs=True)
    b.pose = prev


def _build_main_courtyard_block(b: Builder):
    """4-storey solid main teaching block on exact Overture 253e76b1-caf polygon (no fictional inner courtyard)."""
    b.footprint_building(OV_MAIN_253E, floors=4, floor_h=3.55, wall='cream', accent='ochre', roof_kind='flat', roof_tile='gray_tile')


def build_glut_primary(b: Builder):
    # 1. Campus-wide grey hard paving + greenbelts & planters
    b.pave_polygon(PAVE_PTS, y=0.03, region='pave')
    b.lawn_patch(7.5, -22.3, -0.28, 14.0, 12.0, curb=True)
    b.lawn_patch(29.0, 22.0, -0.35, 5.5, 22.0, curb=True)

    # 2. Gate & perimeter wall (gap on west wall around (-31, -6.8))
    _build_jiangan_gate(b)
    b.perimeter_wall(
        [(-16.96, -54.39), (-26.8, -20.5), (-35.2, 8.8), (-42.6, 34.98), (13.86, 54.83), (45.81, -32.32), (-16.96, -54.39)],
        gap_segments=(1,), h=2.1, wall_mat='cream', base_mat='granite', cap_mat='ochre',
    )

    # 3. All 4 exact OSM/Overture buildings
    _build_main_courtyard_block(b)
    b.footprint_building(OSM_SOUTH_473969842, floors=3, floor_h=3.45, wall='white', accent='ochre', roof_kind='pitched', roof_tile='gray_tile')
    b.footprint_building(OSM_SW_473969841, floors=2, floor_h=3.40, wall='cream', accent='ochre', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building(OSM_NW_692355779, floors=1, floor_h=3.30, wall='cream', accent='gray_tile', roof_kind='flat', roof_tile='gray_tile')

    # 4. Exact OSM pitches (way/692355777 basketball + way/692355778 volleyball)
    b.basketball_court(13.49, 17.45, -0.35 + math.pi / 2, surface='court_green', apron='pave', y0=0.055, scale=0.72)
    b.volleyball_court(1.07, 12.43, -0.35 + math.pi / 2, w=18.0, d=9.0, surface='court_blue', apron='court_green', y0=0.055)
    b.flagpole_plinth(-16.5, 14.5, 1.22, poles=1, height=10.8)

    # 5. Trees in stone planters
    for idx, (tx, tz) in enumerate([(-8.0, -50.5), (34.0, -28.0), (26.0, 36.0), (-36.0, 18.0)]):
        b.campus_tree(tx, tz, h=7.4 + (idx % 2) * 0.8, spread=2.9, seed=idx + 31, planter=True)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'glut_primary.glb', build_glut_primary, signs=SIGNS)
