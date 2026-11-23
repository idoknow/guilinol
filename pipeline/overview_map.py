"""Compile the regional OSM map independently of the playable tile extent."""
import argparse
import gzip
import json
from pathlib import Path

from shapely.geometry import LineString, box

from atlas import flat, rings
from common import ll2xz
from features import area, points, polygons

BBOX = (25.09, 110.00, 25.39, 110.41)
SNAPSHOT = Path(__file__).with_name('overview-map.gz')


def compile_map(elements, ring_ids):
    south, west, north, east = BBOX
    bounds = box(*ll2xz(north, west), *ll2xz(south, east))
    paths, labels, errors = [], [], []
    for element in elements:
        tags = element.get('tags', {})
        name = tags.get('name:zh', tags.get('name', ''))
        road = tags.get('highway', '').removesuffix('_link')
        if element['type'] == 'node':
            center = list(map(round, ll2xz(element['lat'], element['lon'])))
            place = tags.get('place')
            if tags.get('natural') == 'peak':
                labels.append(['peak', name, *center])
            elif name and (place in ('city','county','district','borough','town','suburb','quarter','township') or tags.get('tourism') in ('attraction','viewpoint','museum') or 'historic' in tags):
                labels.append(['district' if place in ('city','county','district') or name.endswith(('区','县')) else 'place', name, *center])
        elif element['type'] == 'way' and road in ('motorway','trunk','primary','secondary'):
            clipped = LineString(points(element)).intersection(bounds)
            layer = 'ring' if element['id'] in ring_ids or 'S2201' in tags.get('ref','').split(';') else road
            for line in getattr(clipped, 'geoms', [clipped]):
                if line.is_empty or line.geom_type != 'LineString': continue
                coords = flat(line.simplify(3 if layer == 'ring' else 8))
                if len(coords) < 4: continue
                paths.append([layer, [coords]])
                if layer == 'ring':
                    errors.append(line.hausdorff_distance(LineString(zip(coords[::2],coords[1::2]))))
        elif tags.get('natural') == 'water' or 'water' in tags or tags.get('waterway') == 'riverbank':
            for poly in polygons(area(element).intersection(bounds)):
                if poly.area < 1800: continue
                outline = rings(poly.simplify(6))
                if outline: paths.append(['lake' if poly.area >= 60000 else 'pond', outline])
    if not errors or max(errors) > 20: raise ValueError('Missing or inaccurate ring geometry')
    print(f'{len(errors)} ring parts, maximum OSM deviation {max(errors):.2f} m')
    return gzip.compress(json.dumps(dict(version=1,paths=paths,labels=labels), separators=(',',':'), ensure_ascii=False).encode(), mtime=0)


def write_overview_map(output, bbox):
    data = SNAPSHOT.read_bytes()
    if len(data) > 400 * 1024: raise ValueError('Regional map exceeds transfer budget')
    (Path(output) / 'overview.bin').write_bytes(data)
    south, west, north, east = bbox
    left, top = ll2xz(north, west)
    right, bottom = ll2xz(south, east)
    def nearby(xmin, ymin, xmax, ymax):
        return xmax >= left-1600 and ymax >= top-1600 and xmin <= right+1600 and ymin <= bottom+1600
    def keep(path):
        coords = path[1][0]
        return nearby(min(coords[::2]), min(coords[1::2]), max(coords[::2]), max(coords[1::2]))
    edge = json.loads(gzip.decompress(data))
    edge['paths'] = list(filter(keep, edge['paths']))
    edge['labels'] = [row for row in edge['labels'] if nearby(*row[2:], *row[2:])]
    (Path(output) / 'overview-edge.bin').write_bytes(gzip.compress(json.dumps(edge,separators=(',',':')).encode(),mtime=0))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('osm', type=Path)
    parser.add_argument('ring_ids', type=Path)
    args = parser.parse_args()
    SNAPSHOT.write_bytes(compile_map(json.loads(args.osm.read_bytes())['elements'], set(json.loads(args.ring_ids.read_bytes()))))
