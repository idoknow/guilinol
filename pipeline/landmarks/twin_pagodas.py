"""Build Guilin Sun & Moon Pagodas (日月双塔) in Shanhu Lake for M2.6.

Hand-authored procedural GLB matching pipeline/avatar.py and docs/style.md + docs/landmarks.md:
- Origin at the midpoint of the two pagodas, Y up, metres (+X east, +Z south).
  World anchor in guilinol: (-977.10, 150.1, 630.90) on Shanhu water plane.
- Sun Pagoda (日塔) at (+13.98, 0, -13.33): 41 m tall, 9 tiers, octagonal copper-gold tower
  on a two-row carved white stone lotus-petal pedestal rising out of the water.
- Moon Pagoda (月塔) at (-13.98, 0, +13.33): 35 m tall, 7 tiers, octagonal white walls,
  vermilion columns/railings and dark slate-grey upturned tile eaves on an island stone terrace.
- Lakeside carved limestone balustrades (湖岸石栏杆) edging the pagoda island shore.

References only (never shipped): raw/refs/shanhu_pagodas/01-2024.jpg, 02-2024.jpg, 13-2018.jpg, 15-2017.jpg.
Usage: uv run python pipeline/landmarks/twin_pagodas.py
"""
import json
import math
import struct
from pathlib import Path

import numpy as np

# World midpoint (-977.10, 630.90) from Overture footprints in guilinol XZ:
# Sun Pagoda (-963.12, 617.57), Moon Pagoda (-991.08, 644.22).
SUN_OFFSET = (13.98, 0.0, -13.33)
MOON_OFFSET = (-13.98, 0.0, 13.33)

# Materials: sRGB hex -> linear baseColorFactor in material()
# Calibrated to guilinol NeutralToneMapping (DirectionalLight + HemisphereLight, no env cubemap).
MATERIALS = {
    'lotusStone':  dict(hex=0xe0dcd2, rough=0.88, metal=0.0),
    'lotusShadow': dict(hex=0xb7b1a3, rough=0.92, metal=0.0),
    'stoneDeck':   dict(hex=0x9c988f, rough=0.90, metal=0.0),
    'stoneRail':   dict(hex=0xd8d4c9, rough=0.85, metal=0.0),
    'bronzeDark':  dict(hex=0x82602f, rough=0.56, metal=0.14),
    'bronzeBody':  dict(hex=0xc4923f, rough=0.45, metal=0.18),
    'goldBronze':  dict(hex=0xe6b550, rough=0.36, metal=0.22),
    'roofBronze':  dict(hex=0x8c672e, rough=0.52, metal=0.16),
    'sunGlow':     dict(hex=0xf6c562, rough=0.35, metal=0.0, emissive=[0.55, 0.36, 0.10]),
    'whiteWall':   dict(hex=0xe7e3d9, rough=0.88, metal=0.0),
    'vermilion':   dict(hex=0x98352d, rough=0.68, metal=0.0),
    'eaveTeal':    dict(hex=0x4f7872, rough=0.75, metal=0.0),
    'slateTile':   dict(hex=0x373e45, rough=0.78, metal=0.04),
    'slateTrim':   dict(hex=0x838b91, rough=0.72, metal=0.04),
    'spireSilver': dict(hex=0xc0c2bc, rough=0.45, metal=0.18),
    'moonGlow':    dict(hex=0xe8eef4, rough=0.35, metal=0.0, emissive=[0.42, 0.45, 0.50]),
}

binary = bytearray()
views, accessors, nodes, meshes, materials = [], [], [], [], []
material_index = {}


def srgb_to_linear(value):
    srgb = [((value >> shift) & 255) / 255.0 for shift in (16, 8, 0)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]


def accessor(values, kind, component=5126, dtype='<f4', target=None):
    array = np.asarray(values, dtype)
    while len(binary) % 4:
        binary.append(0)
    view = dict(buffer=0, byteOffset=len(binary), byteLength=array.nbytes)
    if target:
        view['target'] = target
    views.append(view)
    binary.extend(array.tobytes())
    item = dict(bufferView=len(views) - 1, componentType=component, count=len(array), type=kind)
    if kind == 'VEC3' and target:
        item.update(min=array.min(axis=0).tolist(), max=array.max(axis=0).tolist())
    accessors.append(item)
    return len(accessors) - 1


def get_material(name):
    if name not in material_index:
        spec = MATERIALS[name]
        mat = dict(
            name=name,
            pbrMetallicRoughness=dict(
                baseColorFactor=srgb_to_linear(spec['hex']) + [1.0],
                metallicFactor=spec['metal'],
                roughnessFactor=spec['rough'],
            ),
        )
        if 'emissive' in spec:
            mat['emissiveFactor'] = spec['emissive']
            mat['extras'] = dict(nightEmissive=True)
        materials.append(mat)
        material_index[name] = len(materials) - 1
    return material_index[name]


def make_mesh(name, buckets):
    """Build a mesh from {material_name: list_of_tris} with flat outward normals."""
    primitives = []
    for mat_name, tris in buckets.items():
        if not tris:
            continue
        tri = np.asarray(tris, '<f4').reshape(-1, 3, 3)
        normal = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        lens = np.linalg.norm(normal, axis=1, keepdims=True)
        valid = lens[:, 0] > 1e-8
        if not np.all(valid):
            tri = tri[valid]
            normal = normal[valid]
            lens = lens[valid]
        if len(tri) == 0:
            continue
        normal = normal / lens
        position = tri.reshape(-1, 3)
        normals = np.repeat(normal, 3, axis=0)
        primitives.append(dict(
            attributes=dict(
                POSITION=accessor(position, 'VEC3', target=34962),
                NORMAL=accessor(normals, 'VEC3', target=34962),
            ),
            material=get_material(mat_name),
        ))
    meshes.append(dict(name=name, primitives=primitives))
    return len(meshes) - 1


def make_node(name, translation=(0.0, 0.0, 0.0), mesh=None, children=()):
    item = dict(name=name, translation=[float(v) for v in translation])
    if mesh is not None:
        item['mesh'] = mesh
    if children:
        item['children'] = list(children)
    nodes.append(item)
    return len(nodes) - 1


# --- Geometry Primitives (verified outward clockwise-from-+Y winding) ----------------------------

def ring(radius, y, sides, phase=0.0):
    """Clockwise ring when viewed from +Y; pairs with loft() for outward normals."""
    return [
        (radius * math.cos(phase + 2 * math.pi * k / sides),
         y,
         radius * math.sin(phase + 2 * math.pi * k / sides))
        for k in range(sides)
    ]


def eave_ring16(r_corner, r_mid, y_corner, y_mid, phase=math.pi / 8):
    """16-point octagonal ring alternating 8 corners and 8 edge midpoints."""
    pts = []
    for k in range(16):
        ang = phase + k * math.pi / 8
        if k % 2 == 0:
            pts.append((r_corner * math.cos(ang), y_corner, r_corner * math.sin(ang)))
        else:
            pts.append((r_mid * math.cos(ang), y_mid, r_mid * math.sin(ang)))
    return pts


def loft(rings, cap_bottom=True, cap_top=True):
    """Loft stack of equal-length clockwise rings (bottom -> top) with outward normals."""
    tris = []
    for a, b in zip(rings, rings[1:]):
        n = len(a)
        for k in range(n):
            j = (k + 1) % n
            tris.append((a[k], b[j], a[j]))
            tris.append((a[k], b[k], b[j]))
    for cap, is_bottom in ((rings[0], True), (rings[-1], False)):
        if (is_bottom and not cap_bottom) or (not is_bottom and not cap_top):
            continue
        cx = sum(p[0] for p in cap) / len(cap)
        cy = sum(p[1] for p in cap) / len(cap)
        cz = sum(p[2] for p in cap) / len(cap)
        centre = (cx, cy, cz)
        n = len(cap)
        for k in range(n):
            j = (k + 1) % n
            tris.append((centre, cap[k], cap[j]) if is_bottom else (centre, cap[j], cap[k]))
    return tris


def frustum(r0, r1, y0, y1, sides=8, phase=math.pi / 8, cap_bottom=True, cap_top=True):
    return loft([ring(r0, y0, sides, phase), ring(r1, y1, sides, phase)], cap_bottom, cap_top)


def cylinder_at(cx, cz, r0, r1, y0, y1, sides=6, phase=0.0, cap_bottom=False, cap_top=False):
    return [
        tuple((x + cx, y, z + cz) for x, y, z in tri)
        for tri in frustum(r0, r1, y0, y1, sides, phase, cap_bottom, cap_top)
    ]


def box_at(cx, y0, cz, w, h, d, angle=0.0, cap_bottom=True, cap_top=True):
    """Oriented box whose local +X axis aligns with polar angle `angle` in (cos, sin) XZ plane."""
    hw, hd = w / 2.0, d / 2.0
    c, s = math.cos(angle), math.sin(angle)

    def pt(lx, y, lz):
        return (cx + lx * c - lz * s, y, cz + lx * s + lz * c)

    bot = [pt(-hw, y0, -hd), pt(hw, y0, -hd), pt(hw, y0, hd), pt(-hw, y0, hd)]
    top = [pt(-hw, y0 + h, -hd), pt(hw, y0 + h, -hd), pt(hw, y0 + h, hd), pt(-hw, y0 + h, hd)]
    return loft([bot, top], cap_bottom=cap_bottom, cap_top=cap_top)


def radial_panel(r, angle, y0, width, height, thickness):
    """Place a flat rectangular panel tangent to a circle of radius r at polar angle `angle`."""
    # Tangent direction at angle has local X perpendicular to radial vector; thickness along radial.
    return box_at(r * math.cos(angle), y0, r * math.sin(angle), thickness, height, width, angle)


def segment_bar(ax, az, bx, bz, y0, y1, half_w, cap=False):
    """Oriented rectangular bar connecting (ax, az) -> (bx, bz)."""
    dx, dz = bx - ax, bz - az
    length = math.hypot(dx, dz)
    if length < 1e-4:
        return []
    ang = math.atan2(dz, dx)
    return box_at((ax + bx) * 0.5, y0, (az + bz) * 0.5, length, y1 - y0, half_w * 2.0, ang, cap_bottom=cap, cap_top=cap)


def add_tris(buckets, mat_name, tris):
    buckets.setdefault(mat_name, []).extend(tris)


def add_eave_roof(
    buckets,
    r_wall,
    r_eave,
    y_base,
    roof_h,
    eave_lift,
    roof_mat,
    trim_mat,
    soffit_mat,
    glow_mat=None,
    bell_mat=None,
    phase=math.pi / 8,
):
    """Build an octagonal sweeping upturned Chinese roof (飞檐翘角) + curved corner ridges + under-eave light."""
    r_inner = r_wall * 1.01
    r_inner_mid = r_inner * math.cos(math.pi / 8)
    r_mid = (r_wall + r_eave) * 0.52
    r_mid_edge = r_mid * math.cos(math.pi / 8)
    r_out_corner = r_eave * 1.16
    r_out_edge = r_eave * math.cos(math.pi / 8) * 0.96

    y_top = y_base + roof_h
    y_mid_corner = y_base + roof_h * 0.34 + eave_lift * 0.14
    y_mid_edge = y_base + roof_h * 0.34
    y_edge = y_base
    y_corner = y_base + eave_lift

    top_ring = eave_ring16(r_inner, r_inner_mid, y_top, y_top, phase)
    mid_ring = eave_ring16(r_mid, r_mid_edge, y_mid_corner, y_mid_edge, phase)
    out_ring = eave_ring16(r_out_corner, r_out_edge, y_corner, y_edge, phase)
    add_tris(buckets, roof_mat, loft([out_ring, mid_ring, top_ring], cap_bottom=False, cap_top=True))

    # Underside soffit (facing downward from outer edge inward to wall)
    soffit_in = eave_ring16(r_wall * 0.98, r_wall * 0.98 * math.cos(math.pi / 8), y_base - 0.14, y_base - 0.14, phase)
    soffit_out = eave_ring16(r_out_corner * 0.99, r_out_edge * 0.99, y_corner - 0.08, y_edge - 0.08, phase)
    add_tris(buckets, soffit_mat, loft([soffit_in, soffit_out], cap_bottom=False, cap_top=False))

    # 8 curved corner ridge ribs (垂脊) hugging the 2-segment concave slope (inner -> mid -> outer tip)
    for k in range(8):
        ang = phase + k * math.pi / 4
        c, s = math.cos(ang), math.sin(ang)
        pts_c = [
            (r_inner * 1.00 * c, y_top + 0.06, r_inner * 1.00 * s),
            (r_mid * 1.00 * c, y_mid_corner + 0.07, r_mid * 1.00 * s),
            (r_out_corner * 0.99 * c, y_corner + 0.10, r_out_corner * 0.99 * s),
        ]
        hw = 0.06
        for (ax, ay, az), (bx, by, bz) in zip(pts_c, pts_c[1:]):
            q = [
                (ax - hw * s, ay, az + hw * c),
                (ax + hw * s, ay, az - hw * c),
                (bx + hw * s, by, bz - hw * c),
                (bx - hw * s, by, bz + hw * c),
            ]
            qb = [(p[0], p[1] - 0.12, p[2]) for p in q]
            for idx in range(4):
                nxt = (idx + 1) % 4
                add_tris(buckets, trim_mat, [(qb[idx], q[nxt], qb[nxt]), (qb[idx], q[idx], q[nxt])])
            add_tris(buckets, trim_mat, [(q[0], q[1], q[2]), (q[0], q[2], q[3])])

        if bell_mat:
            bx, bz = r_out_corner * 0.94 * c, r_out_corner * 0.94 * s
            add_tris(buckets, bell_mat, cylinder_at(bx, bz, 0.08, 0.03, y_corner - 0.38, y_corner - 0.10, 4))

    # Under-eave night LED wash band (visible under outer eaves for reflection & night silhouette)
    if glow_mat:
        g_in = ring(r_wall * 1.03, y_base - 0.16, 8, phase)
        g_out = ring(r_mid * 0.96, y_base - 0.08, 8, phase)
        add_tris(buckets, glow_mat, loft([g_in, g_out], cap_bottom=False, cap_top=False))
        # Subtle warm/silver outer eave rim band facing outward
        e_bot = eave_ring16(r_out_corner * 0.96, r_out_edge * 0.96, y_corner - 0.09, y_edge - 0.09, phase)
        e_top = eave_ring16(r_out_corner * 0.99, r_out_edge * 0.99, y_corner - 0.02, y_edge - 0.02, phase)
        add_tris(buckets, glow_mat, loft([e_bot, e_top], cap_bottom=False, cap_top=False))


def add_oct_railing(buckets, radius, y_deck, height, rail_mat, post_mat, phase=math.pi / 8):
    """Compact octagonal balustrade: 8 corner posts + continuous top/mid handrail bands."""
    for k in range(8):
        ang = phase + k * math.pi / 4
        add_tris(buckets, post_mat, box_at(radius * math.cos(ang), y_deck, radius * math.sin(ang), 0.16, height + 0.08, 0.16, ang, cap_bottom=False))
    # Continuous octagonal rail bands via 2 thin lofted rings (outer/inner face)
    for y0, y1 in ((y_deck + height - 0.11, y_deck + height), (y_deck + height * 0.44, y_deck + height * 0.53)):
        r_out, r_in = radius + 0.04, radius - 0.04
        add_tris(buckets, rail_mat, loft([ring(r_out, y0, 8, phase), ring(r_out, y1, 8, phase)], cap_bottom=False, cap_top=False))
        add_tris(buckets, rail_mat, loft([ring(r_in, y1, 8, phase), ring(r_in, y0, 8, phase)], cap_bottom=False, cap_top=False))
        add_tris(buckets, rail_mat, loft([ring(r_in, y1, 8, phase), ring(r_out, y1, 8, phase)], cap_bottom=False, cap_top=False))


def add_oct_spire(buckets, r_roof_top, y_start, y_end, spire_mat, accent_mat, glow_mat=None):
    """Build stepped octagonal lotus finial + ringed 相轮 spire + jewel tip."""
    h = y_end - y_start
    add_tris(buckets, accent_mat, frustum(r_roof_top * 1.25, r_roof_top * 0.72, y_start, y_start + h * 0.12, 8))
    add_tris(buckets, spire_mat, frustum(r_roof_top * 0.72, r_roof_top * 0.92, y_start + h * 0.12, y_start + h * 0.22, 8))
    add_tris(buckets, spire_mat, frustum(r_roof_top * 0.36, 0.08, y_start + h * 0.22, y_end - h * 0.14, 8))
    for i in range(7):
        t = i / 6.0
        ry = y_start + h * (0.28 + 0.46 * t)
        rr = r_roof_top * (0.88 - 0.46 * t)
        add_tris(buckets, accent_mat, frustum(rr, rr * 0.92, ry, ry + 0.14, 8))
    add_tris(buckets, accent_mat, frustum(0.24, 0.34, y_end - h * 0.16, y_end - h * 0.10, 8))
    add_tris(buckets, accent_mat, frustum(0.34, 0.02, y_end - h * 0.10, y_end, 8))
    if glow_mat:
        add_tris(buckets, glow_mat, frustum(r_roof_top * 0.44, 0.15, y_start + h * 0.24, y_end - h * 0.18, 8))


# --- Sun Pagoda (日塔: 9 tiers, 41m, copper-gold, white lotus-petal pedestal) ----------------------

def build_sun_pagoda():
    b = {}
    phase = math.pi / 8

    # 1. White stone lotus-petal pedestal (y = -1.6 .. +2.45 m) rising out of Shanhu lake
    add_tris(b, 'lotusShadow', frustum(9.55, 9.35, -1.6, 2.30, 16, 0.0))

    # Two staggered rows of 16 sculpted 3D carved lotus petals (refined gentle relief)
    for y0, y1, r_base, r_belly, r_tip, ang_off in (
        (-0.30, 1.15, 9.42, 9.80, 9.52, 0.0),
        (0.88, 2.26, 9.46, 9.84, 9.60, math.pi / 16),
    ):
        for k in range(16):
            ang = ang_off + k * 2 * math.pi / 16
            ha = 2 * math.pi / 32 * 0.88
            a0, ac, a1 = ang - ha, ang, ang + ha
            y_mid = (y0 + y1) * 0.52
            p_bl = (r_base * math.cos(a0), y0, r_base * math.sin(a0))
            p_br = (r_base * math.cos(a1), y0, r_base * math.sin(a1))
            p_ml = (r_belly * 0.98 * math.cos(a0), y_mid, r_belly * 0.98 * math.sin(a0))
            p_mc = (r_belly * math.cos(ac), y_mid, r_belly * math.sin(ac))
            p_mr = (r_belly * 0.98 * math.cos(a1), y_mid, r_belly * 0.98 * math.sin(a1))
            p_tip = (r_tip * math.cos(ac), y1, r_tip * math.sin(ac))
            add_tris(b, 'lotusStone', [
                (p_bl, p_mc, p_br),
                (p_bl, p_ml, p_mc),
                (p_mc, p_mr, p_br),
                (p_ml, p_tip, p_mc),
                (p_mc, p_tip, p_mr),
            ])

    add_tris(b, 'lotusStone', frustum(9.55, 9.90, 2.15, 2.45, 8, phase))
    add_tris(b, 'sunGlow', frustum(9.84, 9.84, 2.04, 2.15, 16, 0.0, cap_bottom=False, cap_top=False))
    add_oct_railing(b, 9.20, 2.45, 0.92, 'goldBronze', 'bronzeBody', phase)

    # 2. 1F Open Colonnade Pavilion (y = 2.45 .. 6.65 m)
    y1_top = 6.65
    add_tris(b, 'bronzeDark', frustum(5.90, 5.80, 2.45, y1_top, 8, phase, cap_bottom=False))
    for k in range(8):
        ang = phase + k * math.pi / 4
        add_tris(b, 'bronzeBody', cylinder_at(7.55 * math.cos(ang), 7.55 * math.sin(ang), 0.28, 0.25, 2.45, y1_top, 6))
    for k in range(4):
        ca = k * math.pi / 2
        add_tris(b, 'sunGlow', radial_panel(5.45, ca, 2.55, 1.80, 2.50, 0.20))

    add_eave_roof(
        b, r_wall=7.75, r_eave=10.45, y_base=6.35, roof_h=1.75, eave_lift=0.65,
        roof_mat='roofBronze', trim_mat='goldBronze', soffit_mat='bronzeDark',
        glow_mat='sunGlow', bell_mat='bronzeDark', phase=phase,
    )

    # 3. Tiers 2..9 (8 upper stories -> total 9 stories, y = 7.45 .. 32.8 m)
    y_cur = 7.45
    tier_heights = [3.45, 3.35, 3.25, 3.15, 3.05, 2.95, 2.85, 2.75]
    for idx, th in enumerate(tier_heights):
        t = idx / 7.0
        r_wall = 5.95 - 2.35 * t
        r_balc = r_wall + 0.95
        r_eave = r_wall + 2.15 - 0.45 * t
        y_next = y_cur + th

        add_tris(b, 'bronzeBody', frustum(r_balc * 0.96, r_balc, y_cur - 0.12, y_cur + 0.14, 8, phase))
        add_oct_railing(b, r_balc - 0.12, y_cur + 0.14, 0.78, 'goldBronze', 'bronzeBody', phase)

        add_tris(b, 'bronzeDark', frustum(r_wall, r_wall * 0.97, y_cur, y_next, 8, phase, cap_bottom=False, cap_top=False))
        for k in range(8):
            ang = phase + k * math.pi / 4
            add_tris(b, 'bronzeBody', cylinder_at(r_wall * 0.99 * math.cos(ang), r_wall * 0.99 * math.sin(ang), 0.17, 0.15, y_cur, y_next, 5))
        for k in range(4):
            ca = k * math.pi / 2
            add_tris(b, 'sunGlow', radial_panel(r_wall * 0.92, ca, y_cur + th * 0.24, r_wall * 0.34, th * 0.42, 0.12))

        if idx == 2:
            for ca in (0.0, math.pi):
                add_tris(b, 'goldBronze', radial_panel(r_wall + 0.25, ca, y_cur + th * 0.62, 1.65, 0.68, 0.14))

        add_eave_roof(
            b, r_wall=r_wall, r_eave=r_eave, y_base=y_next - 0.25, roof_h=1.25 - 0.25 * t,
            eave_lift=0.50 - 0.12 * t,
            roof_mat='roofBronze', trim_mat='goldBronze', soffit_mat='bronzeDark',
            glow_mat='sunGlow', bell_mat='bronzeDark', phase=phase,
        )
        y_cur = y_next + 0.18

    add_eave_roof(
        b, r_wall=3.45, r_eave=5.15, y_base=y_cur - 0.35, roof_h=2.55, eave_lift=0.52,
        roof_mat='roofBronze', trim_mat='goldBronze', soffit_mat='bronzeDark',
        glow_mat='sunGlow', bell_mat='goldBronze', phase=phase,
    )
    add_oct_spire(b, r_roof_top=0.95, y_start=y_cur + 2.05, y_end=41.0, spire_mat='bronzeBody', accent_mat='goldBronze', glow_mat='sunGlow')

    return make_mesh('SunPagodaMesh', b)


# --- Moon Pagoda (月塔: 7 tiers, 35m, white walls, vermilion railings, dark grey tiles) ------------

def build_moon_pagoda():
    b = {}
    phase = math.pi / 8

    # 1. Octagonal stone plinth & steps above island terrace (y = 0.45 .. 1.35 m)
    add_tris(b, 'stoneDeck', frustum(8.15, 7.90, 0.45, 1.05, 8, phase))
    add_tris(b, 'stoneDeck', frustum(7.45, 7.35, 1.05, 1.35, 8, phase))

    # 2. 1F Open Vermilion Colonnade Pavilion (y = 1.35 .. 5.25 m)
    y1_top = 5.25
    add_tris(b, 'whiteWall', frustum(4.95, 4.88, 1.35, y1_top, 8, phase, cap_bottom=False))
    for k in range(8):
        ang = phase + k * math.pi / 4
        add_tris(b, 'vermilion', cylinder_at(6.45 * math.cos(ang), 6.45 * math.sin(ang), 0.22, 0.20, 1.35, y1_top, 6))
    for k in range(4):
        ca = k * math.pi / 2
        add_tris(b, 'vermilion', radial_panel(4.56, ca, 1.45, 1.65, 2.45, 0.14))

    add_eave_roof(
        b, r_wall=6.60, r_eave=9.10, y_base=4.95, roof_h=1.65, eave_lift=0.58,
        roof_mat='slateTile', trim_mat='slateTrim', soffit_mat='eaveTeal',
        glow_mat='moonGlow', bell_mat='slateTrim', phase=phase,
    )

    # 3. Tiers 2..7 (6 upper stories -> total 7 stories, y = 5.95 .. 27.6 m)
    y_cur = 5.95
    tier_heights = [3.65, 3.55, 3.40, 3.30, 3.15, 3.00]
    for idx, th in enumerate(tier_heights):
        t = idx / 5.0
        r_wall = 4.95 - 1.75 * t
        r_balc = r_wall + 0.85
        r_eave = r_wall + 1.95 - 0.35 * t
        y_next = y_cur + th

        add_tris(b, 'stoneDeck', frustum(r_balc * 0.96, r_balc, y_cur - 0.10, y_cur + 0.12, 8, phase))
        add_oct_railing(b, r_balc - 0.10, y_cur + 0.12, 0.78, 'vermilion', 'vermilion', phase)

        add_tris(b, 'whiteWall', frustum(r_wall, r_wall * 0.98, y_cur, y_next, 8, phase, cap_bottom=False, cap_top=False))
        add_tris(b, 'eaveTeal', frustum(r_wall * 1.01, r_wall * 1.01, y_next - 0.42, y_next - 0.18, 8, phase, cap_bottom=False, cap_top=False))
        for k in range(8):
            ang = phase + k * math.pi / 4
            add_tris(b, 'whiteWall', box_at(r_wall * 0.99 * math.cos(ang), y_cur, r_wall * 0.99 * math.sin(ang), 0.36, th - 0.2, 0.36, ang, cap_bottom=False))
            # Flush vermilion door/window bay panels centered on each flat octagonal face
            ca = k * math.pi / 4
            r_bay = r_wall * math.cos(math.pi / 8) * 0.99
            add_tris(b, 'vermilion', radial_panel(r_bay, ca, y_cur + 0.18, r_wall * 0.44, th * 0.65, 0.10))

        add_eave_roof(
            b, r_wall=r_wall, r_eave=r_eave, y_base=y_next - 0.22, roof_h=1.22 - 0.20 * t,
            eave_lift=0.48 - 0.10 * t,
            roof_mat='slateTile', trim_mat='slateTrim', soffit_mat='eaveTeal',
            glow_mat='moonGlow', bell_mat='slateTrim', phase=phase,
        )
        y_cur = y_next + 0.22

    add_eave_roof(
        b, r_wall=3.15, r_eave=4.85, y_base=y_cur - 0.30, roof_h=2.45, eave_lift=0.50,
        roof_mat='slateTile', trim_mat='slateTrim', soffit_mat='eaveTeal',
        glow_mat='moonGlow', bell_mat='slateTrim', phase=phase,
    )
    add_oct_spire(b, r_roof_top=0.82, y_start=y_cur + 2.00, y_end=35.0, spire_mat='spireSilver', accent_mat='spireSilver', glow_mat='moonGlow')

    return make_mesh('MoonPagodaMesh', b)


# --- Lakeside Stone Terrace & Carved Stone Railings (湖岸石栏杆) --------------------------------

def add_carved_stone_balustrade_chain(buckets, pts, y_deck, closed=False, post_spacing=2.8):
    """Build carved limestone lakeside railing (石柱头 + 双横栏 + 石栏板)."""
    rail_h = 1.02
    n = len(pts)
    seg_count = n if closed else n - 1
    for idx in range(seg_count):
        ax, az = pts[idx]
        bx, bz = pts[(idx + 1) % n]
        seg_len = math.hypot(bx - ax, bz - az)
        if seg_len < 0.25:
            continue
        steps = max(1, round(seg_len / post_spacing))
        for s in range(steps):
            t0, t1 = s / steps, (s + 1) / steps
            px0, pz0 = ax + (bx - ax) * t0, az + (bz - az) * t0
            px1, pz1 = ax + (bx - ax) * t1, az + (bz - az) * t1
            add_tris(buckets, 'stoneRail', box_at(px0, y_deck, pz0, 0.22, rail_h, 0.22, cap_bottom=False))
            add_tris(buckets, 'stoneRail', cylinder_at(px0, pz0, 0.14, 0.03, y_deck + rail_h, y_deck + rail_h + 0.15, 4, math.pi / 4, cap_top=False))
            add_tris(buckets, 'stoneRail', segment_bar(px0, pz0, px1, pz1, y_deck + rail_h - 0.14, y_deck + rail_h - 0.02, 0.075))
            add_tris(buckets, 'stoneRail', segment_bar(px0, pz0, px1, pz1, y_deck, y_deck + 0.15, 0.085))
            add_tris(buckets, 'stoneDeck', segment_bar(px0, pz0, px1, pz1, y_deck + 0.15, y_deck + rail_h - 0.14, 0.045))
        if not closed and idx == seg_count - 1:
            add_tris(buckets, 'stoneRail', box_at(bx, y_deck, bz, 0.22, rail_h, 0.22, cap_bottom=False))
            add_tris(buckets, 'stoneRail', cylinder_at(bx, bz, 0.14, 0.03, y_deck + rail_h, y_deck + rail_h + 0.15, 4, math.pi / 4, cap_top=False))


def build_lakeside_railings():
    """Build Moon Pagoda island stone terrace + unified south-west lakeside viewing bank with stone railings."""
    b = {}
    mx, mz = MOON_OFFSET[0], MOON_OFFSET[2]
    # Single unified island + lakeside viewing terrace polygon (no self-overlap, north of z=+42)
    island_pts = [
        (mx - 14.5, mz + 2.5),
        (mx - 13.5, mz - 7.5),
        (mx - 8.0,  mz - 13.8),
        (mx + 2.5,  mz - 14.5),
        (mx + 11.2, mz - 9.2),
        (mx + 14.2, mz - 0.5),
        (mx + 13.0, mz + 9.0),
        (mx + 6.5,  mz + 15.8),
        (mx - 3.5,  mz + 17.8),
        (mx - 8.5,  mz + 24.5),
        (mx - 16.5, mz + 25.0),
        (mx - 17.5, mz + 13.5),
    ]
    area2 = sum((island_pts[i][0] * island_pts[(i + 1) % len(island_pts)][1] -
                 island_pts[(i + 1) % len(island_pts)][0] * island_pts[i][1]) for i in range(len(island_pts)))
    if area2 < 0:
        island_pts.reverse()
    bot_ring = [(x, -1.60, z) for x, z in island_pts]
    top_ring = [(x, 0.55, z) for x, z in island_pts]
    add_tris(b, 'stoneDeck', loft([bot_ring, top_ring], cap_bottom=True, cap_top=True))

    # Perimeter carved stone balustrade along the lakeside water edge,
    # leaving a walkway gap on the south-east shore neck (between idx 7 and 9).
    add_carved_stone_balustrade_chain(b, island_pts[9:] + island_pts[:8], y_deck=0.55, closed=False, post_spacing=2.8)
    return make_mesh('LakesideRailingsMesh', b)


def build_glb():
    sun_mesh = build_sun_pagoda()
    moon_mesh = build_moon_pagoda()
    rail_mesh = build_lakeside_railings()

    sun_node = make_node('SunPagoda', SUN_OFFSET, sun_mesh)
    moon_node = make_node('MoonPagoda', MOON_OFFSET, moon_mesh)
    rail_node = make_node('LakesideRailings', (0.0, 0.0, 0.0), rail_mesh)
    root_node = make_node('TwinPagodas', (0.0, 0.0, 0.0), None, [sun_node, moon_node, rail_node])

    while len(binary) % 4:
        binary.append(0)

    doc = dict(
        asset=dict(
            version='2.0',
            generator='guilinol pipeline/landmarks/twin_pagodas.py',
            copyright='CC0-1.0',
        ),
        scene=0,
        scenes=[dict(nodes=[root_node])],
        nodes=nodes,
        meshes=meshes,
        materials=materials,
        accessors=accessors,
        bufferViews=views,
        buffers=[dict(byteLength=len(binary))],
    )
    text = json.dumps(doc, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    target = Path(__file__).resolve().parents[2] / 'public/landmarks/twin_pagodas.glb'
    target.parent.mkdir(exist_ok=True, parents=True)
    target.write_bytes(
        struct.pack('<4sII', b'glTF', 2, 28 + len(text) + len(binary))
        + struct.pack('<I4s', len(text), b'JSON')
        + text
        + struct.pack('<I4s', len(binary), b'BIN\0')
        + binary
    )
    tri_count = sum(acc['count'] // 3 for mesh in meshes for prim in mesh['primitives']
                    for acc in [accessors[prim['attributes']['POSITION']]])
    prim_count = sum(len(mesh['primitives']) for mesh in meshes)
    print(f'{target} | {target.stat().st_size:,} bytes | {tri_count:,} tris | {prim_count} primitives | {len(materials)} materials')


if __name__ == '__main__':
    build_glb()
