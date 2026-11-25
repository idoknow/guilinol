"""Guilin University of Electronic Technology - Jinjiling Campus (桂电金鸡岭校区), IDOK-165.

All 72 buildings of docs/refs/campus/guet_jinjiling/catalog.json (OSM way/606121236)
on their exact footprints; facades follow the catalog photos (IDOK-166, 51 buildings
with ground photos). Heroes: East library with its dark glass entrance band and
rooftop "图书馆 LIBRARY", the grey-white / pink-tile teaching blocks 7-10 (第十教学楼
勤正楼), dorms with continuous balconies, the 金鸡路 gate (name stone + teal portal
frames; no booths, barriers or cameras) and the round garden pool south of the library.
"""
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from shapely.geometry import Point, Polygon

from common import ll2xz, load_osm
from g3_kit import export_school
import uni_campus as C
import uni_kit as U

CAMPUS = 606121236
GATE_NODES = (2642045084, 5934103940)   # 金鸡路 main gate (two lift-gate nodes; barriers not modelled)
POOL_RING = 727843927                   # 草坪花园 round pool: OSM footway ring (catalog lonlat is ~100 m off)

SIGNS = [
    dict(key='guet_name', title='桂林电子科技大学', sub='GUILIN UNIVERSITY OF ELECTRONIC TECHNOLOGY',
         fg=(70, 52, 44), bg=(206, 178, 158), sans=False),
    dict(key='guet_lib', title='图书馆  LIBRARY', fg=(54, 58, 64), bg=(232, 230, 222), sans=False),
    dict(key='guet_qz', title='勤正楼', orient='v', fg=(168, 40, 34), bg=(226, 224, 218), sans=False),
]

TEACHING = {'way/621423420': 5, 'way/621423421': 6, 'way/621423422': 6, 'way/621423423': 5}


def _library(b, pts, spec):
    spec = dict(spec, style='ribbon', wall='white', accent='white', floors=spec.get('floors') or 5, fh=3.9)
    base, top = U.building(b, pts, **spec)
    a, c, L, u, nrm = C.facing_edge(pts, (0.0, 1.0))      # south face toward the round garden
    m = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)
    prev = b.pose
    b.pose = (m[0], 0.0, m[1], math.atan2(nrm[0], nrm[1]))
    y0 = U.pose_footing(b, 0, 0.9, 9.0, 1.8)
    b.prism([(-4.5, -0.2), (4.5, -0.2), (4.5, 1.8), (-4.5, 1.8)], y0, top + 1.2 - y0, 'glass',
            cap_region='white', footing=True, collide=True)
    for sx in (-4.9, 4.9):
        y1 = U.pose_footing(b, sx, 0.9, 0.8, 2.2)
        b.prism([(sx - 0.4, -0.2), (sx + 0.4, -0.2), (sx + 0.4, 2.0), (sx - 0.4, 2.0)], y1, top + 1.5 - y1,
                'white', cap_region='white', footing=True)
    if b.detail:
        # entrance steps and the rooftop name board standing on the parapet
        ys = U.pose_footing(b, 0, 4.0, 12.0, 4.0)
        b.prism([(-6, 1.8), (6, 1.8), (6, 5.8), (-6, 5.8)], ys, max(0.3, base - ys), 'granite', footing=True)
        b.box(0, top + 0.9, -1.0, 15.0, 2.6, 0.3, 'white', cap_region='white')
        b.sign_board(0, top + 2.2, -0.85, 14.0, 2.1, 'guet_lib', backing=None, depth=0)
    b.pose = prev


def _teaching(b, pts, spec):
    spec = dict(spec, style='panel', wall='white', accent='pink_wall', trim='white', fh=3.7)
    base, top = U.building(b, pts, **spec)
    return base, top


def _qinzheng(b, pts, spec):
    base, top = _teaching(b, pts, spec)
    # end wall vertical name 勤正楼 (catalog feature)
    a, c, L, u, nrm = C.facing_edge(pts, (1.0, 0.0))
    m = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)
    if b.detail:
        prev = b.pose
        b.pose = (m[0], 0.0, m[1], math.atan2(nrm[0], nrm[1]))
        b.sign_board(0, base + (top - base) * 0.6, 0.06, 1.8, 6.5, 'guet_qz', backing='white', depth=0.06)
        b.pose = prev


def _gate(b, campus_l, gx, gz):
    ring = list(campus_l.exterior.coords)
    seg = min(((Point(gx, gz).distance(Polygon([p, q, p]).centroid), p, q) for p, q in zip(ring, ring[1:])
               if math.dist(p, q) > 1), key=lambda t: t[0])
    _, p, q = seg
    ux, uz = (q[0] - p[0]) / math.dist(p, q), (q[1] - p[1]) / math.dist(p, q)
    yaw = math.atan2(-uz, ux)
    prev = b.pose
    b.pose = (gx, b.surface.ground(gx, gz), gz, yaw)
    # two teal portal frames over the carriageways (photo 金鸡岭校区校门), no booths/barriers
    for cx in (-4.2, 4.2):
        for sx in (-2.6, 2.6):
            px = cx + sx
            y0 = U.pose_footing(b, px, 0, 0.7, 0.7)
            b.prism([(px - .35, -.35), (px + .35, -.35), (px + .35, .35), (px - .35, .35)], y0, 4.8 - y0,
                    'blue_facade', footing=True, collide=True)
        b.box(cx, 4.8, 0, 6.6, 1.7, 4.2, 'blue_facade', cap_region='steel', bottom=True)
        b.box(cx, 4.75, 0, 6.8, 0.3, 4.4, 'white', cap_region='white', bottom=True)
    # beige-granite name stone left of the gate
    y0 = U.pose_footing(b, -14.5, 2.5, 14.0, 1.6)
    b.box(-14.5, y0, 2.5, 14.0, 3.2 - y0, 1.6, 'granite', cap_region='granite', collide=True)
    if b.detail:
        b.sign_board(-14.5, 1.75, 3.285, 12.8, 2.2, 'guet_name', backing=None, depth=0)
    b.pose = prev


def _pool(b, x, z):
    y = U.footing(b, [(x + 9, z), (x - 9, z), (x, z + 9), (x, z - 9)])
    n = 28
    ring = lambda r: [(x + r * math.cos(k * math.tau / n), z + r * math.sin(k * math.tau / n)) for k in range(n)]
    b.prism(ring(9.0), y, 0.55, 'granite', cap_region='granite', footing=True)
    b.prism(ring(8.4), y, 0.62, 'glass', cap_region='glass', footing=True)
    b.prism(ring(1.6), y, 1.5, 'white', cap_region='white', footing=True)


def build(b):
    els = load_osm('guet_jinjiling')
    camp = next(e for e in els if e['type'] == 'way' and e['id'] == CAMPUS)
    campus_l = C.to_local(b, Polygon([ll2xz(q['lat'], q['lon']) for q in camp['geometry']]))
    heroes = {'way/621423424': _library, 'way/621423420': _qinzheng}
    heroes.update({k: _teaching for k in TEACHING if k not in heroes})
    overrides = {k: dict(floors=v) for k, v in TEACHING.items()}
    C.build_records(b, 'guet_jinjiling', heroes=heroes, overrides=overrides)
    nodes = [e for e in els if e['type'] == 'node' and e['id'] in GATE_NODES]
    gx = sum(ll2xz(n['lat'], n['lon'])[0] for n in nodes) / len(nodes) - b.surface.x
    gz = sum(ll2xz(n['lat'], n['lon'])[1] for n in nodes) / len(nodes) - b.surface.z
    _gate(b, campus_l, gx, gz)
    ring = next(e for e in els if e['type'] == 'way' and e['id'] == POOL_RING)
    pc = Polygon([ll2xz(q['lat'], q['lon']) for q in ring['geometry']]).centroid
    _pool(b, pc.x - b.surface.x, pc.y - b.surface.z)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'guet_jinjiling.glb', build, signs=SIGNS)
