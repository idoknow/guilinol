"""Catalog-driven university campus builder (IDOK-165).

Reads ``docs/refs/campus/<campus_id>/catalog.json`` (one record per OSM / Overture
building, filled from photos by the data sub-issues) and turns every record into a
``uni_kit.building`` call: floors from the catalog (else OSM levels, else a size-based
guess), facade grammar and colours from the photo description. Campus modules only
add their hero buildings and gates on top.
"""
import csv
import json
import math
from pathlib import Path

from shapely import wkt
from shapely.geometry import Polygon
from shapely.ops import transform

from common import ll2xz, load_osm, RAW
import uni_kit as U

ROOT = Path(__file__).resolve().parents[2]

SWATCHES = {
    'white': (236, 234, 226), 'cream': (227, 217, 193), 'yellow_wall': (230, 210, 134),
    'ochre': (204, 168, 110), 'terracotta': (181, 98, 82), 'brick_red': (156, 62, 54),
    'blue_facade': (66, 114, 150), 'granite': (168, 167, 159), 'pink_wall': (224, 206, 204),
    'steel': (188, 194, 199), 'silver_roof': (174, 182, 188),
}


def nearest_swatch(hexcol):
    if not hexcol or not isinstance(hexcol, str) or not hexcol.startswith('#') or len(hexcol) != 7:
        return None
    rgb = tuple(int(hexcol[i:i + 2], 16) for i in (1, 3, 5))
    return min(SWATCHES, key=lambda k: sum((a - b) ** 2 for a, b in zip(SWATCHES[k], rgb)))


def catalog(campus_id):
    return json.loads((ROOT / 'docs/refs/campus' / campus_id / 'catalog.json').read_text())


def footprints(sources, campus_id):
    """source id -> world-space shapely Polygon (OSM way or Overture id)."""
    want = set(sources)
    out = {}
    if not Path(RAW).exists():
        data = json.loads((ROOT/'pipeline/data/landmarks'/f'{campus_id}-footprints.json').read_bytes())
        for key in want:
            row = data['buildings'][key]
            if key.startswith('way/'):
                shape = Polygon([ll2xz(lat, lon) for lat, lon in row['geometry']])
                tags = {}
            else:
                shape = transform(lambda x, y, z=None: ll2xz(y, x), wkt.loads(row['wkt']))
                tags = {'building': 'yes'}
            if row['levels']:
                tags['building:levels'] = row['levels']
            out[key] = shape, tags
        return out
    for e in load_osm():
        key = f"way/{e['id']}" if e['type'] == 'way' else None
        if key in want and 'geometry' in e and len(e['geometry']) >= 4:
            out[key] = (Polygon([ll2xz(q['lat'], q['lon']) for q in e['geometry']]), e.get('tags', {}))
    with open(Path(RAW) / 'overture_buildings.csv') as f:
        for r in csv.DictReader(f, delimiter='\t'):
            if r['id'] in want:
                p = wkt.loads(r['wkt'])   # may be a MultiPolygon (twin blocks under one id)
                t = {'building': 'yes'}
                if r['num_floors']:
                    t['building:levels'] = r['num_floors']
                out[r['id']] = (transform(lambda x, y, z=None: ll2xz(y, x), p), t)
    return out


def spec_for(rec, tags, area):
    """Facade grammar from the catalog's photo description."""
    text = (rec.get('facade') or '') + ' ' + ' '.join(rec.get('features') or [])
    floors = rec.get('floors') or (round(float(tags['building:levels'])) if tags.get('building:levels') else None)
    if not floors:
        floors = 2 if area < 150 else 4 if area < 500 else 5 if area < 1500 else 6
    wall = nearest_swatch((rec.get('colors') or {}).get('wall'))
    if not wall:
        wall = ('pink_wall' if '粉' in text and '夹' not in text else
                'cream' if any(k in text for k in ('浅黄', '米', '暖色', '黄')) else
                'granite' if '深灰' in text else 'white')
    accent = nearest_swatch((rec.get('colors') or {}).get('accent'))
    if '砖红' in text:
        accent = accent or 'brick_red'
    if '淡黄' in text or '浅黄' in text:
        wall = 'yellow_wall' if '淡黄' in text else wall
    if '阳台' in text or '外廊' in text:
        style = 'balcony'
    elif '浅绿' in text and '竖' in text:
        style, accent = 'pilaster', 'turf_light'
    elif '砖红' in text:
        style = 'ribbon'
    elif '粉' in text:
        style, accent = 'panel', 'pink_wall'
    elif '玻璃幕' in text:
        style = 'curtain'
    elif '遮阳' in text or '格构' in text:
        style = 'grid'
    elif '横向' in text or '带窗' in text or '分层线' in text:
        style = 'ribbon'
    elif '壁柱' in text or '竖向线条' in text:
        style = 'pilaster'
    else:
        style = 'punched'
    roof = 'hip' if (rec.get('roof') or '') in ('hip_tile', 'gable_tile') else 'flat'
    return dict(style=style, floors=int(floors), fh=3.4 if style == 'balcony' else 3.6, wall=wall,
                accent=accent or ('white' if wall != 'white' else 'granite'),
                trim='white', roof=roof, roof_tile='gray_tile' if roof == 'hip' else 'silver_roof')


def to_local(b, poly):
    return transform(lambda x, y, z=None: (x - b.surface.x, y - b.surface.z), poly)


def build_records(b, campus_id, heroes=None, overrides=None, skip=()):
    """Build every catalog record; ``heroes[source](b, pts, spec)`` replaces the default."""
    heroes, overrides = heroes or {}, overrides or {}
    cat = catalog(campus_id)
    recs = [r for r in cat['buildings'] if r['source'] not in skip]
    geo = footprints((r['source'] for r in recs), campus_id)
    built = []
    # Catalogs list OSM ways and Overture rows side by side; when both describe the
    # same footprint (>=90% overlap) build it once, preferring the OSM way.
    recs.sort(key=lambda r: not r['source'].startswith('way/'))
    taken = []
    for rec in recs:
        if rec['source'] not in geo:
            continue
        whole, tags = geo[rec['source']]
        for poly in getattr(whole, 'geoms', [whole]):
            if any(t.intersection(poly).area >= 0.9 * min(t.area, poly.area) for t in taken if t.intersects(poly)):
                continue
            taken.append(poly)
            _build_one(b, rec, poly, tags, heroes, overrides)
        built.append(rec['source'])
    return built


def _build_one(b, rec, poly, tags, heroes, overrides):
    pl = to_local(b, poly)
    if not pl.is_valid or pl.area < 8:
        return
    pts = U.ccw(list(pl.exterior.coords))
    holes = [U.ccw(list(h.coords))[::-1] for h in pl.interiors]
    spec = spec_for(rec, tags, pl.area)
    spec.update(overrides.get(rec['source'], {}))
    if pl.area < 120:
        spec.update(floors=min(spec['floors'], 2), style='punched')
    if rec['source'] in heroes:
        heroes[rec['source']](b, pts, spec)
    else:
        U.building(b, pts, holes=holes, **spec)


def facing_edge(pts, direction):
    best = None
    for i, a, c, L, u, nrm in U.edges(pts, 4.0):
        score = (nrm[0] * direction[0] + nrm[1] * direction[1]) * L
        if best is None or score > best[0]:
            best = (score, a, c, L, u, nrm)
    return best[1:]


def gate_frame(campus_l, gx, gz):
    """Pose (x, z, yaw) aligned with the campus outline segment nearest the gate point."""
    from shapely.geometry import LineString, Point
    ring = list(campus_l.exterior.coords)
    best = min((LineString([p, q]).distance(Point(gx, gz)), p, q) for p, q in zip(ring, ring[1:]) if math.dist(p, q) > 1)
    _, p, q = best
    ux, uz = (q[0] - p[0]) / math.dist(p, q), (q[1] - p[1]) / math.dist(p, q)
    return gx, gz, math.atan2(-uz, ux)


def name_wall(b, x, z, w, h, d, region, sign, sign_h, collide=True):
    """Free-standing name wall in the current pose, footed on the ground, sign on its +z face."""
    y0 = U.pose_footing(b, x, z, w, d)
    b.prism([(x - w / 2, z - d / 2), (x + w / 2, z - d / 2), (x + w / 2, z + d / 2), (x - w / 2, z + d / 2)],
            y0, h - y0, region, cap_region=region, footing=True, collide=collide)
    if b.detail:
        b.sign_board(x, h * 0.55, z + d / 2 - 0.015, w * 0.9, sign_h, sign, backing=None, depth=0)


def street_gate_point(campus_world):
    """Boundary point of the campus closest to the nearest named public road (K-12 style gate)."""
    from shapely.geometry import LineString
    from shapely.ops import nearest_points
    best = None
    for e in load_osm():
        t = e.get('tags', {})
        if e['type'] != 'way' or 'geometry' not in e or not t.get('name'):
            continue
        if t.get('highway') not in ('primary', 'secondary', 'tertiary', 'residential', 'unclassified'):
            continue
        line = LineString([ll2xz(q['lat'], q['lon']) for q in e['geometry']])
        d = line.distance(campus_world)
        if d < 120 and (best is None or d < best[0]):
            best = (d, line)
    if best is None:
        return None
    return nearest_points(campus_world.exterior, best[1])[0]


def vocational_campus(b, campus_id, sign_key):
    """OSM-level school campus (minors on site): plain footprint blocks from the catalog,
    one generalized closed street gate with the school name; no interior detail,
    no guard post, turnstile or camera (IDOK-165, K-12 rule)."""
    cat = catalog(campus_id)
    overrides = {r['source']: dict(style='punched', wall='white', accent='granite', roof_box=False)
                 for r in cat['buildings']}
    build_records(b, campus_id, overrides=overrides)
    way = int(cat['campus_osm'].split('/')[1])
    e = next(x for x in load_osm() if x['type'] == 'way' and x['id'] == way)
    campus_w = Polygon([ll2xz(q['lat'], q['lon']) for q in e['geometry']])
    p = street_gate_point(campus_w)
    if p is None:
        return
    campus_l = to_local(b, campus_w)
    x, z, yaw = gate_frame(campus_l, p.x - b.surface.x, p.y - b.surface.z)
    prev = b.pose
    b.pose = (x, b.surface.ground(x, z), z, yaw)
    for sx in (-4.4, 4.4):
        y0 = U.pose_footing(b, sx, 0, 0.9, 0.9)
        b.prism([(sx - .45, -.45), (sx + .45, -.45), (sx + .45, .45), (sx - .45, .45)], y0, 2.6 - y0, 'white',
                cap_region='granite', footing=True, collide=True)
    name_wall(b, -9.5, -0.2, 8.0, 2.2, 0.8, 'granite', sign_key, 1.2)
    b.pose = prev
