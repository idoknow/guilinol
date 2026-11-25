"""Guilin University of Technology - Pingfeng Campus (桂林理工大学屏风校区), IDOK-165.

Every building inside the OSM campus outline (way/380351945) keeps its exact
OSM footprint (plus Overture-only footprints); facades follow the school's
official campus-scenery photos (glut.edu.cn 校园景观 → 屏风校区, 11 photos, see
ops 仓库 docs/layout/universities/glut_pingfeng.md). The attached primary school
(way/473969804, own landmark) and the kindergarten (way/474309073) are left to
the base map / their own landmark. No guard post, turnstile or camera.
"""
import csv
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from shapely import wkt, from_wkb
from shapely.geometry import Point, Polygon
from shapely.ops import transform

from common import ll2xz, load_osm, RAW
from g3_kit import export_school
import uni_kit as U

CAMPUS = 380351945
EXCLUDE_AREAS = (473969804, 474309073)  # attached primary school, kindergarten (K-12: base map only)
GATE_NODE = 2642095456                   # 建干路 main gate (official photo 屏风东校门)

SIGNS = [
    dict(key='glut_name', title='桂林理工大学', sub='GUILIN UNIVERSITY OF TECHNOLOGY',
         fg=(226, 190, 96), bg=(122, 48, 42), sans=False),
    dict(key='glut_lib', title='图书馆', orient='v', fg=(70, 66, 60), bg=(214, 208, 192), sans=False),
    dict(key='glut_park', title='大学科技园', orient='v', fg=(36, 104, 186), bg=(238, 238, 234), sans=True),
    dict(key='glut_staff', title='教职工活动中心', fg=(178, 40, 36), bg=(236, 236, 232), sans=False),
    dict(key='glut_gym', title='体育馆', fg=(96, 70, 62), bg=(196, 170, 160), sans=False),
    dict(key='glut_civil', title='土木与建筑工程学院', fg=(232, 196, 90), bg=(160, 40, 34), sans=False),
    dict(key='glut_biz', title='商学院', fg=(60, 64, 70), bg=(236, 236, 232), sans=False),
]

# Photo-matched facade specs (official photo index in the layout doc).
#   style, floors, wall, accent, extra
SPEC = {
    473969780: dict(hero='library', style='ribbon', floors=5, fh=4.0, wall='white', accent='granite'),
    473969796: dict(hero='gym'),
    473969787: dict(hero='science_park', style='punched', floors=7, wall='white', accent='white', bay=3.4),
    473969788: dict(style='grid', floors=9, fh=3.3, wall='white', accent='white', sign='glut_civil'),
    473969784: dict(hero='business', style='ribbon', floors=8, fh=3.4, wall='white', accent='white'),
    473969782: dict(style='pilaster', floors=5, fh=3.8, wall='cream', accent='white', trim='white',
                    sign='glut_civil'),
    473969783: dict(style='pilaster', floors=3, fh=3.8, wall='cream', accent='white', trim='white'),
    473969786: dict(style='punched', floors=4, fh=3.9, wall='white', accent='granite', trim='granite', bay=3.8),
    473969781: dict(style='ribbon', floors=6, fh=3.7, wall='white', accent='white'),
    473969785: dict(style='ribbon', floors=6, fh=3.6, wall='white', accent='white'),
    473969792: dict(style='punched', floors=6, wall='white', accent='granite'),
    473969795: dict(style='pilaster', floors=4, fh=3.7, wall='cream', accent='white', trim='white'),
    473969797: dict(hero='staff_centre', style='punched', floors=3, fh=4.2, wall='white', accent='silver_roof'),
    473969800: dict(style='punched', floors=2, fh=5.0, wall='cream', accent='white', roof='hip', roof_tile='gray_tile'),
    473969801: dict(style='punched', floors=6, wall='white', accent='granite'),
    473969799: dict(style='ribbon', floors=4, wall='white', accent='white'),
    473969798: dict(style='punched', floors=3, wall='white', accent='granite'),
    403448109: dict(style='ribbon', floors=6, fh=3.6, wall='white', accent='white'),
    473969794: dict(style='punched', floors=5, wall='cream', accent='white'),
    473969809: dict(style='ribbon', floors=4, fh=4.2, wall='white', accent='white'),
}

DEFAULTS = {
    'apartments': dict(style='punched', floors=6, fh=3.0, wall='cream', accent='white', trim='white', bay=3.2),
    'house':      dict(style='punched', floors=5, fh=3.0, wall='white', accent='terracotta', trim='granite', bay=3.2),
    'school':     dict(style='punched', floors=3, wall='white', accent='white'),
    'yes':        dict(style='punched', floors=4, wall='white', accent='granite'),
}


def _local(b, x, z):
    return x - b.surface.x, z - b.surface.z


def _campus_data():
    if not Path(RAW).exists():
        doc = json.loads((Path(__file__).resolve().parents[1]/'data/landmarks/glut_pingfeng.json').read_bytes())
        rows = [(row['id'], row['osm_id'], row['tags'], from_wkb(bytes.fromhex(row['polygon']))) for row in doc['buildings']]
        return from_wkb(bytes.fromhex(doc['campus'])), rows, tuple(doc['gate'])
    els = load_osm()
    ways = {e['id']: e for e in els if e['type'] == 'way' and 'geometry' in e}
    poly = lambda e: Polygon([ll2xz(q['lat'], q['lon']) for q in e['geometry']])
    campus = poly(ways[CAMPUS])
    excl = [poly(ways[i]) for i in EXCLUDE_AREAS]
    out = []
    for e in ways.values():
        t = e.get('tags', {})
        if not t.get('building') or len(e['geometry']) < 4:
            continue
        p = poly(e)
        if not p.is_valid or not campus.contains(p.centroid) or any(x.contains(p.centroid) for x in excl):
            continue
        out.append((f"way/{e['id']}", e['id'], t, p))
    osm_polys = [p for *_, p in out]
    with open(Path(RAW) / 'overture_buildings.csv') as f:
        for r in csv.DictReader(f, delimiter='\t'):
            p = wkt.loads(r['wkt'])
            if p.geom_type != 'Polygon':
                p = max(p.geoms, key=lambda g: g.area)
            p = transform(lambda x, y, z=None: ll2xz(y, x), p)
            if not campus.contains(p.centroid) or any(x.contains(p.centroid) for x in excl):
                continue
            if any(o.intersection(p).area > 0.3 * p.area for o in osm_polys):
                continue
            t = {'building': 'yes'}
            if r['num_floors']:
                t['building:levels'] = r['num_floors']
            out.append((r['id'], None, t, p))
    gate = next(e for e in els if e['type'] == 'node' and e['id'] == GATE_NODE)
    return campus, out, ll2xz(gate['lat'], gate['lon'])


def _edge_facing(pts, direction):
    """Longest edge whose outward normal points along ``direction``."""
    best = None
    for i, a, c, L, u, nrm in U.edges(pts, 4.0):
        score = (nrm[0] * direction[0] + nrm[1] * direction[1]) * L
        if best is None or score > best[0]:
            best = (score, a, c, L, u, nrm)
    return best[1:]


def _library(b, pts, spec):
    bulge = lambda q: q[0] < 77.0 and -70.0 < q[1] < -30.0
    skip = {i for i in range(len(pts)) if bulge(pts[i]) and bulge(pts[(i + 1) % len(pts)])}
    base, top = U.building(b, pts, style='ribbon', floors=5, fh=4.0, wall='white', accent='granite', skip_edges=skip)
    # Drum entrance on the west face (toward the campus axis), ref 图书馆（一）.
    # The OSM footprint already carries the drum as a curved west bulge: fit a circle to it.
    import numpy as np
    arc = np.array([p for p in pts if p[0] < 77.0 and -70.0 < p[1] < -30.0])
    A = np.c_[2 * arc, np.ones(len(arc))]
    sol = np.linalg.lstsq(A, (arc ** 2).sum(1), rcond=None)[0]
    cx, cz = float(sol[0]), float(sol[1])
    r = float(math.sqrt(sol[2] + cx * cx + cz * cz)) + 0.4
    far = arc[np.argmin(arc[:, 0])]
    nrm = ((far[0] - cx) / math.dist(far, (cx, cz)), (far[1] - cz) / math.dist(far, (cx, cz)))
    g = b.surface.ground(cx, cz)
    h = top - base + 1.2
    gmin = min(b.surface.ground(cx + math.cos(t) * (r + 0.6), cz + math.sin(t) * (r + 0.6)) for t in [k * math.tau / 24 for k in range(24)])
    b.prism([(cx + math.cos(k * math.tau / 24) * (r + 0.6), cz + math.sin(k * math.tau / 24) * (r + 0.6)) for k in range(24)],
            gmin - 0.3, base - gmin + 0.3, 'granite', footing=True)
    b.cylinder_y(cx, base, h, cz, r, 'glass', sections=24, collide=True)
    b.cylinder_y(cx, base + h, 0.6, cz, r + 0.25, 'white', sections=24)
    if b.detail:
        # front tiled panel with the vertical plaque, steel columns, ring canopy with spokes
        ang = math.atan2(nrm[1], nrm[0])
        px, pz = cx + math.cos(ang) * (r + 0.05), cz + math.sin(ang) * (r + 0.05)
        prev = b.pose
        yaw = math.atan2(-nrm[0], nrm[1]) * -1
        b.pose = (px, 0.0, pz, math.atan2(nrm[0], nrm[1]))
        b.box(0, base, -0.3, 8.0, h - 0.4, 0.6, 'cream', cap_region='white')
        b.sign_board(0, base + h * 0.62, 0.02, 2.4, 6.6, 'glut_lib', backing=None, depth=0)
        for k in range(4):
            b.box(-2.4 + k * 1.6, base + 0.6, 0.05, 0.5, 2.6, 0.12, 'dark_stone')
        b.pose = prev
        for k in range(10):
            t = ang + math.radians(-80 + k * 160 / 9)
            if abs(k - 4.5) < 1.2:
                continue
            x, z = cx + math.cos(t) * (r + 0.9), cz + math.sin(t) * (r + 0.9)
            y0 = U.footing(b, [(x + 0.38, z), (x - 0.38, z), (x, z + 0.38), (x, z - 0.38)])
            b.cylinder_y(x, y0, base + h + 2.4 - y0, z, 0.38, 'steel', sections=8)
        rr = r + 3.6
        U.ring_arc(b, cx, cz, base + h + 2.0, rr, 1.6, 0.7, ang - 1.9, ang + 1.9, 'white', n=28)
        for k in range(9):
            t = ang - 1.6 + k * 3.2 / 8
            b.tube((cx + math.cos(t) * (r + 0.2), base + h + 2.3, cz + math.sin(t) * (r + 0.2)),
                   (cx + math.cos(t) * (rr - 0.8), base + h + 2.3, cz + math.sin(t) * (rr - 0.8)), 0.28, 'white')
    return base, top


def _gym(b, pts):
    poly = Polygon(pts)
    mrr = list(poly.minimum_rotated_rectangle.exterior.coords)[:4]
    e0, e1 = math.dist(mrr[0], mrr[1]), math.dist(mrr[1], mrr[2])
    if e0 < e1:
        mrr = mrr[1:] + mrr[:1]
        e0, e1 = e1, e0
    ang = math.atan2(-(mrr[1][1] - mrr[0][1]), mrr[1][0] - mrr[0][0])
    c = poly.centroid
    g_lo, g_hi = U.ground_range(b, pts)
    base = g_hi + 0.15
    top = base + 15.0
    b.prism(pts, g_lo - 0.4, base - g_lo + 0.4, 'granite', cap_region='granite', footing=True)
    b.prism(pts, base, top - base, 'glass', cap_region='silver_roof', collide=True)
    if b.detail:
        # pink granite piers + spandrel at the top, ref 体育馆
        for i, a, cc, L, u, nrm in U.edges(U.ccw(pts), 6.0):
            n = max(2, int(L / 7.5))
            for k in range(n + 1):
                p = (a[0] + u[0] * L * k / n, a[1] + u[1] * L * k / n)
                U.fin(b, p, base, top - base, 0.5, 1.1, u, nrm, 'pink_wall', foot=True)
            U.slab(b, a, cc, top - 3.4, 3.4, 0.45, nrm, 'pink_wall')
            U.slab(b, a, cc, base + 4.6, 0.35, 0.6, nrm, 'steel')
    # solid pink-granite entrance block on the road (west) face carrying the name, ref 体育馆
    fa, fc, fL, fu, fn = _edge_facing(U.ccw(pts), (-1.0, 0.0))
    fm = ((fa[0] + fc[0]) / 2 - fu[0] * fL * 0.12, (fa[1] + fc[1]) / 2 - fu[1] * fL * 0.12)
    prev = b.pose
    b.pose = (fm[0], 0.0, fm[1], math.atan2(fn[0], fn[1]))
    y0 = U.pose_footing(b, 0, 0.2, fL * 0.42, 3.2)
    bw = fL * 0.21
    b.prism([(-bw, -1.4), (bw, -1.4), (bw, 1.8), (-bw, 1.8)], y0, top + 0.3 - y0, 'pink_wall',
            cap_region='silver_roof', footing=True, collide=True)
    if b.detail:
        b.sign_board(0, top - 2.6, 1.86, 10.0, 2.4, 'glut_gym', backing='pink_wall', depth=0.06)
        y0 = U.pose_footing(b, fL * 0.26, 2.6, fL * 0.12, 2.4)
        gx0, gx1 = fL * 0.20, fL * 0.32
        b.prism([(gx0, 1.4), (gx1, 1.4), (gx1, 3.8), (gx0, 3.8)], y0, base + 3.5 - y0, 'glass',
                cap_region='white', footing=True)
    b.pose = prev
    prev = b.pose
    b.pose = (c.x, 0.0, c.y, ang)
    b.pitched_roof(0, top + 0.5, 0, e0, e1, 4.2, overhang=3.2, tile_region='silver_roof', fascia_region='steel')
    if b.detail:
        b.box(0, top - 0.1, 0, e0 + 5.0, 0.7, e1 + 5.0, 'steel')
    b.pose = prev
    return base, top


def _science_park(b, pts, spec):
    base, top = U.building(b, pts, **{k: v for k, v in spec.items() if k != 'hero'})
    # White steel truss frame on the west (建干路) end with the blue vertical name, ref 国家大学科技园
    a, c, L, u, nrm = _edge_facing(pts, (-1.0, 0.0))
    m = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)
    d0, d1 = 0.4, 4.4
    hw = min(L / 2 - 0.5, 4.0)
    H = top - base + 6.0
    corners = []
    for s in (-hw, hw):
        for d in (d0, d1):
            corners.append((m[0] + u[0] * s + nrm[0] * d, m[1] + u[1] * s + nrm[1] * d))
    for x, z in corners:
        y0 = U.footing(b, [(x - .25, z - .25), (x + .25, z - .25), (x + .25, z + .25), (x - .25, z + .25)])
        b.box(x, y0, z, 0.5, base + H - y0, 0.5, 'white', collide=True)
    if b.detail:
        lv = 6
        for k in range(lv):
            y0, y1 = base + H * k / lv, base + H * (k + 1) / lv
            for (p, q) in ((corners[0], corners[2]), (corners[1], corners[3]), (corners[0], corners[1]), (corners[2], corners[3])):
                b.tube((p[0], y0, p[1]), (q[0], y1, q[1]), 0.16, 'white')
                b.tube((q[0], y0, q[1]), (p[0], y1, p[1]), 0.16, 'white')
            b.tube((corners[1][0], y1, corners[1][1]), (corners[3][0], y1, corners[3][1]), 0.18, 'white')
        prev = b.pose
        p = (m[0] + nrm[0] * 0.08 + u[0] * (hw + 3.2), m[1] + nrm[1] * 0.08 + u[1] * (hw + 3.2))
        b.pose = (p[0], 0.0, p[1], math.atan2(nrm[0], nrm[1]))
        b.sign_board(0, base + (top - base) * 0.6, 0.0, 2.2, 9.5, 'glut_park', backing=None, depth=0)
        b.pose = prev
    return base, top


def _staff_centre(b, pts, spec):
    base, top = U.building(b, pts, **{k: v for k, v in spec.items() if k != 'hero'})
    # Curved blue-glass corner drum facing 六合路 (south-east), ref 教职工活动中心
    poly = Polygon(pts)
    corner = max(pts, key=lambda p: p[1] + 0.4 * p[0])
    cx, cz = corner[0] * 0.75 + poly.centroid.x * 0.25, corner[1] * 0.75 + poly.centroid.y * 0.25
    r = 8.0
    b.cylinder_y(cx, base + 4.2, top - base - 2.2, cz, r, 'glass', sections=20, collide=True)
    gmin = min(b.surface.ground(cx + math.cos(k * math.tau / 20) * r, cz + math.sin(k * math.tau / 20) * r) for k in range(20))
    b.prism([(cx + math.cos(k * math.tau / 20) * r, cz + math.sin(k * math.tau / 20) * r) for k in range(20)],
            gmin - 0.3, base + 4.2 - gmin + 0.3, 'white', footing=True, collide=True)
    b.cylinder_y(cx, top + 2.0, 0.9, cz, r, 'white', sections=20)
    if b.detail:
        f = _edge_facing(pts, (0.0, 1.0))
        fa, fc, fL, fu, fn = f
        sm = ((fa[0] + fc[0]) / 2 - fu[0] * fL * 0.15, (fa[1] + fc[1]) / 2 - fu[1] * fL * 0.15)
        prev = b.pose
        b.pose = (sm[0] + fn[0] * 0.05, 0.0, sm[1] + fn[1] * 0.05, math.atan2(fn[0], fn[1]))
        b.sign_board(0, top - 2.0, 0.0, 9.0, 1.3, 'glut_staff', backing=None, depth=0)
        b.pose = prev
        for k in range(1, 3):
            U.ring_arc(b, cx, cz, base + 4.2 + k * 4.2 - 0.2, r + 0.15, 0.4, 0.35, 0, math.tau, 'white', n=20)
    return base, top


def _business(b, pts, spec):
    base, top = U.building(b, pts, **{k: v for k, v in spec.items() if k != 'hero'})
    # Blue-glass stair/entrance tower at the south end, ref 商学院 (教七楼 photo)
    a, c, L, u, nrm = _edge_facing(pts, (0.0, 1.0))
    m = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)
    prev = b.pose
    b.pose = (m[0] + nrm[0] * 2.0, 0.0, m[1] + nrm[1] * 2.0, math.atan2(nrm[0], nrm[1]))
    y0 = U.pose_footing(b, 0, -2.0, min(L * 0.5, 10.0), 4.6)
    b.box(0, y0, -2.0, min(L * 0.5, 10.0), top + 2.5 - y0, 4.6, 'glass', cap_region='white', collide=True)
    b.box(0, base + 3.6, 1.2, 9.0, 0.45, 4.0, 'white', cap_region='silver_roof')  # entrance canopy
    if b.detail:
        b.sign_board(0, base + 4.3, 3.21, 4.2, 0.9, 'glut_biz', backing=None, depth=0)
    b.pose = prev
    return base, top


def _gate(b, gx, gz, campus_local):
    """Main gate on 建干路: white swooping ribbon arch across the entrance (ref 屏风东校门)."""
    ring = list(campus_local.exterior.coords)
    best = min(((math.dist(Point(gx, gz).coords[0], Point(*Polygon([p, q, p]).centroid.coords[0]).coords[0]), p, q)
                for p, q in zip(ring, ring[1:]) if math.dist(p, q) > 1), key=lambda t: t[0])
    _, p, q = best
    ux, uz = (q[0] - p[0]) / math.dist(p, q), (q[1] - p[1]) / math.dist(p, q)
    yaw = math.atan2(-uz, ux)
    g = b.surface.ground(gx, gz)
    prev = b.pose
    b.pose = (gx, g, gz, yaw)
    # The ribbon: rises from the left foot over the 14 m carriageway to a tall right shoulder
    n = 22 if b.detail else 10
    span, depth, th = 16.0, 3.6, 0.55
    # low left foot rising across the carriageway into a curled right head (photo 屏风东校门)
    pts = [(-span / 2 + 13.0 * k / n, 0.9 + 4.8 * (k / n) ** 1.8) for k in range(n + 1)]
    ccx, ccz, rr = 6.25, 4.55, 1.75
    m = max(6, n // 2)
    for k in range(1, m + 1):
        a = math.radians(145 - 205 * k / m)
        pts.append((ccx + rr * math.cos(a), ccz + rr * math.sin(a)))
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        nx, ny = -(y1 - y0) / L, (x1 - x0) / L
        top = [(x0, y0, -depth / 2), (x1, y1, -depth / 2), (x1, y1, depth / 2), (x0, y0, depth / 2)]
        bot = [(x + nx * -th, y + ny * -th, zz) for x, y, zz in top]
        b.face(top, (nx, ny, 0), 'white')
        b.face(bot, (-nx, -ny, 0), 'white')
        b.face([top[0], top[1], bot[1], bot[0]], (0, 0, -1), 'white')
        b.face([top[3], top[2], bot[2], bot[3]], (0, 0, 1), 'white')
    # right shoulder pier down to the ground
    y0 = U.pose_footing(b, pts[-1][0] - 0.3, 0, 1.2, depth)
    b.box(pts[-1][0] - 0.3, y0, 0, 1.2, pts[-1][1] - y0, depth, 'white', collide=True)
    y0 = U.pose_footing(b, -span / 2 + 0.5, 0, 1.2, depth)
    b.box(-span / 2 + 0.5, y0, 0, 1.2, 0.9 - y0, depth, 'white', collide=True)
    # closed retractable gate under the arch (generalised, always closed)
    b.pose = prev
    # Red granite name monument in front of the science park (ref 国家大学科技园)
    m = (gx + uz * 26.0 - ux * 14.0, gz - ux * 26.0 - uz * 14.0)
    mg = b.surface.ground(*m)
    b.pose = (m[0], mg, m[1], yaw)
    y0 = U.pose_footing(b, 0, 0, 12.0, 1.6)
    b.box(0, y0, 0, 12.0, 2.7 - y0, 1.6, 'brick_red', cap_region='brick_red', collide=True)
    y0 = U.pose_footing(b, -6.6, 0.3, 1.4, 2.2)
    b.box(-6.6, y0, 0.3, 1.4, 1.7 - y0, 2.2, 'brick_red', collide=True)
    if b.detail:
        b.sign_board(0, 1.55, 0.81, 9.2, 1.7, 'glut_name', backing=None, depth=0)
        b.pose = (m[0], mg, m[1], yaw + math.pi)
        b.sign_board(0, 1.55, 0.81, 9.2, 1.7, 'glut_name', backing=None, depth=0)
    b.pose = prev


def build(b):
    campus, blds, gate = _campus_data()
    to_local = lambda p: transform(lambda x, y, z=None: _local(b, x, y), p)
    campus_l = to_local(campus)
    for sid, oid, tags, p in blds:
        pl = to_local(p)
        pts = U.ccw(list(pl.exterior.coords))
        holes = [U.ccw(list(h.coords))[::-1] for h in pl.interiors]
        spec = dict(SPEC.get(oid, DEFAULTS.get(tags.get('building'), DEFAULTS['yes'])))
        if tags.get('building:levels') and 'floors' not in SPEC.get(oid, {}):
            spec['floors'] = max(1, round(float(tags['building:levels'])))
        if pl.area < 120:
            spec.update(floors=min(spec.get('floors', 2), 2), style='punched')
        hero = spec.pop('hero', None)
        sign = spec.pop('sign', None)
        if hero == 'library':
            _library(b, pts, spec)
        elif hero == 'gym':
            _gym(b, pts)
        elif hero == 'science_park':
            _science_park(b, pts, spec)
        elif hero == 'staff_centre':
            _staff_centre(b, pts, spec)
        elif hero == 'business':
            _business(b, pts, spec)
        else:
            base, top = U.building(b, pts, holes=holes, **spec)
            if sign and b.detail:
                a, c, L, u, nrm = _edge_facing(pts, (0.0, 1.0))
                m = ((a[0] + c[0]) / 2 + nrm[0] * 2.2, (a[1] + c[1]) / 2 + nrm[1] * 2.2)
                prev = b.pose
                b.pose = (m[0], 0.0, m[1], math.atan2(nrm[0], nrm[1]))
                b.box(0, base + 3.4, -1.0, 8.5, 0.5, 4.4, 'white', cap_region='silver_roof')
                for sx in (-3.6, 3.6):
                    y0 = U.pose_footing(b, sx, 0.6, 0.6, 0.6)
                    b.box(sx, y0, 0.6, 0.6, base + 3.4 - y0, 0.6, 'white')
                b.sign_board(0, base + 3.9 + 0.45, 0.6, 6.4, 0.9, sign, backing=None, depth=0)
                b.pose = prev
    gl = _local(b, *gate)
    _gate(b, gl[0], gl[1], campus_l)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'glut_pingfeng.glb', build, signs=SIGNS)
