"""桂林市辰山小学, OSM way/671777304.

游戏布局，非实地导览。临街外观与公开活动照可见要素按实拍参考还原：
- 西北侧临街校门（local (-10.0, -52.0), yaw=-2.30）：暖砂岩米黄门柱配金属牌匾“桂林市辰山小学”、
  关闭状态不锈钢伸缩门与铁艺围墙，无岗亭/门禁/监控/侧后门。
- 南侧 U 形教学楼组团沿用 OSM way/1475475421 轮廓位置（local (-14, +42)），按实拍图 #00/#04/#05/#14
  还原中央 5 层陶红砖主楼（坡屋顶檐冠）与两侧 4 层白墙水平外廊教学翼楼（厚德楼、尚善楼）。
- 东北侧设红边绿面丙烯酸运动场、塑胶跑道与升旗台（参考图 #00/#08/#11）。
"""
import math
import sys
from pathlib import Path

from g3_kit import Builder, ensure_textures, export_school

GATE_YAW = -2.30  # Faces NW onto residential street


def build(b: Builder):
    # 1. Northwest street-facing School Gate (closed伸缩门 + open pedestrian passage, no security booth)
    b.school_gate(
        -10.0, -52.0, GATE_YAW, 'chenshan_gate',
        total_w=15.5, veh_span=6.2, ped_open_w=2.3,
        pillar_h=4.9, beam_h=1.12, style='modern',
        pillar_mat='ochre', accent_mat='terracotta', closed_retractable=True,
    )
    b.motto_stone(-2.0, -38.0, GATE_YAW, 'chenshan_motto', w=4.0, h=1.65)

    # 2. Perimeter fence along campus polygon (safely clear of NW road corridor)
    b.perimeter_wall([
        (-58.0, 22.0), (-22.0, -38.0),
    ], h=2.15, wall_mat='ochre', base_mat='granite', cap_mat='terracotta')
    b.perimeter_wall([
        (2.0, -64.0), (28.0, -92.0), (76.0, -58.0), (42.0, -34.0),
        (28.0, 16.0), (24.0, 92.0), (-44.0, 94.0), (-58.0, 22.0),
    ], h=2.15, wall_mat='ochre', base_mat='granite', cap_mat='terracotta')

    # 3. U-shaped Main Teaching Complex at OSM way/1475475421 (-14, +42), facing NNW (yaw = math.pi)
    # Central 5-storey terracotta-red tower with pitched grey tile crown (photo #00/#05/#21)
    b.teaching_block(
        -14.0, 62.0, math.pi, width=38.0, depth=14.5, floors=5, floor_h=3.45,
        wall='terracotta', accent='white', roof_kind='pitched', roof_tile='gray_tile',
        corridor=True, portico=True, sign_key='bld_houde',
    )
    # West 4-storey white horizontal-corridor wing (photo #04/#11/#14)
    b.teaching_block(
        -38.0, 36.0, math.pi / 2, width=42.0, depth=13.0, floors=4, floor_h=3.4,
        wall='white', accent='terracotta', roof_kind='flat', corridor=True, portico=False, sign_key='bld_mingde',
    )
    # East 4-storey white horizontal-corridor wing
    b.teaching_block(
        10.0, 36.0, -math.pi / 2, width=42.0, depth=13.0, floors=4, floor_h=3.4,
        wall='white', accent='terracotta', roof_kind='flat', corridor=True, portico=False, sign_key='bld_shangshan',
    )
    # Courtyard plaza paving between the U-wings
    b.box(-14.0, 0.0, 34.0, 36.0, 0.04, 38.0, 'pave', tile=2.4)

    # 4. Playground: Red EPDM running oval + green turf & green acrylic basketball court (#00/#08/#11)
    b.track_field(16.0, -24.0, 0.72, straight_len=30.0, inner_r=13.5, track_w=4.0, stand_side=0, y0=0.12)
    b.basketball_court(-24.0, -6.0, 0.0, surface='court_green', apron='track_red', y0=0.10)
    b.flagpole_plinth(-14.0, 12.0, math.pi, poles=1, height=11.2)

    # 5. Campus trees (camphor & banyan along courtyard and fence)
    for tx, tz in ((-42.0, -6.0), (-32.0, -24.0), (8.0, -10.0), (38.0, -14.0), (-44.0, 76.0), (16.0, 76.0)):
        b.campus_tree(tx, tz, h=8.4, spread=3.6, seed=int(abs(tx * 7 + tz)), kind='camphor')


def main():
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    image = ensure_textures(folder)
    export_school(folder / 'chenshan_primary.glb', image, build)


if __name__ == '__main__':
    main()
