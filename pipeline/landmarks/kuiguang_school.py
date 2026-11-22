"""Generalized OSM/Overture model for kuiguang_school."""
import sys
from pathlib import Path

import math

import numpy as np
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from school_exteriors import append_exterior, prism
from legacy_gate_parts import camphor_tree, closed_grille, text_mesh
from mapped_school import build, courtyard, layout, markings, paint
from school_kit import export_school_glb, mrr_stats, make_hoop_template
from features import polygons
from shapely.geometry import Point, LineString, Polygon, box
from shapely import union_all

PALETTE = {
    'wall_main':   '#f4f3ef',
    'wall_sub':    '#4c6a58',
    'wall_accent': '#1e4d8c',
    'wall_base':   '#8b8f92',
    'win_frame':   '#36454f',
    'win_trim':    '#f4f3ef',
    'base_frame':  '#8b8f92',
    'base_trim':   '#5b3e31',
    'pave_grey':   '#c9c4ba',
    'pave_road':   '#9e9a92',
    'pave_dark':   '#594d47',
    'granite':     '#b2afa6',
    'roof_tile':   '#6e747d',
    'roof_blue':   '#1e4d8c',
    'roof_red':    '#9e483c',
    'track_red':   '#a9473a',
    'turf_a':      '#498845',
    'turf_b':      '#3d7438',
    'court_a':     '#2e7a55',
    'court_b':     '#3b6da4',
    'cinnabar':    '#a9473a',
    'yellow':      '#dfb648',
    'cream':       '#f0eee9',
    'white':       '#f4f3ef',
    'has_ac':      True,
}

SIGNS = {
    'school_name': '桂林市奎光学校',
    'motto':       '博学明志 笃行致远',
    'led_title':   '桂林市奎光学校',
    'gate_bg':     '#1e4d8c',
    'gate_fg':     '#f8f9fa',
    'gate_sub_fg': '#d0d8e8',
    'vert_bg':     '#2b3a4a',
    'vert_fg':     '#f0d890',
    'vert_text':   '奎光学校',
    'emblem':      '奎光',
}

SCHOOL = 'kuiguang_school'
BOUNDARY = 'way/253811717'
FRONTAGE = (-13, 25, -65)
SKIP_EDGES = {0, 13, 14}
# The detailed Rongyin Road gate block (live before IDOK-84) replaces the generic gate.
LEGACY_GATE = True
# Boundary trimmed to keep the model off the public street.
STREET_SETBACK = [
    (-115.0, -79.76), (-123.96, -57.52), (-153.23, -69.17), (-174.46, -16.5),
    (-123.86, 3.61), (-128.64, 15.48), (-43.39, 49.36), (-37.61, 35.0),
    (-16.0, 42.5), (-12.1, 31.5), (-8.2, 21.0), (-24.75, 13.92),
    (-10.01, -22.7), (-30.88, -30.99), (-25.54, -44.22), (-115.0, -79.76)
]
CUSTOM_BUILDINGS = {'way/701820464', 'way/683033673'}
BUILDINGS = [
    dict(bid='B1', source_id='way/683033673', floors=5, floor_h=3.55, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B2', source_id='way/683033672', floors=4, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B3', source_id='way/683033678', floors=4, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B4', source_id='way/692355780', floors=4, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B5', source_id='way/683033675', floors=3, floor_h=3.35, roof='flat_rail', wall_reg='white', base_reg='wall_base'),
    dict(bid='B6', source_id='way/701820464', floors=5, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B7', source_id='way/683033677', floors=2, floor_h=3.35, roof='flat_rail', wall_reg='white', base_reg='wall_base')
]


def rongyin_gate(model):
    """Through-building gate on Rongyin Road, kept as it was live before IDOK-84 (IMG_1295/1296).

    Only change: the passage now ends in a closed iron gate, and the road markings that used to be
    painted on the public street are left to the city road surface.
    """
    gate_yaw = math.atan2(-0.917, 0.399)
    gcx, gcz = -9.6, 31.2
    setback = 7.0  # front face kept behind the Rongyin Road sidewalk (IDOK-84 street clearance)
    model.pose = (gcx + setback * math.sin(gate_yaw), 0.0, gcz - setback * math.cos(gate_yaw), gate_yaw)

    model.box(1.75, 5.25, 0.0, 23.5, 11.35, 11.6, 'earth', True)
    model.box(-6.85, -0.8, 0.0, 6.3, 6.05, 11.6, 'stone', True)
    model.box(-6.85, 3.15, 5.92, 6.3, 1.55, 0.24, 'green')
    model.box(-6.85, 0.35, 5.84, 5.4, 2.65, 0.14, 'glass')
    model.box(8.60, -0.8, 3.6, 9.8, 6.05, 4.5, 'white', True)
    for rx in (6.1, 10.9):
        model.box(rx, 0.15, 5.88, 3.9, 3.35, 0.14, 'clock')

    for px in (-4.1, 4.1):
        model.box(px, -0.4, 5.85, 0.85, 5.85, 0.75, 'white', True)
        model.box(px, 0.95, 6.26, 0.44, 2.85, 0.06, 'sign')
    model.box(0.0, 4.15, 5.88, 9.05, 1.35, 0.78, 'white', True)
    model.box(0.0, 5.42, 5.95, 9.25, 0.16, 0.92, 'granite')
    text_mesh(model, '桂林市奎光学校', 6.9, 0.85, 'red', 4.82, 6.32, 30)

    model.box(0.0, 4.02, 0.0, 7.6, 0.22, 11.8, 'white')
    for beam_z in (-4.2, -1.4, 1.4, 4.2):
        model.box(0.0, 3.88, beam_z, 7.6, 0.16, 0.26, 'stone')
    # Passage floor stays inside the building line.
    model.box(0.0, -0.42, 0.0, 7.4, 0.46, 11.6, 'pave', True)
    for sx in (-3.68, 3.68):
        model.box(sx, 0.25, -0.5, 0.14, 3.35, 9.2, 'glass', True)
        if model.detail:
            for gz in np.linspace(-4.6, 3.6, 6):
                model.box(sx, 0.0, gz, 0.18, 3.65, 0.10, 'tile')
    # Closed iron gate recessed just inside the portal (as in IMG_1295).
    closed_grille(model, 0.0, 0.0, 3.9, 7.3, 3.7)
    for lx in (-2.05, 2.05):
        model.beam([lx, 3.62, 4.85], [lx, 4.12, 4.85], .035, 'wood')
        sph = trimesh.creation.icosphere(subdivisions=1 if model.detail else 0)
        model.mesh(sph.vertices * [0.42, 0.30, 0.42] + [lx, 3.62, 4.85], sph.faces, 'red')
        model.box(lx * 1.62, 0.0, 5.45, 0.45, 1.15, 0.55, 'gold')

    for fl in range(3):
        fy = 6.05 + fl * 3.35
        for wx in (-7.2, -2.6, 2.2, 7.2, 11.2):
            model.box(wx, fy, 5.84, 2.85, 1.85, 0.16, 'white')
            model.box(wx, fy + 0.15, 5.92, 2.35, 1.45, 0.08, 'glass')
            if model.detail and wx in (-2.6, 2.2):
                model.box(wx + 1.85, fy + 0.2, 5.97, 0.72, 0.52, 0.54, 'white')
    model.pose = (0, 0, 0, 0)

    for tx, tz, th, tsp in ((-8.0, 35.4, 9.5, 4.2), (-13.5, 22.0, 9.2, 3.8)):
        camphor_tree(model, tx, 0.0, tz, h=th, spread=tsp)


def street_buildings(model):
    model.fit_to_grade(SCHOOL)
    w7018_ring = [(-1.20, -17.21), (-14.60, 13.82), (-0.46, 19.86), (14.84, -15.57), (6.17, -19.27), (4.27, -14.88)]
    prism(model, w7018_ring, -1.2, 17.4, 'earth', 'granite', True)
    rongyin_gate(model)

    cy = 0.30
    model.site_datum = cy
    model.pose = (-28.7, cy, 6.73, -1.147)
    model.box(5.85, -0.3, -0.2, 2.2, 2.85, 5.2, 'brick', True)
    model.box(5.45, 2.55, -0.2, 3.1, 0.22, 5.8, 'earth')
    model.box(-6.35, -0.3, 1.8, 2.3, 2.75, 6.8, 'brick', True)
    model.box(-5.15, 0.85, 1.8, 0.10, 1.25, 5.2, 'red')

    model.pose = (0, 0, 0, 0)
    ring = [(-168.34, -28.89), (-157.16, -53.72), (-146.29, -48.89), (-157.48, -24.06)]
    prism(model, ring, cy - 1.2, 18.4, 'white', 'white', True)
    bx_cx, bx_cz = -157.32, -38.89
    model.pose = (bx_cx, cy, bx_cz, -1.147)

    # 5 stories with open-air corridors, white square columns, safety rails
    for fl in range(5):
        fy = 0.2 + fl * 3.35
        # Setback back wall and classroom windows
        model.box(0, fy + 1.675, 4.9, 26.8, 3.35, 2.2, 'white')
        for wx in np.linspace(-9.58, 9.58, 6):
            model.box(wx, fy + 1.0, 4.92, 2.8, 1.6, 0.1, 'glass')

        # Outdoor corridor balcony on upper floors
        if fl > 0:
            model.box(0, fy, 5.4, 26.8, 0.25, 1.2, 'white')
            model.box(0, fy + 0.25, 6.02, 26.8, 0.82, 0.18, 'white')
            model.box(0, fy + 1.07, 6.02, 26.8, 0.08, 0.22, 'granite')

        # White square columns along the corridor front
        for col_x in np.linspace(-11.5, 11.5, 7):
            model.box(col_x, fy, 5.95, 0.48, 3.35, 0.48, 'white')

    # Roof parapet (fy = 16.95)
    model.box(0, 16.95, 6.02, 27.2, 0.85, 0.24, 'white')
    model.box(0, 17.8, 6.02, 27.2, 0.12, 0.28, 'clock')

    # Central wave pediment arch on top center (photo-5)
    gp = [(-5.2, 17.8, 6.08), (5.2, 17.8, 6.08), (0.0, 19.3, 6.08)]
    model.mesh(gp, [[0, 1, 2], [0, 2, 1]], 'white')
    model.beam([-5.2, 17.8, 6.12], [0.0, 19.3, 6.12], 0.14, 'clock', 5)
    model.beam([0.0, 19.3, 6.12], [5.2, 17.8, 6.12], 0.14, 'clock', 5)
    # Center flagpole
    model.beam([0.0, 19.3, 6.12], [0.0, 22.5, 6.12], 0.04, 'granite', 5)
    model.box(0.5, 21.6, 6.12, 0.9, 0.55, 0.02, 'red')

    # Decorative gold trim bar on 5th floor (no unverified motto text)
    model.box(0, 15.3, 6.02, 14.0, 0.45, 0.08, 'gold')

    # Central large outdoor LED display screen on 3rd & 4th floors (center bay x = -3.8..3.8)
    model.box(0.0, 9.8, 6.10, 7.6, 5.0, 0.12, 'white')
    model.box(0.0, 9.8, 6.16, 7.2, 4.6, 0.18, 'sign')
    model.box(0.0, 9.8, 6.25, 6.8, 4.2, 0.05, 'sign')

    # Gold building plaque "培 华 楼" centered on 2nd floor under the LED screen
    text_mesh(model, '培 华 楼', 4.8, 1.1, 'gold', 5.2, 6.16, font_px=42)

    # Ground floor entrance: red celebratory backdrop banner (no unverified banner text)
    model.box(0.0, 1.8, 6.14, 7.2, 3.2, 0.12, 'red')
    model.box(0.0, 0.1, 6.3, 7.6, 0.25, 0.8, 'granite')

    model.pose = (0, 0, 0, 0)


def build_kuiguang(builder):
    boundary, buildings, sports = layout(sys.modules[__name__])
    ring = list(boundary.exterior.coords)

    # 1. Compute geometry for basketball courts envelope & running track along 德艺楼 Edge 3
    b_courts = [shape for key, sport, shape in sports if sport == 'basketball']
    courts_envelope = union_all(b_courts).minimum_rotated_rectangle if b_courts else None

    # B2 Edge 3: (-122.9606, 4.8722) -> (-89.8941, 17.0022), len = 35.22m, normal towards court = (0.3444, -0.9388)
    p1 = np.array([-122.9606, 4.8722])
    p2 = np.array([-89.8941, 17.0022])
    dp = p2 - p1
    normal = np.array([0.3444, -0.9388])

    # 3-lane red surface: 3.6m width, 0.2m setback from facade
    c1 = p1 + 0.2 * normal
    c2 = p2 + 0.2 * normal
    c3 = p2 + 3.8 * normal
    c4 = p1 + 3.8 * normal
    track_poly = Polygon([c1, c2, c3, c4])

    # 2. Subtract all sports surfaces from campus courtyard paving to eliminate occlusion / Z-fighting
    sports_areas = [shape for _, _, shape in sports] + [track_poly]
    if courts_envelope is not None:
        sports_areas.append(courts_envelope)
    sports_envelope = union_all(sports_areas).buffer(0.3)
    courtyard_geom = courtyard(boundary, builder.surface).difference(sports_envelope)
    paint(builder, courtyard_geom, "pave_grey", 0.009, builder.paving)

    for shape, style in buildings:
        if style['source_id'] not in CUSTOM_BUILDINGS:
            builder.footprint_building(list(shape.exterior.coords), **style)

    # 3. Basketball courts: paint continuous red envelope/isolation bands, green courts, red keys/center circle, white lines, 3D hoops
    if courts_envelope is not None:
        paint(builder, courts_envelope, 'track_red', 0.070)

    for key, sport, shape in sports:
        if sport == 'basketball':
            cx, cz, pl, pw, ang = mrr_stats(list(shape.exterior.coords)[:-1])
            rad = math.radians(ang)
            cos_a, sin_a = math.cos(rad), math.sin(rad)

            # Green playing court surface
            paint(builder, shape, 'court_a', 0.085)

            # Red center circle
            center = Point(cx, cz)
            paint(builder, center.buffer(1.8).intersection(shape), 'track_red', 0.095)

            # Red keys (restricted area) & key border lines at both ends
            for sgn in (-1.0, 1.0):
                u_base = sgn * pl * 0.5
                u_ft = sgn * (pl * 0.5 - 5.8)
                kw = 4.9 / 2.0
                pts = [(u_base, -kw), (u_base, kw), (u_ft, kw)]
                for deg in range(0, 181, 15):
                    th = math.radians(deg)
                    u_c = u_ft - sgn * 1.8 * math.sin(th)
                    v_c = 1.8 * math.cos(th)
                    pts.append((u_c, v_c))
                pts.append((u_ft, -kw))
                w_pts = [(cx + u * cos_a + v * sin_a, cz - u * sin_a + v * cos_a) for u, v in pts]
                key_poly = Polygon(w_pts).intersection(shape)
                paint(builder, key_poly, 'track_red', 0.095)
                if builder.lod < 2:
                    paint(builder, key_poly.boundary.buffer(0.08).intersection(shape), 'white', 0.115)

            # Court markings (boundary line, mid line, center circle line)
            if builder.lod < 2:
                for stripe in markings(shape, sport):
                    paint(builder, stripe, 'white', 0.115)

            # 3D Hoops strictly inside court polygon (px_h = sgn * (pl*0.5 - 0.55))
            if builder.lod < 2:
                for sgn in (-1.0, 1.0):
                    px_h = sgn * (pl * 0.5 - 0.55)
                    hyaw = math.pi if sgn > 0 else 0.0
                    old_p = builder.pose
                    builder.pose = (cx, 0.0, cz, math.radians(ang))
                    y0 = builder.ground(cx, cz)
                    builder.add_instance(
                        f'hoop_{builder.lod}',
                        lambda l=builder.lod: make_hoop_template(lod=l),
                        px_h, y0 + 0.08, 0.0, yaw=hyaw,
                    )
                    if builder.collide:
                        builder.add_hit_box(px_h, y0 + 0.08, 0.0, 0.6, 3.2, 0.9)
                    builder.pose = old_p

            # Court 0 (way/683033679): add net on north/left side (seen in photo-1/5)
            if key == 'way/683033679' and builder.lod < 2:
                old_p = builder.pose
                builder.pose = (cx, 0.0, cz, math.radians(ang))
                y0 = builder.ground(cx, cz)
                for vz in (-5.8, -0.8):
                    builder.cylinder_y(0.0, y0 + 0.08, 2.2, vz, 0.05, 'yellow', collide=True)
                builder.box(0.0, y0 + 1.8, -3.3, 0.04, 0.75, 5.0, 'white')
                builder.pose = old_p

        elif sport == 'volleyball':
            paint(builder, shape, 'court_a', 0.085)
            if builder.lod < 2:
                for stripe in markings(shape, sport):
                    paint(builder, stripe, 'white', 0.115)
        elif sport in ('running', 'athletics'):
            paint(builder, shape, 'track_red', 0.070)
            if builder.lod < 2:
                for stripe in markings(shape, sport):
                    paint(builder, stripe, 'white', 0.115)

    # 4. Running track along 德艺楼 (B2: way/683033672) Edge 3, strictly aligned to OSM building footprint
    paint(builder, track_poly, 'track_red', 0.085)

    # Lane dividing lines (4 lines for 3 lanes)
    if builder.lod < 2:
        for k in range(4):
            d = 0.2 + k * 1.2
            l_start = p1 + d * normal
            l_end = p2 + d * normal
            paint(builder, LineString([l_start, l_end]).buffer(0.04), 'white', 0.115)

    # 3. Trees in white raised tree pits along the strip between track and courts (photo-6, offset 4.7m from B2)
    for t_frac in (0.12, 0.38, 0.64, 0.90):
        pt = p1 + t_frac * dp + 4.7 * normal
        gy = builder.ground(pt[0], pt[1])
        builder.box(pt[0], gy + 0.12, pt[1], 1.8, 0.24, 1.8, 'white', cap_region='turf_a')
        builder.tree(pt[0], pt[1], species='camphor', scale=0.92)

    # 4. North camphor tree row along the courts (photo-3, photo-7)
    for tx, tz in ((-139.0, -32.6), (-124.0, -26.6), (-109.0, -20.9), (-94.0, -15.3), (-79.0, -9.8), (-64.0, -4.3)):
        builder.tree(tx, tz, species='camphor', scale=1.0)

    # 5. Restore perimeter camphor trees along campus boundary
    occupied = union_all([shape for shape, _ in buildings] + [shape for _, _, shape in sports] + [track_poly])
    for edge in polygons(boundary.buffer(-5)):
        path = edge.exterior
        for distance in range(0, int(path.length), 16):
            point = path.interpolate(distance)
            if occupied.distance(point) > 4:
                builder.tree(point.x, point.y, species='camphor', scale=0.85)

    # 6. Campus perimeter fence (SKIP_EDGES = {0, 13, 14} preserves all edges 1..12 along streets and adjacent parcels)
    builder.perimeter_fence(ring, gate_edge=-1, skip_edges=SKIP_EDGES)


if __name__ == '__main__':
    from xiaoyao_tower import generate
    export_school_glb(SCHOOL, PALETTE, SIGNS, build_kuiguang)
    generate(
        'exterior', street_buildings,
        lettering=dict(text=' ', foreground='#1e4d8c', background='#1e4d8c'),
        smooth=('red', 'clock', 'green', 'yellow'),
        colors=dict(
            earth='#d4998f',
            white='#eeede7',
            stone='#cfd1cd',
            granite='#8b8f92',
            pave='#6e7378',
            brick='#9e4d3c',
            red='#c63d32',
            clock='#1e4d8c',
            green='#4c6a58',
            yellow='#dfb648',
            gold='#c99e67',
            glass='#36454f',
            sign='#232021',
            tile='#30353a',
            wood='#5b3e31',
            leaf='#375931',
        ),
    )
    append_exterior(Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.'), SCHOOL)
