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
from road_profile import pair_carriageways, profile, RULES

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


def extract_road_network(frontage_footprints):
    elements = load_osm()
    roads, intersections, banks, waterways, ped_areas = [], Counter(), [], [], []
    facades = STRtree(frontage_footprints)
    for elem in elements:
        tags = elem.get('tags', {})
        if tags.get('waterway') in ('river','stream') and len(points(elem))>1:
            waterways.append((LineString(points(elem)),tags.get('name',''),tags['waterway']))
        if tags.get('highway') and elem['type'] == 'way' and len(points(elem)) > 1:
            coords = points(elem)
            for coord in set(coords):
                intersections[coord] += 1
            kind = tags['highway']
            if kind == 'pedestrian' and tags.get('area') == 'yes':
                poly = area(elem)
                if not poly.is_empty:
                    ped_areas.append(poly)
                continue
            if kind in RULES['defaultWidth'] and tags.get('bridge','no') == 'no' and tags.get('tunnel','no') == 'no':
                roads.append(profile(LineString(coords), tags, facades,elem['id']))
        elif tags.get('water') or tags.get('natural')=='water' or tags.get('waterway')=='riverbank':
            for poly in polygons(area(elem)):
                banks.append((poly,tags.get('name',''),tags.get('water','')))
    roads = list(pair_carriageways(roads))
    named = [(line,name) for line,name,_ in waterways if name]
    banks = [(poly,name or (max(((poly.intersection(line).length,label) for line,label in named if poly.intersects(line)),default=(0,''))[1] if kind=='river' else ''),kind) for poly,name,kind in banks]
    return elements, roads, intersections, banks, waterways, ped_areas


def scatter(bounds, footprints, wet, peaks, elevation, mountain_trees, exclude, precomputed=None, extra_blocked=()):
    rng = random.Random(110300)
    if precomputed is not None:
        elements, roads, intersections, banks, waterways, _ped_areas = precomputed
    else:
        elements, roads, intersections, banks, waterways, _ped_areas = extract_road_network(footprints)
    junctions = STRtree([Point(coord) for coord,count in intersections.items() if count>1])
    road_buffers = [*(road.line.buffer(road.width/2 + 0.45) for road in roads), *extra_blocked]
    road_only = STRtree(road_buffers)
    blocked = STRtree([*footprints,*wet,*peaks,*road_buffers])
    tiles, occupancy, stats = defaultdict(bytearray), defaultdict(list), Counter()
    spacing = CONFIG['minSeparation']

    def tree(pt, profile, source, height=None, normal=(0,1,0), separation=spacing, force_kind=None, force_scale=None):
        east,south = pt.x,pt.y
        if not bounds.contains(pt) or exclude.covers(pt) or road_only.query(pt, predicate='intersects').size:
            return False
        if height is None and blocked.query(pt,predicate='intersects').size:
            return False
        col,row = math.floor(east/spacing),math.floor(south/spacing)
        radius = math.ceil(separation/spacing)
        for ix in range(col-radius,col+radius+1):
            for iz in range(row-radius,row+radius+1):
                if any((east-x)**2+(south-z)**2<separation**2 for x,z in occupancy.get((ix,iz),())):
                    return False
        occupancy[col,row].append((east,south))
        kind = force_kind if force_kind is not None else rng.choices(range(6),CONFIG['weights'][profile])[0]
        scale = force_scale if force_scale is not None else rng.randint(80,125)
        left,top = math.floor(east/CHUNK)*CHUNK,math.floor(south/CHUNK)*CHUNK
        ground_y = elevation(east, south)
        final_y = ground_y if height is None else (max(height, ground_y) if height < ground_y - 0.35 else height)
        tiles[left,top].extend(struct.pack('<HHhBBBBbb',min(CHUNK*100-1,max(0,round((east-left)*100))),min(CHUNK*100-1,max(0,round((south-top)*100))),
            round(10*final_y),kind,scale,
            rng.randrange(256),rng.randrange(256),round(normal[0]*127),round(normal[2]*127)))
        stats[source]+=1
        stats[CONFIG['species'][kind]]+=1
        return True

    # Corner giant banyans at 榕荫路 × 三多路 (Rock field ref IMG_1299.jpg)
    ry_road = next((r for r in roads if r.way == 221349761), None)
    sd_road = next((r for r in roads if r.way == 121981960), None)
    if ry_road is not None and sd_road is not None:
        jct_pt = ry_road.line.intersection(sd_road.line)
        if not jct_pt.is_empty and hasattr(jct_pt, 'x'):
            jx, jz = jct_pt.x, jct_pt.y
            s_ry = ry_road.line.project(jct_pt)
            s_sd = sd_road.line.project(jct_pt)
            u_ry = np.subtract(ry_road.line.interpolate(min(ry_road.line.length, s_ry + 2.0)).coords[0],
                               ry_road.line.interpolate(max(0.0, s_ry - 2.0)).coords[0])
            u_ry /= max(1e-4, np.linalg.norm(u_ry))
            u_sd = np.subtract(sd_road.line.interpolate(min(sd_road.line.length, s_sd + 2.0)).coords[0],
                               sd_road.line.interpolate(max(0.0, s_sd - 2.0)).coords[0])
            u_sd /= max(1e-4, np.linalg.norm(u_sd))
            for sgn_ry in (-1.0, 1.0):
                for sgn_sd in (-1.0, 1.0):
                    for d_ry in (sd_road.width / 2.0 + 1.35, sd_road.width / 2.0 + 2.8, sd_road.width / 2.0 + 4.4):
                        placed_corner = False
                        for d_sd in (ry_road.width / 2.0 + 1.35, ry_road.width / 2.0 + 2.4):
                            cx = jx + sgn_ry * d_ry * u_ry[0] + sgn_sd * d_sd * u_sd[0]
                            cz = jz + sgn_ry * d_ry * u_ry[1] + sgn_sd * d_sd * u_sd[1]
                            if tree(Point(cx, cz), 'lake', 'street', force_kind=1, force_scale=125):
                                placed_corner = True
                                break
                        if placed_corner:
                            break

    for elem in elements:
        natural = elem.get('tags',{}).get('natural')
        if natural=='tree' and elem['type']=='node':
            tree(Point(ll2xz(elem['lat'],elem['lon'])),'mixed','osmTree')
        if natural=='tree_row' and len(points(elem))>1:
            for pt in walk_line(LineString(points(elem)),CONFIG['treeRowSpacing']):
                tree(pt,'mixed','osmRow')
    street = CONFIG['street']
    for road in roads:
        line,width,name = road.line,road.width,road.name
        if not bounds.intersects(line):
            continue
        for side in [-1,1]:
            for pt in walk_line(line,street['spacing'],side*(width/2+street['offset']),street['jitter'],rng):
                if not junctions.query(pt,predicate='dwithin',distance=street['junction']).size:
                    tree(pt,'river' if '滨江' in name else 'lake' if '榕' in name else 'mixed','street')
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
