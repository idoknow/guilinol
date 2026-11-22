import json
from pathlib import Path

from shapely import STRtree
from shapely.geometry import LineString, box

from common import X0, Z0, X1, Z1, load_osm
from dongxi_streets import street_surface
from features import area, points, polygons, raw_overture_footprints
from road_profile import profile


def export():
    facades = STRtree(raw_overture_footprints(box(X0, Z0, X1, Z1)))
    zones = []
    for element in load_osm():
        tags = element.get('tags', {})
        if tags.get('name') not in ('正阳步行街', '东西巷') or element['type'] == 'node':
            continue
        shape = area(element)
        if shape.is_empty and tags.get('highway') == 'pedestrian':
            road = profile(LineString(points(element)), tags, facades, element['id'])
            shape = street_surface(road.aligned_section())
        for polygon in polygons(shape):
            zones.append(dict(osm=f"{element['type']}/{element['id']}", name=tags['name'],
                              bbox=polygon.bounds, rings=[list(ring.coords) for ring in
                                                          [polygon.exterior, *polygon.interiors]]))
    if {zone['name'] for zone in zones} != {'正阳步行街', '东西巷'}:
        raise ValueError('Missing pedestrian district geometry')
    output = Path(__file__).resolve().parents[1] / 'web/src/game/car-free-polygons.json'
    output.write_text(json.dumps(zones, ensure_ascii=False, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    export()
