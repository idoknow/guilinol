"""Guilin Lijiang Primary School (漓江小学).

Restores the Fangxiang Rd street gate with vertical-plaque gate pillar,
closed gate, and perimeter boundary wall (way/1563350367).
In accordance with Standard A: zero buildings or pitches are added
since none exist in OSM/Overture footprints.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from g3_kit import Builder, export_school

SIGNS = [
    dict(key='lj_vert', title='桂林市七星区漓江小学', sub='', fg=(42, 46, 50), bg=(242, 240, 234), orient='v', sans=False, border=(168, 166, 158)),
]

PAVE_PTS = [(-39.02, 24.29), (11.43, 41.78), (36.98, -24.56), (-7.73, -43.36)]
YAW = -0.334  # Orientation of way/1563350367


def _build_street_gate(b: Builder):
    """Street-front gate along Fangxiang Rd (south boundary of way/1563350367):
    Vertical plaque pillar, closed gate, and perimeter wall."""
    prev = b.pose
    b.pose = (-5.5, 0.0, 12.5, YAW)
    gz_line = 16.2
    b.box(0.0, 0.02, gz_line, 34.0, 0.04, 5.2, 'pave_plaza', tile=2.5)

    # Blue-and-white campus boundary wall on left
    for k in range(4):
        cx = -17.5 + k * 3.8
        b.box(cx, 0.0, gz_line, 3.75, 2.35, 0.38, 'white', cap_region='blue_facade', tile=1.8, collide=(k == 0))
        b.box(cx, 0.65, gz_line + 0.21, 2.9, 1.15, 0.06, 'blue_facade', tile=1.4)
    b.solid_box(-11.8, 0.0, gz_line, 15.2, 2.35, 0.42)

    # Cream-stone vertical-plaque gate pillar at x = -3.6
    b.box(-3.6, 0.0, gz_line, 1.45, 4.45, 1.45, 'cream', cap_region='white', tile=1.6, collide=True)
    b.sign_board(-3.6, 2.25, gz_line + 0.75, 0.58, 2.55, 'lj_vert', backing='white', depth=0.05)

    # Closed stainless-steel retractable gate across opening [-2.8 .. +3.6]
    b.retractable_gate(-2.75, 3.55, gz_line, h=1.32)

    # Continuation of boundary wall on right [3.6..15.2]
    for px in (4.0, 8.2, 12.2):
        b.box(px, 0.0, gz_line, 0.95, 3.85, 1.15, 'white', cap_region='white', tile=1.6, collide=True)
    b.box(11.9, 0.0, gz_line, 6.2, 2.25, 0.38, 'white', cap_region='blue_facade', tile=1.8, collide=True)
    b.box(11.9, 0.65, gz_line + 0.21, 4.8, 1.05, 0.06, 'terracotta', tile=1.4)
    b.box(8.1, 3.75, gz_line + 0.15, 9.4, 0.65, 2.8, 'white', cap_region='silver_roof', tile=1.8, bottom=True)
    b.pose = prev


def build_lijiang_primary(b: Builder):
    # 1. Campus-wide paving and lawn
    b.pave_polygon(PAVE_PTS, y=0.03, region='pave')
    b.lawn_patch(-10.0, -10.0, YAW, 18.0, 30.0, curb=True)

    # 2. Gate + Perimeter Wall
    _build_street_gate(b)
    b.perimeter_wall(
        [(11.43, 41.78), (36.98, -24.56), (-7.73, -43.36), (-39.02, 24.29)],
        h=2.10, wall_mat='white', base_mat='blue_facade', cap_mat='gray_tile',
    )

    # Flagpole
    b.flagpole_plinth(-10.5, -16.5, YAW, poles=1, height=10.6)

    # 3. Trees in Stone Planters
    for idx, (tx, tz) in enumerate([(-20.0, 2.0), (-15.5, -10.0), (24.5, -2.0), (29.0, -14.0)]):
        b.campus_tree(tx, tz, h=8.2 + (idx % 2) * 0.9, spread=3.1, seed=idx + 61, planter=True)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'lijiang_primary.glb', build_lijiang_primary, signs=SIGNS)
