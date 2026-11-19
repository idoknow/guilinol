"""桂林医科大学（东城校区）, OSM way/627526148 (环城北二路 109 号).

University campus modeled after 2020–2026 official campus photos (glmu.edu.cn)
and OSM building footprints, anchored at way/627526148 centroid (693.95, -1396.14),
ground flattened to 152.2 m:
- 东北正门（朝环城北二路，local (-24, -290), yaw=2.34）：左侧白色现代悬挑门架、右侧深红花岗岩
  校名照壁“桂林医科大学”，无岗亭/门禁/监控，内侧设“桂林医科大学 东城校区”校名石花坛。
- 东城图书馆（way/459580291, local (22, -200)）：6 层内凹弧形陶红与米白柱廊立面 + 中央 7 层白色门楼。
- 弘德楼（way/671760495, local (50, -144.5)）：7 层主行政教学综合楼，前设“弘德善医”校训石圆形花坛。
- 科教楼与多功能报告厅（way/672633239, local (-48, -116)）：6 层陶红米白合院教学实验楼群 + 院内八角形报告厅。
- 附属口腔医院楼（东北侧 (52, -234)）与第二教学楼（way/671790070, (47, -95)）：6 层浅白陶红教学门诊楼。
- 标准田径运动场（way/672634658, (-5.8, +47)）：红色塑胶跑道 + 绿色草坪足球场 + 西侧遮阳看台 + 北侧高水塔与升旗台。
- 西侧学生公寓群（6 层浅米白配橙红檐口条形板楼）及南区球场与综合实验楼（5 层）。
"""
import math
import sys
from pathlib import Path

from g3_kit import Builder, ensure_textures, export_school


def _build_north_gate(b: Builder):
    """环城北二路 109 号正门: white cantilevered left frame + dark crimson granite name wall on right."""
    prev = b.pose
    # Face NE toward 环城北二路
    b.pose = (-22.0, 0.0, -288.0, 2.34)
    # Entrance asphalt/granite apron
    b.box(2.0, 0.0, 0.0, 34.0, 0.05, 14.0, 'pave', tile=2.4)
    if b.detail:
        for cx in (-3.5, -1.5, 0.5):
            b.box(cx, 0.06, 2.2, 0.22, 0.02, 3.6, 'ochre', tile=1.0)
    # Left white modernist stepped portal frame (photo #00)
    b.box(-11.5, 0.0, 0.0, 4.2, 6.4, 2.8, 'white', tile=2.0, collide=True)
    b.box(-8.2, 4.8, 0.0, 6.8, 1.35, 2.4, 'white', tile=2.0)
    b.box(-11.5, 6.4, 0.0, 4.6, 0.28, 3.1, 'dark_stone', tile=1.6)
    # Right long crimson/terracotta granite screen wall with gold '桂林医科大学'
    b.box(9.6, 0.0, 0.4, 15.6, 0.52, 1.3, 'dark_stone', tile=1.6, collide=True)
    b.box(9.6, 0.52, 0.4, 15.2, 2.15, 0.95, 'brick_red', tile=1.8, collide=True)
    b.box(9.6, 2.67, 0.4, 15.8, 0.22, 1.25, 'dark_stone', tile=1.4)
    b.sign_board(9.6, 1.62, 0.92, 12.6, 1.55, 'glmu_gate', backing=None, depth=0, double_sided=True)
    b.pose = prev

    # Campus name stone boulder inside north plaza
    b.motto_stone(-25.0, -258.0, 2.34, 'glmu_stone', w=5.2, h=1.95)


def _build_library(b: Builder):
    """东城校区图书馆 (way/459580291): 6-storey concave arc terracotta & white colonnade facing NE."""
    prev = b.pose
    # Concave arc center faces NE (yaw ~ 2.34)
    b.pose = (20.0, 0.0, -198.0, 2.34)
    floors, fh = 6, 3.65
    th = floors * fh
    # Central 7-storey white vertical portal tower (photo #03)
    b.box(0.0, 0.0, 2.2, 14.2, th + 3.8, 16.5, 'white', tile=2.2, collide=True)
    b.box(0.0, 0.0, 10.6, 10.4, 4.8, 2.8, 'granite', tile=1.8, collide=True)
    for fl in range(1, floors + 1):
        b.box(0.0, fl * fh - 2.1, 10.52, 8.6, 1.85, 0.10, 'glass', tile=2.0, lit=True)
    b.sign_board(0.0, th + 2.1, 10.55, 7.6, 1.65, 'bld_lib', backing=None, depth=0)
    b.box(0.0, th + 3.8, 2.2, 14.8, 0.45, 17.0, 'dark_stone', tile=1.8)

    # Two symmetric curved/angled terracotta wings curving forward (+Z at ends)
    for side in (-1, 1):
        for seg, (ox, oz, yaw_off, w_seg) in enumerate(((15.5, 4.0, -0.22, 18.5), (31.5, 9.6, -0.46, 17.5))):
            sub_prev = b.pose
            b.pose = b._xf((side * ox, 0.0, oz))[:3] + (2.34 + side * yaw_off,)
            # Re-set cleanly in world-local space
            b.pose = sub_prev
            ang = 2.34 + side * yaw_off
            wx, _, wz = b._xf((side * ox, 0.0, oz))
            b.pose = (wx, 0.0, wz, ang)
            b.box(0, 0, 0, w_seg, 0.6, 14.6, 'dark_stone', tile=1.8)
            b.box(0, 0.6, 0, w_seg, th - 0.6, 14.2, 'terracotta', tile=2.2, collide=True)
            b.box(0, th, 0, w_seg + 0.6, 0.55, 14.8, 'white', tile=2.0)
            for fl in range(floors):
                wy = fl * fh + 1.15
                b.box(0, wy, 7.16, w_seg - 2.2, 1.65, 0.08, 'glass', tile=2.0, lit=True)
                b.box(0, wy, -7.16, w_seg - 2.2, 1.65, 0.08, 'glass', tile=2.0, lit=True)
            if b.detail:
                for px in (-w_seg * 0.36, -w_seg * 0.12, w_seg * 0.12, w_seg * 0.36):
                    b.box(px, 0.6, 7.22, 0.55, th - 0.6, 0.45, 'white', tile=1.6)
            b.pose = sub_prev

    # Forecourt circular red-paver flowerbed in front of library arc
    b.cylinder_y(0.0, 0.0, 0.32, 19.5, 6.2, 'brick_red', sections=16)
    b.cylinder_y(0.0, 0.32, 0.18, 19.5, 5.4, 'foliage', sections=16)
    b.pose = prev


def _build_kejiao_complex(b: Builder):
    """科教楼与多功能报告厅 (way/672633239): 6-storey salmon/terracotta U-courtyard + octagonal hall."""
    # North long wing (-104..-12, z=-135) facing south into courtyard
    b.teaching_block(-58.0, -135.0, 0.0, 88.0, 15.0, 6, floor_h=3.45,
                     wall='cream', accent='terracotta', roof_kind='flat', corridor=True, portico=False)
    # East wing (x=-4, z=-132..-64) facing west into courtyard
    b.teaching_block(-4.0, -98.0, -math.pi / 2, 68.0, 15.2, 6, floor_h=3.45,
                     wall='cream', accent='terracotta', roof_kind='flat', corridor=True, portico=True, sign_key='bld_kejiao')
    # West wing (x=-94, z=-132..-86) facing east
    b.teaching_block(-94.0, -108.0, math.pi / 2, 44.0, 14.5, 5, floor_h=3.45,
                     wall='cream', accent='terracotta', roof_kind='flat', corridor=True, portico=False)
    # Courtyard terracotta brick paving + protruding 2-storey octagonal lecture hall (photo #01)
    b.box(-46.0, 0.0, -104.0, 68.0, 0.05, 46.0, 'pave', tile=2.6)
    prev = b.pose
    b.pose = (-25.0, 0.0, -114.0, -0.4)
    b.cylinder_y(0, 0.0, 8.2, 0, 10.8, 'terracotta', sections=8, tile=2.0, collide=True)
    b.cylinder_y(0, 8.2, 1.1, 0, 11.4, 'white', sections=8, tile=2.0)
    b.box(0, 0.0, 9.8, 8.4, 4.6, 3.6, 'terracotta', tile=1.8, collide=True)
    if b.detail:
        for sx in (-3.2, -1.1, 1.1, 3.2):
            b.box(sx, 0.0, 11.6, 0.45, 4.5, 0.45, 'white', tile=1.4)
    b.pose = prev


def _build_water_tower(b: Builder, cx, cz):
    """Iconic white conical-top campus water tower north-west of the stadium (photo #02)."""
    b.cylinder_y(cx, 0.0, 20.5, cz, 1.65, 'white', sections=10, collide=True)
    b.cylinder_y(cx, 20.5, 4.2, cz, 4.6, 'white', sections=12)
    b.cylinder_y(cx, 24.7, 0.6, cz, 4.8, 'terracotta', sections=12)


def build(b: Builder):
    # 1. North Gate on 环城北二路 & Stomatology Hospital building
    _build_north_gate(b)
    b.teaching_block(-58.0, -268.0, 2.34, 32.0, 14.0, 6, floor_h=3.5,
                     wall='white', accent='blue_facade', roof_kind='flat', corridor=False, portico=True, sign_key='bld_stomat')

    # 2. Library concave colonnade complex (way/459580291)
    _build_library(b)

    # 3. 弘德楼 (way/671760495, 7 storeys) + "弘德善医" motto stone circular garden
    b.teaching_block(50.0, -144.5, -math.pi / 2, 36.5, 22.0, 7, floor_h=3.55,
                     wall='white', accent='terracotta', roof_kind='flat', corridor=False, portico=True, sign_key='bld_hongde')
    b.motto_stone(22.0, -144.5, -math.pi / 2, 'glmu_motto', w=4.6, h=2.3)

    # 4. Second Teaching & Stomatology College Block (way/671790070)
    b.teaching_block(47.0, -95.0, -math.pi / 2, 44.0, 16.5, 6, floor_h=3.45,
                     wall='cream', accent='terracotta', roof_kind='flat', corridor=True, portico=True, sign_key='bld_mingde')

    # 5. 科教楼与多功能报告厅合院 (way/672633239)
    _build_kejiao_complex(b)

    # 6. North basketball & volleyball courts (ways 671760725, 671760840, 671763132)
    for cx, cz in ((-62.0, -216.0), (-92.0, -216.0), (-68.0, -246.0)):
        b.basketball_court(cx, cz, 0.0, surface='court_green', apron='track_red')

    # 7. Standard 400m Track & Soccer Stadium (way/672634658) + west rostrum + water tower + flagpoles
    b.track_field(-5.8, 48.0, 0.0, straight_len=66.0, inner_r=24.5, track_w=5.8, stand_side=-1)
    b.flagpole_plinth(-5.8, -14.0, 0.0, poles=3, height=13.5)
    _build_water_tower(b, -36.0, -12.0)

    # 8. West Student Dormitory Zone (ways 672633244/246/248/251, 672633450/451)
    for dz in (-41.5, -18.5, 3.5):
        b.teaching_block(-80.0, dz, 0.08, 62.0, 13.5, 6, floor_h=3.15,
                         wall='white', accent='terracotta', roof_kind='pitched', roof_tile='red_tile', corridor=True, portico=False)
    for dz in (48.0, 74.0):
        b.teaching_block(-64.0, dz, 0.0, 35.0, 11.5, 5, floor_h=3.2,
                         wall='cream', accent='terracotta', roof_kind='flat', corridor=True, portico=False)
    b.teaching_block(-102.0, 66.0, math.pi / 2, 31.0, 14.0, 6, floor_h=3.15,
                     wall='white', accent='terracotta', roof_kind='flat', corridor=False, portico=False)

    # 9. South courts & Southern Experimental / Teaching Blocks (ways 672659167, 672659168)
    b.basketball_court(12.0, 175.0, 0.0, surface='court_blue', apron='track_red')
    b.basketball_court(56.0, 173.0, 0.0, surface='court_green', apron='track_red')
    b.basketball_court(82.0, 173.0, 0.0, surface='court_green', apron='track_red')
    b.teaching_block(76.0, 218.0, math.pi, 46.0, 16.5, 5, floor_h=3.45,
                     wall='white', accent='terracotta', roof_kind='flat', corridor=True, portico=True, sign_key='bld_boxue')
    b.teaching_block(138.0, 218.0, math.pi, 40.0, 16.0, 5, floor_h=3.45,
                     wall='cream', accent='blue_facade', roof_kind='flat', corridor=True, portico=False)

    # 10. Main campus avenue paving & perimeter wall segments (clear of external roads)
    b.box(-28.0, 0.0, -225.0, 9.0, 0.04, 115.0, 'pave', tile=2.5)
    b.box(-35.0, 0.0, 35.0, 8.0, 0.04, 180.0, 'pave', tile=2.5)
    b.perimeter_wall([
        (-102.0, -278.0), (-42.0, -300.0),  # NW wall up to North Gate
    ], h=2.2)
    b.perimeter_wall([
        (-6.0, -270.0), (58.0, -202.0), (68.0, -55.0),  # NE & East wall inset safely inside campus
    ], h=2.2)

    # 11. Campus avenue trees (camphor, banyan & palms matching photos)
    for tz in (-265, -240, -210, -180, -70, -25, 25, 75, 125):
        b.campus_tree(-38.5, tz, h=8.5, spread=3.6, seed=abs(tz), kind='camphor')
    for tx, tz in ((8.0, -168.0), (32.0, -168.0), (-48.0, -96.0), (-30.0, -155.0), (52.0, 196.0), (98.0, 196.0)):
        b.campus_tree(tx, tz, h=9.5, spread=4.4, seed=int(abs(tx + tz)), kind='banyan')
    for tx, tz in ((-10.0, -274.0), (6.0, -258.0), (14.0, -180.0), (28.0, -180.0)):
        b.campus_tree(tx, tz, h=9.0, spread=3.2, seed=int(abs(tx * 3)), kind='palm')


def main():
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    image = ensure_textures(folder)
    export_school(folder / 'glmu_dongcheng.glb', image, build)


if __name__ == '__main__':
    main()
