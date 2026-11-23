"""Generate the QA route from a parked car on Jinji Road to Huajiang's main gate."""
import gzip
import heapq
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'pipeline'))
from common import ll2xz


def path(world, osm):
    elements = json.loads(osm.read_bytes())['elements']
    ways = {item['id']: item for item in elements if item['type'] == 'way'}
    gate = 3925007976
    vehicles = json.loads(gzip.decompress((world/'vehicles.bin').read_bytes()))
    near = ll2xz(25.284, 110.330)
    car = min(vehicles['cars'], key=lambda row: math.dist((row[0],row[2]), near))
    graph, points = defaultdict(list), {}
    types = {'primary','secondary','tertiary','unclassified','residential','service','living_street'}
    for way in ways.values():
        tags = way.get('tags', {})
        if tags.get('highway') not in types or tags.get('motor_vehicle') == 'no':
            continue
        for node, pos in zip(way['nodes'], way['geometry']):
            points[node] = ll2xz(pos['lat'],pos['lon'])
        for first, second in zip(way['nodes'],way['nodes'][1:]):
            length = math.dist(points[first],points[second])
            if tags.get('oneway') != '-1':
                graph[first].append((second,length))
            if tags.get('oneway') not in ('yes','1','true'):
                graph[second].append((first,length))
    origin = car[0],car[2]
    start = min(ways[258894706]['nodes'],key=lambda node: math.dist(points[node],origin))
    distance, parent, queue = {start:0}, {}, [(0,start)]
    while queue:
        length, node = heapq.heappop(queue)
        if node == gate:
            break
        if length != distance[node]:
            continue
        for other, cost in graph[node]:
            if length+cost < distance.get(other,math.inf):
                distance[other],parent[other] = length+cost,node
                heapq.heappush(queue,(length+cost,other))
    nodes = [gate]
    while nodes[-1] != start:
        nodes.append(parent[nodes[-1]])
    return dict(car=origin, waypoints=[points[node] for node in reversed(nodes)])


if __name__ == '__main__':
    print(json.dumps(path(Path('dist/world'),Path('raw/osm-2026-11.json'))))
