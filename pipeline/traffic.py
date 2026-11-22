import gzip
import json
import math
import re
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
from shapely.prepared import prep

from common import OUT, ll2xz, load_osm
from landmarks.jiefang_layout import SPAN_WAYS, deck_level

ROOT = Path(__file__).resolve().parents[1]
MOTOR = {'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified', 'service', 'busway'}
WALK = {'footway', 'pedestrian', 'path'}


def number(value, fallback):
    match = re.fullmatch(r'(\d+(?:\.\d+)?)(?:\s*(mph|km/h))?', str(value))
    return float(match[1]) * (1.609344 if match[2] == 'mph' else 1) if match else fallback


def bake(output, manifest):
    left, top, width, depth = manifest['extent']
    chunks = {(tile['x'], tile['z']): tile['file'] for tile in manifest['chunks']}
    bridge = next((entry for entry in manifest['landmarks'] if entry['id'] == 'jiefang_bridge'), None)

    @lru_cache(maxsize=96)
    def terrain(key):
        data = gzip.decompress((output / chunks[key]).read_bytes())
        return np.frombuffer(data, '<i2', 65*65, 24).reshape(65, 65)

    def height(x, z, way):
        if bridge and way in SPAN_WAYS:
            bx, by, bz = bridge['position']
            angle = math.radians(-bridge['rotation'])
            return round(by + float(deck_level((x-bx)*math.cos(angle)+(z-bz)*math.sin(angle))), 2)
        key = (math.floor(x/256)*256, math.floor(z/256)*256)
        if key not in chunks:
            return None
        return float(terrain(key)[round((z-key[1])/4), round((x-key[0])/4)]) / 10

    registry = (ROOT/'web/src/game/quiet-zones.ts').read_text().split('QuietZonePolygon[] = ', 1)[1].split(' as const', 1)[0]
    quiet = json.loads(registry)
    banned = [Polygon(zone['polygon']).buffer(5) for zone in quiet]
    for zone in json.loads((ROOT/'web/src/game/car-free-polygons.json').read_text()):
        shell, *holes = zone['rings']
        banned.append(Polygon(shell, holes))
    forbidden = prep(unary_union(banned))
    nodes, lanes, walks, incoming = {}, [], [], defaultdict(list)
    elements = load_osm()
    for way in elements:
        tags = way.get('tags', {})
        kind = tags.get('highway', '').removesuffix('_link')
        if way['type'] != 'way' or kind not in MOTOR | WALK | {'cycleway'} or tags.get('area') == 'yes' or tags.get('access') in ('no', 'private'):
            continue
        refs = way['nodes']
        coords = [ll2xz(pt['lat'], pt['lon']) if pt else None for pt in way['geometry']]
        direction = tags.get('oneway', 'yes' if tags.get('junction') == 'roundabout' else 'no')
        single = direction in ('yes', '1', 'true', '-1')
        count = max(1, min(12, int(number(tags.get('lanes'), 1 if single or kind in WALK else 2))))
        size = min(4, max(2, number(tags.get('width'), count*3)/count))
        for idx, (start, end) in enumerate(zip(coords, coords[1:])):
            if not start or not end or not all(left <= x < left+width and top <= z < top+depth for x,z in (start,end)):
                continue
            length = math.dist(start,end)
            if length < .5:
                continue
            start_id, end_id = refs[idx:idx+2]
            for ref, (x,z) in zip((start_id,end_id),(start,end)):
                if ref not in nodes:
                    nodes[ref] = dict(id=ref,x=round(x,2),z=round(z,2),y=height(x,z,way['id']))
            if any(nodes[ref]['y'] is None for ref in (start_id,end_id)):
                continue
            if kind in WALK:
                walks.append([start_id,end_id,0])
                continue
            if kind in MOTOR and tags.get('sidewalk') in ('left','right','both'):
                for side in (-1,1):
                    if tags['sidewalk'] in ('both','left' if side<0 else 'right'):
                        walks.append([start_id,end_id,side*(count*size/2+1)])
            if tags.get('motor_vehicle') in ('private','no') and kind != 'cycleway':
                continue
            if forbidden.intersects(LineString([start,end]).buffer(count*size/2+2)):
                continue
            for sign in ([-1] if direction=='-1' else [1] if single else [1,-1]):
                head, tail = (start_id,end_id) if sign==1 else (end_id,start_id)
                n = count if single else max(1, count//2 if sign==-1 else (count+1)//2)
                for slot in range(n):
                    offset = (slot+.5-(count/2 if single else 0))*size if count>1 else 0
                    lane = dict(id=len(lanes), to=tail, width=size, offset=round(offset,2), kind='nonmotor' if kind=='cycleway' else 'bus' if kind=='busway' else 'motor',speedKmh=number(tags.get('maxspeed'),20 if kind in ('cycleway','service') else 40),oneway=single)
                    lane['from'] = head
                    lanes.append(lane)
                    incoming[tail].append(lane)

    signals = []
    for element in elements:
        ref = element['id']
        if element['type'] != 'node' or element.get('tags',{}).get('highway') != 'traffic_signals' or ref not in incoming:
            continue
        phases = defaultdict(list)
        for lane in incoming[ref]:
            src, dst = nodes[lane['from']], nodes[ref]
            phases[abs(dst['x']-src['x']) > abs(dst['z']-src['z'])].append(lane['id'])
        signals.append(dict(node=ref,phases=[dict(lanes=ids,green=18,yellow=3) for ids in phases.values()] + ([dict(lanes=[],green=18,yellow=3)] if len(phases)==1 else [])))
    result = dict(nodes=[node for node in nodes.values() if node['y'] is not None],lanes=lanes,signals=signals,quiet=quiet,walks=walks)
    dest = output/'roads'/'graph.json.gz'
    dest.parent.mkdir(exist_ok=True)
    dest.write_bytes(gzip.compress(json.dumps(result, ensure_ascii=False, separators=(',',':')).encode(),mtime=0))
    print('Traffic:', {key:len(value) for key,value in result.items()}, dest.stat().st_size, 'bytes')


if __name__ == '__main__':
    path = Path(OUT)
    bake(path,json.loads((path/'manifest.json').read_text()))
