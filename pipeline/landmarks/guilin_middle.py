"""Generalized OSM/Overture model for guilin_middle."""
import math
import sys
from pathlib import Path

import numpy as np
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from school_exteriors import append_exterior, prism
from legacy_gate_parts import closed_grille, seated_lion, text_mesh
from mapped_school import build
from school_kit import export_school_glb

PALETTE = {
    'wall_main':   '#eeede7',
    'wall_sub':    '#4c6a58',
    'wall_accent': '#1e4d8c',
    'wall_base':   '#9e4d3c',
    'pave_grey':   '#c9c4ba',
    'pave_road':   '#9e9a92',
    'pave_dark':   '#6e747d',
    'granite':     '#83878c',
    'roof_tile':   '#353b40',
    'roof_blue':   '#2a527a',
    'roof_red':    '#a8322c',
    'white':       '#f3eee4',
    'steel':       '#c8ccd0',
    'glass':       '#384752',
    'track_red':   '#b55042',
    'turf_a':      '#498845',
    'turf_b':      '#3d7438',
    'court_a':     '#3e7856',
    'court_b':     '#3b6da4',
    'cinnabar':    '#a8322c',
    'yellow':      '#dfb648',
    'has_ac':      True,
}

SIGNS = {
    'school_name': '桂林中学',
    'gate_bg':     '#efeae0',
    'gate_fg':     '#a8322c',
    'gate_sub_fg': '#36454f',
    'vert_bg':     '#55595e',
    'vert_fg':     '#f0d890',
    'vert_text':   '桂林中学',
    'motto':       '专心致志 严谨治学',
    'led_title':   '桂林中学解西校区',
    'emblem':      '桂中',
}

SCHOOL = 'guilin_middle'
BOUNDARY = 'way/253811718'
FRONTAGE = (15, 25, 0)
SKIP_EDGES = set()
# The pillared Jiefang West Road gate (live before IDOK-84) replaces the generic gate.
LEGACY_GATE = True
GATE_HALF_SPAN = 9.8
CUSTOM_BUILDINGS = {'way/690980799', 'f97d45ef-6943-4e73-8c4b-672340a7b8a7'}
BUILDINGS = [
    dict(bid='B1', source_id='way/690980799', floors=2, floor_h=3.6, roof='hip_gable', wall_reg='pave_dark', base_reg='pave_dark', parapet_reg='cinnabar'),
    dict(bid='B2', source_id='f97d45ef-6943-4e73-8c4b-672340a7b8a7', floors=6, floor_h=3.5, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B3', source_id='way/682942537', floors=4, floor_h=3.6, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B4', source_id='way/682942536', floors=5, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B5', source_id='way/683033683', floors=5, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B6', source_id='way/682942535', floors=5, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B7', source_id='way/682942534', floors=5, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B8', source_id='2c0786a8-316f-4b14-a011-0bcfe23ec27e', floors=3, floor_h=3.35, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base'),
    dict(bid='B9', source_id='72d24742-818c-4954-8a15-ceff8e95e9c8', floors=4, floor_h=3.35, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base'),
    dict(bid='B10', source_id='a1feace1-6a08-44d0-ba70-99390d1b14a4', floors=2, floor_h=3.3, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base'),
    dict(bid='B11', source_id='ba39af2f-b7b6-4a01-a907-790fc605a125', floors=1, floor_h=3.3, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base')
]


HALL_AXIS = math.atan2(5.50, 11.46)


def build_stele_court(model):
    """Hall-local bay: teaching block ends at -22 m, historic gable at -6.4 m."""
    model.pose = (0, 0, 0, HALL_AXIS)
    model.box(-14.2, -0.12, 1.5, 15.1, 0.30, 6.4, 'brick', True)
    carving = trimesh.creation.icosphere(subdivisions=1)

    def relief(center, scale, color='stone'):
        model.mesh(carving.vertices * scale + center, carving.faces, color)

    for gate, center in enumerate((-18.7, -14.2, -9.7)):
        height, opening = (5.8, 2.6) if gate == 1 else (5.0, 2.3)
        shaft = 0.48
        spacing = opening + shaft
        crown = 0.18 + height
        lintel = crown - (1.5 if gate == 1 else 1.4)
        for offset in (-spacing / 2, spacing / 2):
            post = center + offset
            model.box(post, 0.18, 4.05, shaft, height, shaft, 'granite', True)
            for side in (-1, 1):
                depth = 4.05 + side * 0.41
                model.box(post, 0.18, depth, 0.52, 0.35, 0.49, 'granite', True)
                relief([post, 0.83, depth], [0.25, 0.56, 0.27], 'granite')
                if model.detail:
                    for flank in (-1, 1):
                        previous = None
                        for angle in np.linspace(0, 2.25 * math.pi, 15):
                            radius = 0.19 - 0.021 * angle
                            point = [post + flank * 0.235, 0.92 + radius * math.sin(angle), depth + radius * math.cos(angle)]
                            if previous is not None:
                                model.beam(previous, point, 0.025, 'stone', 5)
                            previous = point
            model.box(post, crown, 4.05, 0.55, 0.14, 0.55, 'granite')
            relief([post, crown + 0.31, 4.05], [0.18, 0.22, 0.20], 'granite')
            relief([post, crown + 0.51, 4.14], [0.14, 0.14, 0.13], 'stone')
        for level in (lintel - 0.81, lintel - 0.18):
            model.box(center, level, 4.05, spacing + 0.60, 0.18, 0.44, 'granite')
        model.box(center, lintel - 0.63, 4.05, opening, 0.45, 0.28, 'stone')
        if model.detail:
            for motif in (-0.34, -0.17, 0, 0.17, 0.34):
                relief([center + motif * opening, lintel - 0.40, 4.20], [0.20, 0.13, 0.05], 'granite')

    for row, depth in enumerate((1.8, -0.8)):
        for index in range(8):
            center = -20.55 + 1.77 * index + row * 0.43
            portrait = row == index == 0
            rounded = (row + index) % 2 != 0
            height = 2.44 if portrait else 2.05 + 0.12 * ((row + index) % 4)
            width = 1.48 if portrait else 1.03
            model.box(center, 0.18, depth, width + 0.24, 0.27, 0.58, 'granite', True)
            model.box(center, 0.45, depth, width, height - 0.45, 0.22, 'stone', True)
            if rounded:
                relief([center, height, depth], [width / 2, 0.28, 0.11], 'stone')
            else:
                model.box(center, height - 0.10, depth, width + 0.08, 0.13, 0.30, 'stone')
            model.box(center, 0.57, depth + 0.11, width - 0.14, height - 0.77, 0.04, 'white')
            if portrait and model.detail:
                relief([center, 1.92, depth + 0.14], [0.12, 0.17, 0.025])
                profile = [(-0.09, 1.79), (-0.25, 1.62), (-0.39, 0.77), (0.36, 0.77), (0.24, 1.32), (0.30, 1.49), (0.10, 1.72)]
                for start, end in zip(profile, profile[1:] + profile[:1]):
                    model.beam([center + start[0], start[1], depth + 0.15], [center + end[0], end[1], depth + 0.15], 0.019, 'stone')
    model.pose = (0, 0, 0, 0)


def build_kuiguang_lou(model):
    ang = HALL_AXIS
    model.pose = (0.0, 0.0, 0.0, ang)

    w, d = 12.6, 11.2
    model.box(0, -0.6, -0.6, w, 7.8, d - 1.2, 'brick', True)
    for sx in (-1, 1):
        gx = sx * (w / 2 - 0.22)
        model.box(gx, 6.8, -0.6, 0.46, 1.35, d - 1.4, 'brick')
        peak_pts = [
            (gx, 7.2, -5.2),
            (gx, 7.2, 4.0),
            (gx, 9.65, -0.6),
        ]
        for off in (-0.22, 0.22):
            v = [(px + off, py, pz) for px, py, pz in peak_pts]
            model.mesh(v, [[0, 1, 2], [0, 2, 1]], 'brick')
        if sx > 0:
            model.box(gx + 0.26, 4.55, -2.6, 0.12, 0.95, 0.95, 'white')
            model.box(gx + 0.30, 4.68, -2.6, 0.10, 0.68, 0.68, 'sign')
            model.box(gx + 0.26, 3.85, 1.4, 0.14, 1.35, 0.92, 'red')

    model.roof(0, 7.25, -0.6, w + 0.8, d + 0.8, 2.45)

    gz = d / 2 - 0.55
    model.box(0, -0.4, gz - 0.5, w, 0.65, 2.2, 'stone', True)
    model.box(0, 3.65, gz - 0.4, w - 0.2, 0.22, 1.9, 'red', True)
    model.box(0, 6.95, gz - 0.4, w - 0.2, 0.22, 1.9, 'red')
    for px in np.linspace(-5.6, 5.6, 5):
        model.beam([px, 0.25, gz + 0.35], [px, 7.15, gz + 0.35], 0.16, 'red', 8, True)
    model.box(0, 3.87, gz + 0.35, w - 0.6, 0.88, 0.10, 'red')
    if model.detail:
        for lx in np.linspace(-5.0, 5.0, 7):
            model.box(lx, 0.22, gz - 0.95, 1.25, 3.13, 0.12, 'red')
            model.box(lx, 4.0, gz - 0.95, 1.25, 2.65, 0.12, 'red')
    model.box(6.8, -0.2, 3.6, 0.65, 1.65, 0.28, 'white')
    model.box(7.8, -0.2, 1.2, 1.45, 1.85, 1.15, 'stone')
    model.pose = (0, 0, 0, 0)


def build_school_gate(model):
    """Pillared Jiefang West Road gate, kept as it was live before IDOK-84 (IMG_1373-1375).

    Only changes: closed iron gates between the rear columns and side aisles, and the forecourt
    apron no longer reaches onto the public pavement.
    """
    model.site_datum = -0.58
    gy = -0.58
    yaw = 0.216
    cx, cz = 12.8, 25.4
    model.pose = (cx, gy, cz, yaw)

    model.box(0, -0.45, -3.4, 32.0, 0.48, 10.2, 'pave', True)

    for jamb in (-3.95,0.0,3.95):
        model.box(jamb,0,-1.6,.46,3.48,.52,'granite',True)
        model.box(jamb,-.15,-1.6,.70,.36,.72,'stone',True)
    model.box(0,3.36,-1.6,8.48,.42,.64,'stone',True)

    for px in (-5.45, 5.45):
        for pz in (-3.8, 1.6):
            segs = 18 if model.detail else 8
            cyl = trimesh.creation.cylinder(radius=0.44, height=6.45, sections=segs)
            verts = cyl.vertices[:, [0, 2, 1]].copy()
            verts += [px, 3.05, pz]
            model.mesh(verts, cyl.faces, 'granite', True)
            model.box(px, -0.2, pz, 1.12, 0.36, 1.12, 'tile', True)
        model.box(px, 6.25, 1.6, 1.35, 1.45, 1.35, 'stone')
        model.box(px, 7.70, 1.6, 0.78, 0.92, 0.85, 'granite')
        if px < 0:
            model.box(px, 1.25, 2.04, 0.48, 2.85, 0.14, 'stone')

    model.box(0, 5.82, -1.3, 17.8, 0.52, 7.2, 'earth', True)
    for bx in np.linspace(-8.4, 8.4, 7):
        model.box(bx, 5.54, -1.3, 0.26, 0.30, 7.2, 'white')
    for bz in np.linspace(-4.6, 2.0, 5):
        model.box(0, 5.54, bz, 17.8, 0.30, 0.26, 'white')

    model.box(0, 5.85, 1.85, 11.2, 1.95, 1.10, 'white', True)
    model.box(0, 6.05, 2.40, 8.8, 1.18, 0.12, 'stone')
    text_mesh(model, '桂 林 中 学', 6.9, 0.88, 'red', 6.64, 2.50, 32)
    eave_pts = [(-4.55, 7.18, 2.75), (4.55, 7.18, 2.75), (4.55, 7.68, 2.05), (-4.55, 7.68, 2.05)]
    model.mesh(eave_pts, [[0, 1, 2], [0, 2, 3]], 'green')
    model.box(0, 7.68, 1.85, 9.4, 0.22, 1.25, 'white')

    for sx in (-4.5, 4.5):
        model.box(sx, 5.36, 1.15, .12, .54, .16, 'stone')
    model.box(0, 4.72, 1.15, 9.8, 0.72, 0.26, 'sign')
    for lx in (-3.6, -1.2, 1.2, 3.6):
        model.beam([lx, 4.55, 1.75], [lx, 5.9, 1.75], .035, 'stone')
        sph = trimesh.creation.icosphere(subdivisions=1 if model.detail else 0)
        model.mesh(sph.vertices * [0.32, 0.26, 0.32] + [lx, 4.55, 1.75], sph.faces, 'red')

    model.beam([0, 6.35, -0.3], [0, 11.4, -0.3], 0.07, 'stone', 6)
    flag_pts = [(0.05, 11.25, -0.3), (1.65, 10.65, 0.0), (1.55, 9.65, -0.05), (0.05, 10.15, -0.3)]
    model.mesh(flag_pts, [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]], 'red')

    model.box(-8.4, 4.85, 0.2, 4.6, 1.45, 3.6, 'white', True)
    model.box(8.4, 4.85, 0.2, 4.6, 1.45, 3.6, 'white', True)
    model.box(-9.6, -0.3, -2.0, 0.42, 5.2, 6.0, 'white', True)
    model.box(9.2, -0.3, -2.0, 0.42, 5.2, 6.0, 'white', True)

    closed_grille(model, 0.0, 0.0, -3.8, 10.0, 2.3)
    closed_grille(model, -7.5, 0.0, -3.8, 3.7, 2.3)
    closed_grille(model, 7.3, 0.0, -3.8, 3.3, 2.3)

    # Lions and planter exactly where the live model had them (seated_lion resets the pose).
    seated_lion(model, -6.4, 0.0, 3.65, 0.25)
    seated_lion(model, 6.0, 0.0, 3.65, -0.25)
    model.site_datum = 0
    model.box(-8.6, 0.0, 3.9, 2.2, 0.55, 1.4, 'leaf')
    model.pose = (0, 0, 0, 0)


def build_flanking_facades(model):
    model.site_datum = -0.58
    gy = -0.58
    yaw = 0.216

    model.pose = (-7.8, gy, 19.8, yaw)
    model.box(-2.5, -0.6, 1.2, 15.5, 4.5, 9.6, 'white', True)
    model.box(-2.5, 3.65, 6.25, 16.0, 0.42, 0.85, 'white')
    for sx in (-7.5, -2.5, 2.2):
        model.box(sx, 0.2, 6.02, 3.6, 2.9, 0.14, 'tile')
    model.box(-4.8, 3.9, 0.4, 12.2, 19.2, 10.4, 'stone', True)
    rcx, rcz, rr = 1.3, 0.4, 5.2
    segs = 14 if model.detail else 7
    for fl in range(6):
        fy = 3.9 + fl * 3.15
        for sub_y, sub_h, col in ((fy, 1.35, 'stone'), (fy + 1.35, 1.55, 'clock'), (fy + 2.90, 0.25, 'white')):
            for idx in range(segs):
                a0 = -math.pi * 0.15 + math.pi * 0.80 * idx / segs
                a1 = -math.pi * 0.15 + math.pi * 0.80 * (idx + 1) / segs
                x0, z0 = rcx + rr * math.sin(a0), rcz + rr * math.cos(a0)
                x1, z1 = rcx + rr * math.sin(a1), rcz + rr * math.cos(a1)
                quad = [(x0, sub_y, z0), (x1, sub_y, z1), (x1, sub_y + sub_h, z1), (x0, sub_y + sub_h, z0)]
                model.mesh(quad, [[0, 1, 2], [0, 2, 3]], col, sub_y == fy and fl == 0)
        model.box(-5.2, fy + 1.35, 5.64, 11.2, 1.55, 0.12, 'clock')
    for idx in range(segs):
        a0 = -math.pi * 0.1 + math.pi * 0.72 * idx / segs
        a1 = -math.pi * 0.1 + math.pi * 0.72 * (idx + 1) / segs
        p = [
            (rcx + rr * math.sin(a0), 22.8, rcz + rr * math.cos(a0)),
            (rcx + rr * math.sin(a1), 22.8, rcz + rr * math.cos(a1)),
            (rcx + (rr - 1.2) * math.sin(a1), 24.1, rcz + (rr - 1.2) * math.cos(a1)),
            (rcx + (rr - 1.2) * math.sin(a0), 24.1, rcz + (rr - 1.2) * math.cos(a0)),
        ]
        model.mesh(p, [[0, 1, 2], [0, 2, 3]], 'green')
    model.pose = (0, 0, 0, 0)

    annex_ring = [(21.8, 28.5), (25.2, 34.8), (28.8, 27.6), (22.2, 23.8)]
    prism(model, annex_ring, gy - 0.8, 8.6, 'white', 'white', True)
    model.pose = (24.6, gy, 29.8, yaw + 0.15)
    eave_r = [(-4.2, 7.35, 3.2), (4.2, 7.35, 3.2), (4.2, 8.05, 2.2), (-4.2, 8.05, 2.2)]
    model.mesh(eave_r, [[0, 1, 2], [0, 2, 3]], 'green')
    model.box(0, 4.35, 2.85, 6.8, 1.85, 0.16, 'tile')
    model.box(0, 0.2, 2.82, 6.2, 3.1, 0.14, 'clock')
    model.pose = (0, 0, 0, 0)

    f97_ring = [(60.44, 13.23), (64.56, 2.91), (68.86, -7.87), (46.42, -16.48), (42.60, -6.48), (36.78, 8.61)]
    prism(model, f97_ring, -1.0, 21.8, 'white', 'granite', True)

    f97_ang = math.atan2(13.23 - 8.61, 60.44 - 36.78)
    model.pose = (48.6, -0.2, 10.9, f97_ang)
    model.box(-9.2, 21.8, -2.0, 5.2, 3.8, 5.4, 'stone')
    model.box(-9.8, 25.4, -2.0, 6.8, 0.42, 6.4, 'granite')
    model.box(-9.2, 3.5, 0.12, 2.4, 21.2, 0.14, 'clock')
    model.beam([-14.6, -0.4, 0.5], [-14.6, 18.2, 0.5], 0.42, 'stone', 10, True)
    for idx in range(8):
        t0, t1 = idx / 8, (idx + 1) / 8
        x0, x1 = -18.2 + 8.5 * t0, -18.2 + 8.5 * t1
        y0_c = 16.8 + 2.4 * math.sin(t0 * math.pi * 0.75)
        y1_c = 16.8 + 2.4 * math.sin(t1 * math.pi * 0.75)
        can_q = [(x0, y0_c, 3.2), (x1, y1_c, 3.2), (x1, y1_c, -4.8), (x0, y0_c, -4.8)]
        model.mesh(can_q, [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]], 'granite')
    for px in (-3.5, 1.0, 5.5, 9.5):
        model.box(px, 20.92, -1.5, 0.38, 3.18, 0.38, 'stone')
    model.box(3.0, 24.0, -1.5, 14.5, 0.35, 6.2, 'granite')
    for fl in range(5):
        fy = 3.2 + fl * 3.4
        model.box(2.5, fy, 0.10, 16.5, 1.65, 0.12, 'glass')
    model.pose = (0, 0, 0, 0)


def append_heritage_hall(folder):
    from xiaoyao_tower import generate

    def hall(model):
        model.fit_to_grade(SCHOOL)
        build_kuiguang_lou(model)
        build_stele_court(model)
        build_school_gate(model)
        build_flanking_facades(model)

    generate('exterior', hall, smooth=('red', 'green', 'clock', 'earth'),
             lettering=dict(text=' ', foreground='#3f6788', background='#3f6788'),
             colors=dict(
            white='#eeede7',
            stone='#cfd2d6',
            granite='#83878c',
            pave='#9ea2a6',
            brick='#8e928f',
            tile='#353b40',
            red='#a8322c',
            green='#3e7856',
            clock='#3f6788',
            earth='#cf9382',
            glass='#384752',
            sign='#1f1d1e',
            wood='#6b3c33',
            leaf='#3b5f35',
        ))
    append_exterior(folder, SCHOOL)


if __name__ == '__main__':
    export_school_glb(SCHOOL, PALETTE, SIGNS, lambda builder: build(builder, sys.modules[__name__]))
    append_heritage_hall(Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.'))
