"""漓江小学 (桂林市七星区漓江小学), OSM way/1563350367.

游戏布局，非实地导览。临街外观与公开高处俯拍可见要素按实拍参考还原：
- 南侧临街校门与围墙（local (-14.0, 29.5), yaw=-0.336）：米黄石材门柱、“桂林市漓江小学”校名匾、
  关闭状态不锈钢伸缩门，以及左翼蓝白相间校园文化围墙（参考实拍图 #00/#01），无岗亭/门禁/监控/侧后门。
- 紧邻校门内侧的 5 层米白配深灰竖向窗带坡屋顶主教学楼（尚善楼，屋顶设校名标识，参考图 #00/#15）与北侧
  4 层教学楼（致远楼），按校园轮廓采用游戏布局。
- 校园中东部设红塑胶跑道环绕的双绿红丙烯酸球场与升旗台（参考俯拍图 #06）。
"""
import math
import sys
from pathlib import Path

from g3_kit import Builder, ensure_textures, export_school

GATE_YAW = -0.336  # Faces SSW toward street & 芳香路


def build(b: Builder):
    # 1. Street-facing Gate (closed伸缩门 + open pedestrian passage, no security booth)
    b.school_gate(
        -14.0, 29.5, GATE_YAW, 'lijiang_gate',
        total_w=14.5, veh_span=5.8, ped_open_w=2.2,
        pillar_h=4.6, beam_h=1.08, style='modern',
        pillar_mat='cream', accent_mat='blue_facade', closed_retractable=True,
    )
    # Blue-and-cream cultural mural wall along left street frontage (photo #00)
    prev = b.pose
    b.pose = (-27.0, 0.0, 25.0, GATE_YAW)
    b.box(0, 0.0, 0, 12.0, 0.55, 0.42, 'granite', tile=1.6, collide=True)
    b.box(0, 0.55, 0, 12.0, 1.75, 0.36, 'cream', tile=1.8, collide=True)
    for bx in (-4.0, 0.0, 4.0):
        b.box(bx, 0.85, 0.20, 3.1, 1.15, 0.06, 'blue_facade', tile=1.5)
    b.box(0, 2.30, 0, 12.2, 0.18, 0.48, 'gray_tile', tile=1.2)
    b.pose = prev

    # 2. Remaining perimeter fence along campus boundary
    b.perimeter_wall([
        (-5.5, 32.5), (10.5, 38.5), (34.5, -23.0), (-7.5, -41.0), (-36.5, 22.0),
    ], h=2.15, wall_mat='cream', base_mat='granite', cap_mat='blue_facade')

    # 3. Street-front 5-storey Pitched-Roof Main Building — 尚善楼 (photo #00 & #15)
    b.teaching_block(
        -12.5, 13.5, GATE_YAW, width=30.0, depth=12.5, floors=5, floor_h=3.35,
        wall='cream', accent='dark_stone', roof_kind='pitched', roof_tile='gray_tile',
        corridor=True, portico=True, sign_key='bld_shangshan',
    )
    # Rooftop school sign plaque visible from street (#15)
    prev = b.pose
    b.pose = (-12.5, 0.0, 13.5, GATE_YAW)
    b.sign_board(0, 5 * 3.35 + 1.55, 5.2, 7.6, 1.15, 'lijiang_gate', backing='white', depth=0.12)
    b.pose = prev

    # 4. North Teaching Block — 致远楼 (4 storeys, white + slate-blue accents)
    b.teaching_block(
        8.0, -23.5, GATE_YAW, width=32.0, depth=12.0, floors=4, floor_h=3.35,
        wall='white', accent='blue_facade', roof_kind='pitched', roof_tile='gray_tile',
        corridor=True, portico=False, sign_key='bld_zhiyuan',
    )

    # 5. Playground: Red EPDM perimeter apron + green/red acrylic court (#06) + Flagpole
    b.basketball_court(12.5, 4.0, GATE_YAW + math.pi / 2, surface='court_green', apron='track_red')
    prev = b.pose
    b.pose = (-9.0, 0.03, -6.5, GATE_YAW)
    b.box(0, 0.0, 0, 22.0, 0.04, 15.0, 'track_red', tile=3.0)
    b.box(0, 0.045, 0, 18.0, 0.02, 11.5, 'court_green', tile=3.0)
    b.pose = prev
    b.flagpole_plinth(2.0, 18.0, GATE_YAW, poles=1, height=10.8)
    b.motto_stone(-1.5, 22.5, GATE_YAW, 'lijiang_motto', w=3.8, h=1.55)

    # 6. Campus trees (#00/#06)
    for tx, tz in ((-28.0, 8.0), (-22.0, -16.0), (24.0, -8.0), (8.0, 28.0)):
        b.campus_tree(tx, tz, h=8.0, spread=3.5, seed=int(abs(tx * 5 + tz)), kind='camphor')


def main():
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    image = ensure_textures(folder)
    export_school(folder / 'lijiang_primary.glb', image, build)


if __name__ == '__main__':
    main()
