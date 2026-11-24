"""Report adjacent fixed road-height anchors that exceed the railway grade budget.

Run after railway_crossings.py against the world to be released. The graph uses
shared OSM nodes across way boundaries, including turnouts, and distinguishes
station/service track from main line. An edge cost is the allowed rise in metres.
"""
import gzip
import io
import struct

from PIL import Image, ImageColor
from landmarks.world_surface import Surface

import heapq
import json
import math
import subprocess
from collections import defaultdict
from pathlib import Path

from common import load_osm, ll2xz
from play_region import PlayRegion
from shapely.geometry import LineString

ROOT = Path(__file__).resolve().parents[1]


def rail_graph(elements, region):
    graph = defaultdict(list)
    for way in elements:
        tags = way.get('tags', {})
        if way['type'] != 'way' or tags.get('railway') != 'rail':
            continue
        grade = .020 if tags.get('service') in ('yard', 'siding', 'spur', 'crossover') else .012
        coords = [ll2xz(p['lat'], p['lon']) for p in way['geometry']]
        if not region.intersects(LineString(coords)):
            continue
        nodes = way['nodes']
        for a, b, start, end in zip(nodes, nodes[1:], coords, coords[1:]):
            length = math.dist(start, end)
            if not region.covers(LineString([start, end])):
                continue
            graph[a].append((b, length, length * grade))
            graph[b].append((a, length, length * grade))
    return graph


def conflicts(graph, heights):
    problems = []
    for start, first_y in heights.items():
        queue = [(0., 0., start)]
        visited = set()
        while queue:
            rise, length, node = heapq.heappop(queue)
            if node in visited:
                continue
            visited.add(node)
            if node != start and node in heights:
                delta = abs(heights[node] - first_y)
                if node > start and delta > rise + 1e-6:
                    problems.append(dict(start=start, end=node, distanceM=round(length, 3),
                                         roadDeltaM=round(delta, 4), permittedRiseM=round(rise, 4),
                                         requiredPermille=round(delta / length * 1000, 2)))
                continue
            for neighbor, distance, budget in graph[node]:
                if neighbor not in visited:
                    heapq.heappush(queue, (rise + budget, length + distance, neighbor))
    return sorted(problems, key=lambda row: -row['requiredPermille'])


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world', type=Path)
    args = parser.parse_args()
    output = subprocess.check_output([ROOT/'node_modules/.bin/tsx', ROOT/'scripts/railway-road-heights.mjs',
                                      args.world, ROOT/'docs/railway-crossings.json'])
    samples = json.loads(output)
    world = Surface(args.world)
    rows = json.loads((ROOT/'docs/railway-crossings.json').read_bytes())
    road_color = ImageColor.getrgb(json.loads((ROOT/'pipeline/palette.json').read_bytes())['road'])
    heights = {}
    sources = {}
    for row in rows:
        node = row['sharedNode']
        if node is None or node in sources:
            continue
        surface = samples[str(node)]
        if surface['road'] is not None:
            heights[node] = surface['road']
            sources[node] = 'road'
        elif surface['deck'] is not None:
            heights[node] = surface['deck']
            sources[node] = 'deck'
        else:
            # Minor roads may be baked into the terrain texture only.
            x, z = ll2xz(row['lat'], row['lon'])
            origin = math.floor(x / world.size)*world.size, math.floor(z / world.size)*world.size
            raw = gzip.decompress((args.world/world.files[origin]).read_bytes())
            _, v, i, c, image_size, _ = struct.unpack_from('<4s5I', raw)
            start = 24 + 16900 + 9*v + 4*i + c
            with Image.open(io.BytesIO(raw[start:start+image_size])) as image:
                pixel = image.convert('RGB').getpixel((int(x-origin[0]), int(z-origin[1])))
            if pixel == road_color:
                heights[node] = world.sample(x, z, include_peaks=False)[0]
                sources[node] = 'terrainRoadTexture'
            else:
                sources[node] = 'missing'
    problems = conflicts(rail_graph(load_osm(), PlayRegion().geometry), heights)
    print(json.dumps(dict(carriagewayY=heights, source=sources, gradeConflicts=problems),
                     ensure_ascii=False, indent=2))
