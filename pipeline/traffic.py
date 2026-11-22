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


def signal_schedule(lanes, nodes):
    headings = []
    for lane in lanes:
        src, dst = nodes[lane['from']], nodes[lane['to']]
        angle = math.atan2(dst['z']-src['z'], dst['x']-src['x']) % math.pi
        headings.append((angle, lane['id']))
    headings.sort()
    def partition(first):
        wrapped = headings[first:] + [(angle+math.pi, ref) for angle, ref in headings[:first]]
        families = []
        for angle, ref in wrapped:
            if not families or angle-start >= math.pi/4-1e-10:
                families.append([])
                start = angle
            families[-1].append(ref)
        return families
    families = min((partition(first) for first in range(len(headings))), key=len)
    return [dict(lanes=sorted(family),green=18,yellow=3) for family in families]


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
        bridge_motor = way['id'] in SPAN_WAYS and kind in MOTOR
        fallback = 3 if bridge_motor else 1 if single or kind in WALK else 2
        count = max(1, min(12, int(number(tags.get('lanes'), fallback))))
        size = min(4, max(2, number(tags.get('width'), count*(3.7 if bridge_motor else 3))/count))
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
                    lane['cls'] = kind
                    lanes.append(lane)
                    incoming[tail].append(lane)

    signals = []
    remaining = {element['id'] for element in elements if element['type']=='node'
                 and element.get('tags',{}).get('highway')=='traffic_signals' and element['id'] in incoming}
    while remaining:
        group = [min(remaining)]
        remaining.remove(group[0])
        for ref in group:
            nearby = sorted(other for other in remaining if
                            math.hypot(nodes[ref]['x']-nodes[other]['x'],nodes[ref]['z']-nodes[other]['z'])<=45)
            remaining.difference_update(nearby)
            group.extend(nearby)
        schedule = signal_schedule((lane for ref in group for lane in incoming[ref]), nodes)
        signals.extend(dict(node=ref,group=group[0],offset=group[0]%31,phases=schedule) for ref in group)
    result = dict(nodes=[node for node in nodes.values() if node['y'] is not None],lanes=lanes,signals=signals,quiet=quiet,walks=walks)
    dest = output/'roads'/'graph.json.gz'
    dest.parent.mkdir(exist_ok=True)
    dest.write_bytes(gzip.compress(json.dumps(result, ensure_ascii=False, separators=(',',':')).encode(),mtime=0))
    # A halo contains all spawn and retention candidates until the next cell loads.
    cells = defaultdict(lambda: dict(lanes=[],walks=[],refs=set()))
    for collection in ('lanes','walks'):
        for index, item in enumerate(result[collection]):
            refs = (item['from'],item['to']) if collection=='lanes' else item[:2]
            center = [(nodes[refs[0]][axis]+nodes[refs[1]][axis])/2 for axis in ('x','z')]
            for col in range(math.floor((center[0]-260)/512),math.floor((center[0]+260)/512)+1):
                for row in range(math.floor((center[1]-260)/512),math.floor((center[1]+260)/512)+1):
                    cell=cells[col,row]
                    cell[collection].append(item if collection=='lanes' else [*item,index]);cell['refs'].update(refs)
    for (col,row),cell in cells.items():
        refs=cell.pop('refs');cell['nodes']=[nodes[ref] for ref in sorted(refs)]
        cell['signals']=[signal for signal in signals if signal['node'] in refs]
        (dest.parent/f'{col}_{row}.json.gz').write_bytes(gzip.compress(json.dumps(cell,separators=(',',':')).encode(),mtime=0))
    (dest.parent/'cells.json').write_text(json.dumps([f'{col}_{row}' for col,row in sorted(cells)]))
    print('Traffic:', {key:len(value) for key,value in result.items()}, dest.stat().st_size, 'bytes')


if __name__ == '__main__':
    path = Path(OUT)
    bake(path,json.loads((path/'manifest.json').read_text()))
