"""Guilin Lijiang Primary School (桂林市七星区漓江小学).

Restores the 5-storey cream-white main building with pitched hipped roof,
full-height blue glass stairwell curtain walls, ground-floor red LED portal,
vertical-plaque gate pillar, closed retractable gate, and blue-white culture
wall (ref #00, #01, #05, #19); footprints traced from satellite inside way/1563350367.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from g3_kit import Builder, export_school

SIGNS = [
    dict(key='lj_roof', title='漓 江 小 学', sub='', fg=(204, 46, 38), bg=(238, 236, 228), sans=False, raised=True),
    dict(key='lj_led',  title='热烈欢迎  漓江小学全体师生', sub='', fg=(236, 52, 42), bg=(26, 20, 22), sans=True),
    dict(key='lj_vert', title='桂林市七星区漓江小学', sub='', fg=(42, 46, 50), bg=(242, 240, 234), orient='v', sans=False, border=(168, 166, 158)),
]

PAVE_PTS = [(-39.02, 24.29), (11.43, 41.78), (36.98, -24.56), (-7.73, -43.36)]
YAW = -0.334  # Exact SSW orientation of way/1563350367


def _build_main_building_and_gate(b: Builder):
    """5-storey cream-white main building with pitched roof, full-height blue glass
    stairwell bays, rooftop '漓江小学' sign, and street-level gatehouse with red LED
    banner, vertical plaque pillar, closed retractable gate & blue-white culture wall."""
    prev = b.pose
    b.pose = (-5.5, 0.0, 12.5, YAW)

    w, d, fl_h = 31.0, 13.4, 3.55
    total_h = 5 * fl_h  # 17.75 m

    # Ground floor terracotta brick colonnade base + upper 4 floors cream-white walls (ref #19)
    b.box(0, 0.0, 0, w + 0.3, 3.65, d + 0.2, 'terracotta', tile=2.0, collide=True)
    b.box(0, 3.65, 0, w, total_h - 3.65, d, 'white', tile=2.4, collide=True)
    # Grey-tile ground-floor porch eave skirt along courtyard (-Z) & street (+Z)
    b.box(0, 3.65, 0, w + 1.1, 0.28, d + 1.4, 'gray_tile', cap_region='gray_tile', tile=1.6)

    # Full-height blue reflective glass stairwell curtain walls (center Stairwell + East & West corner stair towers, ref #00, #19!)
    for sx, sw in ((0.0, 4.6), (11.6, 6.2), (-11.6, 5.4)):
        # Slightly proud white tower frame + full-height blue glass curtain wall (floors 2..5)
        b.box(sx, 3.65, 0, sw + 0.6, total_h - 3.1, d + 0.65, 'white', tile=2.0)
        for side in (-1, 1):
            gz = side * (d / 2 + 0.36)
            b.box(sx, 3.9, gz, sw, total_h - 3.7, 0.10, 'glass', tile=2.0, lit=True)
            if b.detail:
                # Crisp silver-white window grid mullions on glass stairwell
                for fl in range(1, 5):
                    b.box(sx, fl * fl_h + 0.2, gz + side * 0.04, sw + 0.08, 0.12, 0.08, 'steel', tile=1.0)
                for mx in (-sw / 4, sw / 4):
                    b.box(sx + mx, 3.9, gz + side * 0.04, 0.10, total_h - 3.7, 0.08, 'steel', tile=1.0)

    # Classroom windows + brown vertical spandrels on remaining bays (ref #00, #19)
    for bx in (-6.2, -3.2, 3.2, 6.2):
        for side in (-1, 1):
            wz = side * (d / 2 + 0.06)
            for fl in range(1, 5):
                wy = fl * fl_h + 1.05
                b.box(bx, wy, wz, 2.0, 1.55, 0.08, 'glass', tile=1.8, lit=True)
            if b.detail:
                b.box(bx + 1.35, 3.9, wz, 0.55, total_h - 4.2, 0.10, 'wood', tile=1.4)

    # Pitched overhanging grey-tile hipped roof ('坡屋顶') + central rooftop '漓江小学' sign
    b.pitched_roof(0, total_h + 0.35, 0, w + 0.8, d + 0.8, 2.35, overhang=0.95, tile_region='gray_tile', fascia_region='white')
    b.box(0, total_h + 1.45, d / 2 - 0.5, 9.6, 1.55, 1.2, 'white', tile=1.8)
    b.sign_board(0, total_h + 2.22, d / 2 + 0.14, 8.6, 1.25, 'lj_roof', backing=None, depth=0, double_sided=True)

    # Street-front gate line along z = +16.2 (right on south boundary of way/1563350367, ref #00)
    gz_line = 16.2
    b.box(0.0, 0.02, gz_line, 34.0, 0.04, 5.2, 'pave_plaza', tile=2.5)

    # Left (-X): Blue-and-white campus culture wall ('蓝白文化墙', ref #00 left)
    for k in range(4):
        cx = -17.5 + k * 3.8
        b.box(cx, 0.0, gz_line, 3.75, 2.35, 0.38, 'white', cap_region='blue_facade', tile=1.8, collide=(k == 0))
        b.box(cx, 0.65, gz_line + 0.21, 2.9, 1.15, 0.06, 'blue_facade', tile=1.4)
    b.solid_box(-11.8, 0.0, gz_line, 15.2, 2.35, 0.42)

    # Tall cream-stone vertical-plaque gate pillar at x = -3.6 (ref #00, #01)
    b.box(-3.6, 0.0, gz_line, 1.45, 4.45, 1.45, 'cream', cap_region='white', tile=1.6, collide=True)
    b.sign_board(-3.6, 2.25, gz_line + 0.75, 0.58, 2.55, 'lj_vert', backing='white', depth=0.05)

    # Closed stainless-steel retractable gate across vehicle opening [-2.8 .. +3.6]
    b.retractable_gate(-2.75, 3.55, gz_line, h=1.32)

    # Right (+X): White flat-canopy pedestrian portal with red LED banner ('首层门头挂红色 LED 字幕', ref #00 right!)
    # Open pedestrian bays [4.2 .. 7.8] between white piers so walkability into campus is seamless!
    for px in (4.0, 8.2, 12.2):
        b.box(px, 0.0, gz_line, 0.85, 3.85, 1.15, 'white', base_mat if False else 'white', tile=1.6, collide=True)
    # Side wall on far right bay [8.6..12.2] (non-guardhouse architectural wall, open walk bay is [4.4..7.8])
    b.box(10.2, 0.0, gz_line - 0.6, 3.8, 3.65, 2.2, 'white', tile=1.8, collide=True)
    b.box(10.2, 0.0, gz_line + 0.52, 3.8, 1.0, 0.12, 'terracotta', tile=1.4)
    b.box(10.2, 1.2, gz_line + 0.52, 2.4, 1.6, 0.10, 'glass', tile=1.6)
    # White flat roof canopy + bright red LED banner across [3.6 .. 12.6]
    b.box(8.1, 3.75, gz_line + 0.15, 9.4, 0.65, 2.8, 'white', cap_region='silver_roof', tile=1.8, bottom=True)
    b.box(8.1, 3.18, gz_line + 1.42, 8.6, 0.62, 0.22, 'led_bg', tile=1.0)
    b.sign_board(8.1, 3.49, gz_line + 1.55, 8.3, 0.52, 'lj_led', backing=None, depth=0)

    b.pose = prev


def build_lijiang_primary(b: Builder):
    # 1. Campus-wide grey hard paving + greenbelts
    b.pave_polygon(PAVE_PTS, y=0.03, region='pave')
    b.lawn_patch(-22.0, -6.0, YAW, 4.5, 26.0, curb=True)

    # 2. 5F Main Building + Street Gate + Perimeter Wall
    _build_main_building_and_gate(b)
    b.perimeter_wall(
        [(11.43, 41.78), (36.98, -24.56), (-7.73, -43.36), (-39.02, 24.29)],
        h=2.10, wall_mat='white', base_mat='blue_facade', cap_mat='gray_tile',
    )

    # 3. Satellite-traced 4F White North Teaching Wing (visible at north end of courts in ref #05 & satellite)
    b.teaching_block(-3.5, -28.5, YAW, width=21.0, depth=9.8, floors=4, floor_h=3.40,
                     wall='white', accent='blue_facade', roof_kind='pitched', roof_tile='gray_tile',
                     corridor=True, portico=False)

    # 4. Satellite-traced Red Synthetic Track Ring & Twin Green-Red Courts (ref #05)
    b.pose = (9.5, 0.04, -10.5, YAW)
    b.box(0.0, 0.0, 0.0, 26.5, 0.03, 30.0, 'track_red', tile=4.0)
    b.pose = (0.0, 0.0, 0.0, 0.0)
    b.basketball_court(4.2, -8.5, YAW, surface='court_green', apron='track_red', y0=0.055, scale=0.68)
    b.basketball_court(15.2, -12.5, YAW, surface='court_green', apron='track_red', y0=0.055, scale=0.68)
    b.flagpole_plinth(-10.5, -16.5, YAW, poles=1, height=10.6)

    # 5. Camphor Trees in Stone Planters along east & west edges (matching ref #05)
    for idx, (tx, tz) in enumerate([(-20.0, 2.0), (-15.5, -10.0), (24.5, -2.0), (29.0, -14.0)]):
        b.campus_tree(tx, tz, h=8.2 + (idx % 2) * 0.9, spread=3.1, seed=idx + 61, planter=True)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'lijiang_primary.glb', build_lijiang_primary, signs=SIGNS)
