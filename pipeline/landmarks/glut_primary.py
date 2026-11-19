"""Primary School Attached to Guilin University of Technology (桂林理工大学附属小学).

Restores Jiangan Rd flat-canopy gate with raised grey lettering & LED banner,
and extrudes exact OSM/Overture campus buildings & pitches (way/473969804).
"""
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from g3_kit import Builder, export_school

SIGNS = [
    dict(key='glut_gate',   title='桂林理工大学附属小学', sub='', fg=(90, 96, 100), bg=(238, 236, 228), sans=False, raised=True),
    dict(key='glut_led',    title='热 烈 庆 祝 · 欢 迎 师 生', sub='', fg=(232, 52, 42), bg=(24, 20, 22), sans=True),
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
    wide flat white canopy, thick white fascia with large raised grey 3D characters,
    LED ticker strip underneath, and closed retractable gate (ref #01, #03)."""
    prev = b.pose
    b.pose = (-30.6, 0.0, -6.8, -1.85)
    b.box(0.0, 0.02, 0.0, 16.0, 0.04, 5.2, 'pave_plaza', tile=2.5)
    # Main pillars supporting flat canopy: vehicle bay [-4.6..+2.8], open pedestrian bay [+2.8..+5.6]
    for px, pw in ((-5.2, 1.15), (2.8, 1.15), (5.8, 0.90)):
        b.box(px, 0.0, 0.0, pw + 0.18, 0.50, 1.35, 'dark_stone', tile=1.4)
        b.box(px, 0.50, 0.0, pw, 3.85, 1.15, 'white', tile=1.8, collide=True)
    # Thick flat-roofed white canopy overhang ('平顶雨棚 + 白色大字檐口')
    b.box(0.3, 4.30, 0.15, 13.6, 1.26, 3.6, 'white', cap_region='silver_roof', tile=2.0, bottom=True)
    b.box(0.3, 5.56, 0.15, 13.9, 0.14, 3.8, 'granite', tile=1.6)
    b.sign_board(-1.0, 4.94, 1.98, 10.2, 1.02, 'glut_gate', backing=None, depth=0)
    # Suspended black-and-red LED banner directly beneath canopy fascia ('热烈庆祝')
    b.box(-1.2, 3.56, 1.10, 7.6, 0.68, 0.24, 'led_bg', tile=1.0)
    b.sign_board(-1.2, 3.90, 1.24, 7.3, 0.56, 'glut_led', backing=None, depth=0)
    # Closed stainless-steel retractable gate across vehicle opening (pedestrian side [3.4..5.3] open)
    b.retractable_gate(-4.55, 2.15, 0.0, h=1.32)
    # Flanking warm-ochre & cream stone nameplate planter wall on left (ref #03)
    b.box(-8.4, 0.0, 0.4, 4.6, 2.05, 0.65, 'ochre', cap_region='cream', tile=1.8, collide=True)
    b.sign_board(-8.4, 1.18, 0.76, 3.6, 0.92, 'glut_plaque', backing='cream', depth=0.06)
    b.lawn_patch(-8.4, 1.45, 0.0, 4.2, 1.0, y=0.04, curb=True, shrubs=True)
    b.pose = prev


def _build_main_courtyard_block(b: Builder):
    """4-storey warm cream-yellow U/quadrangle main teaching block on exact Overture 253e76b1-caf
    polygon (centroid (7.48, -22.28), yaw 16.06 deg, ref #02)."""
    # Build four symmetric perimeter wings around central atrium inside exact OV_MAIN_253E corners
    # Corners: NE=(36.47,-36.54), NW=(-9.36,-49.73), SW=(-21.52,-8.0), SE=(24.32,5.17)
    p_ne, p_nw, p_sw, p_se = OV_MAIN_253E
    def lerp2(a, c, t):
        return (a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t)

    # North wing (26% depth), South wing (26% depth), West & East wings (22% width)
    nw_i = lerp2(p_nw, p_sw, 0.26)
    ne_i = lerp2(p_ne, p_se, 0.26)
    sw_i = lerp2(p_nw, p_sw, 0.74)
    se_i = lerp2(p_ne, p_se, 0.74)
    b.footprint_building([p_nw, p_ne, ne_i, nw_i], floors=4, floor_h=3.55, wall='cream', accent='ochre', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building([sw_i, se_i, p_se, p_sw], floors=4, floor_h=3.55, wall='cream', accent='ochre', roof_kind='flat', roof_tile='gray_tile')
    w_in_n = lerp2(nw_i, ne_i, 0.22)
    w_in_s = lerp2(sw_i, se_i, 0.22)
    e_in_n = lerp2(nw_i, ne_i, 0.78)
    e_in_s = lerp2(sw_i, se_i, 0.78)
    b.footprint_building([nw_i, w_in_n, w_in_s, sw_i], floors=4, floor_h=3.55, wall='cream', accent='ochre', roof_kind='flat', roof_tile='gray_tile')
    b.footprint_building([e_in_n, ne_i, se_i, e_in_s], floors=4, floor_h=3.55, wall='cream', accent='ochre', roof_kind='flat', roof_tile='gray_tile')
    # First-floor colonnade pillars along south playground-facing facade (ref #02)
    if b.detail:
        for k in range(1, 8):
            px, pz = lerp2(p_sw, p_se, k / 8.0)
            b.cylinder_y(px - 0.3, 0.0, 3.6, pz + 0.5, 0.28, 'white', sections=8)


def build_glut_primary(b: Builder):
    # 1. Campus-wide grey hard paving + greenbelts & planters
    b.pave_polygon(PAVE_PTS, y=0.03, region='pave')
    b.walkway((-30.0, -6.8), (-10.0, 4.0), width=5.5, y=0.045)
    b.lawn_patch(7.5, -22.3, -0.28, 14.0, 12.0, curb=True)
    b.lawn_patch(29.0, 22.0, -0.35, 5.5, 22.0, curb=True)

    # 2. Gate & perimeter wall (gap 0 on west wall around (-31, -6.8))
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

    # 4. Exact OSM pitches (way/692355777 basketball + way/692355778 volleyball/turf + sprint lanes & rostrum, ref #04)
    # Campus axis yaw = -0.35 rad (parallel to south/north buildings)
    b.pose = (6.2, 0.04, 14.8, -0.35)
    # Red synthetic sport apron wrapping both OSM pitches + west green turf assembly area
    b.box(-4.5, 0.0, 0.0, 42.0, 0.03, 21.0, 'track_red', tile=4.0)
    # Parallel-striped green turf assembly field on west half
    for si in range(6):
        xa = -23.0 + si * 3.4
        b.box(xa + 1.7, 0.032, 0.0, 3.4, 0.015, 16.8, 'turf_light' if si % 2 == 0 else 'turf_green', tile=4.0)
    b.pose = (0.0, 0.0, 0.0, 0.0)
    b.basketball_court(13.49, 17.45, -0.35 + math.pi / 2, surface='court_green', apron='track_red', y0=0.055, scale=0.66)
    b.flagpole_plinth(-16.5, 14.5, 1.22, poles=1, height=10.8)

    # 5. Trees in stone planters (kept away from west gate view)
    for idx, (tx, tz) in enumerate([(-8.0, -50.5), (34.0, -28.0), (26.0, 36.0), (-36.0, 18.0)]):
        b.campus_tree(tx, tz, h=7.4 + (idx % 2) * 0.8, spread=2.9, seed=idx + 31, planter=True)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'glut_primary.glb', build_glut_primary, signs=SIGNS)
