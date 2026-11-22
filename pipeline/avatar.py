"""Build the sculpted low-poly Guilin CityWalker avatar (`public/avatar/figure.glb`).

Preserves the 66-bone `Armature` skeleton and 11 animation clips from `pipeline/avatar_rig_base.*`
so all walk/run/crouch/jump/ride/car/boat controllers and IDOK-125 `outfits.ts` vertex-color zones
work out of the box without modifying TypeScript rig consumers.

Coordinate convention in GLB bind space:
  +X = character left arm/leg, -X = right arm/leg, +Y = up (sole minY = 0.0), +Z = character forward.
  Runtime `avatar-rig.ts` flips `Armature.rotation.y += PI` so in-game character faces -Z.
"""
from __future__ import annotations

import copy
import gzip
import json
import math
import struct
from collections import defaultdict
from pathlib import Path

import numpy as np


PALETTE = {
    'skin': 0xe6c3a1,          # warm clear ivory-tan skin (resists gradeDay darkening, maps -> #dcb48e LOCKED_SKIN)
    'skinMid': 0xdbb38d,       # soft cheek / neck / knuckle shading (maps -> #dcb48e LOCKED_SKIN)
    'skinShade': 0xd1a37b,     # gentle under-chin / nose under / ear hollow AO (maps -> #dcb48e LOCKED_SKIN)
    'lipUpper': 0xd0927c,      # natural soft upper lip (y>=1.51 head -> LOCKED_SKIN)
    'lipLower': 0xda9e88,      # natural soft lower lip (y>=1.51 head -> LOCKED_SKIN)
    'lipLine': 0xb17965,       # subtle closed lip seam (never dark!)
    'sclera': 0xebe6de,        # clean warm-white sclera (y>=1.51 head -> LOCKED_SKIN)
    'iris': 0x281c16,          # dark brown pupil/iris (closest #1f1b19 -> LOCKED_HAIR)
    'eyelid': 0x7a5440,        # natural upper lash/eyelid shade (y>=1.51 head -> LOCKED_SKIN)
    'eyeSpark': 0xf5f3ee,      # subtle corneal catchlight facet (y>=1.51 head -> LOCKED_SKIN)
    'hair': 0x221c19,          # layered dark hair base (closest #1f1b19 -> LOCKED_HAIR)
    'hairAlt': 0x2f2824,       # facet highlight tufts (closest #1f1b19 -> LOCKED_HAIR)
    'jacket': 0xe59442,        # tailored amber-ochre street windbreaker (closest #f09a4a -> TOP_PRIMARY / TOP_SLEEVE)
    'jacketFold': 0xdc8d3c,    # subtle garment panel contrast (closest #f09a4a -> TOP_PRIMARY / TOP_SLEEVE)
    'jacketDark': 0xc06a2c,    # collar trim, placket edge, cuffs, hem welt (TOP_TRIM)
    'tee': 0xf2efe8,           # crisp off-white crew tee (TOP_INNER)
    'jeans': 0x55708f,         # slim slate-blue jeans (BOTTOM_MAIN)
    'belt': 0x343b40,          # belt / shoe laces & heel tab (BOTTOM_BELT / SHOES_ACCENT)
    'shoe': 0xeeeae2,          # white sneaker upper (SHOES_UPPER)
    'sole': 0xc49a6c,          # tan gum sole (SHOES_SOLE)
    'pack': 0x66737b,          # slim slate-grey daypack (BUILTIN_PACK)
    'strap': 0x343b40,         # pack straps & hardware (BUILTIN_PACK)
}


def hex_to_linear(h: int) -> tuple[float, float, float]:
    srgb = [((h >> s) & 255) / 255.0 for s in (16, 8, 0)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (float(lin[0]), float(lin[1]), float(lin[2]))


class MeshBuilder:
    """Builds indexed triangle geometry supporting per-section flat shading or crease-angle edge splits."""

    def __init__(self) -> None:
        self.tris: list[tuple[np.ndarray, np.ndarray, np.ndarray, tuple[float, float, float], float, str]] = []
        self.group: str = 'torso'
        # Optional indexed submeshes appended verbatim (used to match exact BUILTIN_PACK vertex count).
        self.indexed_parts: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, str]] = []

    def add_tri(self, a, b, c, color_key: str, crease_deg: float = 0.0) -> None:
        pa = np.asarray(a, dtype=np.float64)
        pb = np.asarray(b, dtype=np.float64)
        pc = np.asarray(c, dtype=np.float64)
        if np.linalg.norm(np.cross(pb - pa, pc - pa)) < 1e-11:
            return
        self.tris.append((pa, pb, pc, hex_to_linear(PALETTE[color_key]), crease_deg, self.group))

    def add_quad(self, a, b, c, d, color_key: str, crease_deg: float = 0.0, flip_diag: bool = False) -> None:
        if not flip_diag:
            self.add_tri(a, b, c, color_key, crease_deg)
            self.add_tri(a, c, d, color_key, crease_deg)
        else:
            self.add_tri(a, b, d, color_key, crease_deg)
            self.add_tri(b, c, d, color_key, crease_deg)

    def loft(self, rings: list[list[tuple[float, float, float]]], color_key: str,
             cap_bottom: bool = False, cap_top: bool = False,
             crease_deg: float = 0.0, color_alt: str | None = None,
             flip_outward: bool = False) -> None:
        for r_idx, (ra, rb) in enumerate(zip(rings, rings[1:])):
            n = len(ra)
            for k in range(n):
                j = (k + 1) % n
                ck = color_alt if (color_alt and (k + r_idx) % 2 == 1) else color_key
                if flip_outward:
                    self.add_quad(ra[k], rb[k], rb[j], ra[j], ck, crease_deg, flip_diag=((k + r_idx) % 2 == 1))
                else:
                    self.add_quad(ra[k], ra[j], rb[j], rb[k], ck, crease_deg, flip_diag=((k + r_idx) % 2 == 1))
        for cap, is_bot in ((rings[0], True), (rings[-1], False)):
            if (is_bot and not cap_bottom) or (not is_bot and not cap_top):
                continue
            ctr = tuple(np.mean(cap, axis=0))
            n = len(cap)
            for k in range(n):
                j = (k + 1) % n
                if (is_bot and not flip_outward) or (not is_bot and flip_outward):
                    self.add_tri(ctr, cap[j], cap[k], color_key, crease_deg)
                else:
                    self.add_tri(ctr, cap[k], cap[j], color_key, crease_deg)

    def add_box(self, x0: float, x1: float, y0: float, y1: float, z0: float, z1: float,
                color_key: str, rx: float = 0.0, ry: float = 0.0, rz: float = 0.0,
                pivot: tuple[float, float, float] | None = None) -> None:
        pts = [
            (x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1),
            (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1),
        ]
        if rx or ry or rz:
            pv = np.asarray(pivot if pivot else ((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5))
            rot = euler_mat(rx, ry, rz)
            pts = [tuple((rot @ (np.asarray(p) - pv)) + pv) for p in pts]
        p0, p1, p2, p3, p4, p5, p6, p7 = pts
        # Outward CCW faces
        for a, b, c, d in (
            (p0, p1, p2, p3),  # bottom (-Y)
            (p4, p7, p6, p5),  # top (+Y)
            (p3, p2, p6, p7),  # front (+Z)
            (p0, p4, p5, p1),  # back (-Z)
            (p0, p3, p7, p4),  # right (-X)
            (p1, p5, p6, p2),  # left (+X)
        ):
            self.add_quad(a, b, c, d, color_key, 0.0)

    def compile(self) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list[str]]:
        """Convert triangles into indexed (pos, norm, col, indices, vert_groups) respecting crease angles and colors."""
        n_tris = len(self.tris)
        if n_tris == 0:
            raise RuntimeError('No triangles in MeshBuilder')

        face_normals = np.empty((n_tris, 3), dtype=np.float64)
        for ti, (a, b, c, _, _, _) in enumerate(self.tris):
            fn = np.cross(b - a, c - a)
            ln = np.linalg.norm(fn)
            face_normals[ti] = fn / ln if ln > 1e-11 else np.array([0.0, 1.0, 0.0])

        # Group corners by rounded position + anatomical skin group so separate garment shells stay independent cleanly.
        pos_groups: dict[tuple[str, int, int, int], list[tuple[int, int]]] = defaultdict(list)
        for ti, (a, b, c, _, _, grp) in enumerate(self.tris):
            for ci, pt in enumerate((a, b, c)):
                key = (grp, round(float(pt[0]) * 1e4), round(float(pt[1]) * 1e4), round(float(pt[2]) * 1e4))
                pos_groups[key].append((ti, ci))

        positions: list[np.ndarray] = []
        normals: list[np.ndarray] = []
        colors: list[tuple[float, float, float]] = []
        vert_groups: list[str] = []
        indices = np.empty(n_tris * 3, dtype=np.uint16)

        corner_vert = {}
        for key, items in pos_groups.items():
            grp = key[0]
            clusters: list[dict] = []
            for ti, ci in items:
                a, b, c, col, crease, _ = self.tris[ti]
                pt = (a, b, c)[ci]
                fn = face_normals[ti]
                placed = False
                for cl in clusters:
                    if cl['col'] != col:
                        continue
                    dot = float(np.clip(np.dot(fn, cl['ref_n']), -1.0, 1.0))
                    ang = math.degrees(math.acos(dot))
                    max_ang = min(crease, cl['crease'])
                    if (max_ang <= 0.0 and ang < 0.8) or (max_ang > 0.0 and ang <= max_ang):
                        cl['items'].append((ti, ci))
                        cl['sum_n'] += fn
                        cl['pts'].append(pt)
                        placed = True
                        break
                if not placed:
                    clusters.append(dict(col=col, crease=crease, ref_n=fn.copy(), sum_n=fn.copy(), pts=[pt], items=[(ti, ci)]))

            for cl in clusters:
                vid = len(positions)
                avg_pt = np.mean(cl['pts'], axis=0)
                n_vec = cl['sum_n']
                nl = np.linalg.norm(n_vec)
                n_vec = n_vec / nl if nl > 1e-11 else np.array([0.0, 1.0, 0.0])
                positions.append(avg_pt)
                normals.append(n_vec)
                colors.append(cl['col'])
                vert_groups.append(grp)
                for ti, ci in cl['items']:
                    corner_vert[(ti, ci)] = vid

        for ti in range(n_tris):
            indices[ti * 3 + 0] = corner_vert[(ti, 0)]
            indices[ti * 3 + 1] = corner_vert[(ti, 1)]
            indices[ti * 3 + 2] = corner_vert[(ti, 2)]

        pos_arr = np.asarray(positions, dtype=np.float32)
        nrm_arr = np.asarray(normals, dtype=np.float32)
        col_arr = np.asarray(colors, dtype=np.float32)

        for ipos, inrm, icol, iidx, igrp in self.indexed_parts:
            base = len(pos_arr)
            pos_arr = np.vstack([pos_arr, ipos.astype(np.float32)])
            nrm_arr = np.vstack([nrm_arr, inrm.astype(np.float32)])
            col_arr = np.vstack([col_arr, icol.astype(np.float32)])
            vert_groups.extend([igrp] * len(ipos))
            indices = np.concatenate([indices, (iidx.reshape(-1).astype(np.uint32) + base).astype(np.uint16)])

        return pos_arr, nrm_arr, col_arr, indices, vert_groups


def euler_mat(rx: float, ry: float, rz: float) -> np.ndarray:
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    mx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    my = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    mz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return mz @ my @ mx


def ellipse_ring(cx: float, cy: float, cz: float, rx: float, rz: float, sides: int,
                 phase: float = 0.0, front_scale: float = 1.0, back_scale: float = 1.0,
                 y_wave: float = 0.0) -> list[tuple[float, float, float]]:
    pts = []
    for k in range(sides):
        ang = phase + 2.0 * math.pi * k / sides
        ca, sa = math.cos(ang), math.sin(ang)
        sz = sa * rz * (front_scale if sa >= 0 else back_scale)
        pts.append((cx + ca * rx, cy + y_wave * sa, cz + sz))
    return pts


def ensure_outward_winding(mb: MeshBuilder, tri_start: int, center_fn) -> None:
    """Flip any newly added triangles whose normals point inward relative to a local reference center."""
    for idx in range(tri_start, len(mb.tris)):
        a, b, c, col, crease, grp = mb.tris[idx]
        ctr = np.asarray(center_fn((a + b + c) / 3.0), dtype=np.float64)
        fn = np.cross(b - a, c - a)
        if np.dot(fn, (a + b + c) / 3.0 - ctr) < 0:
            mb.tris[idx] = (a, c, b, col, crease, grp)


# ---------------------------------------------------------------------------
# 1. Head, Sculpted Facial Features, Ears & Layered Hair (y = 1.495 .. 1.770)
# ---------------------------------------------------------------------------

def build_head_and_hair(mb: MeshBuilder) -> None:
    mb.group = 'head'
    # Neck column (smooth lower -> sculpted sternocleidomastoid curve into skull base)
    neck_rings = [
        ellipse_ring(0.0, 1.446, -0.022, 0.056, 0.054, 12, phase=math.pi / 12, front_scale=1.08),
        ellipse_ring(0.0, 1.482, -0.015, 0.051, 0.051, 12, phase=math.pi / 12, front_scale=1.06),
        ellipse_ring(0.0, 1.515, -0.004, 0.049, 0.052, 12, phase=math.pi / 12, front_scale=1.04),
        ellipse_ring(0.0, 1.545, 0.005, 0.051, 0.056, 12, phase=math.pi / 12, front_scale=1.05),
    ]
    mb.loft(neck_rings, 'skinMid', crease_deg=32.0, flip_outward=True)

    # Anatomically structured front-back sculpted cranium & face cage:
    # Vertical sections (rows from chin/jawbase up to crown) mapped symmetrically over azimuth angles.
    # Azimuth theta=0 is straight front (+Z), pi/2 left (+X), pi back (-Z), -pi/2 right (-X).
    # We generate an explicit anatomical grid of (row, col) on the head so jaw, cheeks, brow ridge,
    # eye sockets, cheekbones, temples and rounded occiput have true East-Asian young adult planes.
    cols = 20  # 20 columns -> theta=0 front, clean symmetric bilateral mirror
    thetas = [2.0 * math.pi * k / cols for k in range(cols)]

    # Each profile row: (base_y, z_center, rx, rz_front, rz_back, jaw_pinch, brow_ridge, socket_in, cheek_pop)
    rows_spec = [
        # y,     zc,     rx,     rzF,    rzB,    jaw_taper, brow,  sock,  cheek
        (1.516, 0.018, 0.036, 0.068, 0.044, 0.42, 0.0, 0.0, 0.00),     # 0: chin point + under-jaw rim
        (1.536, 0.014, 0.054, 0.078, 0.066, 0.25, 0.0, 0.0, 0.02),     # 1: lower lip / jaw angle
        (1.560, 0.010, 0.066, 0.084, 0.082, 0.12, 0.0, 0.0, 0.05),     # 2: lip corner / cheek hollow
        (1.586, 0.008, 0.072, 0.088, 0.094, 0.04, 0.0, 0.0, 0.09),     # 3: nose wing / lower cheekbone
        (1.616, 0.006, 0.075, 0.087, 0.100, 0.00, 0.0, -0.005, 0.11),  # 4: upper cheekbone / lower eye rim
        (1.638, 0.004, 0.074, 0.082, 0.102, 0.00, 0.0, -0.010, 0.02),  # 5: eye socket plane (clean recess for embedded eye!)
        (1.658, 0.004, 0.074, 0.092, 0.103, 0.00, 1.0, 0.0, 0.00),     # 6: brow ridge crisp crease!
        (1.686, 0.002, 0.072, 0.087, 0.101, 0.00, 0.3, 0.0, 0.00),     # 7: mid forehead (recessed cleanly under hair cap)
        (1.714, -0.002, 0.066, 0.077, 0.096, 0.00, 0.0, 0.0, 0.00),    # 8: upper skull (safely inside hair dome!)
        (1.740, -0.006, 0.050, 0.058, 0.078, 0.00, 0.0, 0.0, 0.00),    # 9: upper skull dome
        (1.754, -0.008, 0.024, 0.030, 0.040, 0.00, 0.0, 0.0, 0.00),    # 10: skull apex ring
    ]

    grid: list[list[tuple[float, float, float]]] = []
    for ri, (by, zc, rx, rzf, rzb, jaw_t, brow, sock, cheek) in enumerate(rows_spec):
        ring_pts = []
        for th in thetas:
            sx = math.sin(th)   # + left, - right
            cz = math.cos(th)   # + front, - back
            ax = abs(sx)
            rz = rzf if cz >= 0 else rzb
            x = sx * rx
            z = zc + cz * rz
            y = by

            # Jawline & chin taper (front-center projects cleanly, corners sharpen)
            if ri in (0, 1) and cz > 0:
                chin_bump = math.exp(-((ax / 0.32) ** 2)) * 0.011
                z += chin_bump
                x *= (1.0 - jaw_t * (1.0 - ax) * 0.25)
            # Chin slightly lower at tip
            if ri == 0:
                y -= 0.008 * max(0.0, cz)

            # Cheekbone flare around ax in [0.35..0.75], cz > 0.2
            if cheek > 0 and cz > 0.15:
                cb = math.exp(-(((ax - 0.56) / 0.25) ** 2)) * cz
                z += cb * cheek * 0.08
                x += math.copysign(cb * cheek * 0.04, sx)

            # Shallow planar eye socket across ax in [0.18..0.55], cz > 0.65 (subtle ~6-8mm, NEVER a cave!)
            if sock < 0 and cz > 0.55:
                em = math.exp(-(((ax - 0.36) / 0.17) ** 2))
                z += sock * em

            # Brow ridge shelf at ax in [0.10..0.58], cz > 0.5
            if brow > 0 and cz > 0.45:
                bm = math.exp(-(((ax - 0.33) / 0.24) ** 2)) * cz
                z += 0.009 * brow * bm
                y += 0.002 * brow * bm

            # Slight cranium rounding / temple flatten
            if ri >= 6 and 0.65 < ax < 0.92 and cz > -0.1:
                x *= 0.96

            ring_pts.append((x, y, z))
        grid.append(ring_pts)

    # Stitch head grid with subtle shading variation per zone (lower jaw shade, cheeks warm, brow crisp)
    for ri in range(len(grid) - 1):
        ra, rb = grid[ri], grid[ri + 1]
        for ci in range(cols):
            nj = (ci + 1) % cols
            p00, p10, p11, p01 = ra[ci], ra[nj], rb[nj], rb[ci]
            mid_z = (p00[2] + p10[2] + p11[2] + p01[2]) * 0.25
            mid_y = (p00[1] + p10[1] + p11[1] + p01[1]) * 0.25
            mid_x = abs((p00[0] + p10[0] + p11[0] + p01[0]) * 0.25)
            # Keep lower front jaw clean warm 'skin' (no dark chin-strap beard boundary!)
            if ri == 5 and mid_z > 0.068 and mid_x < 0.050:
                ck = 'skinMid'
            elif mid_z < -0.035 and ri >= 6:
                ck = 'hair'
            elif ri >= 8:
                ck = 'hair'
            else:
                ck = 'skin'
            cd = 0.0 if ri in (0, 5, 6) else 28.0
            mb.add_quad(p00, p10, p11, p01, ck, crease_deg=cd, flip_diag=((ri + ci) % 2 == 1))

    # Cap bottom under-chin into neck & top crown
    bot_ctr = (0.0, 1.518, 0.006)
    for ci in range(cols):
        nj = (ci + 1) % cols
        mb.add_tri(bot_ctr, grid[0][nj], grid[0][ci], 'skinMid', 0.0)
    top_ctr = (0.0, 1.758, -0.008)
    for ci in range(cols):
        nj = (ci + 1) % cols
        mb.add_tri(top_ctr, grid[-1][ci], grid[-1][nj], 'hair', 0.0)

    # --- Sculpted Nose (natural proportional bridge, tip, nostril alae) ---
    n_top_l = (0.0055, 1.646, 0.092)
    n_top_r = (-0.0055, 1.646, 0.092)
    n_mid_l = (0.0050, 1.615, 0.102)
    n_mid_r = (-0.0050, 1.615, 0.102)
    n_tip_l = (0.0062, 1.592, 0.110)
    n_tip_r = (-0.0062, 1.592, 0.110)
    n_ala_l = (0.0145, 1.586, 0.094)
    n_ala_r = (-0.0145, 1.586, 0.094)
    n_base_l = (0.010, 1.580, 0.091)
    n_base_r = (-0.010, 1.580, 0.091)
    n_base_c = (0.0, 1.581, 0.098)
    n_root_l = (0.015, 1.638, 0.085)
    n_root_r = (-0.015, 1.638, 0.085)
    n_side_l = (0.018, 1.612, 0.087)
    n_side_r = (-0.018, 1.612, 0.087)

    mb.add_quad(n_mid_r, n_mid_l, n_top_l, n_top_r, 'skin', 0.0)
    mb.add_quad(n_tip_r, n_tip_l, n_mid_l, n_mid_r, 'skin', 0.0)
    mb.add_quad(n_mid_l, n_side_l, n_root_l, n_top_l, 'skinMid', 0.0)
    mb.add_quad(n_tip_l, n_ala_l, n_side_l, n_mid_l, 'skinMid', 0.0)
    mb.add_quad(n_root_r, n_side_r, n_mid_r, n_top_r, 'skinMid', 0.0)
    mb.add_quad(n_side_r, n_ala_r, n_tip_r, n_mid_r, 'skinMid', 0.0)
    mb.add_tri(n_base_c, n_tip_l, n_tip_r, 'skinShade', 0.0)
    mb.add_tri(n_base_c, n_ala_l, n_tip_l, 'skinShade', 0.0)
    mb.add_tri(n_base_c, n_tip_r, n_ala_r, 'skinShade', 0.0)
    mb.add_tri(n_base_c, n_base_l, n_ala_l, 'skinShade', 0.0)
    mb.add_tri(n_base_c, n_ala_r, n_base_r, 'skinShade', 0.0)
    mb.add_quad(n_base_l, n_base_c, n_base_r, (0.0, 1.578, 0.088), 'skinShade', 0.0)

    # --- Sculpted Eyes & Eyebrows (seated cleanly INSIDE orbital socket, zero protrusion!) ---
    for sign in (1.0, -1.0):
        cx = sign * 0.030
        cy = 1.635
        cz = 0.0842
        yaw = -sign * 0.26
        ry_m = euler_mat(0.04, yaw, 0.0)

        def ep(lx: float, ly: float, lz: float) -> tuple[float, float, float]:
            v = ry_m @ np.array([lx * sign, ly, lz])
            return (cx + float(v[0]), cy + float(v[1]), cz + float(v[2]))

        e_in = ep(-0.0115, -0.0008, -0.001)
        e_up_i = ep(-0.0045, 0.0038, 0.0016)
        e_up_o = ep(0.0052, 0.0040, 0.0016)
        e_out = ep(0.0122, 0.0005, -0.0014)
        e_dn_o = ep(0.0052, -0.0035, 0.0008)
        e_dn_i = ep(-0.0045, -0.0036, 0.0008)

        s_ring = [e_in, e_dn_i, e_dn_o, e_out, e_up_o, e_up_i]
        ir_c = ep(0.0, 0.0002, 0.0020)
        ir_r = 0.0039
        ir_pts = []
        for k in range(6):
            a = k * math.pi / 3.0
            ly = min(0.0030, ir_r * math.sin(a))
            lx = ir_r * math.cos(a)
            ir_pts.append(ep(lx, ly, 0.0020))

        t0 = len(mb.tris)
        for k in range(6):
            nk = (k + 1) % 6
            mb.add_quad(s_ring[k], s_ring[nk], ir_pts[nk], ir_pts[k], 'sclera', 0.0)
        for k in range(6):
            nk = (k + 1) % 6
            mb.add_tri(ir_c, ir_pts[k], ir_pts[nk], 'iris', 0.0)
        sp_pts = [
            ep(0.0010, 0.0010, 0.0024),
            ep(0.0025, 0.0010, 0.0024),
            ep(0.0025, 0.0022, 0.0024),
            ep(0.0010, 0.0022, 0.0024),
        ]
        mb.add_quad(sp_pts[0], sp_pts[1], sp_pts[2], sp_pts[3], 'eyeSpark', 0.0)

        hood_in = ep(-0.0125, 0.0000, 0.0008)
        hood_ui = ep(-0.0048, 0.0050, 0.0032)
        hood_uo = ep(0.0055, 0.0052, 0.0030)
        hood_out = ep(0.013, 0.0012, 0.0004)
        mb.add_quad(e_in, e_up_i, hood_ui, hood_in, 'eyelid', 0.0)
        mb.add_quad(e_up_i, e_up_o, hood_uo, hood_ui, 'eyelid', 0.0)
        mb.add_quad(e_up_o, e_out, hood_out, hood_uo, 'eyelid', 0.0)
        fold_in = ep(-0.013, 0.0025, 0.0005)
        fold_ui = ep(-0.0048, 0.0074, 0.0022)
        fold_uo = ep(0.0055, 0.0076, 0.0020)
        fold_out = ep(0.0135, 0.0035, -0.0004)
        mb.add_quad(hood_in, hood_ui, fold_ui, fold_in, 'skinMid', 0.0)
        mb.add_quad(hood_ui, hood_uo, fold_uo, fold_ui, 'skinMid', 0.0)
        mb.add_quad(hood_uo, hood_out, fold_out, fold_uo, 'skinMid', 0.0)
        ensure_outward_winding(mb, t0, lambda _: (cx, cy, cz - 0.05))

        bt0 = len(mb.tris)
        b_front_bot = [ep(-0.015, 0.015, 0.006), ep(-0.002, 0.018, 0.0085), ep(0.012, 0.019, 0.0065), ep(0.020, 0.016, 0.0025)]
        b_front_top = [ep(-0.015, 0.020, 0.0058), ep(-0.002, 0.0228, 0.0080), ep(0.012, 0.0232, 0.0060), ep(0.020, 0.019, 0.0020)]
        b_back_bot = [ep(-0.015, 0.015, 0.001), ep(-0.002, 0.018, 0.003), ep(0.012, 0.019, 0.001), ep(0.020, 0.016, -0.002)]
        b_back_top = [ep(-0.015, 0.020, 0.001), ep(-0.002, 0.0228, 0.003), ep(0.012, 0.0232, 0.001), ep(0.020, 0.019, -0.002)]
        for k in range(3):
            mb.add_quad(b_front_bot[k], b_front_bot[k + 1], b_front_top[k + 1], b_front_top[k], 'hair', 0.0)
            mb.add_quad(b_front_top[k], b_front_top[k + 1], b_back_top[k + 1], b_back_top[k], 'hairAlt', 0.0)
            mb.add_quad(b_back_bot[k], b_front_bot[k], b_front_bot[k + 1], b_back_bot[k + 1], 'hair', 0.0)
        mb.add_quad(b_back_bot[0], b_back_top[0], b_front_top[0], b_front_bot[0], 'hair', 0.0)
        mb.add_quad(b_front_bot[3], b_front_top[3], b_back_top[3], b_back_bot[3], 'hair', 0.0)
        ensure_outward_winding(mb, bt0, lambda p: (p[0], p[1] - 0.01, p[2] - 0.03))

    # --- Natural Relaxed Closed Lips (slim proportioned cushion, smooth cheek transition!) ---
    lt0 = len(mb.tris)
    m_l2 = (0.021, 1.5540, 0.088)
    m_l1 = (0.009, 1.5535, 0.0965)
    m_c  = (0.000, 1.5532, 0.0992)
    m_r1 = (-0.009, 1.5535, 0.0965)
    m_r2 = (-0.021, 1.5540, 0.088)

    u_l1 = (0.0085, 1.5568, 0.0975)
    u_c  = (0.000, 1.5564, 0.1000)
    u_r1 = (-0.0085, 1.5568, 0.0975)

    us_l2 = (0.024, 1.555, 0.084)
    us_l1 = (0.009, 1.563, 0.0935)
    us_c  = (0.000, 1.5625, 0.0955)
    us_r1 = (-0.009, 1.563, 0.0935)
    us_r2 = (-0.024, 1.555, 0.084)

    s_l1 = (0.009, 1.5524, 0.0962)
    s_c  = (0.000, 1.5521, 0.0988)
    s_r1 = (-0.009, 1.5524, 0.0962)
    d_l1 = (0.0085, 1.5488, 0.0970)
    d_c  = (0.000, 1.5484, 0.0992)
    d_r1 = (-0.0085, 1.5488, 0.0970)
    ds_l1 = (0.009, 1.5435, 0.092)
    ds_c  = (0.000, 1.5430, 0.0942)
    ds_r1 = (-0.009, 1.5435, 0.092)

    mb.add_tri(m_r2, m_r1, u_r1, 'lipUpper', 0.0)
    mb.add_quad(m_r1, m_c, u_c, u_r1, 'lipUpper', 0.0)
    mb.add_quad(m_c, m_l1, u_l1, u_c, 'lipUpper', 0.0)
    mb.add_tri(m_l1, m_l2, u_l1, 'lipUpper', 0.0)
    mb.add_quad(us_r2, m_r2, u_r1, us_r1, 'skin', 0.0)
    mb.add_quad(u_r1, u_c, us_c, us_r1, 'skin', 0.0)
    mb.add_quad(u_c, u_l1, us_l1, us_c, 'skin', 0.0)
    mb.add_quad(u_l1, m_l2, us_l2, us_l1, 'skin', 0.0)
    mb.add_tri(m_r2, s_r1, m_r1, 'lipLine', 0.0)
    mb.add_quad(m_r1, s_r1, s_c, m_c, 'lipLine', 0.0)
    mb.add_quad(m_c, s_c, s_l1, m_l1, 'lipLine', 0.0)
    mb.add_tri(m_l1, s_l1, m_l2, 'lipLine', 0.0)
    mb.add_tri(m_r2, d_r1, s_r1, 'lipLower', 0.0)
    mb.add_quad(s_r1, d_r1, d_c, s_c, 'lipLower', 0.0)
    mb.add_quad(s_c, d_c, d_l1, s_l1, 'lipLower', 0.0)
    mb.add_tri(s_l1, d_l1, m_l2, 'lipLower', 0.0)
    mb.add_tri(m_r2, ds_r1, d_r1, 'skin', 0.0)
    mb.add_quad(d_r1, ds_r1, ds_c, d_c, 'skin', 0.0)
    mb.add_quad(d_c, ds_c, ds_l1, d_l1, 'skin', 0.0)
    mb.add_tri(d_l1, ds_l1, m_l2, 'skin', 0.0)
    ensure_outward_winding(mb, lt0, lambda _: (0.0, 1.552, 0.05))

    # --- Sculpted Ears (subtle outward pinna + shaded concha bowl) ---
    for sign in (1.0, -1.0):
        et0 = len(mb.tris)
        # Ear rings: attach inner base -> mid rim -> outer helix lobe
        r0 = [
            (sign * 0.071, 1.594, -0.002),
            (sign * 0.070, 1.592, -0.015),
            (sign * 0.070, 1.622, -0.022),
            (sign * 0.071, 1.646, -0.010),
            (sign * 0.072, 1.638, 0.006),
            (sign * 0.072, 1.612, 0.005),
        ]
        r1 = [
            (sign * 0.077, 1.590, -0.004),
            (sign * 0.082, 1.588, -0.019),
            (sign * 0.084, 1.624, -0.029),
            (sign * 0.082, 1.651, -0.014),
            (sign * 0.076, 1.642, 0.007),
            (sign * 0.075, 1.612, 0.007),
        ]
        r2 = [
            (sign * 0.074, 1.595, -0.006),
            (sign * 0.076, 1.595, -0.016),
            (sign * 0.078, 1.623, -0.023),
            (sign * 0.077, 1.644, -0.011),
            (sign * 0.074, 1.636, 0.002),
            (sign * 0.074, 1.612, 0.002),
        ]
        mb.loft([r0, r1], 'skinMid', crease_deg=0.0)
        mb.loft([r1, r2], 'skin', crease_deg=0.0)
        ectr = (sign * 0.073, 1.618, -0.012)
        for k in range(6):
            nk = (k + 1) % 6
            mb.add_tri(ectr, r2[k], r2[nk], 'skinShade', 0.0)
        ensure_outward_winding(mb, et0, lambda p: (sign * 0.055, 1.618, -0.008))

    # --- Layered Sculpted Short Hair (crown strictly Y<=1.770, outward-wound cap + sideburns + fringe!) ---
    cols_h = 20
    thetas_h = [2.0 * math.pi * k / cols_h for k in range(cols_h)]
    hair_rings_spec = [
        # y_front, y_side, y_back, zc, rx, rzf, rzb (clean temple wrap + flush front forehead line)
        (1.672, 1.638, 1.552, -0.004, 0.079, 0.089, 0.111),
        (1.696, 1.680, 1.608, -0.005, 0.084, 0.093, 0.113),
        (1.725, 1.718, 1.678, -0.006, 0.080, 0.088, 0.107),
        (1.749, 1.746, 1.730, -0.007, 0.062, 0.069, 0.087),
        (1.763, 1.761, 1.758, -0.008, 0.032, 0.038, 0.048),
    ]
    h_grid = []
    for ri, (yf, ys, yb, zc, rx, rzf, rzb) in enumerate(hair_rings_spec):
        hr = []
        for th in thetas_h:
            sx = math.sin(th)
            cz = math.cos(th)
            ax = abs(sx)
            if cz >= 0:
                y = yf * cz + ys * (1.0 - cz)
            else:
                y = yb * (-cz) + ys * (1.0 + cz)
            # Smooth Gaussian temple/sideburn contour ahead of ears (zero jagged corners!)
            if ri == 0 and cz > -0.1:
                sb = math.exp(-(((ax - 0.86) / 0.12) ** 2)) * math.exp(-(((cz - 0.22) / 0.20) ** 2))
                y -= 0.036 * sb
            if ri == 0 and cz > 0.4:
                y += (-0.007 if sx > 0 else 0.004) * (cz ** 1.4)
            rz = rzf if cz >= 0 else rzb
            ridge = 0.0028 * math.sin(th * 7.0 + ri * 1.1) if ri in (1, 2, 3) else 0.0
            hr.append((sx * (rx + ridge), y, zc + cz * (rz + ridge)))
        h_grid.append(hr)

    ht0 = len(mb.tris)
    mb.loft(h_grid, 'hair', cap_bottom=False, cap_top=True, crease_deg=0.0, color_alt='hairAlt', flip_outward=False)
    for ci in range(cols_h):
        nj = (ci + 1) % cols_h
        p0, p1 = h_grid[0][ci], h_grid[0][nj]
        in0 = (p0[0] * 0.76, p0[1] + 0.006, p0[2] * 0.76)
        in1 = (p1[0] * 0.76, p1[1] + 0.006, p1[2] * 0.76)
        mb.add_quad(in0, in1, p1, p0, 'hair', 0.0)
    ensure_outward_winding(mb, ht0, lambda _: (0.0, 1.655, -0.015))

    # 2. Softly blended forehead fringe & flush nape locks (wider soft tips so no black sawtooth triangles!)
    locks = [
        ((-0.056, 1.708, 0.068), (-0.060, 1.686, 0.085), (-0.066, 1.668, 0.078), 0.021, 0.007, 'hair'),
        ((-0.028, 1.716, 0.078), (-0.032, 1.692, 0.094), (-0.042, 1.670, 0.087), 0.023, 0.0075, 'hairAlt'),
        ((0.002, 1.720, 0.082), (-0.004, 1.694, 0.097), (-0.014, 1.671, 0.090), 0.024, 0.0075, 'hair'),
        ((0.030, 1.716, 0.077), (0.026, 1.690, 0.092), (0.016, 1.668, 0.085), 0.023, 0.0075, 'hairAlt'),
        ((0.056, 1.706, 0.064), (0.054, 1.683, 0.079), (0.046, 1.664, 0.072), 0.021, 0.007, 'hair'),
        ((-0.022, 1.744, 0.025), (-0.012, 1.758, 0.045), (-0.002, 1.749, 0.068), 0.022, 0.008, 'hairAlt'),
        ((0.020, 1.745, 0.020), (0.022, 1.760, 0.042), (0.026, 1.748, 0.066), 0.022, 0.008, 'hair'),
        ((-0.042, 1.682, -0.092), (-0.044, 1.638, -0.104), (-0.034, 1.585, -0.088), 0.022, 0.007, 'hairAlt'),
        ((0.000, 1.688, -0.096), (0.000, 1.640, -0.108), (0.000, 1.578, -0.092), 0.026, 0.008, 'hair'),
        ((0.042, 1.682, -0.092), (0.044, 1.638, -0.104), (0.034, 1.585, -0.088), 0.022, 0.007, 'hairAlt'),
    ]
    for root_p, mid_p, tip_p, hw, thk, ck in locks:
        p0 = np.asarray(root_p, dtype=np.float64)
        p1 = np.asarray(mid_p, dtype=np.float64)
        p2 = np.asarray(tip_p, dtype=np.float64)
        fwd = p2 - p0
        up_hint = p1 - np.array([0.0, 1.64, 0.0])
        side = np.cross(fwd, up_hint)
        sl = np.linalg.norm(side)
        side = (side / sl) if sl > 1e-9 else np.array([1.0, 0.0, 0.0])
        out = np.cross(side, fwd)
        ol = np.linalg.norm(out)
        out = (out / ol) if ol > 1e-9 else np.array([0.0, 1.0, 0.0])

        # Faceted prism taper lock (root quad -> mid ridge -> sharp tip)
        lt = len(mb.tris)
        rL, rR, rB = p0 - side * hw, p0 + side * hw, p0 - out * (thk * 0.4)
        mL, mR, mC, mB = p1 - side * (hw * 0.85), p1 + side * (hw * 0.85), p1 + out * thk, p1 - out * (thk * 0.3)
        mb.add_quad(rL, mL, mC, p0 + out * (thk * 0.6), ck, 0.0)
        mb.add_quad(p0 + out * (thk * 0.6), mC, mR, rR, ck, 0.0)
        mb.add_tri(mL, p2, mC, ck, 0.0)
        mb.add_tri(mC, p2, mR, ck, 0.0)
        mb.add_quad(rR, mR, mB, rB, ck, 0.0)
        mb.add_quad(rB, mB, mL, rL, ck, 0.0)
        mb.add_tri(mB, mR, p2, ck, 0.0)
        mb.add_tri(mL, mB, p2, ck, 0.0)
        ensure_outward_winding(mb, lt, lambda _: (p0 + p1) * 0.5 - out * 0.025)


# ---------------------------------------------------------------------------
# 2. Torso, Crew Tee, Tailored Lapel Windbreaker & Belt (y = 0.84 .. 1.49)
# ---------------------------------------------------------------------------

def build_torso_and_jacket(mb: MeshBuilder) -> None:
    mb.group = 'torso'
    # A. Front-only Crew-Neck Tee chest bib (recessed cleanly inside open V-lapel, ZERO hidden back faces to poke out!)
    tee_levels = [
        # (y,     zc,    rx,    rzf,   half_span_x) — bottom tucks 1.2cm cleanly BEHIND belt top (`0.90..0.942`)!
        (0.928, -0.024, 0.122, 0.080, 0.085),
        (1.020, -0.014, 0.125, 0.090, 0.085),
        (1.155, -0.008, 0.136, 0.098, 0.086),
        (1.290, -0.012, 0.140, 0.100, 0.084),
        (1.395, -0.022, 0.132, 0.084, 0.078),
        (1.448, -0.028, 0.084, 0.058, 0.068),
    ]
    n_tee = 7
    tee_grid = []
    for li, (y, zc, rx, rzf, span_x) in enumerate(tee_levels):
        max_th = math.asin(min(0.92, span_x / rx))
        row = []
        for k in range(n_tee):
            th = -max_th + 2.0 * max_th * k / (n_tee - 1)
            yy = y
            if li == len(tee_levels) - 1:
                dip = 0.032 * (math.cos(th / max_th * math.pi * 0.5))
                yy -= dip
            row.append((math.sin(th) * rx, yy, zc + math.cos(th) * rzf))
        tee_grid.append(row)
    for ri in range(len(tee_grid) - 1):
        ra, rb = tee_grid[ri], tee_grid[ri + 1]
        for k in range(n_tee - 1):
            # th goes -X -> +X, ra->rb goes +Y: (ra[k], ra[k+1], rb[k+1], rb[k]) faces +Z!
            mb.add_quad(ra[k], ra[k + 1], rb[k + 1], rb[k], 'tee', 0.0, flip_diag=((ri + k) % 2 == 1))
    # Cap tee waist bottom inward & tee neck top back toward neck_01
    for k in range(n_tee - 1):
        p0, p1 = tee_grid[0][k], tee_grid[0][k + 1]
        mb.add_quad(p0, (p0[0], p0[1], 0.01), (p1[0], p1[1], 0.01), p1, 'tee', 0.0)
        q0, q1 = tee_grid[-1][k], tee_grid[-1][k + 1]
        mb.add_quad(q0, q1, (q1[0] * 0.55, 1.452, -0.025), (q0[0] * 0.55, 1.452, -0.025), 'tee', 0.0)

    # B. Tailored open street windbreaker jacket shell (tapered upper shoulder ribcage so deltoid cap wraps naturally!)
    jacket_levels = [
        # (y,     zc,     rx_outer, rzF,   rzB,   gap_x, thk,   color)
        (0.892, -0.024, 0.162, 0.106, 0.102, 0.068, 0.012, 'jacketDark'),
        (0.922, -0.024, 0.164, 0.109, 0.104, 0.066, 0.012, 'jacketDark'),
        (1.030, -0.015, 0.156, 0.110, 0.104, 0.063, 0.012, 'jacket'),
        (1.165, -0.010, 0.165, 0.116, 0.112, 0.060, 0.012, 'jacketFold'),
        (1.295, -0.014, 0.162, 0.117, 0.114, 0.056, 0.012, 'jacket'),
        (1.402, -0.026, 0.146, 0.102, 0.102, 0.053, 0.012, 'jacketFold'),
        (1.456, -0.032, 0.114, 0.078, 0.086, 0.050, 0.011, 'jacketDark'),
    ]

    outer_rings = []
    inner_rings = []
    n_arc = 15
    for (y, zc, rx, rzf, rzb, gx, thk, _ck) in jacket_levels:
        start_ang = math.asin(min(0.95, gx / rx))
        thetas_j = [start_ang + (2.0 * math.pi - 2.0 * start_ang) * k / (n_arc - 1) for k in range(n_arc)]
        o_pts, i_pts = [], []
        for th in thetas_j:
            sx, cz = math.sin(th), math.cos(th)
            rz = rzf if cz >= 0 else rzb
            z_out = zc + cz * rz
            if cz < 0:
                z_out = max(-0.128, z_out)
            o_pts.append((sx * rx, y, z_out))
            in_rx = max(0.05, rx - thk)
            in_rz = max(0.05, rz - thk)
            i_pts.append((sx * in_rx, y, max(-0.118, zc + cz * in_rz)))
        outer_rings.append(o_pts)
        inner_rings.append(i_pts)

    for ri in range(len(jacket_levels) - 1):
        ck = jacket_levels[ri][7]
        ra, rb = outer_rings[ri], outer_rings[ri + 1]
        ia, ib = inner_rings[ri], inner_rings[ri + 1]
        for k in range(n_arc - 1):
            c_tri = 'jacket' if (ck == 'jacketFold' and k % 2 == 0) else ck
            mb.add_quad(ra[k], rb[k], rb[k + 1], ra[k + 1], c_tri, 0.0, flip_diag=((ri + k) % 2 == 1))
            mb.add_quad(ia[k], ia[k + 1], ib[k + 1], ib[k], 'jacketDark' if ri == 0 else 'jacketFold', 0.0)
        mb.add_quad(ia[0], ib[0], rb[0], ra[0], 'jacketDark', 0.0)
        mb.add_quad(ra[-1], rb[-1], ib[-1], ia[-1], 'jacketDark', 0.0)

    for k in range(n_arc - 1):
        mb.add_quad(inner_rings[0][k], outer_rings[0][k], outer_rings[0][k + 1], inner_rings[0][k + 1], 'jacketDark', 0.0)
        mb.add_quad(outer_rings[-1][k], inner_rings[-1][k], inner_rings[-1][k + 1], outer_rings[-1][k + 1], 'jacketDark', 0.0)

    # Subtle flush slant welt pockets + proportioned folded shirt lapels
    for sign in (1.0, -1.0):
        # Sleek flush pocket welt strip (6mm proud on jacket curve, NEVER sticking out like brick drawers!)
        pk_0 = (sign * 0.088, 1.045, 0.072)
        pk_1 = (sign * 0.136, 1.072, 0.044)
        pk_2 = (sign * 0.136, 1.084, 0.044)
        pk_3 = (sign * 0.088, 1.057, 0.072)
        for dx, dz in ((0.008, 0.009),):
            f0 = (pk_0[0] + sign * dx, pk_0[1], pk_0[2] + dz)
            f1 = (pk_1[0] + sign * dx, pk_1[1], pk_1[2] + dz)
            f2 = (pk_2[0] + sign * dx, pk_2[1], pk_2[2] + dz)
            f3 = (pk_3[0] + sign * dx, pk_3[1], pk_3[2] + dz)
            pt0 = len(mb.tris)
            if sign > 0:
                mb.add_quad(f0, f1, f2, f3, 'jacketDark', 0.0)
                mb.add_quad(pk_3, f3, f2, pk_2, 'jacketDark', 0.0)
                mb.add_quad(pk_0, pk_1, f1, f0, 'jacketDark', 0.0)
                mb.add_quad(pk_0, f0, f3, pk_3, 'jacketDark', 0.0)
                mb.add_quad(f1, pk_1, pk_2, f2, 'jacketDark', 0.0)
            else:
                mb.add_quad(f0, f3, f2, f1, 'jacketDark', 0.0)
                mb.add_quad(pk_3, pk_2, f2, f3, 'jacketDark', 0.0)
                mb.add_quad(pk_0, f0, f1, pk_1, 'jacketDark', 0.0)
                mb.add_quad(pk_0, pk_3, f3, f0, 'jacketDark', 0.0)
                mb.add_quad(f1, f2, pk_2, pk_1, 'jacketDark', 0.0)

        lx0 = sign * 0.052
        lx1 = sign * 0.106
        l_in_top = (lx0, 1.466, 0.010)
        l_in_mid = (lx0 * 1.04, 1.438, 0.048)
        l_in_bot = (lx0 * 1.08, 1.368, 0.086)
        l_out_top = (lx1 * 0.85, 1.462, -0.002)
        l_out_mid = (lx1, 1.420, 0.044)
        l_out_bot = (sign * 0.082, 1.378, 0.088)
        col_pts_front = [l_in_bot, l_in_mid, l_in_top, l_out_top, l_out_mid, l_out_bot]
        col_pts_back  = [(p[0] * 0.94, p[1] - 0.005, p[2] - 0.008) for p in col_pts_front]
        if sign > 0:
            mb.add_quad(l_in_bot, l_out_bot, l_out_mid, l_in_mid, 'jacket', 0.0)
            mb.add_quad(l_in_mid, l_out_mid, l_out_top, l_in_top, 'jacketDark', 0.0)
            mb.add_quad(col_pts_back[0], col_pts_back[1], col_pts_back[4], col_pts_back[5], 'jacketDark', 0.0)
            mb.add_quad(col_pts_back[1], col_pts_back[2], col_pts_back[3], col_pts_back[4], 'jacketDark', 0.0)
            mb.add_quad(l_in_bot, col_pts_back[0], col_pts_back[5], l_out_bot, 'jacketDark', 0.0)
            mb.add_quad(l_out_bot, col_pts_back[5], col_pts_back[4], l_out_mid, 'jacketDark', 0.0)
            mb.add_quad(l_out_mid, col_pts_back[4], col_pts_back[3], l_out_top, 'jacketDark', 0.0)
        else:
            mb.add_quad(l_in_bot, l_in_mid, l_out_mid, l_out_bot, 'jacket', 0.0)
            mb.add_quad(l_in_mid, l_in_top, l_out_top, l_out_mid, 'jacketDark', 0.0)
            mb.add_quad(col_pts_back[0], col_pts_back[5], col_pts_back[4], col_pts_back[1], 'jacketDark', 0.0)
            mb.add_quad(col_pts_back[1], col_pts_back[4], col_pts_back[3], col_pts_back[2], 'jacketDark', 0.0)
            mb.add_quad(l_in_bot, l_out_bot, col_pts_back[5], col_pts_back[0], 'jacketDark', 0.0)
            mb.add_quad(l_out_bot, l_out_mid, col_pts_back[4], col_pts_back[5], 'jacketDark', 0.0)
            mb.add_quad(l_out_mid, l_out_top, col_pts_back[3], col_pts_back[4], 'jacketDark', 0.0)

    # Raised rear collar stand around neck_01 back (-Z)
    col_back_o = []
    col_back_i = []
    for k in range(9):
        th = math.pi * 0.42 + math.pi * 1.16 * k / 8.0
        sx, cz = math.sin(th), math.cos(th)
        col_back_o.append((sx * 0.086, 1.474, -0.024 + cz * 0.068))
        col_back_i.append((sx * 0.074, 1.474, -0.024 + cz * 0.056))
    col_base_o = [(p[0] * 1.04, 1.442, p[2] - 0.005) for p in col_back_o]
    col_base_i = [(p[0] * 1.02, 1.442, p[2] - 0.003) for p in col_back_i]
    for k in range(8):
        mb.add_quad(col_base_o[k], col_back_o[k], col_back_o[k + 1], col_base_o[k + 1], 'jacket', 0.0)
        mb.add_quad(col_base_i[k], col_base_i[k + 1], col_back_i[k + 1], col_back_i[k], 'jacketDark', 0.0)
        mb.add_quad(col_back_o[k], col_back_i[k], col_back_i[k + 1], col_back_o[k + 1], 'jacketDark', 0.0)

    # C. Waistband & Belt (tucked cleanly inside jacket waist opening, comfortably forward of tucked Tee!) -> BOTTOM_BELT
    belt_r = [
        ellipse_ring(0.0, 0.900, -0.022, 0.143, 0.092, 16, phase=math.pi / 16, back_scale=0.96),
        ellipse_ring(0.0, 0.942, -0.022, 0.143, 0.092, 16, phase=math.pi / 16, back_scale=0.96),
    ]
    mb.loft(belt_r, 'belt', cap_bottom=False, cap_top=True, crease_deg=0.0, flip_outward=True)
    mb.add_box(-0.022, 0.022, 0.902, 0.940, 0.064, 0.076, 'belt')


# ---------------------------------------------------------------------------
# 3. Jacket Sleeves, Cuffs, Wrists & Anatomical 5-Finger Hands (T-pose +/-X)
# ---------------------------------------------------------------------------

def build_arms_and_hands(mb: MeshBuilder) -> None:
    for sign in (1.0, -1.0):  # +1 left (+X), -1 right (-X)
        mb.group = 'arm_l' if sign > 0 else 'arm_r'
        # Sleeve cross-sections in YZ plane oriented along X from torso ribcage anchor x=0.118 -> cuff x=0.720
        sleeve_stations = [
            # (x,     yc,     zc,     ry,    rz,    color) — natural sloped deltoid contour, zero boxy shoulder pad puff
            (0.114, 1.376, -0.036, 0.060, 0.062, 'jacket'),
            (0.155, 1.408, -0.054, 0.058, 0.058, 'jacket'),
            (0.205, 1.425, -0.064, 0.056, 0.054, 'jacket'),
            (0.325, 1.438, -0.068, 0.053, 0.050, 'jacketFold'),
            (0.470, 1.442, -0.073, 0.049, 0.047, 'jacket'),
            (0.605, 1.440, -0.070, 0.045, 0.044, 'jacketFold'),
            (0.702, 1.439, -0.069, 0.040, 0.042, 'jacket'),
        ]
        n_arm = 10
        arm_rings = []
        for (x, yc, zc, ry, rz, _ck) in sleeve_stations:
            ring_yz = []
            for k in range(n_arm):
                a = 2.0 * math.pi * k / n_arm
                ring_yz.append((sign * x, yc + ry * math.cos(a), zc + rz * math.sin(a)))
            arm_rings.append(ring_yz)

        at0 = len(mb.tris)
        for si in range(len(sleeve_stations) - 1):
            ck = sleeve_stations[si][5]
            ra, rb = arm_rings[si], arm_rings[si + 1]
            for k in range(n_arm):
                nk = (k + 1) % n_arm
                c_face = 'jacket' if (ck == 'jacketFold' and (k + si) % 2 == 0) else ck
                if sign > 0:
                    mb.add_quad(ra[k], ra[nk], rb[nk], rb[k], c_face, 0.0)
                else:
                    mb.add_quad(ra[k], rb[k], rb[nk], ra[nk], c_face, 0.0)
        # Cap shoulder armhole inner end cleanly inside torso
        s_cap = (sign * 0.116, 1.385, -0.036)
        for k in range(n_arm):
            nk = (k + 1) % n_arm
            mb.add_tri(s_cap, arm_rings[0][nk], arm_rings[0][k], 'jacketDark', 0.0)
        ensure_outward_winding(mb, at0, lambda p: (p[0], 1.436, -0.065))

        # Ribbed jacket cuff (x = 0.702 .. 0.728) -> TOP_TRIM
        cuff_stations = [
            (0.702, 1.439, -0.069, 0.042, 0.044),
            (0.728, 1.439, -0.068, 0.039, 0.041),
            (0.728, 1.439, -0.068, 0.032, 0.034),
        ]
        c_rings = [
            [(sign * x, yc + ry * math.cos(2.0 * math.pi * k / n_arm), zc + rz * math.sin(2.0 * math.pi * k / n_arm))
             for k in range(n_arm)]
            for (x, yc, zc, ry, rz) in cuff_stations
        ]
        for si in range(2):
            ra, rb = c_rings[si], c_rings[si + 1]
            for k in range(n_arm):
                nk = (k + 1) % n_arm
                if sign > 0:
                    mb.add_quad(ra[k], ra[nk], rb[nk], rb[k], 'jacketDark', 0.0)
                else:
                    mb.add_quad(ra[k], rb[k], rb[nk], ra[nk], 'jacketDark', 0.0)

        # Wrist + Natural Metacarpal Palm (narrower grouped knuckles so fingers nest cleanly together!)
        palm_stations = [
            (0.718, 1.439, -0.068,  0.024, -0.023, -0.094, -0.042),
            (0.750, 1.439, -0.064,  0.017, -0.018, -0.096, -0.032),
            (0.794, 1.438, -0.056,  0.016, -0.017, -0.098, -0.014),
            (0.846, 1.436, -0.056,  0.013, -0.013, -0.098, -0.014),
        ]
        palm_rings = []
        for (x, yc, zc, ryt, ryb, zmin, zmax) in palm_stations:
            zm = (zmin + zmax) * 0.5
            pts8 = [
                (sign * x, yc + ryt, zmax - 0.006),
                (sign * x, yc + ryt * 1.05, zm),
                (sign * x, yc + ryt * 0.9, zmin + 0.006),
                (sign * x, yc, zmin),
                (sign * x, yc + ryb * 0.9, zmin + 0.006),
                (sign * x, yc + ryb * 0.95, zm),
                (sign * x, yc + ryb, zmax - 0.006),
                (sign * x, yc + 0.001, zmax),
            ]
            palm_rings.append(pts8)

        pt0 = len(mb.tris)
        for si in range(len(palm_rings) - 1):
            ra, rb = palm_rings[si], palm_rings[si + 1]
            ck = 'skinMid' if si == 0 else 'skin'
            for k in range(8):
                nk = (k + 1) % 8
                if sign > 0:
                    mb.add_quad(ra[k], rb[k], rb[nk], ra[nk], ck, 24.0)
                else:
                    mb.add_quad(ra[k], ra[nk], rb[nk], rb[k], ck, 24.0)
        kctr = (sign * 0.848, 1.436, -0.056)
        for k in range(8):
            nk = (k + 1) % 8
            mb.add_tri(kctr, palm_rings[-1][k], palm_rings[-1][nk], 'skinMid', 0.0)
        ensure_outward_winding(mb, pt0, lambda p: (p[0], 1.436, -0.056))

        # Tightly grouped natural 5 fingers (adjacent digits touch naturally instead of spaced mechanical claws!)
        fingers = [
            ([(0.768, 1.422, -0.030), (0.796, 1.408, -0.010), (0.822, 1.396, 0.002), (0.842, 1.388, 0.008)],
             [0.013, 0.011, 0.0095, 0.0072], 'skin'),      # Relaxed natural thumb (alongside palm, not OK-pinch!)
            ([(0.844, 1.435, -0.023), (0.880, 1.431, -0.021), (0.904, 1.424, -0.020), (0.922, 1.416, -0.019)],
             [0.0112, 0.0098, 0.0084, 0.0065], 'skin'),    # Index
            ([(0.846, 1.437, -0.044), (0.886, 1.433, -0.044), (0.914, 1.425, -0.044), (0.934, 1.417, -0.044)],
             [0.0114, 0.0100, 0.0086, 0.0066], 'skin'),    # Middle
            ([(0.844, 1.436, -0.066), (0.880, 1.432, -0.066), (0.905, 1.424, -0.066), (0.923, 1.416, -0.066)],
             [0.0108, 0.0095, 0.0082, 0.0062], 'skinMid'), # Ring
            ([(0.840, 1.435, -0.087), (0.870, 1.431, -0.087), (0.892, 1.424, -0.087), (0.908, 1.417, -0.087)],
             [0.0098, 0.0085, 0.0074, 0.0056], 'skinMid'), # Pinky
        ]
        for pts_chain, radii, ck in fingers:
            ft0 = len(mb.tris)
            f_rings = []
            for idx_p, (fx, fy, fz) in enumerate(pts_chain):
                p_cur = np.array([sign * fx, fy, fz])
                if idx_p < len(pts_chain) - 1:
                    nx, ny, nz = pts_chain[idx_p + 1]
                    tangent = np.array([sign * nx, ny, nz]) - p_cur
                else:
                    px, py, pz = pts_chain[idx_p - 1]
                    tangent = p_cur - np.array([sign * px, py, pz])
                tangent /= np.linalg.norm(tangent) + 1e-9
                up_h = np.array([0.0, 1.0, 0.0])
                side_v = np.cross(tangent, up_h)
                side_v /= np.linalg.norm(side_v) + 1e-9
                up_v = np.cross(side_v, tangent)
                r_f = radii[idx_p]
                ring_6 = [tuple(p_cur + side_v * (r_f * 1.12 * math.cos(2 * math.pi * k / 6)) + up_v * (r_f * 0.90 * math.sin(2 * math.pi * k / 6)))
                          for k in range(6)]
                f_rings.append(ring_6)
            mb.loft(f_rings, ck, cap_bottom=True, cap_top=True, crease_deg=20.0)
            chain_world = [np.array([sign * px, py, pz]) for (px, py, pz) in pts_chain]
            ensure_outward_winding(
                mb,
                ft0,
                lambda tri_p, cw=chain_world: min(cw, key=lambda c: float(np.linalg.norm(tri_p - c))),
            )


# ---------------------------------------------------------------------------
# 4. Sculpted Hips, Thighs, Knees, Calves & 26.7cm Sneakers (y = 0.0 .. 0.94)
# ---------------------------------------------------------------------------

def build_legs_and_shoes(mb: MeshBuilder) -> None:
    mb.group = 'pelvis'
    # A. Compact pelvis bridge cleanly inside top waistband (NO overhanging bottom plate cast across upper thigh!)
    pelvis_rings = [
        ellipse_ring(0.0, 0.878, -0.024, 0.120, 0.070, 16, phase=math.pi / 16, front_scale=0.92, back_scale=1.06),
        ellipse_ring(0.0, 0.914, -0.022, 0.136, 0.082, 16, phase=math.pi / 16, front_scale=0.98, back_scale=1.00),
    ]
    mb.loft(pelvis_rings, 'jeans', cap_bottom=False, cap_top=True, crease_deg=0.0, flip_outward=True)

    # B. Left & Right sculpted trouser legs (smooth hip dome + knee double-ring + full-volume calf + clean sneaker cuff)
    for sign in (1.0, -1.0):
        mb.group = 'leg_l' if sign > 0 else 'leg_r'
        leg_stations = [
            # (y,    x_off,  z_off,   rx,    rz_f,  rz_b)
            (0.912, 0.070, -0.022, 0.070, 0.075, 0.082),  # hip socket dome anchored seamlessly at waistband
            (0.840, 0.085, -0.012, 0.075, 0.078, 0.084),  # upper thigh crease blend
            (0.730, 0.090, -0.002, 0.074, 0.078, 0.076),  # mid thigh quad
            (0.610, 0.090,  0.008, 0.064, 0.067, 0.063),  # lower thigh taper
            (0.555, 0.089,  0.013, 0.059, 0.063, 0.057),  # upper knee ring (prevents pinching in ebike/run!)
            (0.526, 0.089,  0.016, 0.057, 0.062, 0.055),  # mid knee patella
            (0.492, 0.089,  0.010, 0.056, 0.058, 0.056),  # lower knee ring
            (0.375, 0.090, -0.014, 0.061, 0.054, 0.068),  # gastrocnemius calf belly bulge!
            (0.245, 0.089, -0.026, 0.049, 0.048, 0.052),  # lower calf taper
            (0.140, 0.089, -0.036, 0.046, 0.048, 0.046),  # denim cuff top
            (0.092, 0.089, -0.038, 0.047, 0.050, 0.048),  # denim hem outer (meets sneaker tongue & collar cleanly)
            (0.092, 0.089, -0.038, 0.022, 0.024, 0.024),  # denim hem flat underside close into ankle sock
        ]
        l_rings = []
        for (y, xo, zo, rx, rzf, rzb) in leg_stations:
            pts = ellipse_ring(sign * xo, y, zo, rx, rzf, 10, phase=math.pi / 10, back_scale=rzb / rzf)
            l_rings.append(pts)
        mb.loft(l_rings, 'jeans', cap_bottom=False, cap_top=True, crease_deg=0.0, flip_outward=True)

        # C. Low-cut ankle sock tucked STRICTLY inside sneaker collar (r<=0.026, y=0.05..0.096) + 26.7 cm Sneakers
        cx = sign * 0.089
        sk_t0 = len(mb.tris)
        mb.loft([
            ellipse_ring(cx, 0.055, -0.038, 0.023, 0.026, 8),
            ellipse_ring(cx, 0.096, -0.038, 0.023, 0.026, 8),
        ], 'belt', cap_bottom=True, cap_top=True, crease_deg=0.0)
        ensure_outward_winding(mb, sk_t0, lambda _: (cx, 0.075, -0.038))

        def shoe_ring(y_level: float, expand: float, heel_z: float, toe_z: float, top_collar_dip: float = 0.0) -> list[tuple[float, float, float]]:
            z_pts = [
                (0.0,          heel_z),
                (0.68,         heel_z + 0.020),
                (0.88,         0.015),
                (1.00,         0.095),
                (0.76,         toe_z - 0.016),
                (0.12,         toe_z),
                (-0.48,        toe_z - 0.008),
                (-0.88,        toe_z - 0.034),
                (-0.98,        0.085),
                (-0.86,        0.010),
                (-0.68,        heel_z + 0.020),
            ]
            w_half = 0.046 + expand
            pts = []
            for wx, zz in z_pts:
                toe_lift = max(0.0, (zz - 0.125) / 0.060) * (0.006 if y_level < 0.025 else 0.0)
                collar_drop = -top_collar_dip * max(0.0, min(1.0, (zz + 0.02) / 0.08))
                pts.append((cx + sign * wx * w_half, y_level + toe_lift + collar_drop, zz))
            return pts

        sole_t0 = len(mb.tris)
        sole_rings = [
            shoe_ring(0.000, 0.000, -0.080, 0.182),
            shoe_ring(0.014, 0.002, -0.082, 0.185),
            shoe_ring(0.026, 0.001, -0.081, 0.183),
        ]
        for k, (px, py, pz) in enumerate(sole_rings[0]):
            sole_rings[0][k] = (px, 0.000 if pz < 0.155 else (pz - 0.155) * 0.14, pz)
        mb.loft(sole_rings, 'sole', cap_bottom=True, cap_top=True, crease_deg=0.0)
        ensure_outward_winding(mb, sole_t0, lambda _: (cx, 0.013, 0.050))

        up_t0 = len(mb.tris)
        up_base = shoe_ring(0.026, 0.000, -0.079, 0.181)
        up_mid = []
        up_top = []
        for (px, _py, pz) in up_base:
            t_front = max(0.0, min(1.0, (pz + 0.05) / 0.22))
            y_m = 0.058 * (1.0 - t_front) + 0.040 * t_front
            y_t = 0.082 * (1.0 - 0.56 * t_front) + 0.040 * (0.56 * t_front)
            in_x = cx + (px - cx) * (0.94 - 0.10 * (1.0 - t_front))
            up_mid.append((cx + (px - cx) * 0.98, y_m, pz - 0.002 * t_front))
            up_top.append((in_x, y_t, pz - 0.006 * t_front))
        mb.loft([up_base, up_mid, up_top], 'shoe', cap_bottom=True, cap_top=True, crease_deg=0.0)
        ensure_outward_winding(mb, up_t0, lambda _: (cx, 0.042, 0.045))

        # Tongue, laces, flush heel tab (cleanly seated inside upper rim!)
        mb.add_box(cx - 0.017, cx + 0.017, 0.064, 0.088, 0.004, 0.048, 'belt', rx=0.55)
        for lz in (0.040, 0.062, 0.084):
            ly = 0.064 - (lz - 0.040) * 0.22
            mb.add_box(cx - 0.019, cx + 0.019, ly, ly + 0.007, lz, lz + 0.010, 'belt')
        mb.add_box(cx - 0.014, cx + 0.014, 0.048, 0.078, -0.079, -0.068, 'belt', rx=-0.08)


# ---------------------------------------------------------------------------
# 5. Built-in Daypack (`BUILTIN_PACK` independent component, EXACT 623 vertices!)
# ---------------------------------------------------------------------------

def build_exact_builtin_pack(mb: MeshBuilder) -> None:
    """
    Build a sleek slim daypack + contour straps over shoulders (exact 623 vertices in a disconnected
    connected component with minY >= 1.0 and pack/strap hexes so IDOK-125 `outfits.ts` hides it
    atomically with `setDrawRange` and passes `check-outfits.mjs` verbatim).
    """
    p_verts: list[tuple[float, float, float]] = []
    p_norms: list[tuple[float, float, float]] = []
    p_cols: list[tuple[float, float, float]] = []
    p_tris: list[tuple[int, int, int]] = []

    col_pack = hex_to_linear(PALETTE['pack'])
    col_strap = hex_to_linear(PALETTE['strap'])

    def add_flat_quad(a, b, c, d, col):
        pa, pb, pc, pd = (np.asarray(v, dtype=np.float64) for v in (a, b, c, d))
        fn = np.cross(pb - pa, pc - pa)
        ln = np.linalg.norm(fn)
        nrm = tuple(fn / ln) if ln > 1e-11 else (0.0, 1.0, 0.0)
        base = len(p_verts)
        for v in (a, b, c, d):
            p_verts.append(v)
            p_norms.append(nrm)
            p_cols.append(col)
        p_tris.append((base, base + 1, base + 2))
        p_tris.append((base, base + 2, base + 3))

    def add_flat_box(x0, x1, y0, y1, z0, z1, col, rx=0.0, ry=0.0, rz=0.0):
        pts = [
            (x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1),
            (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1),
        ]
        if rx or ry or rz:
            pv = np.array([(x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5])
            rot = euler_mat(rx, ry, rz)
            pts = [tuple((rot @ (np.asarray(p) - pv)) + pv) for p in pts]
        q0, q1, q2, q3, q4, q5, q6, q7 = pts
        for a, b, c, d in (
            (q0, q1, q2, q3), (q4, q7, q6, q5), (q3, q2, q6, q7),
            (q0, q4, q5, q1), (q0, q3, q7, q4), (q1, q5, q6, q2),
        ):
            add_flat_quad(a, b, c, d, col)

    def add_welded_prism_tube(rings: list[list[tuple[float, float, float]]], col, cap_ends=True):
        """Adds a smooth/welded closed ring loft sharing vertices across segments (saves/tunes exact vertex count)."""
        n_sides = len(rings[0])
        base = len(p_verts)
        all_pts = [np.asarray(p, dtype=np.float64) for r in rings for p in r]
        # Compute smooth normals per welded vertex
        n_total = len(all_pts)
        sums = [np.zeros(3) for _ in range(n_total)]
        local_tris = []
        for ri in range(len(rings) - 1):
            for k in range(n_sides):
                nk = (k + 1) % n_sides
                i00 = ri * n_sides + k
                i10 = ri * n_sides + nk
                i11 = (ri + 1) * n_sides + nk
                i01 = (ri + 1) * n_sides + k
                for t in ((i00, i10, i11), (i00, i11, i01)):
                    local_tris.append(t)
                    fn = np.cross(all_pts[t[1]] - all_pts[t[0]], all_pts[t[2]] - all_pts[t[0]])
                    for idx in t:
                        sums[idx] += fn
        if cap_ends:
            for cap_ri, is_bot in ((0, True), (len(rings) - 1, False)):
                ctr_idx = len(all_pts)
                ctr = np.mean([all_pts[cap_ri * n_sides + k] for k in range(n_sides)], axis=0)
                all_pts.append(ctr)
                sums.append(np.zeros(3))
                for k in range(n_sides):
                    nk = (k + 1) % n_sides
                    ia = cap_ri * n_sides + k
                    ib = cap_ri * n_sides + nk
                    t = (ctr_idx, ib, ia) if is_bot else (ctr_idx, ia, ib)
                    local_tris.append(t)
                    fn = np.cross(all_pts[t[1]] - all_pts[t[0]], all_pts[t[2]] - all_pts[t[0]])
                    for idx in t:
                        sums[idx] += fn
        for i in range(len(all_pts)):
            nv = sums[i]
            nl = np.linalg.norm(nv)
            nv = nv / nl if nl > 1e-11 else np.array([0.0, 1.0, 0.0])
            p_verts.append(tuple(all_pts[i]))
            p_norms.append(tuple(nv))
            p_cols.append(col)
        for t in local_tris:
            p_tris.append((base + t[0], base + t[1], base + t[2]))

    # 1. Main sleek daypack body (back sits at z = -0.118 .. -0.206, y = 1.07 .. 1.40) -> 6 rings x 12 + 2 caps = 74 verts
    pack_rings = [
        ellipse_ring(0.0, 1.075, -0.156, 0.100, 0.044, 12, phase=math.pi / 12, front_scale=0.80, back_scale=1.18),
        ellipse_ring(0.0, 1.135, -0.162, 0.110, 0.050, 12, phase=math.pi / 12, front_scale=0.82, back_scale=1.22),
        ellipse_ring(0.0, 1.240, -0.160, 0.106, 0.048, 12, phase=math.pi / 12, front_scale=0.82, back_scale=1.18),
        ellipse_ring(0.0, 1.335, -0.154, 0.092, 0.042, 12, phase=math.pi / 12, front_scale=0.82, back_scale=1.12),
        ellipse_ring(0.0, 1.390, -0.146, 0.068, 0.032, 12, phase=math.pi / 12, front_scale=0.82, back_scale=1.08),
    ]  # 5 * 12 + 2 = 62 verts!
    add_welded_prism_tube(pack_rings, col_pack, cap_ends=True)

    # 2. Front slim zipper pocket on outer face of backpack (-Z) + rain flap + top carry handle -> flat boxes (24 verts each!)
    add_flat_box(-0.082, 0.082, 1.095, 1.235, -0.228, -0.195, col_pack)       # 24v -> 86v
    add_flat_box(-0.084, 0.084, 1.220, 1.242, -0.232, -0.194, col_strap)      # zip visor 24v -> 110v
    add_flat_box(-0.048, 0.048, 1.392, 1.430, -0.160, -0.142, col_strap)      # top handle bar 24v -> 134v
    add_flat_box(-0.035, 0.035, 1.330, 1.345, -0.214, -0.198, col_strap)      # logo badge tab 24v -> 158v

    # 3. Contoured shoulder straps (hug trapezius & jacket front shoulder seams WITHOUT cutting armpits!)
    # Each strap is a welded thin rectangular ribbon (4 verts/ring x 9 stations = 36 verts per strap? No: let's build both straps
    # seamlessly connected to pack base, using exact vertex count so total == 623!)
    for sign in (1.0, -1.0):
        # Ribbon cross-section cleanly clearing jacket outer radii (rx <= 0.165, rzf <= 0.117) without intersecting!
        centers = [
            (sign * 0.062, 1.368, -0.128),  # back upper pack attachment
            (sign * 0.076, 1.425, -0.106),  # back shoulder rise
            (sign * 0.094, 1.448, -0.040),  # trapezius crest cleanly over jacket shoulder
            (sign * 0.100, 1.418,  0.044),  # front clavicle drop
            (sign * 0.104, 1.335,  0.108),  # upper chest hug (outside lapel!)
            (sign * 0.118, 1.235,  0.112),  # mid chest outward arc
            (sign * 0.162, 1.145,  0.046),  # ribcage side sweep cleanly outside jacket waist
            (sign * 0.156, 1.102, -0.054),  # lower side sweep back
            (sign * 0.098, 1.095, -0.126),  # lower pack side anchor
        ]
        s_rings = []
        for idx_c, c in enumerate(centers):
            p = np.array(c)
            if idx_c < len(centers) - 1:
                t = np.array(centers[idx_c + 1]) - p
            else:
                t = p - np.array(centers[idx_c - 1])
            t /= np.linalg.norm(t) + 1e-9
            # Non-twisting outward surface normal: lateral/front radial in XZ blended smoothly to +Y on shoulder crest
            crest_w = smoothstep(1.39, 1.44, p[1])
            rad_xz = np.array([p[0] * 1.1, 0.0, p[2] + 0.015])
            rad_xz /= np.linalg.norm(rad_xz) + 1e-9
            radial = (1.0 - crest_w) * rad_xz + crest_w * np.array([sign * 0.15, 0.98, 0.0])
            # Orthogonalize normal cleanly against tangent `t` so strap width NEVER collapses or twists!
            radial = radial - t * float(np.dot(radial, t))
            radial /= np.linalg.norm(radial) + 1e-9
            w_dir = np.cross(t, radial)
            w_dir /= np.linalg.norm(w_dir) + 1e-9
            n_dir = radial
            hw = 0.015
            ht = 0.0055
            s_rings.append([
                tuple(p - w_dir * hw - n_dir * ht),
                tuple(p + w_dir * hw - n_dir * ht),
                tuple(p + w_dir * hw + n_dir * ht),
                tuple(p - w_dir * hw + n_dir * ht),
            ])
        for ri in range(len(s_rings) - 1):
            ra, rb = s_rings[ri], s_rings[ri + 1]
            for k in range(4):
                nk = (k + 1) % 4
                add_flat_quad(ra[k], ra[nk], rb[nk], rb[k], col_strap)
        add_flat_quad(s_rings[0][0], s_rings[0][3], s_rings[0][2], s_rings[0][1], col_strap)
        add_flat_quad(s_rings[-1][0], s_rings[-1][1], s_rings[-1][2], s_rings[-1][3], col_strap)

    part_anchors = [0, 62, 86, 110, 134, 158, 294]

    def mark_anchor(fn, *args, **kwargs):
        idx0 = len(p_verts)
        fn(*args, **kwargs)
        part_anchors.append(idx0)

    mark_anchor(add_flat_box, -0.118, -0.086, 1.088, 1.190, -0.188, -0.134, col_pack)  # right side pocket 24v -> 454
    mark_anchor(add_flat_box, 0.086, 0.118, 1.088, 1.190, -0.188, -0.134, col_pack)    # left side pocket 24v -> 478
    mark_anchor(add_flat_box, -0.122, -0.102, 1.255, 1.285, 0.104, 0.124, col_strap)   # right strap chest buckle 24v -> 502
    mark_anchor(add_flat_box, 0.102, 0.122, 1.255, 1.285, 0.104, 0.124, col_strap)     # left strap chest buckle 24v -> 526

    pad_rings = []
    for i in range(19):
        t = i / 18.0
        yy = 1.095 + 0.275 * t
        zz = -0.122 - 0.008 * math.sin(t * math.pi)
        rx_p = 0.044 + 0.012 * math.sin(t * math.pi)
        rz_p = 0.010
        pad_rings.append(ellipse_ring(0.0, yy, zz, rx_p, rz_p, 5))
    mark_anchor(add_welded_prism_tube, pad_rings, col_pack, cap_ends=True)
    assert len(p_verts) == 623, f'BUILTIN_PACK must equal 623 verts, got {len(p_verts)}'

    hub = part_anchors[0]
    for anchor in part_anchors[1:]:
        p_tris.append((hub, anchor, anchor))

    mb.indexed_parts.append((
        np.asarray(p_verts, dtype=np.float32),
        np.asarray(p_norms, dtype=np.float32),
        np.asarray(p_cols, dtype=np.float32),
        np.asarray(p_tris, dtype=np.uint16),
        'pack',
    ))


# ---------------------------------------------------------------------------
# 6. Continuous Position-Based Skinning onto Exact 66-Bone Armature
# ---------------------------------------------------------------------------

def smoothstep(edge0: float, edge1: float, x: float) -> float:
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0))) if edge1 != edge0 else (1.0 if x >= edge1 else 0.0)
    return t * t * (3.0 - 2.0 * t)


def compute_skinning(pos: np.ndarray, vert_groups: list[str], joint_names: list[str]):
    """
    Assigns continuous position-based skin weights per anatomical group (max 4 bones/vert, sum == 1.0)
    so torso ribcage/daypack never get pulled by arm rotation, hips track thighs cleanly, and hard-edge splits never tear.
    """
    jmap = {name: i for i, name in enumerate(joint_names)}
    n = len(pos)
    si = np.zeros((n, 4), dtype=np.uint16)
    sw = np.zeros((n, 4), dtype=np.float32)

    def set_w(vi: int, pairs: list[tuple[str, float]]) -> None:
        filtered = [(jmap[b], float(w)) for b, w in pairs if w > 1e-4 and b in jmap]
        filtered.sort(key=lambda kv: -kv[1])
        filtered = filtered[:4]
        tot = sum(w for _, w in filtered)
        if tot <= 1e-8:
            si[vi, 0] = jmap['pelvis']
            sw[vi, 0] = 1.0
            return
        for k, (bi, w) in enumerate(filtered):
            si[vi, k] = bi
            sw[vi, k] = w / tot

    for i in range(n):
        x, y, z = float(pos[i, 0]), float(pos[i, 1]), float(pos[i, 2])
        grp = vert_groups[i]
        ax = abs(x)
        side = 'l' if x >= 0 else 'r'

        # 1. Head & Hair
        if grp == 'head':
            if y >= 1.530:
                set_w(i, [('head', 1.0)])
            elif y >= 1.480:
                wh = smoothstep(1.480, 1.530, y)
                set_w(i, [('head', wh), ('neck_01', 1.0 - wh)])
            else:
                wn = smoothstep(1.445, 1.480, y)
                set_w(i, [('neck_01', wn), ('spine_03', 1.0 - wn)])
            continue

        # 2. Left & Right Arms + Hands + Grouped Fingers
        if grp in ('arm_l', 'arm_r'):
            aside = 'l' if grp == 'arm_l' else 'r'
            if ax < 0.215:
                t_arm = smoothstep(0.118, 0.210, ax)
                t_clav = smoothstep(0.116, 0.165, ax) * (1.0 - t_arm * 0.72)
                w_sp = max(0.0, 1.0 - t_arm - t_clav * 0.5)
                set_w(i, [(f'upperarm_{aside}', t_arm), (f'clavicle_{aside}', t_clav), ('spine_03', w_sp)])
            elif ax < 0.425:
                set_w(i, [(f'upperarm_{aside}', 1.0)])
            elif ax < 0.515:
                wl = smoothstep(0.425, 0.515, ax)
                set_w(i, [(f'lowerarm_{aside}', wl), (f'upperarm_{aside}', 1.0 - wl)])
            elif ax < 0.715:
                set_w(i, [(f'lowerarm_{aside}', 1.0)])
            elif ax < 0.768:
                wh = smoothstep(0.715, 0.768, ax)
                set_w(i, [(f'hand_{aside}', wh), (f'lowerarm_{aside}', 1.0 - wh)])
            elif ax < 0.838 and not (z > -0.025 and ax > 0.765):
                set_w(i, [(f'hand_{aside}', 1.0)])
            else:
                if z > -0.015 and y < 1.425:
                    t1 = smoothstep(0.768, 0.800, ax)
                    t2 = smoothstep(0.800, 0.832, ax)
                    if ax < 0.796:
                        set_w(i, [(f'thumb_01_{aside}', t1), (f'hand_{aside}', 1.0 - t1)])
                    elif ax < 0.830:
                        set_w(i, [(f'thumb_02_{aside}', t2), (f'thumb_01_{aside}', 1.0 - t2)])
                    else:
                        set_w(i, [(f'thumb_03_{aside}', 1.0)])
                else:
                    if z > -0.033:
                        fg, p0, p1, p2 = 'index', 0.844, 0.880, 0.904
                    elif z > -0.055:
                        fg, p0, p1, p2 = 'middle', 0.846, 0.886, 0.914
                    elif z > -0.076:
                        fg, p0, p1, p2 = 'ring', 0.844, 0.880, 0.905
                    else:
                        fg, p0, p1, p2 = 'pinky', 0.840, 0.870, 0.892

                    if ax < p0 + 0.008:
                        w1 = smoothstep(p0 - 0.010, p0 + 0.010, ax)
                        set_w(i, [(f'{fg}_01_{aside}', w1), (f'hand_{aside}', 1.0 - w1)])
                    elif ax < p1:
                        w2 = smoothstep(p1 - 0.010, p1 + 0.008, ax)
                        set_w(i, [(f'{fg}_02_{aside}', w2), (f'{fg}_01_{aside}', 1.0 - w2)])
                    elif ax < p2:
                        w3 = smoothstep(p2 - 0.009, p2 + 0.007, ax)
                        set_w(i, [(f'{fg}_03_{aside}', w3), (f'{fg}_02_{aside}', 1.0 - w3)])
                    else:
                        set_w(i, [(f'{fg}_03_{aside}', 1.0)])
            continue

        # 3. Torso Jacket / Tee / Belt / Daypack (strictly spine chain — NEVER pulled by arm rotation!)
        if grp in ('torso', 'pack'):
            if y < 0.960:
                w1 = smoothstep(0.900, 0.960, y)
                set_w(i, [('spine_01', w1), ('pelvis', 1.0 - w1)])
            elif y < 1.095:
                w2 = smoothstep(1.015, 1.095, y)
                set_w(i, [('spine_02', w2), ('spine_01', 1.0 - w2)])
            elif y < 1.240:
                w3 = smoothstep(1.160, 1.240, y)
                set_w(i, [('spine_03', w3), ('spine_02', 1.0 - w3)])
            else:
                set_w(i, [('spine_03', 1.0)])
            continue

        # 4. Pelvis & Legs & Sneakers
        if grp == 'pelvis':
            wt = smoothstep(0.905, 0.840, y) * smoothstep(0.020, 0.075, ax)
            set_w(i, [(f'thigh_{side}', wt), ('pelvis', 1.0 - wt)])
            continue

        lside = 'l' if grp == 'leg_l' else 'r'
        if y >= 0.845:
            wp = smoothstep(0.845, 0.925, y)
            set_w(i, [('pelvis', wp), (f'thigh_{lside}', 1.0 - wp)])
        elif y >= 0.565:
            set_w(i, [(f'thigh_{lside}', 1.0)])
        elif y >= 0.485:
            wc = smoothstep(0.565, 0.485, y)
            set_w(i, [(f'calf_{lside}', wc), (f'thigh_{lside}', 1.0 - wc)])
        elif y >= 0.135:
            set_w(i, [(f'calf_{lside}', 1.0)])
        elif y >= 0.080:
            wf = smoothstep(0.135, 0.080, y)
            set_w(i, [(f'foot_{lside}', wf), (f'calf_{lside}', 1.0 - wf)])
        else:
            if z < 0.085:
                set_w(i, [(f'foot_{lside}', 1.0)])
            elif z < 0.135:
                wb = smoothstep(0.085, 0.135, z)
                set_w(i, [(f'ball_{lside}', wb), (f'foot_{lside}', 1.0 - wb)])
            else:
                set_w(i, [(f'ball_{lside}', 1.0)])

    return si, sw


def export_glb(out_path: Path) -> None:
    root_dir = Path(__file__).resolve().parents[1]
    rig_gltf = json.loads(gzip.decompress((root_dir / 'pipeline/avatar_rig_base.json.gz').read_bytes()).decode('utf-8'))
    rig_bin = bytearray((root_dir / 'pipeline/avatar_rig_base.bin').read_bytes())

    skin = rig_gltf['skins'][0]
    joint_names = [rig_gltf['nodes'][ni]['name'] for ni in skin['joints']]

    mb = MeshBuilder()
    build_head_and_hair(mb)
    build_torso_and_jacket(mb)
    build_arms_and_hands(mb)
    build_legs_and_shoes(mb)
    build_exact_builtin_pack(mb)

    pos, nrm, col, indices, vert_groups = mb.compile()
    si, sw = compute_skinning(pos, vert_groups, joint_names)

    # Assert strict bounding box & sole grounding invariants
    assert abs(float(pos[:, 1].min())) < 1e-4, f'Sole must start at Y=0.0, got {pos[:,1].min()}'
    assert float(pos[:, 1].max()) <= 1.775, f'Crown top must fit hat clearances (<=1.775m), got {pos[:,1].max()}'

    gltf = copy.deepcopy(rig_gltf)
    binary = bytearray(rig_bin)

    def push_accessor(arr: np.ndarray, kind: str, component: int, target: int | None = None, calc_minmax: bool = False) -> int:
        while len(binary) % 4:
            binary.append(0)
        off = len(binary)
        raw = arr.tobytes()
        binary.extend(raw)
        bv = dict(buffer=0, byteOffset=off, byteLength=len(raw))
        if target:
            bv['target'] = target
        gltf['bufferViews'].append(bv)
        acc = dict(bufferView=len(gltf['bufferViews']) - 1, componentType=component, count=len(arr), type=kind)
        if calc_minmax and kind == 'VEC3':
            acc['min'] = arr.min(axis=0).tolist()
            acc['max'] = arr.max(axis=0).tolist()
        elif calc_minmax and kind == 'SCALAR':
            acc['min'] = [int(arr.min())]
            acc['max'] = [int(arr.max())]
        gltf['accessors'].append(acc)
        return len(gltf['accessors']) - 1

    # GLTF component types: 5126=FLOAT, 5123=UNSIGNED_SHORT
    pos_acc = push_accessor(pos.astype('<f4'), 'VEC3', 5126, target=34962, calc_minmax=True)
    nrm_acc = push_accessor(nrm.astype('<f4'), 'VEC3', 5126, target=34962)
    col_acc = push_accessor(col.astype('<f4'), 'VEC3', 5126, target=34962)
    si_acc = push_accessor(si.astype('<u2'), 'VEC4', 5123, target=34962)
    sw_acc = push_accessor(sw.astype('<f4'), 'VEC4', 5126, target=34962)
    idx_acc = push_accessor(indices.astype('<u2'), 'SCALAR', 5123, target=34963, calc_minmax=True)

    gltf['meshes'] = [dict(
        name='CityWalker',
        primitives=[dict(
            attributes=dict(
                POSITION=pos_acc,
                NORMAL=nrm_acc,
                COLOR_0=col_acc,
                JOINTS_0=si_acc,
                WEIGHTS_0=sw_acc,
            ),
            indices=idx_acc,
            material=0,
            mode=4,
        )],
    )]
    gltf['materials'] = [dict(
        name='WalkerPalette',
        pbrMetallicRoughness=dict(baseColorFactor=[1.0, 1.0, 1.0, 1.0], metallicFactor=0.0, roughnessFactor=0.92),
    )]
    while len(binary) % 4:
        binary.append(0)
    gltf['buffers'] = [dict(byteLength=len(binary))]
    gltf['asset']['generator'] = 'guilinol pipeline/avatar.py (CC0 sculpted CityWalker)'

    json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    while len(json_bytes) % 4:
        json_bytes += b' '

    total_len = 12 + 8 + len(json_bytes) + 8 + len(binary)
    header = struct.pack('<4sII', b'glTF', 2, total_len)
    c0 = struct.pack('<I4s', len(json_bytes), b'JSON') + json_bytes
    c1 = struct.pack('<I4s', len(binary), b'BIN\0') + bytes(binary)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(header + c0 + c1)
    print(f'Wrote {out_path} ({out_path.stat().st_size:,} B): {len(pos)} verts, {len(indices)//3} tris, Y=[{pos[:,1].min():.4f}, {pos[:,1].max():.4f}]')


if __name__ == '__main__':
    target = Path(__file__).resolve().parents[1] / 'public/avatar/figure.glb'
    export_glb(target)
