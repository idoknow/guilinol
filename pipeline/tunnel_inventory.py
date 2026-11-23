"""Enumerate public motor-road tunnels intersecting a playable bbox by OSM way."""
import argparse
import json
from collections import defaultdict
from pathlib import Path

from shapely.geometry import LineString, box

from common import ll2xz


def motor(tags):
    kind = tags.get('highway', '').removesuffix('_link')
    access = next((tags[key] for key in ('motorcar', 'motor_vehicle', 'vehicle', 'access') if key in tags), '')
    return kind in {'motorway','trunk','primary','secondary','tertiary','unclassified','residential',
                    'living_street','service','road','track'} and access not in {'no','private'}


def inventory(elements, bbox):
    south, west, north, east = bbox
    playable = box(west,south,east,north)
    ways = [way for way in elements if way['type']=='way' and motor(way.get('tags', {}))]
    surface = defaultdict(set)
    for way in ways:
        if way['tags'].get('tunnel','no')=='no':
            for node in way['nodes']:
                surface[node].add(way['id'])
    for way in sorted(ways,key=lambda item:item['id']):
        if way['tags'].get('tunnel')!='yes':
            continue
        points = [(point['lon'],point['lat']) for point in way['geometry']]
        if not playable.intersects(LineString(points)):
            continue
        length = LineString([ll2xz(lat,lon) for lon,lat in points]).length
        yield way['id'],way['tags'].get('name','—'),length,[sorted(surface[node]) for node in (way['nodes'][0],way['nodes'][-1])]


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('osm',type=Path)
    parser.add_argument('manifest',type=Path)
    args = parser.parse_args()
    print('| way | name | full way, m | connected surface ways (start / end) |')
    print('|---:|---|---:|---|')
    for ident,name,length,ends in inventory(json.loads(args.osm.read_bytes())['elements'],json.loads(args.manifest.read_bytes())['bbox']):
        connections = ' / '.join(', '.join(map(str,refs)) or 'not found' for refs in ends)
        print(f'| {ident} | {name} | {length:.1f} | {connections} |')
