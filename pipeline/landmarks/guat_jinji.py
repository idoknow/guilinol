"""Guilin University of Aerospace Technology - Jinji Rd campus (桂林航天工业学院), IDOK-165.

All 196 buildings of docs/refs/campus/guat_jinji/catalog.json (IDOK-168/177) on exact
OSM / Overture footprints. OSM has no campus outline here; the catalog boundary
(approx, from IDOK-168) anchors the landmark. Only five buildings have photos, so the
rest follow the campus palette seen in the school's photos: the newer south campus
in brick red with white bands (天和苑, 飞天楼), the older north campus in white.
Heroes: 问天楼 library (white with red stripe bands and a red entrance cube), 校史馆
航天博物馆 (two-storey white hall, dark hipped roof, red window frames), and the
slanted white-panel gates with the vertical gold school name at both gates (barriers
and booths are not modelled).
"""
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from shapely.geometry import Polygon, LineString
from campus_passage import open_straight_passage
from canal_passages import sample_road_heights
import json
from world_surface import WORLD

from common import ll2xz, load_osm
from g3_kit import export_school
import uni_campus as C
import uni_kit as U

GATES = ((13637274739, 13637274740), (13637274757, 13637274758))   # south, north (lift-gate pairs)

SIGNS = [
    dict(key='guat_name', title='桂林航天工业学院', orient='v', fg=(206, 162, 70), bg=(236, 236, 232), sans=False),
    dict(key='guat_wt', title='问天楼', fg=(250, 246, 240), bg=(178, 46, 40), sans=False),
]


def _wentian(b, pts, spec):
    base, top = U.building(b, pts, style='ribbon', floors=5, fh=4.0, wall='white', accent='brick_red', trim='white')
    a, c, L, u, nrm = C.facing_edge(pts, (0.0, 1.0))
    m = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)
    prev = b.pose
    b.pose = (m[0], 0.0, m[1], math.atan2(nrm[0], nrm[1]))
    y0 = U.pose_footing(b, 0, 2.5, 22.0, 5.0)
    b.prism([(-11, -0.2), (11, -0.2), (11, 5.0), (-11, 5.0)], y0, base + 8.5 - y0, 'brick_red',
            cap_region='white', footing=True, collide=True)
    if b.detail:
        b.box(0, base + 0.2, 5.03, 9.0, 4.6, 0.06, 'glass', lit=True)
        b.sign_board(0, base + 6.2, 5.03, 7.0, 1.6, 'guat_wt', backing=None, depth=0)
    b.pose = prev


def _museum(b, pts, spec):
    U.building(b, pts, style='punched', floors=2, fh=4.2, wall='white', accent='white', trim='brick_red',
               roof='hip', roof_tile='gray_tile', parapet=0.0, bay=3.2, win_h=2.2, win_w=1.2)


def _gate(b, campus_l, gx, gz):
    x, z, yaw = C.gate_frame(campus_l, gx, gz)
    prev = b.pose
    b.pose = (x, b.surface.ground(x, z), z, yaw)
    for side in (-1, 1):
        sx = side * 7.5
        y0 = U.pose_footing(b, sx, 0, 2.6, 1.2)
        # tall slanted white panel: lean the top outward (two prisms stepping out)
        b.prism([(sx - 1.3, -0.6), (sx + 1.3, -0.6), (sx + 1.3, 0.6), (sx - 1.3, 0.6)], y0, 9.4, 'white',
                cap_region='white', footing=True, collide=True)
        px = sx + side * 1.6
        y1 = U.pose_footing(b, px, 0, 0.9, 1.0)
        b.prism([(px - .45, -.5), (px + .45, -.5), (px + .45, .5), (px - .45, .5)], y1, 7.0 + (y0 - y1) if y0 > y1 else 7.0, 'steel',
                cap_region='steel', footing=True)
        gx = sx - side * 1.9
        y2 = U.pose_footing(b, gx, 0, 1.4, 0.08)
        b.prism([(gx - .7, -.04), (gx + .7, -.04), (gx + .7, .04), (gx - .7, .04)], y2, 6.1, 'green_glaze',
                cap_region='green_glaze', footing=True)
        if b.detail:
            b.sign_board(sx, y0 + 5.0, 0.615, 1.4, 6.6, 'guat_name', backing=None, depth=0)
            front = b.pose
            b.pose = (front[0], front[1], front[2], front[3] + math.pi)
            b.sign_board(-sx, y0 + 5.0, 0.615, 1.4, 6.6, 'guat_name', backing=None, depth=0)
            b.pose = front
    b.pose = prev


def build(b):
    els = load_osm('guat_jinji')
    cat = C.catalog('guat_jinji')
    campus_l = C.to_local(b, Polygon([ll2xz(la, lo) for lo, la in cat['boundary']]))
    geo = C.footprints((r['source'] for r in cat['buildings']), 'guat_jinji')
    overrides = {}
    for r in cat['buildings']:
        if r.get('facade') or r['source'] not in geo:
            continue
        p = C.to_local(b, geo[r['source']][0])
        south = p.centroid.y > 0.0
        overrides[r['source']] = (dict(style='pilaster', wall='brick_red', accent='white', trim='white')
                                  if south else dict(style='punched', wall='white', accent='granite'))
    overrides.update({'way/680695951': dict(style='balcony', wall='white', accent='white'),
                      'way/680695956': dict(style='ribbon', wall='white', accent='granite'),
                      'a58c9bc2-83c6-4f1c-afe7-bf2f3ee41cdc': dict(style='ribbon', wall='white', accent='white')})
    road=next(w for w in els if w['type']=='way' and w['id']==1487527349)
    axis=LineString([ll2xz(g['lat'],g['lon']) for g in road['geometry']])
    def passage(builder, ring, spec):
        local=C.to_local(builder,axis)
        across=Polygon(ring).intersection(local.buffer(2.5,cap_style='flat'))
        probes=[dict(x=builder.surface.x+x,z=builder.surface.z+z,way=road['id'])
                for x,z in across.exterior.coords]
        for side in (-2.5,0,2.5):
            track=local.offset_curve(side).intersection(across) if side else local.intersection(across)
            if track.is_empty:continue
            for i in range(math.ceil(track.length)+1):
                point=track.interpolate(i)
                probes.append(dict(x=builder.surface.x+point.x,z=builder.surface.z+point.y,way=road['id']))
        highest=max(sample_road_heights(WORLD,json.loads((WORLD/'manifest.json').read_text()),probes))-builder.surface.y
        open_straight_passage(builder,ring,spec,local,2.5,highest,U.building)
    C.build_records(b, 'guat_jinji', heroes={'way/1472913840': _wentian, 'way/724360581': _museum,'way/1472913843':passage},
                    overrides=overrides)
    nodes = {e['id']: e for e in els if e['type'] == 'node' and any(e['id'] in g for g in GATES)}
    for pair in GATES:
        pts = [ll2xz(nodes[i]['lat'], nodes[i]['lon']) for i in pair if i in nodes]
        if pts:
            gx = sum(p[0] for p in pts) / len(pts) - b.surface.x
            gz = sum(p[1] for p in pts) / len(pts) - b.surface.z
            _gate(b, campus_l, gx, gz)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'guat_jinji.glb', build, signs=SIGNS)
