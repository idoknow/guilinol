"""Build Guilin Elephant Trunk Hill (象鼻山景区: 象鼻 + 水月洞 + 普贤塔 + 岸边石栏杆 + 竹筏) for M2.6-D.

Hand-authored procedural GLB matching docs/style.md and docs/landmarks.md (Group D):
- Local origin (0, 0, 0) corresponds to peak center (-854.61, baseHeight 145.6, 1097.66), +X east, +Z south, +Y up (m).
  - Dry western/northern foot sits at y = 0.0 m (145.6 m ASL), with cliff skirt to y = -4.5 m (141.1 m ASL).
  - Li River (漓江) & Water-Moon Cave (水月洞) water plane sits at y = +2.10 m (147.7 m ASL).
  - Karst summit reaches y = +52.4 m (198.0 m ASL), crowned by Ming bottle-shaped brick Puxian Pagoda (普贤塔).
山脚 145.6 m、江面 147.7 m、山顶 198 m（docs/landmarks.md 与 peaks.json target）。锚点 OSM node/344461733。
拱洞与普贤塔发光面走材质 cave_lit（COLOR_0 × grain）。碰撞只留 coarsen 后的山体。
Usage: python pipeline/landmarks/elephant_hill.py <outdir>
"""
import json
import math
import struct
from pathlib import Path

import numpy as np

# Local Y of the 147.7 m ASL Li River surface relative to 145.6 m baseHeight
WATER_Y = 2.10
SKIRT_Y = -4.50
SUMMIT_Y = 52.40

# Clockwise spine rotation (+U points ESE ~14.9 deg) aligning the Water-Moon Cave channel (+V -> SSW)
# with the confluence bank & official viewing preset `elephant` (-740, 171, 868).
SPINE_ANGLE = 0.26
COS_A = math.cos(SPINE_ANGLE)
SIN_A = math.sin(SPINE_ANGLE)


def srgb_hex_to_linear(hex_val):
    srgb = [((hex_val >> shift) & 255) / 255.0 for shift in (16, 8, 0)]
    return np.array([c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb], dtype=np.float64)


PAL = {
    'foot':       srgb_hex_to_linear(0x5d6b3e),
    'green':      srgb_hex_to_linear(0x3a6334),
    'greenDark':  srgb_hex_to_linear(0x203d26),
    'greenLight': srgb_hex_to_linear(0x62873f),
    'rock':       srgb_hex_to_linear(0xbab8ae),
    'rockLight':  srgb_hex_to_linear(0xcac8be),
    'rockDark':   srgb_hex_to_linear(0x57544c),
    'rockDeep':   srgb_hex_to_linear(0x3e3c37),
    'ochre':      srgb_hex_to_linear(0x9f8b60),
    'wetRock':    srgb_hex_to_linear(0x494841),
    'brick':      srgb_hex_to_linear(0x76675a),
    'brickDark':  srgb_hex_to_linear(0x584c42),
    'brickLight': srgb_hex_to_linear(0x8e7d6e),
    'stoneBase':  srgb_hex_to_linear(0xb8b3a6),
    'stoneTrim':  srgb_hex_to_linear(0xd6d2c6),
    'stoneDeck':  srgb_hex_to_linear(0x9c988f),
    'spireGold':  srgb_hex_to_linear(0xb89448),
    'bamboo':     srgb_hex_to_linear(0xba9458),
    'bambooDark': srgb_hex_to_linear(0x846234),
    'canopyMat':  srgb_hex_to_linear(0xc7a56a),
    'redFlag':    srgb_hex_to_linear(0xb6362c),
}


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def hash2(x, z):
    v = math.sin(x * 12.9898 + z * 78.233) * 43758.5453
    return v - math.floor(v)


def value_noise2(x, z, cell):
    gx, gz = x / cell, z / cell
    ix, iz = math.floor(gx), math.floor(gz)
    fx, fz = gx - ix, gz - iz
    u = fx * fx * (3.0 - 2.0 * fx)
    v = fz * fz * (3.0 - 2.0 * fz)
    a = hash2(ix, iz) + (hash2(ix + 1, iz) - hash2(ix, iz)) * u
    b = hash2(ix, iz + 1) + (hash2(ix + 1, iz + 1) - hash2(ix, iz + 1)) * u
    return a + (b - a) * v


def lerp(a, b, t):
    return a + (b - a) * t


def uv_to_xz(u, v):
    return (u * COS_A - v * SIN_A, u * SIN_A + v * COS_A)


def paint_karst_face(centroid, normal, cave_vault=False):
    """Compute linear RGB matching docs/style.md karst cliff + continuous vertical water-stain runnels."""
    x, y, z = centroid
    nx, ny, nz = normal
    h_norm = float(np.clip((y - WATER_Y) / (SUMMIT_Y - WATER_Y), 0.0, 1.0))
    steep = 1.0 - abs(ny)

    # Canopy base color (2-scale clump noise matching web/src/peaks.ts)
    clump = value_noise2(x + y * 0.3, z - y * 0.3, 7.0) * 0.65 + value_noise2(x, z, 2.5) * 0.35
    veg = lerp(PAL['greenDark'], PAL['green'], smoothstep(0.20, 0.75, clump))
    veg = lerp(veg, PAL['greenLight'], smoothstep(0.60, 0.95, clump) * (0.35 + 0.45 * h_norm))
    veg = lerp(veg, PAL['foot'], (1.0 - smoothstep(0.02, 0.18, h_norm)) * 0.65)

    # Continuous vertical limestone water-stain streaks (水痕) coherent vertically so facets read as tall streaks
    s_coord = x * 0.22 + z * 0.19
    streak_broad = value_noise2(s_coord * 1.4, y * 0.025, 1.0)
    streak_fine = (math.sin(s_coord * 2.9 + math.sin(s_coord * 0.9) * 1.3) * 0.5 + 0.5) ** 2.1
    runnel = 0.55 * streak_broad + 0.45 * streak_fine

    strata = math.sin(y * 0.78 + value_noise2(x, z, 8.0) * 1.6)
    crevice = float(smoothstep(0.86, 0.99, abs(strata)))

    stone = lerp(PAL['rock'], PAL['rockLight'], smoothstep(0.48, 0.88, value_noise2(x, y * 0.6, 5.5)) * 0.42)
    stone = lerp(stone, PAL['ochre'], smoothstep(0.68, 0.93, value_noise2(x * 0.7, y * 0.35 + z * 0.35, 6.5)) * 0.32)
    stain_strength = runnel * (0.28 + 0.48 * (1.0 - smoothstep(0.08, 0.86, h_norm)))
    stone = lerp(stone, PAL['rockDark'], np.clip(stain_strength, 0.0, 0.80))
    stone = lerp(stone, PAL['rockDeep'], crevice * 0.28)

    # Waterline undercut darkening near 147.7 m water surface
    wet_band = 1.0 - smoothstep(0.0, 2.3, abs(y - (WATER_Y + 0.45)))
    stone = lerp(stone, PAL['wetRock'], wet_band * 0.52)

    if cave_vault:
        arch_band = (math.sin(z * 1.15 + y * 0.45) * 0.5 + 0.5) ** 1.8
        vault_col = lerp(PAL['rock'], PAL['rockDark'], 0.26 + 0.40 * arch_band)
        vault_col = lerp(vault_col, PAL['ochre'], 0.16 * (1.0 - h_norm))
        vault_col = lerp(vault_col, PAL['wetRock'], wet_band * 0.60)
        jitter = 1.0 + (hash2(x * 1.3, z * 1.3) - 0.5) * 0.05
        return np.clip(vault_col * jitter, 0.0, 1.0)

    rock_band = value_noise2(x * 0.28, z * 0.28 + y * 0.08, 3.6)
    bare = smoothstep(0.36, 0.68, steep + 0.16 * (1.0 - h_norm) + 0.12 * (rock_band - 0.5))
    if y < 25.0 and steep > 0.48:
        bare = max(bare, 0.88 - 0.16 * smoothstep(0.74, 0.95, clump))
    if ny > 0.72 and y > 24.0:
        bare *= 0.16

    col = lerp(veg, stone, np.clip(bare, 0.0, 1.0))
    jitter = 1.0 + (hash2(math.floor(x * 0.5), math.floor(z * 0.5)) - 0.5) * 0.05
    return np.clip(col * jitter, 0.0, 1.0)


class Collector:
    """Collect colored triangles with flat normals and per-vertex linear RGB."""

    def __init__(self):
        self.tris = []
        self.cols = []

    def add_tri(self, p0, p1, p2, col, col1=None, col2=None):
        a = np.asarray(p0, dtype=np.float64)
        b = np.asarray(p1, dtype=np.float64)
        c = np.asarray(p2, dtype=np.float64)
        n = np.cross(b - a, c - a)
        ln = np.linalg.norm(n)
        if ln <= 1e-8:
            return
        self.tris.append((a, b, c))
        if col1 is None:
            self.cols.append((col, col, col))
        else:
            self.cols.append((col, col1, col2))

    def add_karst_tri(self, p0, p1, p2, cave_vault=False):
        a = np.asarray(p0, dtype=np.float64)
        b = np.asarray(p1, dtype=np.float64)
        c = np.asarray(p2, dtype=np.float64)
        n = np.cross(b - a, c - a)
        ln = np.linalg.norm(n)
        if ln <= 1e-8:
            return
        n /= ln
        centroid = (a + b + c) / 3.0
        col = paint_karst_face(centroid, n, cave_vault=cave_vault)
        self.tris.append((a, b, c))
        self.cols.append((col, col, col))

    def add_quad(self, p0, p1, p2, p3, col):
        self.add_tri(p0, p1, p2, col)
        self.add_tri(p0, p2, p3, col)


def loft_karst_rings(geo: Collector, rings, cap_top=True, cave_vault=False):
    """Connect closed rings with outward-facing normals."""
    r_mid = rings[len(rings) // 2]
    cx = sum(p[0] for p in r_mid) / len(r_mid)
    cz = sum(p[2] for p in r_mid) / len(r_mid)
    p0, p1 = r_mid[0], r_mid[1]
    tx, tz = p1[0] - p0[0], p1[2] - p0[2]
    out_dot = (-tz) * (p0[0] - cx) + tx * (p0[2] - cz)
    ordered = [list(reversed(r)) for r in rings] if out_dot > 0 else rings

    n = len(ordered[0])
    for k in range(len(ordered) - 1):
        r0, r1 = ordered[k], ordered[k + 1]
        for i in range(n):
            j = (i + 1) % n
            geo.add_karst_tri(r0[i], r1[i], r1[j], cave_vault=cave_vault)
            geo.add_karst_tri(r0[i], r1[j], r0[j], cave_vault=cave_vault)

    if cap_top:
        top = ordered[-1]
        tc = np.mean(np.asarray(top), axis=0)
        tc[1] += 0.35
        for i in range(n):
            j = (i + 1) % n
            a, b = np.asarray(top[i]), np.asarray(top[j])
            if np.cross(b - a, tc - a)[1] >= 0:
                geo.add_karst_tri(a, b, tc)
            else:
                geo.add_karst_tri(b, a, tc)


# Body sits on the west bank. +X is east, into the Li River (OSM water begins near
# local x=72 at z=0 and x=64 at z=16). North (−Z) is the Taohua River mouth.
BODY_CX, BODY_CZ = -8.0, 2.0
RX_BODY, RZ_BODY = 58.0, 32.0


def body_vertex(ang, t):
    """Rounded hump: north crest is highest, south back falls away. t=0 foot, t=1 crown."""
    ca, sa = math.cos(ang), math.sin(ang)
    rib = 0.12 * math.sin(2.0 * ang + 0.5) + 0.07 * math.cos(5.0 * ang - 0.7) + 0.04 * math.sin(8.0 * ang)
    z_guess = BODY_CZ + RZ_BODY * sa
    north = smoothstep(24.0, -18.0, z_guess)
    # Steep lower cliff, then a round shoulder so the crest is a hump rather than a flat lid.
    if t < 0.40:
        rad = 1.0 - 0.06 * (t / 0.40)
    else:
        u = (t - 0.40) / 0.60
        rad = 0.94 * (math.cos(u * math.pi * 0.5) ** lerp(0.72, 0.95, north))
    hang = 0.20 * math.sin(3.0 * ang + 0.6) * (math.sin(t * math.pi) ** 0.85)
    hang -= 0.15 * max(0.0, math.cos(4.0 * ang - 1.1)) * smoothstep(0.12, 0.48, t) * (1.0 - smoothstep(0.78, 0.96, t))
    rad = max(0.06, rad * (1.0 + hang + rib * (1.0 - 0.4 * t)))
    x = BODY_CX + RX_BODY * ca * rad
    z = BODY_CZ + RZ_BODY * sa * (0.82 + 0.18 * rad) * (1.0 + 0.35 * rib)
    crest = lerp(22.0, SUMMIT_Y, smoothstep(30.0, -16.0, z) ** 0.85)
    if t <= 0.0:
        y = SKIRT_Y
    else:
        y = lerp(0.0, crest, math.sin(t * math.pi * 0.5) ** lerp(0.72, 1.05, 1.0 - north))
    # Walk-quick starts at local (−107, −2) heading (0.8, 0.6) and must meet rock near x=−80.5.
    h_prog = t
    z = max(z, -25.2 + h_prog * 3.0)
    toe = -80.5 + h_prog * 4.2
    if y < 9.0 and -8.0 < z < 26.0 and x < toe + 24.0:
        x = toe
    else:
        x = max(x, toe)
    return x, y, z


def build_main_body(geo: Collector):
    """Camel-back karst: high at the north head, falling south, with an irregular cliff."""
    segs = 42
    levels = 13
    rings = []
    peak = (BODY_CX, 0.0, BODY_CZ)
    for level in range(levels):
        t = 0.0 if level == 0 else level / (levels - 1)
        ring = []
        for i in range(segs):
            x, y, z = body_vertex(2.0 * math.pi * i / segs, t)
            ring.append((x, y, z))
            if y > peak[1]:
                peak = (x, y, z)
        rings.append(ring)
    loft_karst_rings(geo, rings, cap_top=True)
    return peak


def build_trunk_and_water_moon_cave(geo: Collector):
    """Ridge from the hillside out to a round arch standing in the Li River.

    Rendered water (clearance probe) starts near local x=120 for z=0..16. The open
    span is x=126..150, z=2..15, feet below the waterline, no floor and no end cap.
    The east pier is the trunk: the arch spring itself, narrowing into the water.
    """
    def shoulder_ring(t):
        cx = lerp(46.0, 120.0, t)
        cz = 7.4
        half_w = lerp(9.0, 6.8, t)
        top = lerp(27.0, 16.5, t)
        ring = []
        for k in range(12):
            a = math.pi * k / 11.0
            z = cz + half_w * math.cos(a)
            y = 0.4 + (top - 0.4) * (math.sin(a) ** 0.82)
            x = cx + 2.4 * math.sin(a)
            ring.append((x, y, z))
        ring.append((cx - 1.2, 0.35, cz - half_w * 0.6))
        ring.append((cx - 1.2, 0.35, cz + half_w * 0.6))
        return ring

    loft_karst_rings(geo, [shoulder_ring(i / 7.0) for i in range(8)], cap_top=False)

    def vault_ring(z):
        phase = (z - 8.0) * 0.35
        inner = []
        for k in range(9):
            a = math.pi * (1.0 - k / 8.0)
            wobble = 1.0 + 0.04 * math.sin(3.0 * a + phase)
            x = 138.0 + 12.0 * math.cos(a) * wobble
            y = (WATER_Y - 1.6) + 14.8 * math.sin(a)
            inner.append((x, y, z))
        outer = []
        for k in range(9):
            a = math.pi * (k / 8.0)
            wobble = 1.0 + 0.05 * math.cos(2.0 * a - phase)
            # East spring (the trunk) reaches a little further and lower than the west pier.
            east = max(0.0, math.cos(a))
            x = 136.0 + (17.5 + 4.5 * east) * math.cos(a) * wobble
            y = (WATER_Y - 2.6) + (19.0 - 3.0 * east) * math.sin(a)
            if east > 0.65:
                y = min(y, lerp(WATER_Y - 1.2, -3.2, (east - 0.65) / 0.35))
            outer.append((x, y, z))
        return inner + outer

    loft_karst_rings(
        geo,
        [vault_ring(2.0 + 13.0 * i / 10.0) for i in range(11)],
        cap_top=False,
        cave_vault=True,
    )


def add_foliage_clump(geo: Collector, cx, cy, cz, rx, ry, rz, seed=0.0):
    """Low-poly icosahedron broadleaf shrub/tree crown matching web/src/look/trees.ts."""
    phi = (1.0 + math.sqrt(5.0)) * 0.5
    base_verts = np.array([
        [-1,  phi, 0], [ 1,  phi, 0], [-1, -phi, 0], [ 1, -phi, 0],
        [ 0, -1,  phi], [ 0,  1,  phi], [ 0, -1, -phi], [ 0,  1, -phi],
        [ phi, 0, -1], [ phi, 0,  1], [-phi, 0, -1], [-phi, 0,  1],
    ], dtype=np.float64)
    base_verts /= np.linalg.norm(base_verts[0])
    faces = [
        (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
        (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
        (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
        (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
    ]
    cy_cos, cy_sin = math.cos(seed), math.sin(seed)
    verts = []
    for vx, vy, vz in base_verts:
        j = 1.0 + 0.14 * math.sin(vx * 3.1 + vy * 2.7 + seed * 4.3)
        rx_v = (vx * cy_cos - vz * cy_sin) * rx * j
        rz_v = (vx * cy_sin + vz * cy_cos) * rz * j
        ry_v = vy * ry * j
        verts.append(np.array([cx + rx_v, cy + ry_v, cz + rz_v]))

    y_min = min(v[1] for v in verts)
    y_max = max(v[1] for v in verts)
    tint = 0.92 + 0.16 * hash2(cx + seed, cz - seed)
    for i0, i1, i2 in faces:
        p0, p1, p2 = verts[i0], verts[i1], verts[i2]
        ym = (p0[1] + p1[1] + p2[1]) / 3.0
        t = float(np.clip((ym - y_min) / max(0.05, y_max - y_min), 0.0, 1.0))
        col = lerp(PAL['greenDark'], PAL['green'], t * 2.0) if t < 0.5 else lerp(PAL['green'], PAL['greenLight'], (t - 0.5) * 2.0)
        geo.add_tri(p0, p1, p2, np.clip(col * tint, 0.0, 1.0))


def build_draped_canopy(geo: Collector):
    """Clustered broadleaf crowns down the upper slopes. Lower cliff and the trunk face stay bare rock."""
    for i in range(96):
        ang = (i * 2.399963) % (2.0 * math.pi)
        t = 0.30 + 0.64 * (((i * 5) % 13) / 12.0)
        x, y, z = body_vertex(ang, t)
        ox, oz = x - BODY_CX, z - BODY_CZ
        reach = math.hypot(ox, oz) or 1.0
        x += ox / reach * 2.8
        z += oz / reach * 1.8
        if x > 108.0 or y < 9.0:
            continue
        scale = 0.85 + 0.7 * ((i * 3) % 5) / 4.0
        rx = 3.6 * scale
        ry = 2.5 * scale
        rz = 3.3 * scale
        add_foliage_clump(geo, x, y + ry * 0.28, z, rx, ry, rz, seed=i * 0.73)
        if i % 2 == 0:
            add_foliage_clump(geo, x + 2.4 * math.cos(ang), y + ry * 0.05, z + 1.8 * math.sin(ang),
                              rx * 0.7, ry * 0.66, rz * 0.7, seed=i * 1.17 + 2.0)
    # Crowns along the rock shoulder that runs out to the cave, stopping short of the bare trunk.
    for i in range(9):
        t = i / 8.0
        if t > 0.62:
            continue
        x = lerp(50.0, 108.0, t)
        y = lerp(28.0, 17.0, t)
        z = 7.5 + 2.4 * math.sin(t * 4.0)
        scale = 1.15 - 0.35 * t
        add_foliage_clump(geo, x, y, z, 4.2 * scale, 2.6 * scale, 3.6 * scale, seed=3.0 + i)


def add_prism_frustum(geo: Collector, cx, cz, r0, r1, y0, y1, sides, col, yaw=0.0, cap_top=True, cap_bottom=False):
    pts0, pts1 = [], []
    for i in range(sides):
        a = yaw + 2.0 * math.pi * i / sides
        ca, sa = math.cos(a), math.sin(a)
        pts0.append((cx + r0 * ca, y0, cz + r0 * sa))
        pts1.append((cx + r1 * ca, y1, cz + r1 * sa))
    for i in range(sides):
        j = (i + 1) % sides
        geo.add_tri(pts0[i], pts1[i], pts1[j], col)
        geo.add_tri(pts0[i], pts1[j], pts0[j], col)
    if cap_top and r1 > 1e-4:
        tc = (cx, y1, cz)
        for i in range(sides):
            j = (i + 1) % sides
            geo.add_tri(pts1[j], pts1[i], tc, col)
    if cap_bottom and r0 > 1e-4:
        bc = (cx, y0, cz)
        for i in range(sides):
            j = (i + 1) % sides
            geo.add_tri(pts0[i], pts0[j], bc, col)


def build_puxian_pagoda(geo: Collector):
    """Build Ming bottle-shaped brick Puxian Pagoda (普贤塔) on the summit shoulder (04-2024.jpg)."""
    # North crest of the hump (象头), not the flat middle of the old drum.
    px, _y, pz = body_vertex(math.pi * 1.15, 0.92)
    y_base = _y - 1.4

    oct_yaw = math.pi / 8.0
    add_prism_frustum(geo, px, pz, 3.85, 3.65, y_base - 1.8, y_base + 1.15, 8, PAL['stoneBase'], oct_yaw)
    add_prism_frustum(geo, px, pz, 3.82, 3.82, y_base + 1.15, y_base + 1.42, 8, PAL['stoneTrim'], oct_yaw)
    add_prism_frustum(geo, px, pz, 3.25, 3.05, y_base + 1.42, y_base + 2.35, 8, PAL['brickDark'], oct_yaw)
    add_prism_frustum(geo, px, pz, 3.28, 3.18, y_base + 2.35, y_base + 2.62, 8, PAL['stoneBase'], oct_yaw)

    vase_profile = [
        (2.62, 2.55, PAL['brickDark']),
        (3.15, 2.22, PAL['brick']),
        (3.75, 2.48, PAL['brickLight']),
        (4.55, 2.78, PAL['brick']),
        (5.45, 2.92, PAL['brickDark']),
        (6.35, 2.86, PAL['brick']),
        (7.20, 2.64, PAL['brickLight']),
        (7.95, 2.30, PAL['brick']),
        (8.60, 1.92, PAL['brickDark']),
        (9.15, 1.78, PAL['brick']),
    ]
    sides = 14
    for k in range(len(vase_profile) - 1):
        dy0, r0, col = vase_profile[k]
        dy1, r1, _ = vase_profile[k + 1]
        add_prism_frustum(geo, px, pz, r0, r1, y_base + dy0, y_base + dy1, sides, col, cap_top=False)

    yc = y_base + 9.15
    for r_eave in [2.22, 2.04, 1.84, 1.62, 1.38]:
        add_prism_frustum(geo, px, pz, r_eave * 0.84, r_eave, yc, yc + 0.22, sides, PAL['brickDark'], cap_top=False)
        add_prism_frustum(geo, px, pz, r_eave, r_eave * 0.92, yc + 0.22, yc + 0.44, sides, PAL['brickLight'], cap_top=True)
        add_prism_frustum(geo, px, pz, r_eave * 0.76, r_eave * 0.76, yc + 0.44, yc + 0.56, sides, PAL['brickDark'], cap_top=False)
        yc += 0.56

    add_prism_frustum(geo, px, pz, 1.42, 1.05, yc, yc + 0.42, 12, PAL['stoneTrim'], cap_top=True)
    add_prism_frustum(geo, px, pz, 0.78, 0.36, yc + 0.42, yc + 0.95, 10, PAL['stoneBase'], cap_top=True)
    add_prism_frustum(geo, px, pz, 0.34, 0.08, yc + 0.95, yc + 1.55, 8, PAL['spireGold'], cap_top=True)
    add_prism_frustum(geo, px, pz, 0.05, 0.015, yc + 1.55, yc + 2.55, 6, PAL['spireGold'], cap_top=True)
    return (px, y_base + 6.5, pz)


def add_oriented_box(geo: Collector, cx, y0, cz, sx, sy, sz, yaw, col, cap_bottom=False):
    ca, sa = math.cos(yaw), math.sin(yaw)
    hx, hz = sx * 0.5, sz * 0.5
    corners = [(-hx, -hz), (-hx, hz), (hx, hz), (hx, -hz)]
    bot = [(cx + lx * ca - lz * sa, y0, cz + lx * sa + lz * ca) for lx, lz in corners]
    top = [(x, y0 + sy, z) for x, _, z in bot]
    for i in range(4):
        j = (i + 1) % 4
        geo.add_quad(bot[i], bot[j], top[j], top[i], col)
    geo.add_quad(top[0], top[1], top[2], top[3], col)
    if cap_bottom:
        geo.add_quad(bot[0], bot[3], bot[2], bot[1], col)


def add_balustrade_chain(geo: Collector, pts, y_deck, post_spacing=2.8):
    rail_h = 1.02
    for idx in range(len(pts) - 1):
        ax, az = pts[idx]
        bx, bz = pts[idx + 1]
        seg_len = math.hypot(bx - ax, bz - az)
        if seg_len < 0.3:
            continue
        yaw = math.atan2(bz - az, bx - ax)
        steps = max(1, round(seg_len / post_spacing))
        for s in range(steps):
            t0, t1 = s / steps, (s + 1) / steps
            x0, z0 = lerp(ax, bx, t0), lerp(az, bz, t0)
            x1, z1 = lerp(ax, bx, t1), lerp(az, bz, t1)
            mx, mz = 0.5 * (x0 + x1), 0.5 * (z0 + z1)
            slen = math.hypot(x1 - x0, z1 - z0)
            add_oriented_box(geo, x0, y_deck, z0, 0.22, rail_h, 0.22, yaw, PAL['stoneTrim'])
            add_prism_frustum(geo, x0, z0, 0.14, 0.04, y_deck + rail_h, y_deck + rail_h + 0.14, 4, PAL['stoneTrim'], yaw + math.pi / 4)
            add_oriented_box(geo, mx, y_deck + rail_h - 0.14, mz, slen, 0.11, 0.13, yaw, PAL['stoneTrim'], cap_bottom=True)
            add_oriented_box(geo, mx, y_deck + 0.02, mz, slen, 0.14, 0.15, yaw, PAL['stoneTrim'])
            add_oriented_box(geo, mx, y_deck + 0.20, mz, slen * 0.88, rail_h - 0.38, 0.07, yaw, PAL['stoneBase'], cap_bottom=True)
        if idx == len(pts) - 2:
            add_oriented_box(geo, bx, y_deck, bz, 0.22, rail_h, 0.22, yaw, PAL['stoneTrim'])
            add_prism_frustum(geo, bx, bz, 0.14, 0.04, y_deck + rail_h, y_deck + rail_h + 0.14, 4, PAL['stoneTrim'], yaw + math.pi / 4)


def add_bamboo_raft(geo: Collector, cx, cz, yaw):
    """Guilin sightseeing bamboo raft (竹筏) floating at WATER_Y (147.7 m ASL), matching 00-2025.jpg."""
    y0 = WATER_Y - 0.06
    ca, sa = math.cos(yaw), math.sin(yaw)

    def to_w(lx, ly, lz):
        return (cx + lx * ca - lz * sa, ly, cz + lx * sa + lz * ca)

    for b_idx in range(6):
        lz = -0.95 + b_idx * 0.38
        add_oriented_box(geo, *to_w(-0.2, y0, lz), 5.6, 0.16, 0.22, yaw, PAL['bamboo'])
        bx, _, bz = to_w(2.85, y0 + 0.12, lz)
        add_oriented_box(geo, bx, y0 + 0.08, bz, 0.85, 0.15, 0.20, yaw, PAL['bamboo'])

    for lx in (-2.4, -0.8, 0.8, 2.2):
        px, _, pz = to_w(lx, y0 + 0.15, 0.0)
        add_oriented_box(geo, px, y0 + 0.15, pz, 0.16, 0.08, 2.15, yaw, PAL['bambooDark'])

    cabin_y = y0 + 0.22
    for lx in (-1.45, 1.15):
        for lz in (-0.82, 0.82):
            px, _, pz = to_w(lx, cabin_y, lz)
            add_oriented_box(geo, px, cabin_y, pz, 0.10, 1.55, 0.10, yaw, PAL['bambooDark'])
    for lz in (-0.82, 0.82):
        px, _, pz = to_w(-0.15, cabin_y + 0.55, lz)
        add_oriented_box(geo, px, cabin_y + 0.55, pz, 2.7, 0.08, 0.08, yaw, PAL['bamboo'])
    for lx in (-0.75, 0.45):
        px, _, pz = to_w(lx, cabin_y + 0.32, 0.0)
        add_oriented_box(geo, px, cabin_y + 0.32, pz, 0.48, 0.10, 1.45, yaw, PAL['bambooDark'], cap_bottom=True)

    roof_y = cabin_y + 1.55
    p_nw = to_w(-1.65, roof_y, -0.96)
    p_ne = to_w( 1.35, roof_y, -0.96)
    p_mw = to_w(-1.65, roof_y + 0.26, 0.0)
    p_me = to_w( 1.35, roof_y + 0.26, 0.0)
    p_sw = to_w(-1.65, roof_y,  0.96)
    p_se = to_w( 1.35, roof_y,  0.96)
    geo.add_quad(p_nw, p_ne, p_me, p_mw, PAL['canopyMat'])
    geo.add_quad(p_mw, p_me, p_se, p_sw, PAL['canopyMat'])
    geo.add_quad(p_ne, p_nw, p_mw, p_me, PAL['bambooDark'])
    geo.add_quad(p_se, p_me, p_mw, p_sw, PAL['bambooDark'])

    fx0 = to_w(2.55, cabin_y + 0.9, -0.78)
    fx1 = to_w(2.55, cabin_y + 1.85, -0.78)
    fx2 = to_w(2.05, cabin_y + 1.62, -0.78)
    geo.add_tri(fx0, fx1, fx2, PAL['redFlag'])
    geo.add_tri(fx0, fx2, fx1, PAL['redFlag'])


def build_shore_balustrade(geo: Collector):
    """Build riverside stone balustrade & elephant statue seated cleanly on the dry northern shoreline (01-2024.jpg)."""
    # Seated along the dry bank edge (dz in [-26.5..-29.5], dx in [-50..+12]) facing the confluence & Water-Moon Cave
    terrace_y = WATER_Y + 0.32
    shore_pts = [
        (-50.0, -26.2),
        (-34.0, -27.4),
        (-18.0, -28.6),
        ( -3.0, -29.2),
        ( 11.5, -28.4),
    ]
    for i in range(len(shore_pts) - 1):
        ax, az = shore_pts[i]
        bx, bz = shore_pts[i + 1]
        mx, mz = 0.5 * (ax + bx), 0.5 * (az + bz)
        yaw = math.atan2(bz - az, bx - ax)
        slen = math.hypot(bx - ax, bz - az) + 0.35
        add_oriented_box(geo, mx, SKIRT_Y, mz + 1.5, slen, terrace_y - SKIRT_Y, 3.4, yaw, PAL['stoneDeck'])
    add_balustrade_chain(geo, shore_pts, y_deck=terrace_y, post_spacing=2.8)

    # White-stone elephant sculpture on plinth along the riverside promenade (docs/landmarks.md)
    sx, sz = -10.5, -27.5
    add_oriented_box(geo, sx, terrace_y, sz, 1.5, 0.65, 1.0, 0.12, PAL['stoneBase'])
    add_oriented_box(geo, sx, terrace_y + 0.65, sz, 1.15, 0.78, 0.68, 0.12, PAL['stoneTrim'])
    add_oriented_box(geo, sx + 0.62, terrace_y + 0.82, sz + 0.08, 0.52, 0.58, 0.52, 0.12, PAL['stoneTrim'])
    add_oriented_box(geo, sx + 0.92, terrace_y + 0.42, sz + 0.12, 0.20, 0.72, 0.20, 0.12, PAL['stoneTrim'])


def build_rafts(geo: Collector):
    """Three Guilin sightseeing bamboo rafts floating on the 147.7 m Li River mirror."""
    # In the river: one north of the cave mouth, one in front of the arch, one south of the trunk.
    for rx, rz, ryaw in (
        (134.0, -14.0, 0.3),
        (152.0, 20.0, 1.4),
        (118.0, 24.0, 2.0),
    ):
        add_bamboo_raft(geo, rx, rz, ryaw)


def build_glb():
    import sys
    from pathlib import Path
    cliff = Collector()
    build_main_body(cliff)
    build_trunk_and_water_moon_cave(cliff)
    pagoda = np.array(build_puxian_pagoda(cliff))
    build_shore_balustrade(cliff)
    decor = Collector()
    build_draped_canopy(decor)
    build_rafts(decor)
    tris = np.concatenate([np.asarray(cliff.tris, dtype=np.float64), np.asarray(decor.tris, dtype=np.float64)])
    cols = np.concatenate([np.asarray(cliff.cols, dtype=np.float64), np.asarray(decor.cols, dtype=np.float64)])
    cave = np.array([138.0, WATER_Y + 8.0, 8.0])
    center = tris.mean(axis=1)
    lit = np.linalg.norm(center - cave, axis=1) < 15.5
    lit |= np.linalg.norm(center - pagoda, axis=1) < 5.5
    from d_export import coarsen, export_colored
    shell = coarsen(np.asarray(cliff.tris, dtype=np.float64), cell=3.4, limit=0.12)
    export_colored(Path(sys.argv[1]) / 'elephant_hill.glb', tris, cols, shell, lit)


if __name__ == '__main__':
    build_glb()
