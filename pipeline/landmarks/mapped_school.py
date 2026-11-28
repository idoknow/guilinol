"""OSM sports polygons and OSM/Overture building outlines for the old-city schools."""
import csv
import json
import math
from functools import cache
from pathlib import Path

from shapely import constrained_delaunay_triangles, shortest_line, union_all
from shapely.affinity import translate
from shapely.geometry import LineString, Point, Polygon, box

from common import RAW, load_osm
from features import area, overture_geometry, polygons


@cache
def sources(model):
    osm = {f"{e['type']}/{e['id']}": e for e in load_osm(model)}
    if Path(RAW).exists():
        with (Path(RAW) / 'overture_buildings.csv').open() as source:
            overture = {row['id']: row for row in csv.DictReader(source, delimiter='\t')}
    else:
        path = Path(__file__).resolve().parents[1]/'data/landmarks'/f'{model}.json'
        overture = {row['id']: row for row in json.loads(path.read_bytes())['overture']}
    entries = json.loads(Path(__file__).resolve().parents[1].joinpath('landmarks.json').read_text())
    return osm, overture, {e['id']: e for e in entries}


@cache
def layout(module):
    osm, overture, entries = sources(module.SCHOOL)
    origin = area(osm[entries[module.SCHOOL]['anchor']]).centroid

    def local(shape):
        return translate(shape, -origin.x, -origin.y)

    boundary = local(area(osm[module.BOUNDARY]))
    setback = Polygon(module.STREET_SETBACK) if hasattr(module, "STREET_SETBACK") else None
    if setback is not None:
        boundary = boundary.intersection(setback).simplify(0.05)
    buildings = []
    for style in module.BUILDINGS:
        key = style['source_id']
        shape = area(osm[key]) if key.startswith('way/') else overture_geometry(overture[key])
        shape = local(shape)
        if module.SCHOOL == 'zhonghua_primary' and style['bid'] == 'B1':
            shape = shape.intersection(setback).simplify(0.3)
        # The facade builder accepts a single ring. Open a narrow seam to each
        # courtyard so the roof and ground-floor footprint retain the void.
        if shape.interiors:
            shape = shape.simplify(0.3)
        for hole in list(shape.interiors):
            seam = shortest_line(shape.exterior, hole).buffer(0.5, cap_style='square')
            shape = shape.difference(seam)
        buildings.append((shape, style))
    available = boundary.difference(union_all([shape for shape, _ in buildings]))
    sports = []
    # Paint nested infield courts before their surrounding athletics surface.
    elements = sorted(osm.items(), key=lambda item: item[1].get('tags', {}).get('sport') in ('running', 'athletics'))
    for key, element in elements:
        tags = element.get('tags', {})
        if tags.get('leisure') not in ('pitch', 'track'):
            continue
        shape = local(area(element))
        if shape.is_empty or not boundary.covers(shape.representative_point()):
            continue
        for part in polygons(shape.intersection(available)):
            if part.area > 1:
                sports.append((key, tags.get('sport', 'pitch'), part))
        available = available.difference(shape)
    return boundary, buildings, sports


def markings(shape, sport):
    inset = shape.buffer(-0.45)
    if inset.is_empty:
        return
    yield inset.boundary.buffer(0.09)
    if sport in ('running', 'athletics'):
        if shape.interiors:
            yield shape.buffer(-1.6).boundary.buffer(0.08)
        return
    corners = list(shape.minimum_rotated_rectangle.exterior.coords)
    edges = [(b[0]-a[0], b[1]-a[1]) for a, b in zip(corners, corners[1:])]
    dx, dz = min(edges, key=lambda edge: math.hypot(*edge))
    x, z = shape.centroid.coords[0]
    yield LineString([(x-dx, z-dz), (x+dx, z+dz)]).buffer(0.09).intersection(inset)
    if sport in ('basketball', 'soccer'):
        radius = 1.8 if sport == 'basketball' else min(5, math.hypot(dx, dz)/5)
        yield Point(x, z).buffer(radius).boundary.buffer(0.09).intersection(inset)


def courtyard(boundary, site):
    # Public road polygons already carry their grades, curbs, paint and textures.
    from seam_streets import Streets
    streets = Streets(site.surface)
    bounds = translate(boundary, site.x, site.z)
    parts = []
    for origin in site.surface.files:
        ox, oz = origin
        size = site.surface.size
        if not box(ox, oz, ox+size, oz+size).intersects(bounds):
            continue
        tree, _, _ = streets.tile(origin)
        parts.extend(tree.geometries.take(tree.query(bounds, predicate='intersects')))
    street = translate(union_all(parts), -site.x, -site.z)
    return boundary.difference(street.buffer(0.15))


def paint(builder, shape, region, lift, mesh=None):
    # Clip to the GL04 terrain grid, including its NE-SW diagonal. A long
    # triangle across multiple cells can otherwise dip below the game terrain.
    surface = builder.surface
    step = surface.surface.grid
    left, top, right, bottom = shape.bounds
    x0 = step * math.floor((left + surface.x) / step) - surface.x
    z0 = step * math.floor((top + surface.z) / step) - surface.z
    for i in range(math.ceil((right - x0) / step)):
        x = x0 + i * step
        strip = shape.intersection(box(x, top-1, x+step, bottom+1))
        if strip.area == 0:
            continue
        for j in range(math.ceil((bottom - z0) / step)):
            z = z0 + j * step
            a, b, c, d = (x,z), (x+step,z), (x,z+step), (x+step,z+step)
            for corners in ((a,b,c), (c,b,d)):
                cut = strip.intersection(Polygon(corners))
                for face in polygons(cut):
                    for tri in constrained_delaunay_triangles(face).geoms:
                        ring = list(tri.exterior.coords)[:3]
                        if tri.exterior.is_ccw:
                            ring.reverse()
                        vertices = [(u, builder.ground(u, v) + lift, v) for u, v in ring]
                        (mesh or builder.atlas).add_tri(*vertices, region)


def build(builder, module):
    boundary, buildings, sports = layout(module)
    ring = list(boundary.exterior.coords)
    paint(builder, courtyard(boundary, builder.surface), "pave_grey", 0.009, builder.paving)
    for shape, style in buildings:
        if style['source_id'] not in getattr(module, 'CUSTOM_BUILDINGS', ()):
            builder.footprint_building(list(shape.exterior.coords), **style)
    for _, sport, shape in sports:
        region = {'running': 'track_red', 'athletics': 'track_red', 'soccer': 'turf_a'}.get(sport, 'court_a')
        paint(builder, shape, region, 0.075)
        if builder.lod < 2:
            for stripe in markings(shape, sport):
                paint(builder, stripe, 'white', 0.11)

    occupied = union_all([p for p, _ in buildings] + [p for _, _, p in sports])
    for edge in polygons(boundary.buffer(-5)):
        path = edge.exterior
        for distance in range(0, int(path.length), 16):
            point = path.interpolate(distance)
            if occupied.distance(point) > 4:
                builder.tree(point.x, point.y, species='camphor', scale=0.85)
    x, z, degrees = module.FRONTAGE
    # Schools whose detailed, already-live street gate is packed separately keep it instead.
    if not getattr(module, 'LEGACY_GATE', False):
        y = builder.ground(x, z)
        builder.pose = (x, 0, z, math.radians(degrees))
        lintel = getattr(module, "LINTEL_HEIGHT", 4.55)
        for side in (-1, 1):
            builder.box(side*4.5, y-0.15, 0, 1, lintel+0.8, 1.4, 'granite', collide=True)
        builder.box(0, y+lintel, 0, 10, 0.85, 1.45, 'wall_accent', collide=True)
        builder.sign(0, y+lintel+0.43, 0.74, 6.5, 0.7, 'sign_gate', double_sided=True)
        builder.retractable_gate(8, gate_h=2.2, y0=y, iron_grille=True)
        builder.pose = (0, 0, 0, 0)
    if module.SCHOOL == 'guilin_middle':
        # Let the closed street frontage occupy its own bay.
        edge_ring = builder._clean_ring_ccw(ring)
        gate = Point(x, z)
        edges = [LineString([a, b]) for a, b in zip(edge_ring, edge_ring[1:] + edge_ring[:1])]
        index = min(range(len(edges)), key=lambda i: edges[i].distance(gate))
        station = edges[index].project(gate, normalized=True)
        half_span = getattr(module, 'GATE_HALF_SPAN', 5) / edges[index].length
        builder.perimeter_fence(ring, index, max(0, station-half_span), min(1, station+half_span))
    else:
        builder.perimeter_fence(ring, gate_edge=-1, skip_edges=module.SKIP_EDGES)
