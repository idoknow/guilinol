"""Build a CC0 low-poly Guilin street electric scooter (小电驴) for M5a (IDOK-15).

Follows pipeline/avatar.py and docs/style.md:
- Facing -Z, tires resting on y = 0, wheelbase ~1.14 m, saddle height ~0.71 m, handlebars ~0.98 m.
- Single vertex-colored primitive (1 draw call, InstancedMesh-ready).
- COLOR_0.rgb holds linear sRGB base color (neutral pale body panels are tinted per instance in WebGL);
  COLOR_0.a encodes lamp channel (1.0 = front warm headlamp, 0.5 = rear red tail lamp, 0.0 = body)
  so night lighting works in zero extra draw calls.

Usage: uv run python pipeline/ebike.py
"""
import json
import math
import struct
from pathlib import Path

import numpy as np


def srgb_to_linear(hex_val):
    srgb = [((hex_val >> shift) & 255) / 255.0 for shift in (16, 8, 0)]
    return np.array([c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb], dtype=np.float64)


C = {
    'body':      srgb_to_linear(0xe6e2d8),  # Tintable pale body shell
    'bodyShade': srgb_to_linear(0xc9c4b8),
    'floor':     srgb_to_linear(0x33393d),
    'seat':      srgb_to_linear(0x3d342e),
    'seatSide':  srgb_to_linear(0x2d2622),
    'tire':      srgb_to_linear(0x25292c),
    'rim':       srgb_to_linear(0xbab8b0),
    'metal':     srgb_to_linear(0x555c61),
    'grip':      srgb_to_linear(0x23272a),
    'headlamp':  srgb_to_linear(0xfff1cc),
    'taillamp':  srgb_to_linear(0xc93b32),
    'box':       srgb_to_linear(0xdad6cb),
}


class Geo:
    def __init__(self):
        self.tris = []
        self.cols = []

    def tri(self, p0, p1, p2, rgb, lamp=0.0):
        a = np.asarray(p0, dtype=np.float64)
        b = np.asarray(p1, dtype=np.float64)
        c = np.asarray(p2, dtype=np.float64)
        if np.linalg.norm(np.cross(b - a, c - a)) <= 1e-8:
            return
        rgba = np.array([rgb[0], rgb[1], rgb[2], lamp], dtype=np.float64)
        self.tris.append((a, b, c))
        self.cols.append((rgba, rgba, rgba))

    def quad(self, p0, p1, p2, p3, rgb, lamp=0.0):
        self.tri(p0, p1, p2, rgb, lamp)
        self.tri(p0, p2, p3, rgb, lamp)


def add_box(g: Geo, cx, cy, cz, sx, sy, sz, rgb, pitch=0.0, yaw=0.0, lamp=0.0):
    hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
    cp, sp = math.cos(pitch), math.sin(pitch)
    cyw, syw = math.cos(yaw), math.sin(yaw)

    def xf(lx, ly, lz):
        # Pitch around X, then yaw around Y
        y1 = ly * cp - lz * sp
        z1 = ly * sp + lz * cp
        x2 = lx * cyw + z1 * syw
        z2 = -lx * syw + z1 * cyw
        return (cx + x2, cy + y1, cz + z2)

    v = [
        xf(-hx, -hy, -hz), xf(hx, -hy, -hz), xf(hx, hy, -hz), xf(-hx, hy, -hz),
        xf(-hx, -hy,  hz), xf(hx, -hy,  hz), xf(hx, hy,  hz), xf(-hx, hy,  hz),
    ]
    faces = [
        (0, 3, 2, 1),  # -Z front
        (4, 5, 6, 7),  # +Z back
        (0, 4, 7, 3),  # -X left
        (1, 2, 6, 5),  # +X right
        (3, 7, 6, 2),  # +Y top
        (0, 1, 5, 4),  # -Y bottom
    ]
    for i0, i1, i2, i3 in faces:
        g.quad(v[i0], v[i1], v[i2], v[i3], rgb, lamp)


def add_wheel(g: Geo, cz, radius=0.225, width=0.105, sides=14):
    """Wheel aligned in YZ plane (axle along X), resting on y = 0."""
    cy = radius
    hx = width * 0.5
    pts_l, pts_r, hub_l, hub_r = [], [], [], []
    r_hub = radius * 0.56
    for i in range(sides):
        a = 2.0 * math.pi * i / sides
        y = cy + math.sin(a) * radius
        z = cz + math.cos(a) * radius
        yh = cy + math.sin(a) * r_hub
        zh = cz + math.cos(a) * r_hub
        pts_l.append((-hx, y, z))
        pts_r.append(( hx, y, z))
        hub_l.append((-hx - 0.008, yh, zh))
        hub_r.append(( hx + 0.008, yh, zh))

    for i in range(sides):
        j = (i + 1) % sides
        # Outer tread
        g.quad(pts_l[i], pts_r[i], pts_r[j], pts_l[j], C['tire'])
        # Tire sidewalls
        g.quad(pts_l[j], hub_l[j], hub_l[i], pts_l[i], C['tire'])
        g.quad(pts_r[i], hub_r[i], hub_r[j], pts_r[j], C['tire'])
        # Alloy wheel disc caps
        g.tri((-hx - 0.012, cy, cz), hub_l[i], hub_l[j], C['rim'])
        g.tri(( hx + 0.012, cy, cz), hub_r[j], hub_r[i], C['rim'])


def loft_body(g: Geo, rings, rgb, cap_ends=True):
    n = len(rings[0])
    # Ensure consistent outward normals along ring stack
    c_all = np.mean([p for r in rings for p in r], axis=0)
    for k in range(len(rings) - 1):
        r0, r1 = rings[k], rings[k + 1]
        for i in range(n):
            j = (i + 1) % n
            p00, p01, p11, p10 = r0[i], r0[j], r1[j], r1[i]
            mid = (np.asarray(p00) + np.asarray(p01) + np.asarray(p11)) / 3.0
            nrm = np.cross(np.asarray(p01) - np.asarray(p00), np.asarray(p11) - np.asarray(p00))
            if np.dot(nrm, mid - c_all) >= 0:
                g.quad(p00, p01, p11, p10, rgb)
            else:
                g.quad(p00, p10, p11, p01, rgb)
    if cap_ends:
        for ring_pts in (rings[0], rings[-1]):
            rc = tuple(np.mean(ring_pts, axis=0))
            for i in range(n):
                j = (i + 1) % n
                mid = (np.asarray(ring_pts[i]) + np.asarray(ring_pts[j]) + np.asarray(rc)) / 3.0
                nrm = np.cross(np.asarray(ring_pts[j]) - np.asarray(ring_pts[i]), np.asarray(rc) - np.asarray(ring_pts[i]))
                if np.dot(nrm, mid - c_all) >= 0:
                    g.tri(ring_pts[i], ring_pts[j], rc, rgb)
                else:
                    g.tri(ring_pts[j], ring_pts[i], rc, rgb)


def build_ebike():
    g = Geo()

    # 1. Front & rear wheels (wheelbase 1.14 m)
    add_wheel(g, cz=-0.57, radius=0.225, width=0.105)
    add_wheel(g, cz=0.57,  radius=0.225, width=0.115)

    # 2. Front fender + telescopic fork legs
    add_box(g, 0.0, 0.44, -0.55, 0.16, 0.06, 0.28, C['body'], pitch=0.28)
    for sx in (-0.085, 0.085):
        add_box(g, sx, 0.46, -0.50, 0.036, 0.50, 0.038, C['metal'], pitch=-0.26)

    # 3. Step-through flat floorboard + underframe battery box
    add_box(g, 0.0, 0.25, -0.06, 0.36, 0.075, 0.58, C['floor'])
    add_box(g, 0.0, 0.20, -0.04, 0.30, 0.06,  0.52, C['metal'])

    # 4. Sculpted front leg-shield apron (classic rounded Guilin scooter shield)
    apron_rings = [
        [(-0.17, 0.26, -0.33), (0.17, 0.26, -0.33), (0.19, 0.28, -0.45), (-0.19, 0.28, -0.45)],
        [(-0.18, 0.50, -0.36), (0.18, 0.50, -0.36), (0.21, 0.52, -0.51), (-0.21, 0.52, -0.51)],
        [(-0.17, 0.76, -0.38), (0.17, 0.76, -0.38), (0.20, 0.78, -0.52), (-0.20, 0.78, -0.52)],
        [(-0.13, 0.90, -0.39), (0.13, 0.90, -0.39), (0.15, 0.91, -0.49), (-0.15, 0.91, -0.49)],
    ]
    loft_body(g, apron_rings, C['body'])
    # Inner dark knee panel + utility bag hook
    add_box(g, 0.0, 0.58, -0.355, 0.28, 0.46, 0.03, C['floor'], pitch=-0.08)

    # 5. Rear under-seat body shell (sweeping up toward tail)
    rear_rings = [
        [(-0.17, 0.26, 0.20), (0.17, 0.26, 0.20), (0.17, 0.58, 0.14), (-0.17, 0.58, 0.14)],
        [(-0.20, 0.34, 0.46), (0.20, 0.34, 0.46), (0.20, 0.65, 0.44), (-0.20, 0.65, 0.44)],
        [(-0.16, 0.44, 0.72), (0.16, 0.44, 0.72), (0.16, 0.66, 0.70), (-0.16, 0.66, 0.70)],
    ]
    loft_body(g, rear_rings, C['body'])
    # Rear mudguard flap
    add_box(g, 0.0, 0.36, 0.74, 0.15, 0.20, 0.04, C['floor'], pitch=0.35)

    # 6. Two-up cushioned saddle (y_top = 0.72 m, rider sits around z = +0.08..+0.16)
    add_box(g, 0.0, 0.66, 0.26, 0.29, 0.11, 0.54, C['seat'], pitch=-0.04)
    add_box(g, 0.0, 0.62, 0.26, 0.305, 0.05, 0.55, C['seatSide'], pitch=-0.04)

    # 7. Compact rear commuter tailbox (尾箱) + red brake/tail lamp
    add_box(g, 0.0, 0.78, 0.67, 0.31, 0.22, 0.25, C['box'])
    add_box(g, 0.0, 0.77, 0.67, 0.32, 0.03, 0.26, C['floor'])
    add_box(g, 0.0, 0.63, 0.73, 0.16, 0.055, 0.03, C['taillamp'], lamp=0.5)

    # 8. Handlebar cowl, round LED headlamp, handlebars, grips & stem mirrors
    add_box(g, 0.0, 0.95, -0.43, 0.22, 0.11, 0.13, C['body'])
    add_box(g, 0.0, 0.99, -0.40, 0.13, 0.04, 0.08, C['floor'], pitch=-0.4)
    # Round warm headlamp on front apron / cowl (lamp=1.0 -> glows warm at night!)
    add_box(g, 0.0, 0.84, -0.525, 0.14, 0.12, 0.04, C['headlamp'], lamp=1.0)
    # Left & right handlebar bars + black rubber grips + rear-view mirrors
    for sx in (-1.0, 1.0):
        add_box(g, sx * 0.20, 0.97, -0.41, 0.22, 0.032, 0.032, C['metal'], yaw=sx * 0.18)
        add_box(g, sx * 0.31, 0.97, -0.39, 0.11, 0.042, 0.042, C['grip'], yaw=sx * 0.18)
        # Mirror stalk + mirror head
        add_box(g, sx * 0.24, 1.06, -0.41, 0.016, 0.16, 0.016, C['metal'], yaw=0.0)
        add_box(g, sx * 0.27, 1.14, -0.41, 0.085, 0.055, 0.024, C['bodyShade'])

    # 9. Side kickstand on left side (subtle parked detail)
    add_box(g, -0.17, 0.11, 0.05, 0.022, 0.22, 0.022, C['metal'], pitch=0.32)

    return g


def write_glb(g: Geo, target: Path):
    tris = np.asarray(g.tris, dtype='<f4')
    cols = np.asarray(g.cols, dtype='<f4')
    normals = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    lens = np.linalg.norm(normals, axis=1, keepdims=True)
    valid = lens[:, 0] > 1e-8
    tris = tris[valid]
    cols = cols[valid]
    normals = normals[valid] / lens[valid]

    positions = tris.reshape(-1, 3).astype('<f4')
    vert_normals = np.repeat(normals, 3, axis=0).astype('<f4')
    vert_colors = np.clip(np.rint(cols.reshape(-1, 4) * 255.0), 0, 255).astype('<u1')

    binary = bytearray()
    views, accessors = [], []

    def add_acc(arr, kind, comp, normalized=False, bounds=False):
        while len(binary) % 4:
            binary.append(0)
        off = len(binary)
        raw = arr.tobytes()
        binary.extend(raw)
        views.append(dict(buffer=0, byteOffset=off, byteLength=len(raw), target=34962))
        acc = dict(bufferView=len(views) - 1, componentType=comp, count=len(arr), type=kind)
        if normalized:
            acc['normalized'] = True
        if bounds:
            acc['min'] = arr.min(axis=0).astype(float).tolist()
            acc['max'] = arr.max(axis=0).astype(float).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    pos_i = add_acc(positions, 'VEC3', 5126, bounds=True)
    nrm_i = add_acc(vert_normals, 'VEC3', 5126)
    col_i = add_acc(vert_colors, 'VEC4', 5121, normalized=True)

    while len(binary) % 4:
        binary.append(0)

    doc = dict(
        asset=dict(version='2.0', generator='guilinol pipeline/ebike.py', copyright='CC0-1.0'),
        scene=0,
        scenes=[dict(nodes=[0])],
        nodes=[dict(name='Ebike', mesh=0)],
        meshes=[dict(
            name='EbikeMesh',
            primitives=[dict(attributes=dict(POSITION=pos_i, NORMAL=nrm_i, COLOR_0=col_i), material=0)],
        )],
        materials=[dict(
            name='ebikeMat',
            pbrMetallicRoughness=dict(baseColorFactor=[1.0, 1.0, 1.0, 1.0], metallicFactor=0.05, roughnessFactor=0.82),
        )],
        accessors=accessors,
        bufferViews=views,
        buffers=[dict(byteLength=len(binary))],
    )

    text = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    text += b' ' * (-len(text) % 4)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(
        struct.pack('<4sII', b'glTF', 2, 28 + len(text) + len(binary))
        + struct.pack('<I4s', len(text), b'JSON')
        + text
        + struct.pack('<I4s', len(binary), b'BIN\0')
        + binary
    )
    print(f'{target} | {target.stat().st_size:,} B | {len(tris)} tris')


if __name__ == '__main__':
    write_glb(build_ebike(), Path(__file__).resolve().parents[1] / 'public/avatar/ebike.glb')
