import json
import math
import random
import struct
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from shapely import STRtree
from shapely.geometry import Point, LineString
from shapely.ops import unary_union

from common import CHUNK, ll2xz, load_osm
from features import area, points, polygons

CONFIG = json.loads(Path(__file__).with_name('vegetation.json').read_text())


def walk_line(line, spacing, offset=0, jitter=0, rng=None):
    length = line.length
    for along in np.arange(spacing / 2, length, spacing):
        along += rng.uniform(-jitter, jitter) if jitter else 0
        before = line.interpolate(max(0, along-.25))
        after = line.interpolate(min(length, along+.25))
        angle = math.atan2(after.y-before.y, after.x-before.x)
        center = line.interpolate(along)
        yield Point(center.x-offset*math.sin(angle), center.y+offset*math.cos(angle))


def scatter(bounds, footprints, wet, peaks, elevation, mountain_trees):
    rng = random.Random(110300)
    elements = load_osm()
    roads, intersections, banks, waterways = [], Counter(), [], []
    for elem in elements:
        tags = elem.get('tags', {})
        if tags.get('waterway') in ('river','stream') and len(points(elem))>1:
            waterways.append((LineString(points(elem)),tags.get('name',''),tags['waterway']))
        if tags.get('highway') and elem['type'] == 'way' and len(points(elem)) > 1:
            coords = points(elem)
            for coord in set(coords):
                intersections[coord] += 1
            kind = tags['highway']
            if kind in CONFIG['width'] and tags.get('bridge','no') == 'no' and tags.get('tunnel','no') == 'no':
                try:
                    width = float(tags.get('width', CONFIG['width'][kind]))
                except ValueError:
                    width = CONFIG['width'][kind]
                roads.append((LineString(coords), max(2,min(36,width)), kind,tags.get('name','')))
        elif tags.get('water') or tags.get('natural')=='water' or tags.get('waterway')=='riverbank':
            for poly in polygons(area(elem)):
                banks.append((poly,tags.get('name',''),tags.get('water','')))
    named = [(line,name) for line,name,_ in waterways if name]
    banks = [(poly,name or (max(((poly.intersection(line).length,label) for line,label in named if poly.intersects(line)),default=(0,''))[1] if kind=='river' else ''),kind) for poly,name,kind in banks]
    junctions = STRtree([Point(coord) for coord,count in intersections.items() if count>1])
    blocked = STRtree([*footprints,*wet,*peaks,*(line.buffer(width/2) for line,width,_,_ in roads)])
    tiles, occupancy, stats = defaultdict(bytearray), defaultdict(list), Counter()
    spacing = CONFIG['minSeparation']

    def tree(pt, profile, source, height=None, normal=(0,1,0), separation=spacing):
        east,south = pt.x,pt.y
        if not bounds.contains(pt) or (height is None and blocked.query(pt,predicate='intersects').size):
            return
        col,row = math.floor(east/spacing),math.floor(south/spacing)
        radius = math.ceil(separation/spacing)
        for ix in range(col-radius,col+radius+1):
            for iz in range(row-radius,row+radius+1):
                if any((east-x)**2+(south-z)**2<separation**2 for x,z in occupancy.get((ix,iz),())):
                    return
        occupancy[col,row].append((east,south))
        kind = rng.choices(range(6),CONFIG['weights'][profile])[0]
        left,top = math.floor(east/CHUNK)*CHUNK,math.floor(south/CHUNK)*CHUNK
        tiles[left,top].extend(struct.pack('<HHhBBBBbb',round((east-left)*100),round((south-top)*100),
            round(10*(elevation(east,south) if height is None else height)),kind,rng.randint(80,125),
            rng.randrange(256),rng.randrange(256),round(normal[0]*127),round(normal[2]*127)))
        stats[source]+=1
        stats[CONFIG['species'][kind]]+=1

    for elem in elements:
        natural = elem.get('tags',{}).get('natural')
        if natural=='tree' and elem['type']=='node':
            tree(Point(ll2xz(elem['lat'],elem['lon'])),'mixed','osmTree')
        if natural=='tree_row' and len(points(elem))>1:
            for pt in walk_line(LineString(points(elem)),CONFIG['treeRowSpacing']):
                tree(pt,'mixed','osmRow')
    street = CONFIG['street']
    for line,width,kind,name in roads:
        if not bounds.intersects(line):
            continue
        for side in [-1,1]:
            for pt in walk_line(line,street['spacing'],side*(width/2+street['offset']),street['jitter'],rng):
                if not junctions.query(pt,predicate='dwithin',distance=street['junction']).size:
                    tree(pt,'river' if '滨江' in name else 'mixed','street')
    shore = unary_union(wet).boundary
    for poly,name,water in banks:
        for pt in walk_line(poly.exterior,CONFIG['bank']['spacing']):
            if not bounds.contains(pt) or pt.distance(shore)>.2:
                continue
            distance = rng.uniform(*CONFIG['bank']['offset'])
            base = poly.exterior.project(pt)
            prev = poly.exterior.interpolate((base-.5)%poly.exterior.length)
            angle = math.atan2(pt.y-prev.y,pt.x-prev.x)
            for side in [-1,1]:
                land = Point(pt.x-side*distance*math.sin(angle),pt.y+side*distance*math.cos(angle))
                if not poly.contains(land):
                    tree(land,'shan' if name=='杉湖' else 'lake' if water=='lake' else 'mixed','bank')
    for elem in elements:
        tags = elem.get('tags',{})
        key = next((tags[tag] for tag in ('natural','leisure','landuse','amenity') if tags.get(tag) in CONFIG['patchSpacing']),None)
        if key is None or elem['type']=='node':
            continue
        distance = CONFIG['patchSpacing'][key]
        for patch in polygons(area(elem).intersection(bounds)):
            left,top,right,bottom = patch.bounds
            for _ in range(math.ceil(patch.area/distance**2*3)):
                pt = Point(rng.uniform(left,right),rng.uniform(top,bottom))
                if patch.contains(pt):
                    tree(pt,'mixed',key,separation=distance)
    water_index=STRtree(wet)
    for line,name,kind in waterways:
        for side in (-1,1):
            for pt in walk_line(line,CONFIG['bank']['spacing'],side*CONFIG['waterwayBankOffset'][kind]):
                if not water_index.query(pt,predicate='dwithin',distance=12).size:
                    tree(pt,'mixed','waterway')
    for pos,normal in mountain_trees:
        tree(Point(pos[0],pos[2]),'peak','mountain',pos[1],normal)
    return tiles, roads, banks, stats
