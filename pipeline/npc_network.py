import argparse
import gzip
import json
from pathlib import Path

from common import load_osm
from npc_sidewalks import audit


def annotate(graph, elements, report):
    ways = {tuple(sorted(pair)): way['tags'] for way in elements if way['type'] == 'way'
            and 'highway' in way.get('tags', {}) for pair in zip(way['nodes'], way['nodes'][1:])}
    way_tags = {way['id']: way['tags'] for way in elements if way['type'] == 'way'
                and 'highway' in way.get('tags', {})}
    parents = {}

    def root(key):
        while parents.setdefault(key, key) != key:
            parents[key] = parents[parents[key]]
            key = parents[key]
        return key

    lanes = graph['lanes']
    for lane in lanes:
        pair = lane['from'], lane['to']
        # Surveyed lanes can introduce vertices between the original OSM nodes.
        tags = way_tags.get(lane.get('way'), ways.get(tuple(sorted(pair)), {}))
        name = tags.get('name')
        lane['street'] = name or ''
        if not name:
            first, second = sorted(root((lane['cls'], node)) for node in pair)
            parents[second] = first
    for lane in lanes:
        if not lane['street']:
            kind, node = root((lane['cls'], lane['from']))
            lane['street'] = f'@{kind}:{node}'
    by_id = {lane['id']: lane for lane in lanes}
    for row in report:
        lane = by_id[row['lane']]
        lane['sidewalkFace'] = row['tileSidewalk']
        lane['npcWalks'] = [[round(value, 4) for point in (coords[0], coords[-1]) for value in point]
                            for coords in row['tracks']]
    return by_id


def save(path, data):
    path.write_bytes(gzip.compress(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0))


def install(world, report):
    roads = world/'roads'
    graph_file = roads/'graph.json.gz'
    graph = json.loads(gzip.decompress(graph_file.read_bytes()))
    enriched = annotate(graph, load_osm(), report)
    save(graph_file, graph)
    for cell in json.loads((roads/'cells.json').read_bytes()):
        path = roads/f'{cell}.json.gz'
        data = json.loads(gzip.decompress(path.read_bytes()))
        for lane in data['lanes']:
            annotated=enriched[lane['id']]
            for field in ('street','sidewalkFace','npcWalks'):
                if field in annotated:
                    lane[field]=annotated[field]
        save(path, data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('world', type=Path)
    options = parser.parse_args()
    install(options.world, audit(options.world))
