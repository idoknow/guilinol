import gzip
import json
import math
import random
from collections import Counter, defaultdict

from shapely import Point, STRtree

from common import ll2xz


def allowed(tags, side, cls):
    if cls in ('trunk', 'primary') or tags.get('bridge', 'no') != 'no' or tags.get('tunnel', 'no') != 'no':
        return False
    if tags.get('divider', 'no') not in ('no', 'none', 'line') or tags.get('junction') == 'roundabout':
        return False
    values = [value for key, value in tags.items() if key.startswith('parking:') and
              not ({'left', 'right'} - {side}).intersection(key.split(':'))]
    return not {'no', 'no_stopping', 'no_parking'}.intersection(values) and (
        cls in ('tertiary', 'residential', 'unclassified', 'service') or
        bool({'parallel', 'diagonal'}.intersection(values)))


def bake_parking(output, segments, elements, nodes, forbidden):
    arms = defaultdict(set)
    for start, end, *_ in segments:
        arms[start].add(end)
        arms[end].add(start)
    keepouts = [Point(nodes[ref]['x'], nodes[ref]['z']) for ref in arms if len(arms[ref]) >= 3]
    for element in elements:
        tags = element.get('tags', {})
        if element['type'] == 'node' and (tags.get('highway') in ('crossing', 'bus_stop', 'traffic_signals') or
                                         tags.get('public_transport') in ('platform', 'stop_position')):
            keepouts.append(Point(*ll2xz(element['lat'], element['lon'])))
    junctions = STRtree(keepouts)
    pickups = json.loads(gzip.decompress((output/'vehicles.bin').read_bytes())).get('cars', [])
    legacy = STRtree([Point(east, south) for east, _, south, *_ in pickups])
    cells = defaultdict(list)
    counts = Counter()
    eligible = Counter()
    for start, end, way, tags, cls, sign, offset, extent in segments:
        if not allowed(tags, 'right' if sign > 0 else 'left', cls) or extent-offset < 1.95:
            continue
        head, tail = nodes[start], nodes[end]
        east, south = tail['x']-head['x'], tail['z']-head['z']
        length = math.hypot(east, south)
        rng = random.Random(f'{way}/{start}/{end}')
        distance = 3.5 + rng.random()*.75
        while distance < length-3.5:
            along = distance/length
            distance += rng.uniform(6, 7.5)
            occupied = rng.random() < (.41 if cls == 'tertiary' else .59)
            lateral = extent-.95
            x = head['x']+east*along-south/length*lateral
            z = head['z']+south*along+east/length*lateral
            x, z = round(x, 1), round(z, 1)
            point = Point(x, z)
            if (forbidden.intersects(point.buffer(2.6)) or junctions.query(point, predicate='dwithin', distance=18).size or
                    legacy.query(point, predicate='dwithin', distance=8.0).size):
                continue
            eligible[cls] += 1
            if not occupied:
                continue
            y = head['y']+(tail['y']-head['y'])*along
            key = f'{math.floor(x/256)}_{math.floor(z/256)}'
            cells[key].append([round(x, 1), round(y, 1), round(z, 1), round(math.atan2(east, south), 3), rng.randrange(65536), cls])
            counts[cls] += 1
    dest = output/'roads'/'parking'
    dest.mkdir(parents=True, exist_ok=True)
    for key, rows in cells.items():
        (dest/f'{key}.json.gz').write_bytes(gzip.compress(json.dumps(rows, separators=(',', ':')).encode(), mtime=0))
    (dest/'index.json').write_text(json.dumps({key:len(rows) for key,rows in sorted(cells.items())}, separators=(',', ':')))
    print('G2 parking:', dict(counts), 'eligible:', dict(eligible), 'cells:', len(cells))
