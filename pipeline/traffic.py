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
from traffic_parking import allowed, bake_parking
from landmarks.jiefang_layout import SPAN_WAYS, deck_level
from landmarks.world_surface import Surface

ROOT = Path(__file__).resolve().parents[1]
MOTOR = {'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified', 'service', 'busway'}
WALK = {'footway', 'pedestrian', 'path'}
RENDERED_LANE_WAYS = {674460013}  # Longyin Road: OSM has no lane count; GL04 has a painted section.


def number(value, fallback):
    match = re.fullmatch(r'(\d+(?:\.\d+)?)(?:\s*(mph|km/h))?', str(value))
    return float(match[1]) * (1.609344 if match[2] == 'mph' else 1) if match else fallback


def simplify_profile(samples):
    keep = {0,len(samples)-1}
    pending = [(0,len(samples)-1)]
    while pending:
        first,last = pending.pop()
        start,low = samples[first]
        stop,high = samples[last]
        worst,split = .025,None
        for index in range(first+1,last):
            fraction,level = samples[index]
            error = abs(level-(low+(high-low)*(fraction-start)/(stop-start)))
            if error>worst:
                worst,split = error,index
        if split is not None:
            keep.add(split)
            pending.extend(((first,split),(split,last)))
    return [value for index in sorted(keep) for value in samples[index]]


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


def bake(output, manifest, rendered_roads=None):
    left, top, width, depth = manifest['extent']
    if rendered_roads is None:
        from features import raw_overture_footprints
        from scatter import extract_road_network
        from shapely.geometry import box
        bounds = box(left, top, left+width, top+depth)
        rendered_roads = extract_road_network(raw_overture_footprints(bounds))[1]
    region = prep(Polygon(manifest['region']['local'])) if 'region' in manifest else None
    carriageways = {road.way: road for road in rendered_roads if road.way in RENDERED_LANE_WAYS}
    surface = Surface(output, manifest)
    from station_levels import UNDERPASS
    station_tunnel = next((t for t in manifest.get('tunnels', []) if t['way']==UNDERPASS), None)
    bridge = next((entry for entry in manifest['landmarks'] if entry['id'] == 'jiefang_bridge'), None)

    @lru_cache(maxsize=96)
    def original_grid(key):
        data = gzip.decompress((output/surface.files[key]).read_bytes())
        return np.frombuffer(data, '<i2', 65*65, 24).reshape(65,65)

    def node_height(x,z,way):
        if way in SPAN_WAYS:
            return height(x,z,way)
        key = (math.floor(x/256)*256,math.floor(z/256)*256)
        return float(original_grid(key)[round((z-key[1])/4),round((x-key[0])/4)])/10

    def height(x, z, way):
        if bridge and way in SPAN_WAYS:
            bx, by, bz = bridge['position']
            angle = math.radians(-bridge['rotation'])
            return round(by + float(deck_level((x-bx)*math.cos(angle)+(z-bz)*math.sin(angle))), 2)
        return surface.sample(max(left,min(left+width,x)), max(top,min(top+depth,z)), include_peaks=False)[0]

    def profile(head, tail, offset, way):
        start, end = nodes[head], nodes[tail]
        east, south = end['x']-start['x'], end['z']-start['z']
        length = math.hypot(east, south)
        x = start['x']-south/length*offset
        z = start['z']+east/length*offset
        fractions = {0.,1.}
        for origin, delta, axis in ((x,east,True),(z,south,True),(x+z,east+south,False)):
            lo, hi = sorted((origin,origin+delta))
            for line in range(math.floor(lo/4)+1,math.ceil(hi/4)):
                fraction = round((4*line-origin)/delta,10)
                fractions.add(fraction)
                if axis and line%64==0:
                    fractions.update((max(0,round(fraction-1e-9,10)),min(1,round(fraction+1e-9,10))))
        samples = []
        for fraction in sorted(fractions):
            y = round(height(x+east*fraction,z+south*fraction,way),2)
            samples.append((fraction,y))
        return simplify_profile(samples)

    def add_walk(head, tail, offset, way, linear):
        walk = [head,tail,offset,len(walks)]
        if not linear:
            walk.append(profile(head,tail,offset,way))
        walks.append(walk)

    registry = (ROOT/'web/src/game/quiet-zones.ts').read_text().split('QuietZonePolygon[] = ', 1)[1].split(' as const', 1)[0]
    quiet = json.loads(registry)
    banned = [Polygon(zone['polygon']).buffer(5) for zone in quiet]
    for zone in json.loads((ROOT/'web/src/game/car-free-polygons.json').read_text()):
        shell, *holes = zone['rings']
        banned.append(Polygon(shell, holes))
    forbidden = prep(unary_union(banned))
    nodes, lanes, walks, incoming = {}, [], [], defaultdict(list)
    elements = load_osm()
    parking_segments = []
    sections = {road['way']:road['width'] for road in json.loads((output/'street-report.json').read_text())}
    for way in elements:
        tags = way.get('tags', {})
        linear = way['id'] not in SPAN_WAYS and any(tags.get(key,'no')!='no' for key in ('bridge','tunnel'))
        kind = tags.get('highway', '').removesuffix('_link')
        if way['type'] != 'way' or kind not in MOTOR | WALK | {'cycleway'} or tags.get('area') == 'yes' or tags.get('access') in ('no', 'private'):
            continue
        refs = way['nodes']
        coords = [ll2xz(pt['lat'], pt['lon']) if pt else None for pt in way['geometry']]
        direction = tags.get('oneway', 'yes' if tags.get('junction') == 'roundabout' else 'no')
        single = direction in ('yes', '1', 'true', '-1')
        bridge_motor = way['id'] in SPAN_WAYS and kind in MOTOR
        fallback = 3 if bridge_motor else 1 if single or kind in WALK or kind == 'residential' else 2
        count = max(1, min(12, int(number(tags.get('lanes'), fallback))))
        size = min(4, max(2, number(tags.get('width'), count*(3.7 if bridge_motor else 3))/count))
        paved = sections.get(way['id'], number(tags.get('width'), {'tertiary':10,'residential':6}.get(kind, 3)))
        section = carriageways.get(way['id'])
        if single and section and 'lanes' not in tags and not bridge_motor:
            count, paved = section.lanes, section.width
            size = paved/count
        if kind == 'residential' and 'lanes' not in tags:
            paved = number(tags.get('width'), 6.5)
        curb = 0
        curb_sign = -1 if direction == '-1' else 1
        if (kind == 'residential' and 1 <= count <= 2 and paved >= 3*count+2.1 and
                allowed(tags, 'right' if curb_sign > 0 else 'left', kind)):
            curb = min(2.4, paved-3*count)
            size = (paved-curb)/count
        for idx, (start, end) in enumerate(zip(coords, coords[1:])):
            if not start or not end or not all(left <= x < left+width and top <= z < top+depth for x,z in (start,end)):
                continue
            if region and not region.covers(LineString([start,end]).buffer(count*size/2+2)):
                continue
            length = math.dist(start,end)
            if length < .5:
                continue
            start_id, end_id = refs[idx:idx+2]
            for ref, (x,z) in zip((start_id,end_id),(start,end)):
                if ref not in nodes:
                    nodes[ref] = dict(id=ref,x=round(x,2),z=round(z,2),y=node_height(x,z,way['id']))
            if any(nodes[ref]['y'] is None for ref in (start_id,end_id)):
                continue
            if kind in WALK:
                add_walk(start_id,end_id,0,way['id'],linear)
                continue
            if kind in MOTOR and tags.get('sidewalk') in ('left','right','both'):
                for side in (-1,1):
                    if tags['sidewalk'] in ('both','left' if side<0 else 'right'):
                        add_walk(start_id,end_id,side*(count*size/2+1),way['id'],linear)
            if tags.get('motor_vehicle') in ('private','no') and kind != 'cycleway':
                continue
            if forbidden.intersects(LineString([start,end]).buffer(count*size/2+2)):
                continue
            for sign in ([-1] if direction=='-1' else [1] if single else [1,-1]):
                head, tail = (start_id,end_id) if sign==1 else (end_id,start_id)
                n = count if single else max(1, count//2 if sign==-1 else (count+1)//2)
                shift = -curb_sign*sign*curb/2
                outer = ((n-.5-(count/2 if single else 0))*size if count>1 else 0) + size/2 + shift
                parking_segments.append((head, tail, way['id'], tags, kind, sign, outer, paved/2))
                for slot in range(n):
                    offset = (slot+.5-(count/2 if single else 0))*size if count>1 else 0
                    offset += shift
                    lane = dict(id=len(lanes), to=tail, width=size, offset=round(offset,2), kind='nonmotor' if kind=='cycleway' else 'bus' if kind=='busway' else 'motor',speedKmh=number(tags.get('maxspeed'),20 if kind in ('cycleway','service') else 40),oneway=single)
                    lane['from'] = head
                    lane['cls'] = kind
                    if station_tunnel and way['id']==UNDERPASS:
                        knots = station_tunnel['stations']
                        if sign<0:
                            knots = [(station_tunnel['length']-d,y) for d,y in reversed(knots)]
                        lane['heights'] = [v for d,y in knots for v in (d/station_tunnel['length'],y)]
                        lane['gradeSeparated'] = 'tunnelProfile'
                        lane['tunnelWay'] = UNDERPASS
                    elif not linear:
                        lane['heights'] = profile(head,tail,lane['offset'],way['id'])
                    if 'gradeSeparated' not in lane and (linear or way['id'] in SPAN_WAYS):
                        lane['gradeSeparated'] = 'linear' if linear else 'jiefang'
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
        for item in result[collection]:
            refs = (item['from'],item['to']) if collection=='lanes' else item[:2]
            center = [(nodes[refs[0]][axis]+nodes[refs[1]][axis])/2 for axis in ('x','z')]
            for col in range(math.floor((center[0]-260)/512),math.floor((center[0]+260)/512)+1):
                for row in range(math.floor((center[1]-260)/512),math.floor((center[1]+260)/512)+1):
                    cell=cells[col,row]
                    cell[collection].append(item);cell['refs'].update(refs)
    for (col,row),cell in cells.items():
        refs=cell.pop('refs');cell['nodes']=[nodes[ref] for ref in sorted(refs)]
        cell['signals']=[signal for signal in signals if signal['node'] in refs]
        (dest.parent/f'{col}_{row}.json.gz').write_bytes(gzip.compress(json.dumps(cell,separators=(',',':')).encode(),mtime=0))
    (dest.parent/'cells.json').write_text(json.dumps([f'{col}_{row}' for col,row in sorted(cells)]))
    print('Traffic:', {key:len(value) for key,value in result.items()}, dest.stat().st_size, 'bytes')
    bake_parking(output, parking_segments, elements, nodes, forbidden, height)


if __name__ == '__main__':
    path = Path(OUT)
    bake(path,json.loads((path/'manifest.json').read_text()))
