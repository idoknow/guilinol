"""Middle Zhongshan Road Streetscape (中山中路街景: 阳桥—中心广场—十字街段).

Anchor [110.2903834, 25.2790956] spans the 430 m arterial corridor of Middle
Zhongshan Rd (OSM way/258911170 northbound, way/259016852 & way/259020518
southbound) from Yangqiao north to Weixiaotang / Shizijie.

Hand-authored street frontages replace procedural extrusions on OSM & Overture
parcels with heights estimated against 4.2 m double-decker buses in the 2024
Yangqiao Commons series (00..11-2024.jpg) and 2018–2025 street views:
- West side: commercial block way/675593163 (6F / 20.6 m), Bagui Mansion
  (八桂大厦, way/264328067, 6F / 23.2 m podium + 11F / 38.4 m north tower),
  Yangqiao white-tiled Jinma block (Overture 09ade280..., 8F / 27.2 m with dark
  '金马大厦' vertical shaft & '和谐心理咨询中心' blue sign in 02..04-2024.jpg).
- East side: shopfront blocks way/679990110 (5F / 17.6 m), way/679990111
  (5F / 18.4 m), L-shaped colonnade hotel way/264904810 (6F / 21.6 m), gateway
  retail way/675591854 (4F / 15.2 m), and Yangqiao east podium + hotel tower
  way/675586420 (3F / 12.2 m molded podium + 7F / 24.8 m tower).
- Streetscape computed directly from IDOK-17 road_profile.py: central green
  hedge median along the paired-carriageway midpoint, linked redwood flower
  planter dividers placed on each carriageway's outermost lane line
  (width * ((lanes - 1) / lanes - 0.5)) so the outer lane next to the sidewalk
  is a clean bike lane with no motor-lane markings outside the planters
  (89188-Guilin.jpg), sidewalk camphor street trees, 4 bus shelters (十字街 /
  阳桥), and Yangqiao municipal blue road sign gantry.
"""
from collections import defaultdict
import math
from pathlib import Path
import sys

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Point, box
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import ll2xz, load_osm  # noqa: E402
from features import points  # noqa: E402
from road_profile import RULES, pair_carriageways, profile  # noqa: E402

from nikoniko import Builder, export_landmark  # noqa: E402


AX, AZ = ll2xz(25.2790956, 110.2903834)

WEST_NORTH_675593163 = [
    (-30.97, -93.55), (-13.31, -88.25), (-6.34, -88.73), (-0.73, -91.13),
    (5.76, -95.91), (24.48, -157.39), (7.19, -162.58), (1.02, -142.31),
    (-27.69, -150.93), (-34.01, -130.18), (-4.79, -121.41), (-9.04, -107.46),
    (-25.25, -112.34),
]

WEST_BAGUI_264328067 = [
    (-48.51, 94.53), (-72.72, 86.87), (-64.33, 60.69),
    (-82.04, 54.62), (-44.00, -66.77), (-1.31, -52.66),
]

WEST_JINMA_OV = [
    (-84.53, 195.61), (-48.10, 101.30), (-60.73, 95.25),
    (-89.22, 174.20), (-100.55, 170.46), (-107.07, 188.11),
]

EAST_679990110 = [
    (76.25, -176.64), (93.93, -171.39), (82.96, -134.93), (65.27, -140.18),
]

EAST_679990111 = [
    (82.12, -132.17), (76.37, -112.98), (70.06, -91.91),
    (52.37, -97.14), (58.67, -118.12), (64.44, -137.42),
]

EAST_264904810 = [
    (52.07, -80.70), (54.96, -83.12), (58.45, -83.50), (90.19, -73.36),
    (95.43, -89.55), (114.96, -83.30), (100.16, -37.58), (58.80, -50.99),
    (52.51, -32.03), (37.86, -36.80),
]

EAST_675591854 = [
    (36.14, -30.97), (52.13, -25.63), (47.69, -12.70), (70.28, -5.69),
    (64.11, 12.63), (32.68, 2.14), (29.50, -0.73), (28.14, -4.54), (28.70, -9.00),
]

EAST_YANGQIAO_675586420 = [
    (-23.12, 171.54), (-17.27, 170.23), (26.55, 193.83), (24.97, 197.70),
    (16.25, 205.63), (11.70, 204.61), (-19.42, 234.59), (-6.59, 249.57),
    (-14.86, 257.54), (-47.91, 221.97), (-48.81, 219.14), (-48.44, 216.04),
    (-46.64, 212.92),
]


def _local_ground_y(z):
    """Smooth transition from Shizijie 151.5 m (y=-2.3) north of z=-58 to 153.8 m (y=0)."""
    if z >= -54.0:
        return 0.0
    if z <= -70.0:
        return -2.3
    return -2.3 * (-54.0 - z) / 16.0


def _iter_lines(geom):
    if geom.is_empty:
        return
    if geom.geom_type == 'LineString':
        if geom.length > 6.0:
            yield geom
    elif hasattr(geom, 'geoms'):
        for part in geom.geoms:
            yield from _iter_lines(part)


def _load_zhongshan_street_profile():
    """Load paired Road profiles and intersection masks from OSM via road_profile.py."""
    raw_roads = []
    empty_index = STRtree([])
    signal_pts = []
    for el in load_osm():
        tags = el.get('tags', {})
        if el['type'] == 'way' and tags.get('highway') in RULES['defaultWidth']:
            if tags.get('bridge', 'no') == 'no' and tags.get('tunnel', 'no') == 'no':
                pts = points(el)
                if len(pts) > 1:
                    raw_roads.append(profile(LineString(pts), tags, empty_index, el['id']))
        elif el['type'] == 'node' and tags.get('highway') in ('traffic_signals', 'crossing'):
            signal_pts.append(Point(ll2xz(el['lat'], el['lon'])))

    paired = list(pair_carriageways(raw_roads))
    junctions = defaultdict(list)
    for r in paired:
        coords = list(r.line.coords)
        for c in set(coords):
            junctions[c].extend([r.width] * (1 if c in (coords[0], coords[-1]) else 2))

    masks = [Point(c).buffer(max(ws) / 2.0 + 4.5) for c, ws in junctions.items() if len(ws) > 2]
    for pt in signal_pts:
        masks.append(pt.buffer(5.5))
    junc_mask = unary_union(masks)
    by_way = {r.way: r for r in paired}
    return by_way, junc_mask


def _street_facade(m: Builder, p0, p1, nx_sign, y0, ground_h, total_h, wall_mat, shop_seed, bays, canopy=True):
    """Hand-authored street frontage with shop band, rain canopy, CJK sign fascia & upper bays."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    if length < 5.0:
        return
    ux, uz = dx / length, dz / length
    nx, nz = -uz * nx_sign, ux * nx_sign
    yaw = math.atan2(nx, nz)
    mx, mz = (p0[0] + p1[0]) / 2.0 + nx * 0.30, (p0[1] + p1[1]) / 2.0 + nz * 0.30

    m.pose = (mx, y0, mz, yaw)
    m.box(0, ground_h - 0.2, 0.16, length + 0.3, 0.52, 0.72, wall_mat)
    m.box(0, ground_h + 0.32, 0.04, length - 0.6, total_h - ground_h - 1.05, 0.26, 'glass')
    m.box(0, total_h - 0.75, 0.18, length + 0.4, 0.78, 0.82, wall_mat)
    m.box(0, total_h + 0.03, 0.20, length + 0.55, 0.24, 0.96, 'dark')

    if not m.detail:
        m.pose = (0.0, 0.0, 0.0, 0.0)
        return

    bay_w = length / bays
    floors = max(2, round((total_h - ground_h - 0.8) / 3.35))
    fl_h = (total_h - ground_h - 1.05) / floors
    for i in range(bays + 1):
        lx = -length / 2.0 + i * bay_w
        m.box(lx, -1.8, 0.20, 0.58, total_h + 1.8, 0.58, wall_mat, collide=True)
        if i < bays:
            cx = lx + bay_w / 2.0
            m.box(cx, 0.12, -0.04, bay_w - 0.68, 3.05, 0.20, 'glass')
            m.box(cx, 0.12, 0.08, 0.14, 2.95, 0.14, 'dark')
            if canopy:
                m.box(cx, 3.08, 0.78, bay_w - 0.36, 0.15, 1.45, 'alum')
            m.box(cx, 3.32, 0.28, bay_w - 0.58, 0.88, 0.24, 'dark')
            m.sign_quad(cx, 3.35, 0.42, bay_w - 0.64, 0.82, f'shop_{(i + shop_seed) % 8}')
            for fl in range(1, floors):
                m.box(cx, ground_h + 0.32 + fl * fl_h, 0.18, bay_w - 0.46, 0.38, 0.30, wall_mat)
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _bus_shelter(m: Builder, x, y0, z, yaw, station_key='bus_shizijie'):
    """Guilin Zhongshan Road modern transit bus shelter + CJK station totem."""
    # Local +X of pose points toward carriageway; local +Z runs along sidewalk.
    m.pose = (x, y0, z, yaw)
    m.box(0, -0.4, 0, 2.5, 0.48, 11.2, 'pave', collide=True)
    for sz in (-4.6, -1.5, 1.5, 4.6):
        m.beam([-0.82, 0.08, sz], [-0.82, 2.95, sz], 0.08, 'bronze', sections=6, collide=True)
    m.box(0.05, 2.95, 0, 2.65, 0.16, 11.2, 'alum')
    m.box(0.12, 3.11, 0, 2.45, 0.08, 10.9, 'white')

    # Back route-map & transit lightboxes facing +X toward waiting passengers
    for sz, col in ((-3.1, 'blue'), (0.0, 'white'), (3.1, 'red')):
        m.box(-0.78, 0.52, sz, 0.18, 1.85, 2.38, 'dark', collide=True)
        if m.detail:
            m.box(-0.67, 0.65, sz, 0.04, 1.58, 2.16, col)
    m.box(-0.22, 0.48, 0.0, 0.46, 0.08, 4.4, 'alum', collide=True)
    for bz in (-1.8, 0.0, 1.8):
        m.box(-0.22, 0.08, bz, 0.40, 0.40, 0.12, 'dark')

    # Tall double-sided bus-stop totem ('十字街' / '阳桥') facing along sidewalk (+Z / -Z)
    m.box(0.76, 0.08, 5.25, 0.72, 2.82, 0.16, 'dark', collide=True)
    m.sign_quad(0.76, 1.15, 5.35, 0.66, 1.68, station_key, double_sided=True)
    m.box(0.76, 0.18, 5.25, 0.66, 0.92, 0.18, 'blue')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _median_curve(m: Builder, world_line: LineString):
    """Build central green hedge median + topiary shrubs + 5-globe lamps along world_line."""
    # Subdivide into ~18 m chords so local ground transition is smooth
    n_segs = max(1, round(world_line.length / 18.0))
    pts = [world_line.interpolate(world_line.length * i / n_segs) for i in range(n_segs + 1)]
    for i in range(n_segs):
        p0 = (pts[i].x - AX, pts[i].y - AZ)
        p1 = (pts[i + 1].x - AX, pts[i + 1].y - AZ)
        dx, dz = p1[0] - p0[0], p1[1] - p0[1]
        seg_len = math.hypot(dx, dz)
        if seg_len < 2.0:
            continue
        yaw = math.atan2(dx, dz)
        mx, mz = (p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0
        y0 = _local_ground_y(mz)
        m.pose = (mx, y0, mz, yaw)
        # 1.48 m wide median curb stays strictly inside the paired-carriageway gap
        m.box(0, -0.5, 0, 1.48, 0.72, seg_len + 0.15, 'beige', collide=True)
        m.box(0, 0.22, 0, 1.16, 0.56, max(0.5, seg_len - 0.3), 'hedge')
        m.box(0, 0.78, 0, 0.06, 0.36, max(0.5, seg_len - 0.5), 'alum')
        if m.detail:
            n_shrubs = max(1, int(seg_len // 8.5))
            for k in range(n_shrubs):
                sz = -seg_len / 2.0 + (k + 0.5) * (seg_len / n_shrubs)
                m.cylinder_y(0, 0.76, 0.65, sz, 0.68, 'leaf' if k % 2 == 0 else 'hedge', sections=8)
                if (i + k) % 2 == 1:
                    m.cylinder_y(0, 1.40, 0.34, sz, 0.48, 'red', sections=7)
        m.pose = (0.0, 0.0, 0.0, 0.0)

    n_lamps = max(1, int(world_line.length // 28.0))
    for k in range(n_lamps):
        pt = world_line.interpolate(world_line.length * (k + 0.5) / n_lamps)
        lx, lz = pt.x - AX, pt.y - AZ
        m.cluster_lamp(lx, _local_ground_y(lz) + 0.20, lz, height=7.4, globes=5, collide=True)


def _planter_divider_curve(m: Builder, world_line: LineString):
    """Linked redwood flower planter barrier on the motor/bike divider line (89188-Guilin.jpg)."""
    if not m.detail:
        return
    n_segs = max(1, round(world_line.length / 16.0))
    pts = [world_line.interpolate(world_line.length * i / n_segs) for i in range(n_segs + 1)]
    for i in range(n_segs):
        p0 = (pts[i].x - AX, pts[i].y - AZ)
        p1 = (pts[i + 1].x - AX, pts[i + 1].y - AZ)
        dx, dz = p1[0] - p0[0], p1[1] - p0[1]
        seg_len = math.hypot(dx, dz)
        if seg_len < 2.2:
            continue
        yaw = math.atan2(dx, dz)
        mx, mz = (p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0
        y0 = _local_ground_y(mz)
        m.pose = (mx, y0, mz, yaw)
        # Continuous redwood slat planter wall covering the outer lane stripe (0.64 m wide)
        m.box(0, -0.05, 0, 0.64, 0.67, seg_len, 'wood', collide=True)
        m.box(0, 0.62, 0, 0.70, 0.06, seg_len + 0.06, 'dark')
        m.box(0, 0.66, 0, 0.48, 0.14, max(0.4, seg_len - 0.2), 'red')
        # Periodic black steel frame posts & taller green shrub planter boxes (89188-Guilin.jpg)
        n_posts = max(1, int(seg_len // 5.2))
        for k in range(n_posts):
            sz = -seg_len / 2.0 + (k + 0.5) * (seg_len / n_posts)
            m.box(0, 0.0, sz - 0.62, 0.68, 0.84, 0.08, 'dark')
            m.box(0, 0.0, sz + 0.62, 0.68, 0.84, 0.08, 'dark')
            m.box(0, 0.64, sz, 0.66, 0.20, 1.24, 'wood')
            m.box(0, 0.84, sz, 0.72, 0.05, 1.30, 'dark')
            m.cylinder_y(0, 0.86, 0.58, sz, 0.44, 'leaf' if k % 2 == 0 else 'hedge', sections=7)
        m.pose = (0.0, 0.0, 0.0, 0.0)


def build_zhongshan_road(m: Builder):
    # ------------------------------------------------------------------
    # 1. West Frontage 1: Commercial Complex way/675593163 (6F / 20.6 m)
    # ------------------------------------------------------------------
    y_wn = -1.2
    m.prism(WEST_NORTH_675593163, y_wn - 2.0, 6.5, 'dark', collide=True, cap_mat='alum')
    m.prism(WEST_NORTH_675593163, y_wn + 4.5, 16.1, 'white', collide=True, cap_mat='roof')
    _street_facade(m, (-0.73, -91.13), (24.48, -157.39), 1, y_wn, 4.5, 20.6, 'white', 0, 9)

    # ------------------------------------------------------------------
    # 2. West Frontage 2: Bagui Mansion (八桂大厦, way/264328067)
    # ------------------------------------------------------------------
    m.prism(WEST_BAGUI_264328067, -2.5, 7.3, 'dark', collide=True, cap_mat='beige')
    m.prism(WEST_BAGUI_264328067, 4.8, 18.4, 'beige', collide=True, cap_mat='roof')
    _street_facade(m, (-48.51, 94.53), (-1.31, -52.66), 1, 0.0, 4.8, 23.2, 'beige', 2, 18)

    # Bagui Mansion 11-storey north-end signature tower crown + '八桂大厦' sign
    m.pose = (-14.5, 0.0, -40.5, math.atan2(0.952, 0.305))
    m.box(0, 23.2, 0, 26.0, 14.2, 22.0, 'beige', collide=True)
    m.box(0, 24.0, 11.1, 21.5, 12.2, 0.35, 'glass')
    m.box(0, 37.4, 0, 27.2, 1.1, 23.2, 'alum')
    m.box(0, 38.5, 10.6, 9.8, 1.9, 0.28, 'dark')
    m.sign_quad(0, 38.55, 10.78, 9.5, 1.78, 'bagui_roof')
    if m.detail:
        for bx in (-8.5, -2.8, 2.8, 8.5):
            m.box(bx, 23.8, 11.25, 0.72, 12.8, 0.45, 'beige')
        m.beam([0, 38.5, 0], [0, 44.5, 0], 0.16, 'alum', sections=6)
    m.pose = (-54.0, 0.0, 78.0, math.atan2(0.952, 0.305))
    m.box(0, 23.2, 0, 22.0, 6.8, 18.0, 'beige')
    m.box(0, 23.8, 9.1, 18.5, 5.4, 0.32, 'glass')
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # ------------------------------------------------------------------
    # 3. West Frontage 3: Yangqiao White-Tiled Block & '金马大厦' Shaft
    # ------------------------------------------------------------------
    m.prism(WEST_JINMA_OV, -2.5, 7.0, 'dark', collide=True, cap_mat='white')
    m.prism(WEST_JINMA_OV, 4.5, 22.7, 'white', collide=True, cap_mat='roof')
    annex = [(-93.23,170.59),(-87.41,157.37),(-96.83,153.17),(-102.55,166.72)]
    m.prism(annex, -2.5, 10.5, 'white', collide=True, cap_mat='roof')
    _street_facade(m, (-84.53, 195.61), (-48.10, 101.30), 1, 0.0, 4.5, 27.2, 'white', 4, 12)
    m.pose = (-64.6, 0.0, 144.0, math.atan2(0.933, 0.360))
    m.box(-2.0, 5.0, 0.85, 3.8, 23.2, 0.85, 'dark')
    m.sign_quad(-2.0, 12.6, 1.32, 3.4, 14.4, 'jinma_vert')
    m.box(-18.0, 17.6, 0.78, 14.6, 1.85, 0.28, 'dark')
    m.sign_quad(-18.0, 17.66, 0.96, 14.3, 1.72, 'hexie_sign')
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # ------------------------------------------------------------------
    # 4. East Frontages 1..4 (Shizijie S to Central Square NW)
    # ------------------------------------------------------------------
    m.prism(EAST_679990110, -4.5, 6.6, 'dark', collide=True, cap_mat='beige')
    m.prism(EAST_679990110, 2.1, 13.2, 'white', collide=True, cap_mat='roof')
    _street_facade(m, (76.25, -176.64), (65.27, -140.18), 1, -2.3, 4.4, 17.6, 'white', 1, 5)

    m.prism(EAST_679990111, -3.0, 7.4, 'dark', collide=True, cap_mat='white')
    m.prism(EAST_679990111, 4.4, 14.0, 'white', collide=True, cap_mat='roof')
    _street_facade(m, (64.44, -137.42), (52.37, -97.14), 1, 0.0, 4.4, 18.4, 'white', 3, 6)

    m.prism(EAST_264904810, -2.5, 7.3, 'dark', collide=True, cap_mat='beige')
    m.prism(EAST_264904810, 4.8, 16.8, 'beige', collide=True, cap_mat='roof')
    _street_facade(m, (52.07, -80.70), (37.86, -36.80), 1, 0.0, 4.8, 21.6, 'beige', 5, 6)

    m.prism(EAST_675591854, -2.5, 6.7, 'dark', collide=True, cap_mat='white')
    m.prism(EAST_675591854, 4.2, 11.0, 'white', collide=True, cap_mat='roof')
    _street_facade(m, (36.14, -30.97), (28.70, -9.00), 1, 0.0, 4.2, 15.2, 'white', 7, 4)

    # ------------------------------------------------------------------
    # 5. East Frontage 5: Yangqiao East Molded Podium & Hotel Tower (way/675586420)
    # ------------------------------------------------------------------
    m.prism(EAST_YANGQIAO_675586420, -2.5, 14.7, 'alum', collide=True, cap_mat='roof')
    _street_facade(m, (-23.12, 171.54), (-46.64, 212.92), 1, 0.0, 4.5, 12.2, 'alum', 6, 6)
    m.pose = (-14.0, 0.0, 214.0, math.atan2(-0.92, 0.38))
    m.box(0, 12.2, 0, 32.0, 12.6, 22.0, 'beige', collide=True)
    m.box(0, 13.0, 11.1, 28.0, 10.8, 0.30, 'glass')
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # ------------------------------------------------------------------
    # 6. Street-Profile-Driven Medians, Redwood Planter Dividers, Bus Stops & Trees
    # ------------------------------------------------------------------
    by_way, junc_mask = _load_zhongshan_street_profile()
    corridor_clip = box(-1060.0, -76.0, -885.0, 302.0)

    east_road = by_way[258911170]
    west_roads = [by_way[259016852], by_way[259020518]]

    # Place 4 bus shelters directly on the paired carriageways' 2.5 m sidewalks
    bus_specs = [
        # (road, fraction_along, station_key)
        (east_road, 0.78, 'bus_shizijie'),
        (west_roads[0], 0.16, 'bus_shizijie'),
        (east_road, 0.31, 'bus_yangqiao'),
        (west_roads[1], 0.42, 'bus_yangqiao'),
    ]
    bus_pullin_zones = []
    for road, frac, station_key in bus_specs:
        sw_line = road.line.offset_curve(road.width / 2.0 + max(road.right, 2.5) * 0.58)
        d = sw_line.length * frac
        pt = sw_line.interpolate(d)
        p_a = sw_line.interpolate(max(0.0, d - 1.0))
        p_b = sw_line.interpolate(min(sw_line.length, d + 1.0))
        tx, tz = p_b.x - p_a.x, p_b.y - p_a.y
        # Outward (+offset) on both one-way carriageways is to the right of travel:
        # travel tangent is (tx, tz), so inward toward carriageway (+X of pose) is (-tz, tx)?
        # Check: inBuilder._transform, local +X maps to (cos(yaw), -sin(yaw)), local +Z maps to (sin(yaw), cos(yaw)).
        # Setting local +Z along (-tx, -tz) or (+tx, +tz) so local +X points INWARD toward road.line:
        road_pt = road.line.interpolate(road.line.project(pt))
        inward_x, inward_z = road_pt.x - pt.x, road_pt.y - pt.y
        # Local +X = (cos(yaw), -sin(yaw)) == normalized (inward_x, inward_z) -> yaw = atan2(-inward_z, inward_x)
        shelter_yaw = math.atan2(-inward_z, inward_x)
        lx, lz = pt.x - AX, pt.y - AZ
        _bus_shelter(m, lx, _local_ground_y(lz), lz, shelter_yaw, station_key=station_key)
        bus_pullin_zones.append(pt.buffer(11.5))

    divider_mask = unary_union([junc_mask, *bus_pullin_zones])

    # Central green median along exact midpoint between east & west paired carriageways
    median_raw = east_road.line.offset_curve(-(east_road.width / 2.0 + 0.40)).intersection(corridor_clip).difference(junc_mask)
    for seg in _iter_lines(median_raw):
        _median_curve(m, seg)

    # Redwood flower planter dividers on each carriageway's outermost lane line:
    # offset = road.width * ((road.lanes - 1) / road.lanes - 0.5)
    for road in [east_road, *west_roads]:
        divider_offset = road.width * ((road.lanes - 1) / float(road.lanes) - 0.5)
        div_raw = road.line.offset_curve(divider_offset).intersection(corridor_clip).difference(divider_mask)
        for seg in _iter_lines(div_raw):
            _planter_divider_curve(m, seg)

        # Sidewalk camphor street trees along the 2.5 m sidewalk (clear of intersections & bus shelters)
        if m.detail:
            tree_line = road.line.offset_curve(road.width / 2.0 + max(road.right, 2.5) * 0.62).intersection(corridor_clip).difference(divider_mask)
            idx_counter = 0
            for seg in _iter_lines(tree_line):
                n_trees = max(1, int(seg.length // 26.0))
                for k in range(n_trees):
                    pt = seg.interpolate(seg.length * (k + 0.5) / n_trees)
                    tx, tz = pt.x - AX, pt.y - AZ
                    m.street_tree(
                        tx, _local_ground_y(tz), tz,
                        height=8.8, spread=3.5, kind='camphor',
                        lanterns=(idx_counter % 2 == 0), collide=True,
                    )
                    idx_counter += 1

    # Overhead municipal blue road direction sign gantry on Yangqiao north approach (02-2024.jpg left)
    sw_yq = west_roads[1].line.offset_curve(west_roads[1].width / 2.0 + 1.4)
    g_pt = sw_yq.interpolate(sw_yq.length * 0.72)
    g_a = sw_yq.interpolate(sw_yq.length * 0.68)
    g_b = sw_yq.interpolate(sw_yq.length * 0.76)
    # Gantry faces south (+Z) toward northbound/approaching traffic
    g_yaw = math.atan2(g_b.x - g_a.x, g_b.y - g_a.y)
    gx, gz = g_pt.x - AX, g_pt.y - AZ
    m.pose = (gx, _local_ground_y(gz), gz, g_yaw)
    m.cylinder_y(0, 0.0, 6.8, 0, 0.22, 'alum', sections=8 if m.detail else 5, collide=True)
    m.beam([0, 6.2, 0], [8.8, 6.2, 0], 0.09, 'alum', sections=6)
    m.box(4.6, 5.05, 0.12, 3.7, 2.15, 0.08, 'alum')
    m.sign_quad(4.6, 5.08, 0.18, 3.6, 2.08, 'road_yangqiao', double_sided=True)
    m.pose = (0.0, 0.0, 0.0, 0.0)


if __name__ == '__main__':
    export_landmark('zhongshan_road', build_zhongshan_road)
