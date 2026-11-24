import json
from pathlib import Path

from shapely import STRtree, union_all
from shapely.geometry import LineString, box

from common import X0, Z0, X1, Z1, load_osm
from dongxi_streets import street_surface
from features import area, points, polygons, raw_overture_footprints
from road_profile import pair_carriageways, profile


def export():
    facades = STRtree(raw_overture_footprints(box(X0, Z0, X1, Z1)))
    zones = []
    elements = load_osm()
    by_way = {element['id']: element for element in elements if element['type'] == 'way'}
    def section(way):
        element = by_way[way]
        return profile(LineString(points(element)), element['tags'], facades, way)

    entrance = section(221821082)
    mouth = entrance.line.boundary.geoms[0]
    carriageways = list(pair_carriageways([section(259020569), section(258909993)]))
    patch = mouth.buffer(entrance.width * 1.5, cap_style='square')
    lanes = [road.pavement.intersection(patch) for road in carriageways]
    for element in elements:
        tags = element.get('tags', {})
        if tags.get('name') not in ('正阳步行街', '东西巷') or element['type'] == 'node':
            continue
        shape = area(element)
        if shape.is_empty and tags.get('highway') == 'pedestrian':
            road = profile(LineString(points(element)), tags, facades, element['id'])
            shape = street_surface(road.aligned_section())
            if element['id'] == entrance.way:
                remainder = shape.difference(union_all(lanes).convex_hull)
                shape, = (part for part in polygons(remainder) if part.covers(entrance.line.interpolate(.5, normalized=True)))
        for polygon in polygons(shape):
            zones.append(dict(osm=f"{element['type']}/{element['id']}", name=tags['name'],
                              bbox=polygon.bounds, rings=[list(ring.coords) for ring in
                                                          [polygon.exterior, *polygon.interiors]]))
    if {zone['name'] for zone in zones} != {'正阳步行街', '东西巷'}:
        raise ValueError('Missing pedestrian district geometry')
    output = Path(__file__).resolve().parents[1] / 'web/src/game/car-free-polygons.json'
    output.write_text(json.dumps(zones, ensure_ascii=False, separators=(',', ':')) + '\n')
    output.with_name('jiefang-junction.json').write_text(json.dumps([
        dict(osm=f'way/{road.way}', bbox=lane.bounds, ring=list(lane.exterior.coords))
        for road, lane in zip(carriageways, lanes)
    ], separators=(',', ':')) + '\n')


if __name__ == '__main__':
    export()
