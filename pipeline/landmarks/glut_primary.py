"""桂林理工大学附属小学 (理工大附小), OSM way/473969804 (建干路 10 号).

游戏布局，非实地导览。临街外观与公开宣传可见要素按实拍参考还原：
- 西侧朝建干路校门（local (-33.5, -2.0), yaw=-1.92）：米白与暖黄石材现代平挑雨棚门头、
  “桂林理工大学附属小学”校名匾额及花坛铭牌墙、关闭状态不锈钢伸缩门，无岗亭/门禁/监控。
- 主教学楼（崇德楼，4 层暖米黄配浅赭竖向壁柱与首层柱廊）及南侧综合教学楼（笃学楼，3 层），
  沿校园既有轮廓范围采用游戏化布局，不重建真实室内外动线。
- 校园中部设红色塑胶边框运动场、绿色草坪与篮球场及升旗台。
"""
import math
import sys
from pathlib import Path

from g3_kit import Builder, ensure_textures, export_school

# Campus axis: WNW gate faces 建干路 (yaw = -1.92); campus long axis runs NNE-SSW (yaw = -0.35)
GATE_YAW = -1.92
AXIS_YAW = -0.35


def build(b: Builder):
    # 1. Street-facing Gate on 建干路 (closed伸缩门 + open pedestrian passage, no security booth)
    b.school_gate(
        -33.2, -1.5, GATE_YAW, 'glut_gate',
        total_w=15.0, veh_span=6.0, ped_open_w=2.3,
        pillar_h=4.8, beam_h=1.15, style='modern',
        pillar_mat='cream', accent_mat='ochre', closed_retractable=True,
    )
    # Warm ochre entrance flowerbed wall plaque (#03 photo feature)
    prev = b.pose
    b.pose = (-31.0, 0.0, -11.5, GATE_YAW)
    b.box(0, 0.0, 0, 5.2, 0.55, 1.4, 'granite', tile=1.4, collide=True)
    b.box(0, 0.55, 0, 4.6, 2.35, 0.65, 'ochre', tile=1.6, collide=True)
    b.box(0, 0.35, 0.75, 4.8, 0.35, 0.75, 'foliage', tile=1.5)
    b.sign_board(0, 1.65, 0.36, 3.9, 0.78, 'glut_gate', backing=None, depth=0)
    b.pose = prev

    # 2. Perimeter wall along 建干路 and campus border (inset safely inside campus)
    b.perimeter_wall([
        (-17.0, -52.0), (-30.5, -13.5),
    ], h=2.15, wall_mat='cream', base_mat='granite', cap_mat='ochre')
    b.perimeter_wall([
        (-36.2, 8.2), (-41.5, 33.5), (13.0, 52.5), (43.5, -31.0), (-17.0, -52.0),
    ], h=2.15, wall_mat='cream', base_mat='granite', cap_mat='ochre')

    # 3. North Main Teaching Block — 崇德楼 (4 storeys, cream & ochre vertical pilasters, photo #02/#05/#23)
    b.teaching_block(
        8.5, -24.0, AXIS_YAW, width=44.0, depth=13.5, floors=4, floor_h=3.45,
        wall='cream', accent='ochre', roof_kind='flat', corridor=True, portico=True, sign_key='bld_chongwen',
    )
    # Motto banner across 2nd floor balustrade
    prev = b.pose
    b.pose = (8.5, 0.0, -24.0, AXIS_YAW)
    b.sign_board(0, 4.35, 8.75, 8.6, 0.92, 'banner_study', backing=None, depth=0)
    b.pose = prev

    # 4. South Teaching Block — 笃学楼 (3 storeys, cream & white, facing NNW toward courtyard)
    b.teaching_block(
        -2.0, 35.5, AXIS_YAW + math.pi, width=32.0, depth=12.5, floors=3, floor_h=3.4,
        wall='white', accent='ochre', roof_kind='flat', corridor=True, portico=False, sign_key='bld_qiushi',
    )

    # 5. Central Playground (red EPDM apron + green turf & basketball court, photo #04/#07/#17) + Flagpole
    prev = b.pose
    b.pose = (1.5, 0.03, 6.5, AXIS_YAW)
    b.box(0, 0.0, 0, 44.0, 0.04, 28.0, 'track_red', tile=3.5)
    b.box(-8.0, 0.045, 0, 22.0, 0.02, 22.0, 'turf_green', tile=4.0)
    if b.detail:
        for r_off in (-12.5, 12.5):
            b.box(0, 0.06, r_off, 41.0, 0.015, 0.10, 'line_white', tile=1.0)
    b.pose = prev
    b.basketball_court(13.5, 8.5, AXIS_YAW + math.pi / 2, surface='court_green', apron='track_red')
    b.flagpole_plinth(-17.5, 4.0, AXIS_YAW + math.pi / 2, poles=1, height=11.0)

    # 6. Entrance walkway & campus trees (camphor & banyan, photo #07/#09)
    prev = b.pose
    b.pose = (-22.0, 0.0, 0.5, GATE_YAW)
    b.box(0, 0.0, -8.0, 7.5, 0.04, 20.0, 'pave', tile=2.0)
    b.pose = prev
    for tx, tz in ((-24.0, -24.0), (-14.0, -38.0), (30.0, -8.0), (24.0, 24.0), (-26.0, 24.0)):
        b.campus_tree(tx, tz, h=8.2, spread=3.5, seed=int(abs(tx * 5 + tz)), kind='camphor')


def main():
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    image = ensure_textures(folder)
    export_school(folder / 'glut_primary.glb', image, build)


if __name__ == '__main__':
    main()
