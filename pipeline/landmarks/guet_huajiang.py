"""GUET Huajiang Campus (桂电花江校区), IDOK-165.

All 169 buildings of docs/refs/campus/guet_huajiang/catalog.json (OSM way/606118480,
IDOK-176: 22 of 60 named non-dorm buildings photographed, floors for all) on exact
OSM / Overture footprints. Palette from the photos: grey small-tile teaching blocks
with salmon spandrels (第十三/十四教学楼), red-brown and salmon brick (第十六/十七),
white 四创 blocks with slit windows and brown fins, the lakeside 会议中心 with dark
hipped roofs. Heroes: the long lakeside library (grey ribbon bands), and the 正门
standing stone with the gold vertical school name (no barriers or booths).
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

CAMPUS = 606118480
MAIN_GATE = 3925007976   # OSM 正门

SIGNS = [
    dict(key='hj_name', title='桂林電子科技大學', orient='v', fg=(214, 172, 74), bg=(98, 92, 84), sans=False),
    dict(key='hj_lib', title='图书馆', fg=(60, 64, 70), bg=(226, 226, 222), sans=False),
]

OVERRIDES = {
    'way/606478183': dict(style='panel', wall='granite', accent='pink_wall'),
    'way/606478186': dict(style='panel', wall='granite', accent='pink_wall'),
    'way/606478191': dict(style='punched', wall='terracotta', accent='white', trim='white'),
    'way/606478194': dict(style='punched', wall='pink_wall', accent='white', trim='white'),
    'way/606478146': dict(style='punched', wall='granite', accent='white'),
    'way/606478156': dict(style='punched', wall='granite', accent='white'),
    'way/606478159': dict(style='punched', wall='granite', accent='white'),
    'way/1417187720': dict(style='pilaster', wall='white', accent='wood', win_w=0.8),
    'way/1417187721': dict(style='pilaster', wall='white', accent='wood', win_w=0.8),
    'way/1417187722': dict(style='pilaster', wall='white', accent='wood', win_w=0.8),
    'way/1417190113': dict(style='pilaster', wall='white', accent='wood', win_w=0.8),
    'way/621959944': dict(style='pilaster', wall='terracotta', accent='white'),
    'way/621959945': dict(style='punched', wall='cream', accent='terracotta', roof='hip', roof_tile='gray_tile',
                          parapet=0.0),
    'way/1243629557': dict(style='pilaster', wall='pink_wall', accent='terracotta'),
    'way/1417192550': dict(style='grid', wall='white', accent='white'),
    'way/1417180485': dict(style='ribbon', wall='white', accent='granite'),
    'way/633662027': dict(style='ribbon', wall='white', accent='white'),
    'way/606465853': dict(style='punched', wall='cream', accent='white', roof='hip', roof_tile='gray_tile',
                          parapet=0.0),
    'way/606411548': dict(style='punched', wall='granite', accent='white'),
    'way/624036628': dict(style='ribbon', wall='granite', accent='white'),
    'way/1417175071': dict(style='pilaster', wall='granite', accent='white'),
}


def _library(b, pts, spec):
    base, top = U.building(b, pts, style='ribbon', floors=spec.get('floors') or 4, fh=4.2, wall='white',
                           accent='granite', trim='white')
    a, c, L, u, nrm = C.facing_edge(pts, (0.0, 1.0))
    m = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)
    if b.detail:
        prev = b.pose
        b.pose = (m[0], 0.0, m[1], math.atan2(nrm[0], nrm[1]))
        b.box(0, top + 0.9, -0.6, 10.0, 2.0, 0.3, 'white', cap_region='white', bottom=True)
        b.sign_board(0, top + 1.9, -0.43, 9.0, 1.6, 'hj_lib', backing=None, depth=0)
        b.pose = prev


def _gate_stone(b, campus_l, gx, gz):
    x, z, yaw = C.gate_frame(campus_l, gx, gz)
    prev = b.pose
    sx = -11.0
    b.pose = (x, b.surface.ground(x, z), z, yaw)
    y0 = U.pose_footing(b, sx, 0, 3.2, 2.2)
    rock = [(sx - 1.6, -0.9), (sx + 1.1, -1.1), (sx + 1.7, 0.2), (sx + 0.9, 1.1), (sx - 1.3, 0.9)]
    b.prism(rock, y0, 8.6 - y0, 'dark_stone', cap_region='granite', footing=True, collide=True)
    b.prism([(sx - 2.6, -2.0), (sx + 2.6, -2.0), (sx + 2.6, 2.0), (sx - 2.6, 2.0)], y0, 0.45, 'hedge',
            cap_region='hedge', footing=True)
    if b.detail:
        b.sign_board(sx, y0 + 4.9, 1.04, 1.3, 6.2, 'hj_name', backing=None, depth=0)
    b.pose = prev


def build(b):
    els = load_osm()
    camp = next(e for e in els if e['type'] == 'way' and e['id'] == CAMPUS)
    campus_l = C.to_local(b, Polygon([ll2xz(q['lat'], q['lon']) for q in camp['geometry']]))
    C.build_records(b, 'guet_huajiang', heroes={'05d68d98-09ab-4af4-818e-61b78b620331': _library},
                    overrides=OVERRIDES)
    g = next(e for e in els if e['type'] == 'node' and e['id'] == MAIN_GATE)
    gx, gz = ll2xz(g['lat'], g['lon'])
    _gate_stone(b, campus_l, gx - b.surface.x, gz - b.surface.z)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'guet_huajiang.glb', build, signs=SIGNS)
