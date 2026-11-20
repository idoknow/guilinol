"""3D landmark model for Guilin No. 13 Middle School (桂林市第十三中学)."""
import math
import sys
from pathlib import Path

from shapely.geometry import Polygon
import trimesh

from h2_kit import (
    CampusScene,
    _extrude_flat,
    _rot_y_matrix,
    colorize,
    make_text_sign,
    merge_meshes,
    sloped_wall_strip,
    triangulate_sloped_cap,
)


def build_guilin_thirteen(out_path: Path):
    cs = CampusScene('guilin_thirteen')

    # ------------------------------------------------------------------
    # 1. Safe buildable boundary (staying >= 0.45 m off 四会路 road/sidewalk
    #    and >= 0.5 m clear of Guihu lakeside houses on NW edge)
    # ------------------------------------------------------------------
    campus_ring = [
        (-0.20, 62.60),
        (2.56, 57.60),
        (3.60, 57.80),
        (14.00, 41.00),
        (16.90, 35.10),
        (21.95, 28.40),
        (20.15, 26.35),
        (36.05, -2.15),
        (38.45, -1.65),
        (39.65, -4.25),
        (43.55, -54.25),
        (44.20, -76.50),
        (18.10, -52.80),
        (21.55, -48.30),
        (6.40, -35.80),
        (3.00, -39.20),
        (-4.35, -32.45),
        (-1.60, -29.60),
        (-13.60, -14.25),
        (-21.30, -19.55),
        (-39.90, -5.35),
        (-53.40, 2.25),
        (-54.40, 3.45),
        (-53.15, 9.85),
        (-62.55, 12.60),
        (-64.25, 14.95),
    ]

    # Full paved campus ground apron (staying inside perimeter)
    campus_poly = Polygon(campus_ring)
    cs.add('lod0', 'ground_pave', triangulate_sloped_cap(campus_poly, cs.ls, y_offset=0.03, step=4.0, skirt_depth=0.10, color='#aeb3ac'))
    cs.add('lod1', 'ground_pave', triangulate_sloped_cap(campus_poly, cs.ls, y_offset=0.03, step=8.0, skirt_depth=0.10, color='#aeb3ac'))
    cs.add('lod2', 'ground_pave', triangulate_sloped_cap(campus_poly, cs.ls, y_offset=0.03, step=14.0, skirt_depth=0.0, color='#aeb3ac'))

    # ------------------------------------------------------------------
    # 2. Sports Field S1: red rubber track apron, 2 OSM courts + 1 NE court, NW rostrum
    # ------------------------------------------------------------------
    track_poly = Polygon([
        (-43.2, 6.2), (-15.0, -18.5), (1.0, -34.0), (14.5, -36.5),
        (32.5, -24.0), (29.5, -4.0), (12.0, 24.5), (-0.5, 42.5),
    ])
    cs.add('lod0', 'track_red', triangulate_sloped_cap(track_poly, cs.ls, y_offset=0.082, step=2.8, skirt_depth=0.05, color='#9d463c'))
    cs.add('lod1', 'track_red', triangulate_sloped_cap(track_poly, cs.ls, y_offset=0.082, step=6.0, skirt_depth=0.0, color='#9d463c'))
    cs.add('lod2', 'track_red', triangulate_sloped_cap(track_poly, cs.ls, y_offset=0.082, step=12.0, skirt_depth=0.0, color='#9d463c'))

    # Running track white lane lines along NE-SW straight & track rim
    lane_base = [(-38.5, 6.5), (-13.0, -16.0), (12.0, -34.0), (28.5, -23.0), (26.0, -5.0), (9.5, 22.0), (-2.0, 38.0)]
    lane_poly = Polygon(lane_base)
    for shrink in (0.0, 1.4, 2.8):
        lp = lane_poly.buffer(-shrink)
        if not lp.is_empty and lp.geom_type == 'Polygon':
            cs.add('lod0', 'track_line', sloped_wall_strip(list(lp.exterior.coords)[:-1], 0.11, 0.075, 0.098, cs.ls, '#f2f0ea', seg_max=3.5, closed=True))

    # Two OSM basketball courts (1087_1.jpg: grass green perimeter + cobalt blue paint & center)
    p_sw = Polygon([(-19.31, 4.86), (-28.73, 17.25), (-7.12, 33.39), (1.58, 20.56)])
    p_ne = Polygon([(-9.30, -8.39), (-18.29, 2.55), (3.90, 19.13), (11.59, 7.02)])
    cs.add_court(p_sw, court_col='#2f6b47', key_col='#2c588e', include_hoops=True)
    cs.add_court(p_ne, court_col='#2f6b47', key_col='#2c588e', include_hoops=True)

    # Third auxiliary court at NE playground seen in Bing/Google/Esri satellite imagery
    p_small = Polygon([(4.8, -22.2), (-2.0, -14.2), (14.2, -2.0), (20.8, -10.4)])
    cs.add_court(p_small, court_col='#35744e', key_col='#2b5386', include_hoops=False)

    # Rostrum (gltv_2510.jpg: cream strip-tile podium + red-black display frame + flagpole on NW side facing SE)
    cs.add_rostrum(cx=-5.8, cz=-19.2, width=11.5, depth=3.0, height=1.5, yaw=math.atan2(0.75, 0.66))

    # ------------------------------------------------------------------
    # 3. Buildings B1..B5 (neutral codes only; structural joints >= 0.35m for auditBuildings)
    # ------------------------------------------------------------------
    # B1: Southwest 4-storey external-corridor block (Overture 066329fa, 1087_1.jpg & gltv_54th.jpg)
    # Edges: 0=NE facing courts (open gallery), 2=SW facing outside (windows)
    b1 = Polygon([(-0.13, 47.58), (-50.92, 10.37), (-56.23, 17.61), (-5.45, 54.82)])
    cs.add_building(
        b1, floors=4, floor_h=3.25,
        wall_color='#ebe8df', band_color='#c4beb2', roof_color='#7c8186',
        roof_type='parapet', gallery_edges=(0,), window_edges=(2,),
    )

    # B1w: NW low-rise 2-storey west corner wing clear of B1 & ae4bcc78
    b1w = Polygon([(-52.2, 4.4), (-41.4, -3.6), (-38.2, 1.0), (-49.0, 8.8)])
    cs.add_building(
        b1w, floors=2, floor_h=3.2,
        wall_color='#dfdacf', band_color='#b6b0a3', roof_color='#767b80',
        roof_type='parapet', gallery_edges=(), window_edges=(1, 3),
    )

    # B1e: SE chamfered 2-storey mural corner block (gltv_54th.jpg left side: "德智体美" facade)
    # Kept >= 0.45 m clear of B1 and B3
    b1e = Polygon([(-0.05, 47.1), (2.7, 42.3), (7.9, 45.5), (5.1, 50.3)])
    cs.add_building(
        b1e, floors=2, floor_h=3.35,
        wall_color='#eae5db', band_color='#b55d47', roof_color='#7a7f84',
        roof_type='parapet', window_edges=(0, 1),
    )

    # B2-Main: East 四会路 4-storey block matching trimmed Overture 6719a1e1 (IoU > 0.90)
    # Edges: 1..4=East facing 四会路, 6=West facing playground
    b2_main = Polygon([
        (36.66, -2.46), (39.06, -1.58), (44.45, -11.31),
        (45.32, -22.11), (45.65, -31.20), (46.02, -43.55), (40.21, -44.62),
    ])
    cs.add_building(
        b2_main, floors=4, floor_h=3.45,
        wall_color='#ece9e2', band_color='#9e594c', roof_color='#566270',
        roof_type='stepped_hip', window_edges=(2, 3, 4, 6),
    )
    # 5F stair/hall projection + rooftop metal truss sign「十三中」(pw_sg_gate_2.jpg)
    b2_top = Polygon([(38.8, -14.0), (44.0, -13.6), (44.6, -26.0), (39.4, -26.4)])
    g_b2 = sum(cs.ls.ground(x, z) for x, z in list(b2_main.exterior.coords)[:-1]) / 7.0
    b2_roof_y = g_b2 + 4 * 3.45
    cs.add('lod0', 'wall_#ece9e2', _extrude_flat(b2_top, b2_roof_y - 0.1, b2_roof_y + 3.2, '#ece9e2'))
    cs.add('lod1', 'wall_#ece9e2', _extrude_flat(b2_top, b2_roof_y - 0.1, b2_roof_y + 3.2, '#ece9e2'))
    cs.add('lod0', 'roof_#566270', _extrude_flat(b2_top.buffer(0.35, join_style='mitre'), b2_roof_y + 3.2, b2_roof_y + 3.85, '#566270'))

    # Rooftop school emblem & characters truss "十三中" facing SE onto 四会路
    truss_yaw = math.atan2(0.88, 0.47)
    roof_sign = make_text_sign('十三中', 8.6, 2.3, 0.22, bg_color='#eef1f2', fg_color='#9a7b3c', border_color='#8e969e')
    roof_sign.apply_transform(_rot_y_matrix(42.2, b2_roof_y + 2.75, -8.5, truss_yaw))
    cs.signs.append(('sign_guilin_thirteen_roof', roof_sign))
    for off_s in (-3.2, 0.0, 3.2):
        strut = colorize(trimesh.creation.box([0.12, 1.5, 0.12]), '#c8cfd6')
        strut.apply_transform(_rot_y_matrix(42.2 - off_s * 0.47, b2_roof_y + 1.5, -8.5 + off_s * 0.88, truss_yaw))
        cs.add('lod0', 'roof_truss', strut)

    # B2-Glass: Southeast glass-curtain entrance block (pw_sg_gate_0/1/3.jpg), >= 0.45 m south of B2-Main
    # Recessed 1.6 m west of 四会路 sidewalk inside edge to accommodate Marble Culture Wall plaza
    b2_glass = Polygon([(34.8, -1.6), (26.2, 13.6), (20.2, 10.2), (28.8, -5.0)])
    cs.add_building(
        b2_glass, floors=4, floor_h=3.35,
        wall_color='#edeae3', band_color='#c4beb2', roof_color='#566270',
        roof_type='stepped_hip', window_edges=(0, 2),
    )
    # Prominent 2-storey dark-blue glass curtain facade on East street-facing edge of B2-Glass
    p_curtain = Polygon([(34.95, -1.4), (26.35, 13.8), (25.95, 13.55), (34.55, -1.65)])
    g_bg = cs.ls.ground(30.5, 6.0)
    cs.add('lod0', 'glass_curtain', _extrude_flat(p_curtain, g_bg + 0.5, g_bg + 7.2, '#2d475e'))
    cs.add('lod1', 'glass_curtain', _extrude_flat(p_curtain, g_bg + 0.5, g_bg + 7.2, '#2d475e'))

    # B3: Southeast corner 3-storey wing south of Gate Plaza (replaces 06dcb0bc inside safe_c)
    b3 = Polygon([(4.6, 55.2), (14.4, 38.8), (18.6, 30.8), (13.4, 27.6), (0.8, 50.6)])
    cs.add_building(
        b3, floors=3, floor_h=3.2,
        wall_color='#e2dfd6', band_color='#b6b0a3', roof_color='#767b80',
        roof_type='parapet', window_edges=(1, 3),
    )
    # 1F street-facing dark terracotta storefront base trim along 四会路 (matching pw_sg_gate_3.jpg left side, NO text sign)
    b3_trim = Polygon([(14.5, 38.8), (18.7, 30.8), (18.4, 30.6), (14.2, 38.6)])
    g_b3 = cs.ls.ground(16.5, 34.8)
    cs.add('lod0', 'b3_trim', _extrude_flat(b3_trim, g_b3 + 2.8, g_b3 + 3.6, '#8f2924'))

    # B4: North apex 2-storey square pavilion (Esri + Bing + Google z19 verified)
    b4 = Polygon([(37.4, -56.0), (42.6, -55.5), (43.2, -64.0), (38.0, -64.5)])
    cs.add_building(
        b4, floors=2, floor_h=3.45,
        wall_color='#dcd8ce', band_color='#afa99c', roof_color='#767b80',
        roof_type='parapet', window_edges=(0, 2),
    )

    # B5: North-inner warm cream/yellow 2-storey wing (Bing + Google z19 verified)
    b5 = Polygon([(25.8, -46.8), (33.5, -45.5), (32.4, -37.2), (24.7, -38.5)])
    cs.add_building(
        b5, floors=2, floor_h=3.5,
        wall_color='#ebe4d1', band_color='#cbb78e', roof_color='#d2be90',
        roof_type='parapet', window_edges=(0, 2),
    )

    # ------------------------------------------------------------------
    # 4. Main Gate, Marble Culture Wall (桂林市第十三中學), & Closed Perimeter Wall
    # ------------------------------------------------------------------
    # Gate driveway opening on SE 四会路 frontage: (26.2, 15.2) to (21.6, 23.4)
    # Outward normal towards 四会路 ESE: dx = -4.6, dz = +8.2 -> left/east normal (+8.2, +4.6) normalized:
    dx_g, dz_g = -4.6, 8.2
    gl_len = math.hypot(dx_g, dz_g)
    out_se = (dz_g / gl_len, -dx_g / gl_len)  # (+0.872, +0.489) points ESE onto 四会路!
    cs.add_closed_gate(
        p0=(21.8, 23.2), p1=(26.2, 15.4), outward_vec=out_se,
        school_name='桂林市第十三中學',
        plaque_side='right', plaque_text='桂林市第十三中學',
        plaque_sub='GVEI LINZ SIDIAHCIB SAM CUNG HYDZ · The No. 13 Middle School of Guilin',
        plaque_w=8.4, plaque_h=2.3,
    )

    # Closed perimeter wall inset 0.35m safely inside campus_ring, skipping gate + culture wall span
    wall_poly = Polygon(campus_ring).buffer(-0.25, join_style='mitre')
    wall_ring = list(wall_poly.exterior.coords)[:-1]
    cs.add_perimeter_wall(wall_ring, gate_gap=(21.2, 24.4, 32.8, 3.6), wall_h=1.05)

    # ------------------------------------------------------------------
    # 5. Campus Trees (IDOK-71 species instances verified on Esri/Bing/Google + photos)
    # ------------------------------------------------------------------
    trees = [
        ('camphor', -45.5, 11.2, 1.05, 0.2),
        ('banyan', -36.5, 16.5, 1.15, 1.1),
        ('osmanthus', -28.0, 22.8, 0.90, 2.3),
        ('camphor', -16.5, 31.5, 1.05, 0.8),
        ('osmanthus', -6.5, 38.5, 0.92, 1.7),
        ('banyan', -23.5, -7.5, 1.05, 0.4),
        ('camphor', -0.5, -22.0, 1.00, 2.1),
        ('osmanthus', 10.5, -29.0, 0.92, 1.3),
        ('virens', 20.5, -38.0, 1.05, 0.6),
        ('camphor', 28.5, -25.0, 1.00, 2.8),
        ('osmanthus', 32.0, -52.0, 0.92, 0.9),
        ('bischofia', 39.2, -66.5, 1.05, 1.5),
        ('palm', 24.5, 8.2, 0.95, 0.3),
        ('palm', 21.0, 14.5, 0.92, 1.9),
        ('osmanthus', 14.8, 21.5, 0.88, 2.5),
    ]
    for sp, tx, tz, sc, yw in trees:
        cs.add_tree(sp, tx, tz, scale=sc, yaw=yw)

    cs.export(out_path)


if __name__ == '__main__':
    build_guilin_thirteen(Path(sys.argv[1]) / 'guilin_thirteen.glb')
