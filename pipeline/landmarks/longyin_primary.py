"""龙隐小学 (桂林市龙隐小学), OSM way/1027048356 (七星路 5 号).

游戏布局，非实地导览。临街外观与公开活动照可见要素按实拍参考还原：
- 西南侧朝七星路 5 号校门（local (-52.0, 34.0), yaw=-0.95）：青灰花岗岩门柱配绿琉璃坡檐门楼（参考图 #00）、
  “桂林市龙隐小学”校名匾、关闭状态不锈钢伸缩门，无岗亭/门禁/监控/侧后门。
- 校内沿 OSM 既有楼座与运动场轮廓采用游戏布局：入口香樟林荫道内设银色腾龙主题雕塑（参考图 #08），
  西侧设暖黄立面崇文楼（4 层，参考图 #05/#10），中部设白墙陶红饰带明德楼（4 层）与北侧陶橙山墙博学楼
  （4 层，参考图 #11/#14）。
- 东侧按 OSM way/1474986236–1474986237 及实拍图 #18 还原四道红色塑胶跑道、绿色人工草坪小足球场、
  篮球场及升旗台。
"""
import math
import sys
from pathlib import Path

from g3_kit import Builder, ensure_textures, export_school

GATE_YAW = -0.95  # Faces SW onto 七星路


def _build_dragon_sculpture(b: Builder, cx, cz):
    """银色现代腾龙/火炬不锈钢雕塑与深色花岗岩基座（参考图 #08）."""
    prev = b.pose
    b.pose = (cx, 0.0, cz, GATE_YAW)
    b.cylinder_y(0, 0.0, 0.30, 0, 2.8, 'granite', sections=12)
    b.cylinder_y(0, 0.30, 0.18, 0, 2.4, 'foliage', sections=12)
    b.box(0, 0.32, 0, 1.8, 0.95, 1.4, 'dark_stone', tile=1.2, collide=True)
    b.sign_board(0, 0.78, 0.72, 1.5, 0.55, 'longyin_motto', backing=None, depth=0)
    # Swept silver sculpture blades rising 3.4m
    b.tube((-0.35, 1.25, 0.0), (0.45, 3.85, 0.15), 0.18, 'steel', 6)
    b.tube((0.35, 1.25, -0.1), (-0.30, 3.45, -0.15), 0.15, 'steel', 6)
    if b.detail:
        b.cylinder_y(0.1, 2.4, 1.1, 0.0, 0.42, 'steel', sections=8)
    b.pose = prev


def build(b: Builder):
    # 1. Southwest Street-facing Glazed-Eave Gate on 七星路 5 号 (#00)
    b.school_gate(
        -52.0, 34.0, GATE_YAW, 'longyin_gate',
        total_w=15.5, veh_span=6.0, ped_open_w=2.3,
        pillar_h=5.0, beam_h=1.15, style='glazed',
        pillar_mat='granite', accent_mat='cream', roof_tile='green_glaze',
        closed_retractable=True,
    )

    # 2. Perimeter fence safely inside campus boundary (clear of 七星路)
    b.perimeter_wall([
        (-86.0, -18.0), (-74.0, 2.0), (-58.0, 25.0),
    ], h=2.15, wall_mat='cream', base_mat='granite', cap_mat='green_glaze')
    b.perimeter_wall([
        (-44.0, 44.5), (-30.0, 58.0), (28.0, 34.0), (68.0, 40.0),
        (71.0, -46.0), (36.0, -51.0), (-38.0, -35.0), (-86.0, -18.0),
    ], h=2.15, wall_mat='cream', base_mat='granite', cap_mat='green_glaze')

    # 3. Entrance Camphor Avenue & Silver Dragon Sculpture (#08)
    prev = b.pose
    b.pose = (-40.0, 0.0, 25.0, GATE_YAW)
    b.box(0, 0.0, -10.0, 8.0, 0.04, 28.0, 'pave', tile=2.2)
    b.pose = prev
    _build_dragon_sculpture(b, -32.0, 20.0)

    # 4. Teaching Buildings (following OSM blocks & photo colors #05/#11/#14)
    # West ochre-yellow block — 崇文楼 (4F, photo #05/#10)
    b.teaching_block(
        -38.0, -12.0, 0.15, width=32.0, depth=13.0, floors=4, floor_h=3.4,
        wall='ochre', accent='white', roof_kind='flat', corridor=True, portico=True, sign_key='bld_chongwen',
    )
    # North terracotta-gable block — 博学楼 (4F, photo #11/#14 facing east sports field)
    b.teaching_block(
        10.0, -24.0, 0.05, width=34.0, depth=13.5, floors=4, floor_h=3.4,
        wall='cream', accent='terracotta', roof_kind='pitched', roof_tile='red_tile',
        corridor=True, portico=False, sign_key='bld_boxue',
    )
    # Central-south white & terracotta block — 明德楼 (4F, OSM way/1488495381)
    b.teaching_block(
        8.0, 14.0, math.pi + 0.05, width=34.0, depth=13.5, floors=4, floor_h=3.4,
        wall='white', accent='terracotta', roof_kind='flat', corridor=True, portico=True, sign_key='bld_mingde',
    )

    # 5. East Sports Field: 4-lane Red EPDM Track + Green Soccer Turf + Basketball Court (#18)
    b.track_field(50.0, 10.0, 0.04, straight_len=26.0, inner_r=11.5, track_w=4.2, stand_side=0)
    b.basketball_court(48.0, -28.0, math.pi / 2 + 0.04, surface='court_green', apron='track_red')
    b.flagpole_plinth(30.0, 6.0, math.pi / 2, poles=1, height=11.0)

    # 6. Lush old camphor & banyan trees (#00/#08/#24)
    for tx, tz in ((-44.0, 16.0), (-24.0, 32.0), (-14.0, 0.0), (-64.0, -6.0), (28.0, -40.0), (26.0, 28.0)):
        b.campus_tree(tx, tz, h=9.2, spread=4.2, seed=int(abs(tx * 5 + tz)), kind='banyan' if tx < -20 else 'camphor')


def main():
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    image = ensure_textures(folder)
    export_school(folder / 'longyin_primary.glb', image, build)


if __name__ == '__main__':
    main()
