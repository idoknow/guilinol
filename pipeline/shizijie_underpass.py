"""Shizijie real underground passage geometry, crosswalk cleanup, and surface stairwell builders.

Single source of truth shared by:
- pipeline/landmarks/shizijie.py (NW / NE / SE surface stairwells & apron holes)
- pipeline/landmarks/nikoniko.py (SW surface stairwell & apron hole)
- pipeline/streets.py (crosswalk bar/gap suppression inside Shizijie core while keeping stop lines)
- pipeline/traffic.py (15 OSM tunnel=yes, layer=-1 ways + stair links at -4.2 m depth)
- pipeline/world.py (surgical post-restore hook for 101_38.glc, roads/, manifest.groundCutouts)
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import OUT, ll2xz, load_osm

SHIZIJIE_ORIGIN = (-879.7502021582604, -169.62604470000713)
NIKONIKO_ORIGIN = (-974.9045970485561, -121.58610126568682)
SHIZIJIE_SURFACE_Y = 151.3
UNDERPASS_DEPTH = 4.2
INTERSECTION_CLEAR_RADIUS = 48.0

# Real OSM way IDs forming the Shizijie "小香港" underground commercial complex & approaches
SHIZIJIE_UNDERPASS_WAYS = (
    985734873, 985734874, 985734875, 985734876, 985734877,
    985734878, 985734879, 985734880, 985734881, 985734882,
    985734883, 985734884, 985734885, 985734886, 985734888,
)
RING_WAY_ID = 985734888

# Canonical surface stairwells in Shizijie local XZ:
# -Z (lz = -length/2) is the open street/plaza entrance mouth (guarded by 3 bollards).
# +Z (lz = +length/2) descends down -4.2m into the underground lobby & ring hall.
STAIRWELLS = (
    {
        'id': 'shizijie_stair_nw',
        'corner': 'nw',
        'label': '南方大厦 · NW出口',
        'shizijie': (-22.5, -38.8),
        'yawDeg': 72.0,
        'width': 3.4,
        'length': 9.0,
        'targetNodeHint': (-16.46, -33.80),
    },
    {
        'id': 'shizijie_stair_ne',
        'corner': 'ne',
        'label': '解放东路 · NE出口',
        'shizijie': (43.0, -23.0),
        'yawDeg': -45.0,
        'width': 3.4,
        'length': 9.0,
        'targetNodeHint': (38.54, -24.30),
    },
    {
        'id': 'shizijie_stair_se',
        'corner': 'se',
        'label': '文化大厦 · SE出口',
        'shizijie': (22.5, 46.5),
        'yawDeg': -158.0,
        'width': 3.4,
        'length': 9.0,
        'targetNodeHint': (20.32, 40.13),
    },
    {
        'id': 'shizijie_stair_sw',
        'corner': 'sw',
        'label': '微笑堂 · SW出口',
        'shizijie': (-46.2, 21.5),
        'yawDeg': -131.2,
        'width': 3.2,
        'length': 8.8,
        'targetNodeHint': (-42.17, 21.60),
    },
)

RESERVED_SHUTTERS = [
    f'XH-{i:02d}' for i in range(1, 17)
]

SHELL_SHOPS = [
    ('小香港 · 漓江米粉', '#e65100', '#ffe0b2'),
    ('桂林三宝手信坊', '#b71c1c', '#ffd54f'),
    ('阳朔鲜果茶饮', '#00695c', '#b2dfdb'),
    ('正阳潮玩盲盒社', '#6a1b9a', '#e1bee7'),
    ('潮流数码配件站', '#1565c0', '#bbdefb'),
    ('港式冰室甜品屋', '#ad1457', '#f8bbd0'),
    ('复古黑胶与明信片', '#37474f', '#cfd8dc'),
    ('手作银饰工坊', '#4e342e', '#ffe082'),
    ('二次元谷子集市', '#283593', '#90caf9'),
    ('精品美妆集合店', '#c2185b', '#fce4ec'),
    ('街头运动潮鞋馆', '#212121', '#76ff03'),
    ('象山文创纪念馆', '#00838f', '#b2ebf2'),
    ('手工鲜奶麻薯铺', '#f57f17', '#fff9c4'),
    ('眼镜快配工坊', '#0277bd', '#e1f5fe'),
    ('港风复古穿搭馆', '#4a148c', '#f3e5f5'),
    ('24H地下便利店', '#2e7d32', '#c8e6c9'),
]


def stair_local_to_frame(lx: float, lz: float, center_xz: tuple[float, float], yaw_rad: float) -> tuple[float, float]:
    """Transform local (lx, lz) in builder Three.js Y-rotation convention to target XZ frame."""
    cx, cz = center_xz
    c, s = math.cos(yaw_rad), math.sin(yaw_rad)
    return (cx + lx * c + lz * s, cz - lx * s + lz * c)


def stair_for_origin(stair: dict, target_origin: tuple[float, float]) -> tuple[float, float, float]:
    """Return (cx, cz, yaw_rad) relative to `target_origin`."""
    sx, sz = SHIZIJIE_ORIGIN
    ox, oz = target_origin
    cx = stair['shizijie'][0] + sx - ox
    cz = stair['shizijie'][1] + sz - oz
    return cx, cz, math.radians(stair['yawDeg'])


def stair_hole_ring(stair: dict, target_origin: tuple[float, float] = (0.0, 0.0), margin: float = 0.0) -> list[tuple[float, float]]:
    """Return CCW rectangle corners of a stairwell opening relative to `target_origin`."""
    cx, cz, yaw = stair_for_origin(stair, target_origin)
    hw = stair['width'] * 0.5 + margin
    hl = stair['length'] * 0.5 + margin
    pts = [stair_local_to_frame(lx, lz, (cx, cz), yaw) for lx, lz in ((-hw, -hl), (hw, -hl), (hw, hl), (-hw, hl))]
    poly = Polygon(pts)
    if poly.exterior.is_ccw:
        return [(float(x), float(z)) for x, z in pts]
    return [(float(x), float(z)) for x, z in reversed(pts)]


STAIR_RISERS = 28
STAIR_TREAD = 0.3


def stair_opening_ring(stair: dict, target_origin: tuple[float, float] = (0.0, 0.0), margin: float = 0.0) -> list[tuple[float, float]]:
    """Return CCW corners of the open well only: first nosing to bottom nosing.

    The top landing (mouth to first nosing) stays street paving; the runtime cuts terrain and streets to the
    same rectangle (web/src/shizijie/frame.ts), and its stairwell geometry covers the walls and the B1 door.
    """
    cx, cz, yaw = stair_for_origin(stair, target_origin)
    hw = stair['width'] * 0.5 + margin
    hl = stair['length'] * 0.5
    z0 = -hl + (stair['length'] - STAIR_RISERS * STAIR_TREAD) - margin
    z1 = hl + margin
    pts = [stair_local_to_frame(lx, lz, (cx, cz), yaw) for lx, lz in ((-hw, z0), (hw, z0), (hw, z1), (-hw, z1))]
    if Polygon(pts).exterior.is_ccw:
        return [(float(x), float(z)) for x, z in pts]
    return [(float(x), float(z)) for x, z in reversed(pts)]


def stair_hole_world_poly(stair: dict, margin: float = 0.0) -> Polygon:
    return Polygon(stair_hole_ring(stair, (0.0, 0.0), margin))


def in_shizijie_clear_zone(x: float, z: float, radius: float = INTERSECTION_CLEAR_RADIUS) -> bool:
    return math.hypot(x - SHIZIJIE_ORIGIN[0], z - SHIZIJIE_ORIGIN[1]) <= radius


def build_surface_stairwell(
    m,
    stair: dict,
    origin: tuple[float, float],
    *,
    frame_mat: str = 'alum',
    parapet_mat: str = 'dark',
    glass_mat: str = 'glass',
    bollard_mat: str = 'red',
    roof_mat: str = 'alum',
    header_sign_key: str | None = None,
):
    """Add an above-ground open-front blue-glass canopy, 3-sided parapet, and 3 bollards.

    All footing vertices snap to surface ground via footing=True so audit_grounding stays in [-0.30, +0.15]m.
    No sub-surface geometry is emitted into landmark GLBs (walkable stairs & ring live in web/src/tunnels.ts).
    """
    cx, cz, yaw = stair_for_origin(stair, origin)
    w = stair['width']
    l = stair['length']
    hw = w * 0.5
    hl = l * 0.5
    y0 = float(m.surface.ground(cx, cz))
    prev_grade = getattr(m, 'follow_grade', False)
    m.follow_grade = False
    m.pose = (cx, y0, cz, yaw)

    # 3-sided granite base curb wall (left, right, and deep +Z end; -Z mouth stays open for entry)
    wall_t = 0.24
    wall_h = 0.52
    m.box(-hw - wall_t * 0.5, 0.0, 0.0, wall_t, wall_h, l + wall_t, parapet_mat, collide=True, footing=True)
    m.box(hw + wall_t * 0.5, 0.0, 0.0, wall_t, wall_h, l + wall_t, parapet_mat, collide=True, footing=True)
    m.box(0.0, 0.0, hl + wall_t * 0.5, w + wall_t * 2, wall_h + 0.52, wall_t, parapet_mat, collide=True, footing=True)

    # Side glass balustrades + aluminum handrails above granite curb (total guard height ~1.06 m)
    for sx_side in (-hw - wall_t * 0.5, hw + wall_t * 0.5):
        m.box(sx_side, wall_h, 0.0, 0.06, 0.50, l, glass_mat)
        m.box(sx_side, wall_h + 0.50, 0.0, 0.11, 0.06, l + wall_t, frame_mat)
        for z_post in np.linspace(-hl + 0.2, hl - 0.2, 5):
            m.box(sx_side, wall_h, float(z_post), 0.09, 0.52, 0.09, frame_mat)

    # Cantilevered sloped blue-glass subway/underpass canopy (high at -Z entrance, tapering to +Z end)
    col_zs = (-hl + 0.35, -hl + 3.2, hl - 2.6, hl - 0.15)
    for zc in col_zs:
        t_prog = (zc + hl) / l
        top_h = 3.18 - 0.90 * t_prog
        for xc in (-hw - wall_t * 0.5, hw + wall_t * 0.5):
            m.box(xc, wall_h, float(zc), 0.12, top_h - wall_h, 0.12, frame_mat, collide=True)

    # Sloped canopy roof glass & perimeter steel fascia
    over_w = w + wall_t * 2 + 0.36
    hw_roof = over_w * 0.5
    zf, zb = -hl - 0.35, hl + 0.35
    yf, yb = 3.24, 2.28
    roof_verts = [
        (-hw_roof, yf, zf), (hw_roof, yf, zf),
        (hw_roof, yb, zb), (-hw_roof, yb, zb),
    ]
    m.mesh(roof_verts, [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]], glass_mat)
    # Ridge beams & entrance fascia header above -Z mouth
    m.beam([-hw_roof, yf, zf], [hw_roof, yf, zf], 0.075, frame_mat, sections=6)
    m.beam([-hw_roof, yb, zb], [hw_roof, yb, zb], 0.075, frame_mat, sections=6)
    m.beam([-hw_roof, yf, zf], [-hw_roof, yb, zb], 0.075, frame_mat, sections=6)
    m.beam([hw_roof, yf, zf], [hw_roof, yb, zb], 0.075, frame_mat, sections=6)
    if m.detail:
        for t_rib in np.linspace(0.2, 0.8, 4):
            zr = zf + t_rib * (zb - zf)
            yr = yf + t_rib * (yb - yf)
            m.beam([-hw_roof, yr, zr], [hw_roof, yr, zr], 0.045, frame_mat, sections=4)
    # Entrance header accent band ("十字街地下通道 · 小香港") at -Z portal (high clearance y=2.62..3.18m)
    m.box(0.0, yf - 0.52, zf + 0.12, over_w, 0.50, 0.22, roof_mat)
    if header_sign_key:
        if header_sign_key == 'xiaoxianggang' and hasattr(m, 'sign_quad'):
            m.sign_quad(0.0, yf - 0.49, zf + 0.02, over_w - 0.26, 0.42, header_sign_key, double_sided=True)
        elif hasattr(m, 'shop_sign_quad'):
            m.shop_sign_quad(0.0, yf - 0.49, zf + 0.02, over_w - 0.26, 0.42, header_sign_key, double_sided=True)

    # 3 anti-ebike/car stainless/red bollards across open -Z entrance mouth
    # Clear gap between outer edge and bollards is ~0.82m (walkers pass freely; motorbikes blocked)
    for bx in (-0.95, 0.0, 0.95):
        by_local = float(m.surface.ground(*stair_local_to_frame(bx, -hl - 0.35, (cx, cz), yaw))) - y0
        m.cylinder_y(bx, by_local - 0.03, 0.68, -hl - 0.35, 0.09, frame_mat, sections=10 if m.detail else 6, collide=True)
        m.cylinder_y(bx, by_local + 0.65, 0.22, -hl - 0.35, 0.092, bollard_mat, sections=10 if m.detail else 6)

    m.pose = (0.0, 0.0, 0.0, 0.0)
    m.follow_grade = prev_grade


def _build_bays_on_ring(ring_pts: list[list[float]], skip_points: list[tuple[float, float]]) -> tuple[list[dict], list[dict]]:
    """Distribute 16 reserved shutter bays (XH-01..16) and 16 illuminated shell shops along the outer perimeter of way/985734888."""
    poly = Polygon(ring_pts)
    centroid = np.array([poly.centroid.x, poly.centroid.y])
    if not poly.exterior.is_ccw:
        ring_pts = list(reversed(ring_pts))
    line = LineString(ring_pts)
    total_len = line.length
    # Sample candidates along outer wall, keeping bays clear of radial corridor mouths
    candidates = []
    n_cand = 72
    for i in range(n_cand):
        s = (i + 0.5) / n_cand * total_len
        p = line.interpolate(s)
        p_a = line.interpolate(max(0.0, s - 0.8))
        p_b = line.interpolate(min(total_len, s + 0.8))
        dx, dz = p_b.x - p_a.x, p_b.y - p_a.y
        tangent_len = max(1e-6, math.hypot(dx, dz))
        tx, tz = dx / tangent_len, dz / tangent_len
        # Outward normal away from ring centroid
        nx, nz = tz, -tx
        if (p.x - centroid[0]) * nx + (p.y - centroid[1]) * nz < 0:
            nx, nz = -nx, -nz
        bx, bz = p.x + nx * 2.75, p.y + nz * 2.75
        min_skip = min((math.hypot(bx - sx, bz - sz) for sx, sz in skip_points), default=99.0)
        if min_skip < 3.6:
            continue
        yaw = math.atan2(-nx, -nz)
        candidates.append((s, bx, bz, yaw, min_skip))

    if len(candidates) >= 32:
        step = len(candidates) / 32.0
        chosen = [candidates[int(i * step)] for i in range(32)]
    else:
        chosen = candidates

    shutters, shops = [], []
    for idx, (_, bx, bz, yaw, _) in enumerate(chosen):
        base = {'x': round(bx, 2), 'z': round(bz, 2), 'yaw': round(yaw, 4), 'width': 2.8, 'height': 2.8}
        if idx % 2 == 0 and len(shutters) < 16:
            sh = dict(base)
            sh['code'] = RESERVED_SHUTTERS[len(shutters)]
            shutters.append(sh)
        elif len(shops) < 16:
            name, accent, glow = SHELL_SHOPS[len(shops)]
            sp = dict(base)
            sp['name'] = name
            sp['accent'] = accent
            sp['glow'] = glow
            sp['index'] = len(shops)
            shops.append(sp)
        elif len(shutters) < 16:
            sh = dict(base)
            sh['code'] = RESERVED_SHUTTERS[len(shutters)]
            shutters.append(sh)
    return shutters, shops


def build_manifest_data(surface_sampler=None) -> tuple[list[dict], dict]:
    """Generate `groundCutouts` and `shizijieUnderpass` specs for `public/world/manifest.json`."""
    def sample_ground_y(wx: float, wz: float) -> float:
        if surface_sampler is not None:
            return float(surface_sampler(wx, wz))
        return SHIZIJIE_SURFACE_Y

    floor_y = round(sample_ground_y(*SHIZIJIE_ORIGIN) - UNDERPASS_DEPTH, 2)
    els = load_osm()
    by_id = {e['id']: e for e in els if e.get('type') == 'way'}

    corridors = []
    ring_pts = []
    for wid in SHIZIJIE_UNDERPASS_WAYS:
        w = by_id.get(wid)
        if not w:
            continue
        pts = [[round(x, 2), round(z, 2)] for x, z in (ll2xz(v['lat'], v['lon']) for v in w['geometry'])]
        if wid == RING_WAY_ID:
            ring_pts = pts[:-1] if len(pts) > 2 and pts[0] == pts[-1] else pts
        else:
            corridors.append({'way': wid, 'points': pts, 'halfWidth': 2.3})

    cutouts = []
    stairs_spec = []
    connectors = []
    skip_pts = []
    # Collect corridor entry endpoints onto ring to keep bay mouths unobstructed
    ring_poly = Polygon(ring_pts)
    for c in corridors:
        for p in c['points']:
            if ring_poly.boundary.distance(Point(p)) < 3.5:
                skip_pts.append((p[0], p[1]))

    for stair in STAIRWELLS:
        cx, cz, yaw = stair_for_origin(stair, (0.0, 0.0))
        hw = stair['width'] * 0.5
        hl = stair['length'] * 0.5
        mouth = stair_local_to_frame(0.0, -hl, (cx, cz), yaw)
        deep = stair_local_to_frame(0.0, hl, (cx, cz), yaw)
        top_y = round(sample_ground_y(mouth[0], mouth[1]), 2)
        hole_ring = [[round(x, 3), round(z, 3)] for x, z in stair_hole_ring(stair, (0.0, 0.0), margin=0.05)]
        cutout = {
            'id': stair['id'],
            'corner': stair['corner'],
            'kind': 'shizijie-stair',
            'center': [round(cx, 3), top_y, round(cz, 3)],
            'yaw': round(yaw, 5),
            'width': stair['width'],
            'length': stair['length'],
            'topY': top_y,
            'floorY': floor_y,
            'polygon': hole_ring,
        }
        cutouts.append(cutout)
        stairs_spec.append({
            **cutout,
            'label': stair['label'],
            'mouth': [round(mouth[0], 3), top_y, round(mouth[1], 3)],
            'deep': [round(deep[0], 3), floor_y, round(deep[1], 3)],
        })
        # Connect stair deep bottom directly to nearest node on the 15-way OSM network
        hx, hz = stair['targetNodeHint']
        target_wx, target_wz = SHIZIJIE_ORIGIN[0] + hx, SHIZIJIE_ORIGIN[1] + hz
        connectors.append({
            'id': stair['id'],
            'points': [[round(deep[0], 2), round(deep[1], 2)], [round(target_wx, 2), round(target_wz, 2)]],
            'halfWidth': 2.2,
        })
        skip_pts.append((target_wx, target_wz))

    shutters, shops = _build_bays_on_ring(ring_pts, skip_pts)
    underpass = {
        'id': 'shizijie_xiaoxianggang',
        'center': [round(SHIZIJIE_ORIGIN[0], 3), round(sample_ground_y(*SHIZIJIE_ORIGIN), 2), round(SHIZIJIE_ORIGIN[1], 3)],
        'floorY': floor_y,
        'ceilingHeight': 3.15,
        'ringPolygon': ring_pts,
        'ringHalfWidth': 2.8,
        'corridors': corridors,
        'connectors': connectors,
        'stairs': stairs_spec,
        'shutters': shutters,
        'shops': shops,
    }
    return cutouts, underpass


def _compass_label(dx: float, dz: float) -> str:
    """Map directional XZ vector (local stair mouth -> street facing) to cardinal/intercardinal tag."""
    ang = (math.degrees(math.atan2(dx, -dz)) + 360.0) % 360.0
    dirs = ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW')
    return dirs[int((ang + 22.5) // 45.0) % 8]


def build_underground_landmark_metadata(surface_sampler=None) -> dict:
    """Build landmark-local B1 metadata for `public/landmarks/shizijie.json['underground']`
    aligned 1:1 with STAIRWELLS cutouts, OSM 15-way ring concourse, shop booths & lightboxes."""
    _, ug = build_manifest_data(surface_sampler)
    ox, oz = SHIZIJIE_ORIGIN
    surf_y = round(float(surface_sampler(ox, oz) if surface_sampler is not None else SHIZIJIE_SURFACE_Y), 2)
    world_floor_y = ug['floorY']
    local_floor_y = round(world_floor_y - surf_y, 2)
    ceiling_h = round(ug['ceilingHeight'], 2)
    local_ceil_y = round(local_floor_y + ceiling_h, 2)

    ring_local = [[round(px - ox, 3), round(pz - oz, 3)] for px, pz in ug['ringPolygon']]
    corridors_local = []
    poly_parts = [Polygon(ring_local).buffer(ug.get('ringHalfWidth', 2.8))]
    for c in ug['corridors']:
        pts_l = [[round(px - ox, 3), round(pz - oz, 3)] for px, pz in c['points']]
        corridors_local.append({'way': c['way'], 'points': pts_l, 'halfWidth': c['halfWidth']})
        if len(pts_l) >= 2:
            poly_parts.append(LineString(pts_l).buffer(c['halfWidth']))

    connectors_local = []
    for conn in ug['connectors']:
        pts_l = [[round(px - ox, 3), round(pz - oz, 3)] for px, pz in conn['points']]
        connectors_local.append({'id': conn['id'], 'points': pts_l, 'halfWidth': conn['halfWidth']})
        if len(pts_l) >= 2:
            poly_parts.append(LineString(pts_l).buffer(conn['halfWidth']))

    entrances = []
    stairs_local = []
    for st in ug['stairs']:
        cx_l = round(st['center'][0] - ox, 3)
        cz_l = round(st['center'][2] - oz, 3)
        mx_l = round(st['mouth'][0] - ox, 3)
        mz_l = round(st['mouth'][2] - oz, 3)
        dx_l = round(st['deep'][0] - ox, 3)
        dz_l = round(st['deep'][2] - oz, 3)
        hole_local = [[round(px - ox, 3), round(pz - oz, 3)] for px, pz in st['polygon']]
        if len(hole_local) >= 3:
            poly_parts.append(Polygon(hole_local))
        orient = _compass_label(mx_l - dx_l, mz_l - dz_l)
        top_local_y = round(st['topY'] - surf_y, 3)
        ent = {
            'id': st['id'],
            'corner': st['corner'],
            'label': st['label'],
            'orientation': orient,
            'yawDeg': round(math.degrees(st['yaw']), 2),
            'yawRad': st['yaw'],
            'center': [cx_l, top_local_y, cz_l],
            'mouth': [mx_l, top_local_y, mz_l],
            'deep': [dx_l, local_floor_y, dz_l],
            'worldMouth': st['mouth'],
            'worldDeep': st['deep'],
            'width': st['width'],
            'length': st['length'],
            'cutoutPolygon': hole_local,
        }
        entrances.append(ent)
        stairs_local.append(ent)

    walk_union = unary_union(poly_parts).buffer(0)
    if walk_union.geom_type == 'MultiPolygon':
        walk_dom = max(walk_union.geoms, key=lambda g: g.area)
    else:
        walk_dom = walk_union
    walk_simplified = walk_dom.simplify(0.12, preserve_topology=True)
    walk_poly = [[round(float(x), 3), round(float(z), 3)] for x, z in list(walk_simplified.exterior.coords)[:-1]]

    shops_local = [
        {**sp, 'x': round(sp['x'] - ox, 3), 'z': round(sp['z'] - oz, 3), 'depth': 2.4}
        for sp in ug['shops']
    ]
    shutters_local = [
        {**sh, 'x': round(sh['x'] - ox, 3), 'z': round(sh['z'] - oz, 3), 'depth': 2.4}
        for sh in ug['shutters']
    ]
    booths = [
        {'id': f'shop-{sp["index"] + 1:02d}', 'kind': 'lit_shop', **sp}
        for sp in shops_local
    ] + [
        {'id': f'shutter-{sh["code"].lower()}', 'kind': 'reserved_shutter', **sh}
        for sh in shutters_local
    ]

    lightboxes = []
    for st in entrances:
        lightboxes.append({
            'id': f"portal-lb-{st['corner']}",
            'kind': 'stair_portal',
            'text': st['label'],
            'position': [st['deep'][0], round(local_floor_y + 2.68, 2), st['deep'][2]],
            'yaw': st['yawRad'],
        })
    for idx, (lx, lz, yaw, text) in enumerate((
        (0.0, -14.8, 0.0, '小香港地下商业街 · 北通道'),
        (15.2, 1.0, math.pi * 0.5, '↑ 出口 · 解放东路 / 正阳步行街'),
        (0.8, 17.5, math.pi, '中心环岛 · 南通道'),
        (-15.5, 2.2, -math.pi * 0.5, '↑ 出口 · 中山中路 / 解放西路'),
    )):
        lightboxes.append({
            'id': f'atrium-dir-{idx}',
            'kind': 'hanging_wayfinding',
            'text': text,
            'position': [lx, round(local_floor_y + 2.72, 2), lz],
            'yaw': round(yaw, 4),
        })

    return {
        'id': ug['id'],
        'name': '十字街小香港地下商业街',
        'coordinateSpace': 'landmark-local',
        'originWorld': [round(ox, 6), surf_y, round(oz, 6)],
        'nodeName': 'underground',
        'floorY': local_floor_y,
        'worldFloorY': world_floor_y,
        'ceilingY': local_ceil_y,
        'ceilingHeight': ceiling_h,
        'entrances': entrances,
        'walkPolygon': walk_poly,
        'ringPolygon': ring_local,
        'corridors': corridors_local,
        'connectors': connectors_local,
        'stairs': stairs_local,
        'shops': shops_local,
        'shutters': shutters_local,
        'booths': booths,
        'lightboxes': lightboxes,
    }


def _is_zebra_bar_near_shizijie(ring_world: np.ndarray) -> bool:
    """Identify the 79 Shizijie center crosswalk zebra bars (w~0.48m, l~3.80m) while preserving all stop lines (l>=4.69m) & lane dashes (w~0.18m)."""
    c = ring_world.mean(axis=0)
    if math.hypot(c[0] - SHIZIJIE_ORIGIN[0], c[1] - SHIZIJIE_ORIGIN[1]) > INTERSECTION_CLEAR_RADIUS:
        return False
    poly = Polygon(ring_world)
    if poly.is_empty or poly.area <= 0.1 or poly.area > 3.5:
        return False
    rect = poly.minimum_rotated_rectangle
    coords = list(rect.exterior.coords)
    if len(coords) < 5:
        return False
    edges = sorted(math.hypot(coords[i + 1][0] - coords[i][0], coords[i + 1][1] - coords[i][1]) for i in range(4))
    w, l = edges[0], edges[2]
    return 0.44 <= w <= 0.54 and 3.40 <= l <= 4.15


def _seal_curb_guardrail_gaps(decor: list, tile_origin: tuple[float, float], road_union, cutout_union: Polygon) -> list:
    """Close collinear curb guardrail (kind=5) gaps caused by removed Shizijie crosswalks, keeping intersections open."""
    ox, oz = tile_origin
    keep = []
    near_rails = []
    for item in decor:
        kind, ex, sz, hdg, span = item
        wx, wz = ox + ex / 10.0, oz + sz / 10.0
        pt = Point(wx, wz)
        if cutout_union.buffer(0.6).contains(pt):
            continue
        keep.append(item)
        if kind == 5 and math.hypot(wx - SHIZIJIE_ORIGIN[0], wz - SHIZIJIE_ORIGIN[1]) < 52.0:
            ang = hdg / 100.0
            ca, sa = math.cos(ang), math.sin(ang)
            half = (span / 10.0) * 0.5
            p0 = (wx - half * ca, wz - half * sa)
            p1 = (wx + half * ca, wz + half * sa)
            near_rails.append((kind, wx, wz, ang, half, p0, p1))

    # Detect short collinear gaps along the same curb line (<12m) that are outside interior carriageway
    added_centers = []
    for i in range(len(near_rails)):
        ki, xi, zi, ai, hi, a0, a1 = near_rails[i]
        ui = (math.cos(ai), math.sin(ai))
        ni = (-ui[1], ui[0])
        for j in range(i + 1, len(near_rails)):
            kj, xj, zj, aj, hj, b0, b1 = near_rails[j]
            if abs(math.cos(ai - aj)) < 0.995:
                continue
            lat = abs((xj - xi) * ni[0] + (zj - zi) * ni[1])
            if lat > 0.35:
                continue
            # Project onto ui axis
            si_lo, si_hi = -hi, hi
            dj = (xj - xi) * ui[0] + (zj - zi) * ui[1]
            sj_lo, sj_hi = dj - hj, dj + hj
            gap_lo, gap_hi = min(si_hi, sj_hi), max(si_lo, sj_lo)
            gap_len = gap_hi - gap_lo
            if not (1.8 <= gap_len <= 12.0):
                continue
            mid_s = 0.5 * (gap_lo + gap_hi)
            mx, mz = xi + mid_s * ui[0], zi + mid_s * ui[1]
            mpt = Point(mx, mz)
            if cutout_union.buffer(0.8).contains(mpt):
                continue
            # Do not bridge across an actual vehicle asphalt carriageway!
            if not road_union.is_empty and road_union.buffer(-0.45).contains(mpt):
                continue
            if any(math.hypot(mx - ax, mz - az) < 1.5 for ax, az in added_centers):
                continue
            # Emit 3.2m guardrail segments filling the gap
            pos_s = gap_lo + 0.1
            while pos_s < gap_hi - 0.1:
                seg_len = min(3.4, gap_hi - pos_s)
                if seg_len >= 0.9:
                    sc = pos_s + seg_len * 0.5
                    rx, rz = xi + sc * ui[0], zi + sc * ui[1]
                    if not cutout_union.buffer(0.6).contains(Point(rx, rz)):
                        added_centers.append((rx, rz))
                        keep.append([5, round((rx - ox) * 10), round((rz - oz) * 10), round(ai * 100), round(seg_len * 10)])
                pos_s += seg_len + 0.1
    return keep


def patch_101_38(output: Path) -> int:
    """Surgically update public/world/101_38.glc in-place without disturbing any other chunk."""
    tile_path = output / '101_38.glc'
    raw = gzip.decompress(tile_path.read_bytes())
    magic, nv, ni, size, png, deck = struct.unpack_from('<4s5I', raw, 0)
    assert magic == b'GL04', f'Unexpected 101_38.glc magic {magic!r}'
    coll_off = 24 + 65 * 65 * 4 + nv * 9 + ni * 4
    prefix = raw[:coll_off]
    suffix = raw[coll_off + size:]
    coll = json.loads(raw[coll_off:coll_off + size])
    tile_origin = (-1024.0, -256.0)
    ox, oz = tile_origin

    cutout_polys = [stair_hole_world_poly(st, margin=0.05) for st in STAIRWELLS]
    cutout_union = unary_union(cutout_polys)

    streets = coll[1]
    paths = streets[0]
    new_paths = []
    road_polys = []
    removed_bars = 0
    clipped_sw = 0

    for item in paths:
        kind = item[0]
        rings = item[1:]
        outer_w = np.array(rings[0], dtype=float) / 100.0 + [ox, oz]
        if kind == 0:
            holes_w = [np.array(r, dtype=float) / 100.0 + [ox, oz] for r in rings[1:]]
            road_polys.append(Polygon(outer_w, holes_w).buffer(0))
        elif kind == 2:
            if _is_zebra_bar_near_shizijie(outer_w):
                removed_bars += 1
                continue
        elif kind == 1:
            holes_w = [np.array(r, dtype=float) / 100.0 + [ox, oz] for r in rings[1:]]
            sw_poly = Polygon(outer_w, holes_w).buffer(0)
            if sw_poly.intersects(cutout_union):
                diff = sw_poly.difference(cutout_union)
                parts = list(diff.geoms) if hasattr(diff, 'geoms') else [diff]
                for part in parts:
                    if part.is_empty or part.area < 0.05 or part.geom_type != 'Polygon':
                        continue
                    ext = [[round((x - ox) * 100), round((z - oz) * 100)] for x, z in list(part.exterior.coords)[:-1]]
                    ints = [[[round((x - ox) * 100), round((z - oz) * 100)] for x, z in list(h.coords)[:-1]] for h in part.interiors if len(h.coords) >= 4]
                    if len(ext) >= 3:
                        new_paths.append([1, ext, *ints])
                clipped_sw += 1
                continue
        new_paths.append(item)

    streets[0] = new_paths
    road_union = unary_union(road_polys) if road_polys else Polygon()
    if len(streets) > 9 and streets[9]:
        streets[9] = _seal_curb_guardrail_gaps(streets[9], tile_origin, road_union, cutout_union)

    new_coll = json.dumps(coll, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    new_header = struct.pack('<4s5I', magic, nv, ni, len(new_coll), png, deck)
    new_raw = new_header + prefix[24:] + new_coll + suffix
    tile_path.write_bytes(gzip.compress(new_raw, mtime=0))
    print(f'101_38.glc patched: removed_zebra_bars={removed_bars}, clipped_sidewalks={clipped_sw}, new_bytes={tile_path.stat().st_size}')
    return tile_path.stat().st_size


def patch_roads_surgical(output: Path, underpass: dict):
    """Surgically inject the 15-way Shizijie -4.2m underpass + 4 stair links into public/world/roads/ without touching city lanes/signals."""
    roads_dir = output / 'roads'
    graph_path = roads_dir / 'graph.json.gz'
    if not graph_path.exists():
        return
    graph = json.loads(gzip.decompress(graph_path.read_bytes()))
    ug_base = 9_900_000_000_000

    els = load_osm()
    by_id = {e['id']: e for e in els if e.get('type') == 'way'}

    # Identify all legacy surface edges & OSM node IDs from the 15 SHIZIJIE_UNDERPASS_WAYS (d2 fix)
    ug_edge_pairs: set[tuple[int, int]] = set()
    ug_osm_nodes: set[int] = set()
    for wid in SHIZIJIE_UNDERPASS_WAYS:
        way = by_id.get(wid)
        if not way:
            continue
        refs = way['nodes']
        ug_osm_nodes.update(refs)
        for a, b in zip(refs, refs[1:]):
            ug_edge_pairs.add((a, b))
            ug_edge_pairs.add((b, a))

    # Strip BOTH previous synthetic underground edges/nodes (>= ug_base) AND stale surface underpass walk edges
    old_ug_ids = {n['id'] for n in graph['nodes'] if n['id'] >= ug_base}
    graph['walks'] = [
        w for w in graph['walks']
        if w[0] < ug_base and w[1] < ug_base and (w[0], w[1]) not in ug_edge_pairs
    ]
    used_pos_ids: set[int] = set()
    for lane in graph.get('lanes', []):
        used_pos_ids.add(lane['from'])
        used_pos_ids.add(lane['to'])
    for w in graph['walks']:
        used_pos_ids.add(w[0])
        used_pos_ids.add(w[1])
    for sig in graph.get('signals', []):
        used_pos_ids.add(sig['node'])

    removed_stale_nodes = {
        n['id'] for n in graph['nodes']
        if n['id'] in ug_osm_nodes and n['id'] not in used_pos_ids
    }
    graph['nodes'] = [
        n for n in graph['nodes']
        if n['id'] < ug_base and n['id'] not in removed_stale_nodes
    ]

    try:
        from landmarks.world_surface import Surface
        manifest = json.loads((output / 'manifest.json').read_text())
        surf = Surface(output, manifest)
        sample_y = lambda wx, wz: float(surf.sample(wx, wz, include_peaks=False)[0])
    except Exception:
        sample_y = lambda wx, wz: SHIZIJIE_SURFACE_Y

    added_nodes: dict[int, dict] = {}
    added_walks: list = []
    max_walk_id = max((w[3] for w in graph['walks']), default=-1)

    def next_walk_id() -> int:
        nonlocal max_walk_id
        max_walk_id += 1
        return max_walk_id

    for wid in SHIZIJIE_UNDERPASS_WAYS:
        way = by_id.get(wid)
        if not way:
            continue
        refs = way['nodes']
        pts = [ll2xz(v['lat'], v['lon']) for v in way['geometry']]
        for i in range(1, len(pts)):
            a, b = pts[i - 1], pts[i]
            if math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5:
                continue
            r0 = ug_base + refs[i - 1]
            r1 = ug_base + refs[i]
            for r, (px, pz) in ((r0, a), (r1, b)):
                if r not in added_nodes:
                    added_nodes[r] = {'id': r, 'x': round(px, 2), 'z': round(pz, 2), 'y': round(sample_y(px, pz) - UNDERPASS_DEPTH, 2)}
            added_walks.append([r0, r1, 0, next_walk_id()])

    if added_nodes:
        ug_pts = [(nid, n['x'], n['z']) for nid, n in added_nodes.items()]
        for idx, st in enumerate(underpass['stairs'], start=1):
            mx, _, mz = st['mouth']
            dx, _, dz = st['deep']
            top_id = 9_910_000_000_000 + idx * 2
            bot_id = top_id + 1
            added_nodes[top_id] = {'id': top_id, 'x': round(mx, 2), 'z': round(mz, 2), 'y': round(sample_y(mx, mz), 2)}
            added_nodes[bot_id] = {'id': bot_id, 'x': round(dx, 2), 'z': round(dz, 2), 'y': round(sample_y(dx, dz) - UNDERPASS_DEPTH, 2)}
            added_walks.append([top_id, bot_id, 0, next_walk_id()])
            nearest = min(ug_pts, key=lambda n: math.hypot(n[1] - dx, n[2] - dz))[0]
            added_walks.append([bot_id, nearest, 0, next_walk_id()])

    graph['nodes'].extend(added_nodes.values())
    graph['walks'].extend(added_walks)
    graph_path.write_bytes(gzip.compress(json.dumps(graph, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0))

    # Update all spatial cells touching stale surface underpass edges OR new -4.2m underpass edges
    affected = set()
    for n in added_nodes.values():
        for col in range(math.floor((n['x'] - 260) / 512), math.floor((n['x'] + 260) / 512) + 1):
            for row in range(math.floor((n['z'] - 260) / 512), math.floor((n['z'] + 260) / 512) + 1):
                affected.add((col, row))
    node_map = {**added_nodes}
    drop_ids = old_ug_ids | removed_stale_nodes
    for cell_path in sorted(roads_dir.glob('*_*.json.gz')):
        cell = json.loads(gzip.decompress(cell_path.read_bytes()))
        orig_walks = cell.get('walks', [])
        cleaned_walks = [
            w for w in orig_walks
            if w[0] < ug_base and w[1] < ug_base and (w[0], w[1]) not in ug_edge_pairs
        ]
        stem = cell_path.name[:-len('.json.gz')]
        col_s, row_s = stem.split('_')
        col, row = int(col_s), int(row_s)
        touched = len(cleaned_walks) != len(orig_walks) or (col, row) in affected
        if not touched:
            continue
        cell['walks'] = cleaned_walks
        cell['nodes'] = [n for n in cell['nodes'] if n['id'] < ug_base and n['id'] not in drop_ids]
        if (col, row) in affected:
            existing_ids = {n['id'] for n in cell['nodes']}
            used_ids = set()
            for w in added_walks:
                n0, n1 = node_map[w[0]], node_map[w[1]]
                cx = 0.5 * (n0['x'] + n1['x'])
                cz = 0.5 * (n0['z'] + n1['z'])
                if col * 512 - 260 <= cx <= (col + 1) * 512 + 260 and row * 512 - 260 <= cz <= (row + 1) * 512 + 260:
                    cell['walks'].append(w)
                    used_ids.update((w[0], w[1]))
            for uid in sorted(used_ids):
                if uid not in existing_ids:
                    cell['nodes'].append(node_map[uid])
        cell_path.write_bytes(gzip.compress(json.dumps(cell, separators=(',', ':')).encode(), mtime=0))
    print(f'Surgical roads/ patch: stripped stale_surface_nodes={len(removed_stale_nodes)}, +{len(added_nodes)} ug_nodes, +{len(added_walks)} ug_walks across cells={sorted(affected)}, total_nodes={len(graph["nodes"])}, total_walks={len(graph["walks"])}, signals={len(graph["signals"])}')


def apply_world(output: Path, rendered_roads=None, bake_roads: bool = True):
    """Apply Shizijie underpass world patches (101_38.glc, manifest groundCutouts/underpass, roads/)."""
    manifest_path = output / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())

    new_size = patch_101_38(output)
    for chunk in manifest['chunks']:
        if chunk['file'] == '101_38.glc':
            chunk['bytes'] = new_size
            break

    try:
        from landmarks.world_surface import Surface
        surf = Surface(output, manifest)
        sampler = lambda wx, wz: surf.sample(wx, wz, include_peaks=False)[0]
    except Exception:
        sampler = None

    cutouts, underpass = build_manifest_data(sampler)
    existing_cutouts = [c for c in manifest.get('groundCutouts', []) if c.get('kind') != 'shizijie-stair']
    manifest['groundCutouts'] = existing_cutouts + cutouts
    manifest['shizijieUnderpass'] = underpass
    manifest_path.write_text(json.dumps(manifest, separators=(',', ':'), ensure_ascii=False) + '\n')

    if bake_roads:
        patch_roads_surgical(output, underpass)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--world', type=Path, default=Path(OUT))
    parser.add_argument('--no-traffic', action='store_true')
    args = parser.parse_args()
    apply_world(args.world, bake_roads=not args.no_traffic)
