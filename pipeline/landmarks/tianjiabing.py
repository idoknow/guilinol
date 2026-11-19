"""桂林市田家炳中学 (原桂林市第四中学), OSM way/658142453 (屏风路 2 号).

游戏布局，非实地导览。临街外观与公开校庆航拍可见要素按实拍参考还原：
- 屏风路主校门（local (-38.0, 56.0), yaw=-0.495）：陶红砖柱与米白横梁牌坊门楼、左侧弧形红砖照壁、
  顶部“桂林市田家炳中学”校名与圆形校徽、关闭状态不锈钢伸缩门，无岗亭/门禁/监控/侧后门。
- 临街可见的田家炳图书综合楼（白墙配半圆弧形立面与绿色琉璃瓦顶，参考图 #00）、中部弧顶艺体馆（参考图 #03/#05）、
  东侧 4–5 层白墙陶红饰带教学楼群（博学楼、明德楼，参考图 #04/#09），采用校园内游戏化布局。
- 西侧设红色塑胶跑道足球场与绿红双色丙烯酸篮球场及升旗台（参考图 #03/#07/#14）。
"""
import math
import sys
from pathlib import Path

from g3_kit import Builder, ensure_textures, export_school

GATE_YAW = -0.495  # Faces SSW onto 屏风路


def _build_tjb_gate(b: Builder):
    """屏风路 2 号四柱门楼 + 左侧弧形红砖照壁 + 关闭伸缩门."""
    b.school_gate(
        -38.0, 56.0, GATE_YAW, 'tjb_gate',
        total_w=18.5, veh_span=6.8, ped_open_w=2.4,
        pillar_h=5.6, beam_h=1.25, style='classic',
        pillar_mat='terracotta', accent_mat='cream', roof_tile='gray_tile',
        closed_retractable=True,
    )
    # Left curved crimson-brick screen wall (#00 photo) & circular emblem medallion on beam
    prev = b.pose
    b.pose = (-38.0, 0.0, 56.0, GATE_YAW)
    b.cylinder_y(0.0, 6.2, 0.22, 0.82, 0.62, 'vermilion', sections=12)
    b.box(-10.8, 0.0, 0.3, 9.6, 2.8, 0.55, 'brick_red', tile=1.6, collide=True)
    b.box(-10.8, 2.8, 0.3, 9.9, 0.22, 0.72, 'cream', tile=1.4)
    b.pose = prev


def _build_rotunda_library(b: Builder):
    """田家炳楼（半圆弧立面 + 绿色琉璃檐顶，参考图 #00 门内左侧主楼）."""
    prev = b.pose
    b.pose = (-12.0, 0.0, 22.0, GATE_YAW)
    floors, fh = 5, 3.45
    th = floors * fh
    # Main rectangular wing + front semicircular drum
    b.box(0, 0.0, -3.5, 34.0, th, 13.0, 'white', tile=2.2, collide=True)
    b.cylinder_y(-6.0, 0.0, th + 0.6, 3.2, 8.8, 'white', sections=14, tile=2.0, collide=True)
    b.cylinder_y(-6.0, 0.0, 3.8, 3.4, 9.1, 'brick_red', sections=14, tile=1.8)
    for fl in range(1, floors):
        b.cylinder_y(-6.0, fl * fh + 1.0, 1.55, 3.25, 8.9, 'glass', sections=12, tile=2.0)
    # Green glazed traditional eave cap over drum & wing (#00)
    b.cylinder_y(-6.0, th + 0.6, 1.65, 3.2, 9.6, 'green_glaze', sections=14, tile=1.4)
    b.pitched_roof(4.0, th, -3.5, 26.0, 13.4, 2.1, 0.6, 'green_glaze', 'white')
    b.sign_board(5.5, th - 1.2, 3.15, 5.2, 1.15, 'bld_tjb_hall', backing=None, depth=0)
    b.pose = prev


def _build_sports_hall(b: Builder):
    """中部圆拱银灰金属屋面艺体馆（参考航拍图 #03 与球场实拍 #05）."""
    prev = b.pose
    b.pose = (-6.0, 0.0, -48.0, 0.0)
    w, d, h = 36.0, 24.0, 10.6
    b.box(0, 0.0, 0, w, h, d, 'white', tile=2.4, collide=True)
    for sx in (-1, 1):
        for sz in (-1, 1):
            b.box(sx * (w / 2 - 2.2), 0.0, sz * (d / 2 - 2.0), 4.8, h + 0.8, 4.4, 'terracotta', tile=1.8)
    # Curved barrel-vault silver roof approximated with 5 stepped/angled bands
    segs = 8 if b.detail else 4
    for i in range(segs):
        a0 = math.pi * i / segs
        a1 = math.pi * (i + 1) / segs
        z0, y0 = -d / 2 * math.cos(a0), h + 2.8 * math.sin(a0)
        z1, y1 = -d / 2 * math.cos(a1), h + 2.8 * math.sin(a1)
        b.face([(-w / 2 - 0.5, y0, z0), (w / 2 + 0.5, y0, z0),
                (w / 2 + 0.5, y1, z1), (-w / 2 - 0.5, y1, z1)],
               (0, 1, 0), 'steel', tile=2.5)
    for fl_z in (-1, 1):
        b.box(0, 4.5, fl_z * (d / 2 + 0.08), w - 10.0, 3.8, 0.10, 'glass', tile=2.2, lit=True)
    b.pose = prev


def build(b: Builder):
    # 1. Street-facing Gate on 屏风路 2 号
    _build_tjb_gate(b)
    b.motto_stone(-22.0, 42.0, GATE_YAW, 'tjb_motto', w=4.4, h=1.8)

    # 2. Perimeter fence safely inside campus boundary (clear of 屏风路 & 建干路)
    b.perimeter_wall([
        (-122.0, -68.0), (-124.0, 10.0), (-52.0, 49.0),
    ], h=2.2, wall_mat='cream', base_mat='terracotta', cap_mat='gray_tile')
    b.perimeter_wall([
        (-24.0, 63.5), (42.0, 96.0), (124.0, -34.0), (54.0, -64.0), (-122.0, -68.0),
    ], h=2.2, wall_mat='cream', base_mat='terracotta', cap_mat='gray_tile')

    # 3. 田家炳楼 (rotunda + green glaze roof) & Central Barrel-Vault Sports Hall
    _build_rotunda_library(b)
    _build_sports_hall(b)

    # 4. East Teaching Blocks — 博学楼 (5F) & 明德楼 (4F) (white + terracotta accents, #03/#04/#09)
    b.teaching_block(
        52.0, -24.0, -0.45, width=54.0, depth=14.5, floors=5, floor_h=3.45,
        wall='white', accent='terracotta', roof_kind='flat', corridor=True, portico=True, sign_key='bld_boxue',
    )
    b.teaching_block(
        58.0, 20.0, -0.45 + math.pi, width=46.0, depth=14.0, floors=4, floor_h=3.45,
        wall='white', accent='terracotta', roof_kind='flat', corridor=True, portico=True, sign_key='bld_mingde',
    )

    # 5. West Track Field & Basketball Courts (#03/#05/#07/#14) + Flagpole
    b.track_field(-84.0, -16.0, 0.04, straight_len=46.0, inner_r=18.5, track_w=4.8, stand_side=0)
    b.basketball_court(-40.0, -24.0, 0.04, surface='court_green', apron='track_red')
    b.basketball_court(-40.0, 8.0, 0.04, surface='court_green', apron='track_red')
    b.flagpole_plinth(-54.0, -12.0, math.pi / 2, poles=3, height=12.5)

    # 6. Main walkway & lush campus camphor/banyan trees (#04/#12)
    prev = b.pose
    b.pose = (-22.0, 0.0, 36.0, GATE_YAW)
    b.box(0, 0.0, -14.0, 9.0, 0.04, 42.0, 'pave', tile=2.4)
    b.pose = prev
    for tx, tz in ((-55.0, 36.0), (-8.0, 52.0), (18.0, 44.0), (22.0, -2.0), (88.0, -6.0), (-44.0, -52.0)):
        b.campus_tree(tx, tz, h=9.0, spread=4.0, seed=int(abs(tx * 3 + tz)), kind='banyan' if tx < 0 else 'camphor')


def main():
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    image = ensure_textures(folder)
    export_school(folder / 'tianjiabing.glb', image, build)


if __name__ == '__main__':
    main()
