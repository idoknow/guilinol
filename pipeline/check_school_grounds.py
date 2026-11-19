"""Check G1 campus footprint coverage in the actual world building pipeline."""
import json
import math
from pathlib import Path

from shapely import STRtree
from shapely.geometry import Point, box
from shapely.ops import unary_union

from common import X0, X1, Z0, Z1, ll2xz, load_osm
from features import area, buildings, ground_features, polygons
from landmark_layout import Layout


def main():
    root = Path(__file__).resolve().parent
    layout = Layout()
    bounds = box(X0,Z0,X1,Z1)
    footprints,_ = buildings(bounds,lambda east,south: 0,STRtree([]),layout)
    tree = STRtree(footprints)
    elements = {f"{item['type']}/{item['id']}":item for item in load_osm()}
    sports = ground_features(bounds,layout.school_grounds)
    entries = {entry['id']:entry for entry in json.loads((root/'landmarks.json').read_text())}
    for identifier in ('guilin_middle','kuiguang_school'):
        entry = entries[identifier]
        assert entry['schoolGround'] and not any(entry.get(key) for key in ('replace','replacePolygons','allowUnmappedCourt'))
    for school in json.loads((root/'schools-g1.json').read_text()):
        if school['heritage']:
            continue
        campus = area(elements[school['osm']])
        entry = entries[school['id']]
        east,south = ll2xz(*entry['anchor'][::-1])
        angle = math.radians(entry['rotation'])
        forward = (math.sin(angle),math.cos(angle))
        gate = Point(east+17*school['scale']*forward[0],south+17*school['scale']*forward[1])
        if 'wallStreet' in school:
            assert school['wallStreet'] == elements[school['osm']]['tags'].get('addr:street','')
            assert not entry.get('replace') and not entry.get('allowUnmappedCourt') and not school['blocks']
            if school['wallStreet']:
                assert gate.distance(campus.boundary)<.05
        mapped = [shape for element in elements.values() if element['type']!='node'
                  and element.get('tags',{}).get('building') for shape in polygons(area(element))
                  if campus.covers(shape.representative_point())]
        missing = 0
        for shape in mapped:
            matches = [footprints[index] for index in tree.query(shape,predicate='intersects')]
            if unary_union(matches).intersection(shape).area < .45*shape.area:
                missing += 1
        generated = sum(campus.covers(footprints[index].representative_point()) for index in tree.query(campus))
        fields = sum(campus.covers(shape.representative_point()) for key in ('schoolTrack','schoolCourt') for shape in sports[key])
        print(f"{school['id']}: mapped={len(mapped)}, generated={generated}, missing={missing}, fields={fields}")
        if missing:
            raise ValueError(f"Incomplete footprint coverage: {school['id']}")


if __name__ == '__main__':
    main()
