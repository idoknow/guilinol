import json
import math
import random
import struct
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from shapely import STRtree
from shapely.geometry import Point, LineString, Polygon
from shapely.ops import unary_union

from common import CHUNK, ll2xz, load_osm
from features import area, points, polygons
from road_profile import pair_carriageways, profile, RULES

CONFIG = json.loads(Path(__file__).with_name('vegetation.json').read_text())
SPECIES_IDS = list(range(len(CONFIG['species'])))


def walk_line(line, spacing, offset=0, jitter=0, rng=None, phase=None):
    length = line.length
    for along in np.arange(spacing / 2 if phase is None else phase, length, spacing):
        along += rng.uniform(-jitter, jitter) if jitter else 0
        along = min(length, max(0.0, along))
        before = line.interpolate(max(0, along - .25))
        after = line.interpolate(min(length, along + .25))
        angle = math.atan2(after.y - before.y, after.x - before.x)
        center = line.interpolate(along)
        yield Point(center.x - offset * math.sin(angle), center.y + offset * math.cos(angle))


def extract_road_network(frontage_footprints):
    elements = load_osm()
    roads, intersections, banks, waterways, ped_areas = [], Counter(), [], [], []
    facades = STRtree(frontage_footprints)
    for elem in elements:
        tags = elem.get('tags', {})
        if tags.get('waterway') in ('river', 'stream') and len(points(elem)) > 1:
            waterways.append((LineString(points(elem)), tags.get('name', ''), tags['waterway']))
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
            if kind in RULES['defaultWidth'] and tags.get('bridge', 'no') == 'no' and tags.get('tunnel', 'no') == 'no':
                roads.append(profile(LineString(coords), tags, facades, elem['id']))
        elif tags.get('water') or tags.get('natural') == 'water' or tags.get('waterway') == 'riverbank':
            for poly in polygons(area(elem)):
                banks.append((poly, tags.get('name', ''), tags.get('water', '')))
    roads = list(pair_carriageways(roads))
    named = [(line, name) for line, name, _ in waterways if name]
    banks = [
        (
            poly,
            name or (max(((poly.intersection(line).length, label) for line, label in named if poly.intersects(line)), default=(0, ''))[1] if kind == 'river' else ''),
            kind,
        )
        for poly, name, kind in banks
    ]
    return elements, roads, intersections, banks, waterways, ped_areas


def _road_weights(road):
    by_name = CONFIG['roadSpecies']
    if road.name in by_name:
        return by_name[road.name]
    for key, weights in by_name.items():
        if road.name and key in road.name:
            return weights
    sec = road.section or ('pedestrian' if road.kind == 'pedestrian' else 'local')
    return CONFIG['classWeights'].get(sec, CONFIG['classWeights']['local'])


def _street_scale(kind: int, canopy_road: bool, arterial: bool, rng: random.Random) -> int:
    if canopy_road:
        return rng.randint(108, 124)
    if kind == 2:  # osmanthus in sidewalk planter pits (IMG_1359-1360, 01_IMG_1390)
        return rng.randint(92, 110)
    if arterial and kind in (0, 1, 6):  # arterial verge canopy overarching 3 m cycleway (IMG_1380-1386)
        return rng.randint(106, 124)
    return rng.randint(92, 118)


def _bank_profile(name: str, water_kind: str) -> str:
    if '杉湖' in name:
        return 'shan'
    if '榕湖' in name:
        return 'ronghu'
    if '桂湖' in name or '木龙湖' in name:
        return 'guihu'
    if '漓江' in name or '桃花江' in name or water_kind == 'river':
        return 'river'
    return 'lake' if water_kind == 'lake' else 'mixed'


def scatter(bounds, footprints, wet, peaks, elevation, mountain_trees, exclude, precomputed=None, extra_blocked=(), structure_exclude=None, verge_obstacles=None):
    rng = random.Random(110300)
    if precomputed is not None:
        elements, roads, intersections, banks, waterways, _ped_areas = precomputed
    else:
        elements, roads, intersections, banks, waterways, _ped_areas = extract_road_network(footprints)
    junctions = STRtree([Point(coord) for coord, count in intersections.items() if count > 1])
    road_buffers = [*(road.line.buffer(road.width / 2 + 0.45) for road in roads), *extra_blocked]
    road_only = STRtree(road_buffers)
    blocked = STRtree([*footprints, *wet, *peaks, *road_buffers])
    tiles, occupancy, stats = defaultdict(bytearray), defaultdict(list), Counter()
    spacing = CONFIG['minSeparation']

    def tree(pt, profile_name, source, height=None, normal=(0, 1, 0), separation=spacing, force_kind=None, force_scale=None, yaw=None, planting_mask=None, weights=None):
        east, south = pt.x, pt.y
        mask = exclude if planting_mask is None else planting_mask
        if not bounds.contains(pt) or mask.covers(pt) or road_only.query(pt, predicate='intersects').size:
            return False
        if height is None and blocked.query(pt, predicate='intersects').size:
            return False
        col, row = math.floor(east / spacing), math.floor(south / spacing)
        radius = math.ceil(separation / spacing)
        for ix in range(col - radius, col + radius + 1):
            for iz in range(row - radius, row + radius + 1):
                if any((east - x) ** 2 + (south - z) ** 2 < separation ** 2 for x, z in occupancy.get((ix, iz), ())):
                    return False
        occupancy[col, row].append((east, south))
        w = weights if weights is not None else CONFIG['weights'][profile_name]
        kind = force_kind if force_kind is not None else rng.choices(SPECIES_IDS, w)[0]
        scale = force_scale if force_scale is not None else rng.randint(82, 124)
        left, top = math.floor(east / CHUNK) * CHUNK, math.floor(south / CHUNK) * CHUNK
        ground_y = elevation(east, south)
        final_y = ground_y if height is None else (max(height, ground_y) if height < ground_y - 0.35 else height)
        tiles[left, top].extend(struct.pack(
            '<HHhBBBBbb',
            min(CHUNK * 100 - 1, max(0, round((east - left) * 100))),
            min(CHUNK * 100 - 1, max(0, round((south - top) * 100))),
            round(10 * final_y),
            kind,
            scale,
            rng.randrange(256) if yaw is None else round(yaw * 128 / math.pi) % 256,
            rng.randrange(256),
            round(normal[0] * 127),
            round(normal[2] * 127),
        ))
        stats[source] += 1
        stats[CONFIG['species'][kind]] += 1
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
                            if tree(Point(cx, cz), 'ronghu', 'street', force_kind=1, force_scale=125):
                                placed_corner = True
                                break
                        if placed_corner:
                            break

    for elem in elements:
        natural = elem.get('tags', {}).get('natural')
        if natural == 'tree' and elem['type'] == 'node':
            tree(Point(ll2xz(elem['lat'], elem['lon'])), 'mixed', 'osmTree')
        if natural == 'tree_row' and len(points(elem)) > 1:
            for pt in walk_line(LineString(points(elem)), CONFIG['treeRowSpacing']):
                tree(pt, 'mixed', 'osmRow')

    street = CONFIG['street']
    double_osm_roads = set(CONFIG.get('doubleRowSidewalkOsmanthus', ()))
    beds = defaultdict(list)
    for road in roads:
        width, name = road.width, road.name
        if not bounds.intersects(road.line):
            continue
        section = road.dimensions
        r_weights = _road_weights(road)
        for side, available in ((-1, road.left), (1, road.right)):
            if section and not available:
                continue
            arterial = road.kind in ('trunk', 'primary')
            offset = (section['verge'] / 2 if arterial else section['verge'] + section['cycle'] + section['curb'] + .58) if section else street['offset']
            if section:
                offset = section.get('treeInset', offset)
            side_line = road.side_line(side)
            canopy = bool(section and 'treeInset' in section)
            for pt in walk_line(side_line, street['spacing'], side * (width / 2 + offset), 0 if section else street['jitter'], rng, phase=0 if canopy else None):
                fitted_verge = road.widening and road.widening[0] == side and road.line.project(pt) < RULES['outerWidening'][str(road.way)]['stationMetres'][-1]
                if junctions.query(pt, predicate='dwithin', distance=4 if fitted_verge else street['junction']).size:
                    continue
                if not section:
                    # Pedestrian lakeside / historic paths (e.g. 榕湖北路 IMG_1334)
                    candidates = [pt]
                    if name in ('榕湖北路', '榕湖南路'):
                        along_p = side_line.project(pt)
                        b_p = side_line.interpolate(max(0, along_p - .25))
                        a_p = side_line.interpolate(min(side_line.length, along_p + .25))
                        ang_p = math.atan2(a_p.y - b_p.y, a_p.x - b_p.x)
                        c_p = side_line.interpolate(along_p)
                        for extra_off in (4.6, 6.2):
                            candidates.append(Point(c_p.x - side * extra_off * math.sin(ang_p), c_p.y + side * extra_off * math.cos(ang_p)))
                    for cand in candidates:
                        chosen_k = rng.choices(SPECIES_IDS, r_weights)[0]
                        if tree(cand, 'mixed', 'street', force_kind=chosen_k, force_scale=_street_scale(chosen_k, False, False, rng)):
                            break
                elif not blocked.query(pt.buffer(.52), predicate='intersects').size:
                    origin = tuple(math.floor(value / CHUNK) * CHUNK for value in pt.coords[0])
                    along = side_line.project(pt)
                    before = side_line.interpolate(max(0, along - .2))
                    after = side_line.interpolate(min(side_line.length, along + .2))
                    angle = math.atan2(after.y - before.y, after.x - before.x)
                    chosen_k = rng.choices(SPECIES_IDS, r_weights)[0]
                    # Orient +X leaning/arching limbs toward the road centerline / cycleway with natural jitter
                    toward_road_yaw = math.atan2(side * math.cos(angle), side * math.sin(angle)) + rng.uniform(-0.38, 0.38)
                    if not tree(
                        pt,
                        'mixed',
                        'street',
                        force_kind=chosen_k,
                        force_scale=_street_scale(chosen_k, canopy, arterial, rng),
                        yaw=toward_road_yaw if (canopy or arterial) else None,
                        planting_mask=structure_exclude if fitted_verge else None,
                    ):
                        continue
                    beds[origin].append([round((pt.x - origin[0]) * 10), round((pt.y - origin[1]) * 10), round(angle * 100), int(arterial)])

            # Outer sidewalk raised granite planter row of Sweet Osmanthus on commercial arterials (01_IMG_1390)
            if arterial and section and name in double_osm_roads:
                sw_offset = section['verge'] + section['cycle'] + section['curb'] + .62
                for pt in walk_line(side_line, street['spacing'], side * (width / 2 + sw_offset), 0, rng, phase=street['spacing'] / 2):
                    if junctions.query(pt, predicate='dwithin', distance=street['junction']).size:
                        continue
                    if blocked.query(pt.buffer(.62), predicate='intersects').size:
                        continue
                    origin = tuple(math.floor(value / CHUNK) * CHUNK for value in pt.coords[0])
                    along = side_line.project(pt)
                    before = side_line.interpolate(max(0, along - .2))
                    after = side_line.interpolate(min(side_line.length, along + .2))
                    angle = math.atan2(after.y - before.y, after.x - before.x)
                    if tree(pt, 'mixed', 'street', force_kind=2, force_scale=rng.randint(92, 106), separation=3.2):
                        beds[origin].append([round((pt.x - origin[0]) * 10), round((pt.y - origin[1]) * 10), round(angle * 100), 0])

    if ry_road is not None and ry_road.line.length > 280:
        for station in (265, 273, 281):
            center = ry_road.line.interpolate(station)
            ahead = ry_road.line.interpolate(station + .1)
            angle = math.atan2(ahead.y - center.y, ahead.x - center.x)
            inset = ry_road.width / 2 + 2.85
            point = Point(center.x - inset * math.sin(angle), center.y + inset * math.cos(angle))
            if tree(point, 'ronghu', 'street', force_kind=1, force_scale=130, yaw=-angle, separation=3, planting_mask=Polygon()):
                origin = tuple(math.floor(value / CHUNK) * CHUNK for value in point.coords[0])
                beds[origin].append([round((point.x - origin[0]) * 10), round((point.y - origin[1]) * 10), round(angle * 100), 0])

    # Flanking rows of large camphor trees along both sides of the Ronghu North rill promenade (IMG_1334-1336)
    rh_node = next((ll2xz(e['lat'], e['lon']) for e in elements if e['type'] == 'node' and e['id'] == 6320266329), None)
    if rh_node is not None:
        rx0, rz0 = rh_node
        ang18 = math.radians(18.0)
        c18, s18 = math.cos(ang18), math.sin(ang18)

        def rill_world_pt( u_x: float, u_z: float) -> Point:
            lx = u_x * c18 - (u_z + 17.5) * s18
            lz = -16.25 + u_x * s18 + (u_z + 17.5) * c18
            return Point(rx0 + lx, rz0 + lz)

        # South (lakeside) camphor row & North (promenade outer edge) camphor row flanking the stone rill
        for ux, uz, sc, yw in (
            (3.5,  -15.6, 122, -1.35), (-5.5, -14.8, 118, -1.45), (-14.5, -14.4, 124, -1.30), (-24.0, -14.8, 116, -1.40),
            (13.0, -25.8, 124,  1.65), (4.0,  -26.2, 118,  1.55), (-5.0,  -26.5, 126,  1.70), (-14.0, -26.8, 120,  1.60),
            (-23.0,-27.2, 122,  1.65), (-32.0,-27.6, 118,  1.55),
        ):
            tree(rill_world_pt(ux, uz), 'ronghu', 'street', force_kind=0, force_scale=sc, yaw=yw, separation=4.2)

    # Waterfront banyans, weeping willows, and dawn redwoods along lakeshores & rivers
    shore = unary_union(wet).boundary
    for poly, name, water in banks:
        b_prof = _bank_profile(name, water)
        for pt in walk_line(poly.exterior, CONFIG['bank']['spacing']):
            if not bounds.contains(pt) or pt.distance(shore) > .25:
                continue
            distance = rng.uniform(*CONFIG['bank']['offset'])
            base = poly.exterior.project(pt)
            prev = poly.exterior.interpolate((base - .5) % poly.exterior.length)
            angle = math.atan2(pt.y - prev.y, pt.x - prev.x)
            for side in (-1, 1):
                land = Point(pt.x - side * distance * math.sin(angle), pt.y + side * distance * math.cos(angle))
                if not poly.contains(land):
                    # Near water's edge (< 4.8 m), bias toward weeping willow (10) & banyan (1) / metasequoia (4)
                    chosen_k = rng.choices(SPECIES_IDS, CONFIG['weights'][b_prof])[0]
                    toward_water_yaw = math.atan2(side * math.cos(angle), side * math.sin(angle)) + rng.uniform(-0.4, 0.4)
                    tree(land, b_prof, 'bank', force_kind=chosen_k, yaw=toward_water_yaw if chosen_k == 10 else None)

    for elem in elements:
        tags = elem.get('tags', {})
        key = next((tags[tag] for tag in ('natural', 'leisure', 'landuse', 'amenity') if tags.get(tag) in CONFIG['patchSpacing']), None)
        if elem['type'] == 'way' and elem['id'] in (1382487359, 1382487360):
            key = 'park'
        if key is None or elem['type'] == 'node':
            continue
        distance = CONFIG['patchSpacing'][key]
        prof_name = 'school' if key in ('school', 'university') else 'mixed'
        for patch in polygons(area(elem).intersection(bounds)):
            left, top, right, bottom = patch.bounds
            for _ in range(math.ceil(patch.area / distance ** 2 * 3)):
                pt = Point(rng.uniform(left, right), rng.uniform(top, bottom))
                if patch.contains(pt):
                    tree(pt, prof_name, key, separation=distance)

    water_index = STRtree(wet)
    for line, name, kind in waterways:
        for side in (-1, 1):
            for pt in walk_line(line, CONFIG['bank']['spacing'], side * CONFIG['waterwayBankOffset'][kind]):
                if not water_index.query(pt, predicate='dwithin', distance=12).size:
                    tree(pt, 'river' if kind == 'river' else 'mixed', 'waterway')

    for pos, normal in mountain_trees:
        tree(Point(pos[0], pos[2]), 'peak', 'mountain', pos[1], normal)
    # Surveyed strips opposite IMG_1384/1386 and along the market at IMG_1393.
    # Some verge centres fall in landmark replacement or tree-clearing polygons.
    # Keep the actual structures, tactile paving and the usual road clearance.
    if verge_obstacles is not None:
        # A half-pitch shift fits one pit before the taper meets the junction.
        # Values are distances along the outer edge guide, in metres.
        restored = {221821072: (465, 545, None), 727682110: (13, 15, 0), 258909993: (345, 393, None)}
        for road in roads:
            if road.way not in restored or not road.right:
                continue
            start, end, phase = restored[road.way]
            guide = road.side_line(1)
            inset = (road.width + road.dimensions['verge']) / 2
            for pt in walk_line(guide, street['spacing'], inset, phase=phase):
                station = guide.project(pt)
                if not start <= station <= end:
                    continue
                pit = pt.buffer(.52)
                if (blocked.query(pit, predicate='intersects').size or
                    verge_obstacles.query(pit, predicate='intersects').size or
                    junctions.query(pt, predicate='dwithin', distance=4 if road.widening else street['junction']).size):
                    continue
                kind = rng.choices(SPECIES_IDS, _road_weights(road))[0]
                if tree(pt, 'mixed', 'street', force_kind=kind, force_scale=_street_scale(kind, False, True, rng),
                        planting_mask=Polygon()):
                    tangent = np.subtract(guide.interpolate(station+.2).coords[0], guide.interpolate(station-.2).coords[0])
                    angle = math.atan2(tangent[1], tangent[0])
                    origin = tuple(math.floor(value / CHUNK) * CHUNK for value in pt.coords[0])
                    beds[origin].append([round((pt.x-origin[0])*10), round((pt.y-origin[1])*10), round(angle*100), 1])
    return tiles, roads, banks, stats, beds
