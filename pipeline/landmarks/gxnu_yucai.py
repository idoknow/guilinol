"""Guangxi Normal University - Yucai Campus (广西师大育才校区), IDOK-165.

All 127 buildings of docs/refs/campus/gxnu_yucai/catalog.json (OSM way/643029633) on
their exact footprints; facades from the catalog photos (IDOK-167). Heroes: library
(salmon-tile upper block on a white podium, vertical 图书馆), 越南九二学校旧址 (two-storey
yellow block, dark hip roof, ground-floor arcade), 职业技术师范学院 brick-red bands,
化学楼 green bands, and the north gate name wall. The attached foreign-language school
(K-12) keeps plain OSM-level blocks only.
"""
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from shapely.geometry import Polygon

from common import ll2xz, load_osm
from g3_kit import export_school
import uni_campus as C
import uni_kit as U

CAMPUS = 643029633
NORTH_GATE = 6310986841
K12 = ('广西师范大学附属外国语学校',)

SIGNS = [
    dict(key='gxnu_name', title='广西师范大学', sub='育才校区', fg=(52, 44, 40), bg=(196, 170, 140), sans=False),
    dict(key='gxnu_lib', title='图书馆', orient='v', fg=(250, 248, 240), bg=(170, 120, 104), sans=False),
]


def _library(b, pts, spec):
    base, top = U.building(b, pts, style='punched', floors=6, fh=3.8, wall='pink_wall', accent='white', trim='white')
    fh = 3.8
    for i, a, c, L, u, nrm in U.edges(pts, 3.0):
        U.slab(b, a, c, base - 0.1, 2 * fh + 0.1, 0.35, nrm, 'white')         # white podium skin
        if L > 6:
            for f in range(2):
                y = base + f * fh + 1.0
                U.quad(b, (a[0] + u[0] * 0.8, a[1] + u[1] * 0.8), (c[0] - u[0] * 0.8, c[1] - u[1] * 0.8),
                       y, y + 1.7, 0.37, nrm, 'glass', lit=True)
    if b.detail:
        a, c, L, u, nrm = C.facing_edge(pts, (0.0, -1.0))
        m = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)
        prev = b.pose
        b.pose = (m[0], 0.0, m[1], math.atan2(nrm[0], nrm[1]))
        b.sign_board(0, base + 2 * fh + (top - base - 2 * fh) * 0.55, 0.075, 2.2, 7.5, 'gxnu_lib', backing='pink_wall', depth=0.06)
        b.pose = prev


def _vietnam_school(b, pts, spec):
    base, top = U.building(b, pts, style='punched', floors=2, fh=3.9, wall='yellow_wall', accent='white',
                           trim='white', roof='hip', roof_tile='gray_tile', parapet=0.0, bay=3.0)
    # ground-floor arcade: square white piers along the long faces
    for i, a, c, L, u, nrm in U.edges(pts, 12.0):
        n = int(L / 3.0)
        for k in range(1, n):
            p = (a[0] + u[0] * L * k / n + nrm[0] * 1.0, a[1] + u[1] * L * k / n + nrm[1] * 1.0)
            U.fin(b, p, base, 3.7, 0.45, 0.45, u, nrm, 'white', foot=True)
        U.slab(b, a, c, base + 3.7, 0.35, 1.5, nrm, 'yellow_wall')


def build(b):
    els = load_osm()
    camp = next(e for e in els if e['type'] == 'way' and e['id'] == CAMPUS)
    campus_l = C.to_local(b, Polygon([ll2xz(q['lat'], q['lon']) for q in camp['geometry']]))
    cat = C.catalog('gxnu_yucai')
    overrides = {r['source']: dict(style='punched', wall='white', accent='granite')
                 for r in cat['buildings'] if any(k in (r.get('name') or '') for k in K12)}
    overrides.update({'way/674051986': dict(style='ribbon', wall='white', accent='brick_red'),
                      'way/673896838': dict(style='pilaster', wall='yellow_wall', accent='white')})
    C.build_records(b, 'gxnu_yucai', heroes={'way/448299119': _library, 'way/674026701': _vietnam_school},
                    overrides=overrides)
    g = next(e for e in els if e['type'] == 'node' and e['id'] == NORTH_GATE)
    gx, gz = ll2xz(g['lat'], g['lon'])
    x, z, yaw = C.gate_frame(campus_l, gx - b.surface.x, gz - b.surface.z)
    prev = b.pose
    b.pose = (x, 0.0, z, yaw)
    C.name_wall(b, -12.0, -1.2, 12.0, 2.6, 1.2, 'ochre', 'gxnu_name', 1.6)
    C.name_wall(b, 9.5, -1.2, 5.0, 2.2, 1.0, 'ochre', 'gxnu_name', 1.2)
    b.pose = prev


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'gxnu_yucai.glb', build, signs=SIGNS)
