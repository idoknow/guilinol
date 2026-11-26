"""Audit packed at-grade network corridors against final GL04 street faces."""
from collections import defaultdict
import gzip
import json
import math
import struct

import numpy as np
from shapely import Polygon, STRtree, box, make_valid, set_precision, union_all
from shapely.affinity import translate

from features import polygons
from common import load_osm


def network_masks(world):
    graph = json.loads(gzip.decompress((world/'roads/graph.json.gz').read_bytes()))
    nodes = {node['id']: (node['x'], node['z']) for node in graph['nodes']}
    masks = [[], []]
    skip, surface = set(), set()
    for way in load_osm():
        tags = way.get('tags', {})
        if way['type'] != 'way' or not tags.get('highway'):
            continue
        separated = tags.get('layer', '0') != '0' or any(tags.get(key, 'no') != 'no' for key in ('bridge', 'tunnel', 'indoor'))
        unpaved = tags.get('surface') in ('unpaved', 'dirt', 'ground', 'earth', 'grass', 'sand', 'gravel', 'fine_gravel')
        edges = skip if separated or unpaved else surface
        refs = way.get('nodes', [])
        edges.update((min(head, tail), max(head, tail)) for head, tail in zip(refs, refs[1:]))
    skip -= surface

    def add(kind, head, tail, offset, width):
        if (min(head, tail), max(head, tail)) in skip:
            return
        start, end = nodes[head], nodes[tail]
        east, south = end[0]-start[0], end[1]-start[1]
        length = math.hypot(east, south)
        if length < .01:
            return
        corners = [(round(100*(node[0]-south/length*shift)), round(100*(node[1]+east/length*shift)))
                   for node, shift in ((start, offset-width/2), (end, offset-width/2),
                                       (end, offset+width/2), (start, offset+width/2))]
        masks[kind].append(Polygon(corners))

    for lane in graph['lanes']:
        if not lane.get('gradeSeparated'):
            add(0, lane['from'], lane['to'], lane['offset'], lane['width'])
    for head, tail, offset, _, *profile in graph['walks']:
        if profile:
            add(1, head, tail, offset, 2)
    return [STRtree(group) for group in masks]


def loops(part):
    return [[[int(east), int(south)] for east, south in ring.coords[:-1]]
            for ring in (part.exterior, *part.interiors)]


def patches_for(tile, raw, masks):
    west, north = 100*tile['x'], 100*tile['z']
    boundary = box(west, north, west+25600, north+25600)
    selected = [index.query(boundary, predicate='intersects') for index in masks]
    if not any(len(group) for group in selected):
        return [], raw
    vertices, indices, size, png, decks = struct.unpack_from('<5I',raw,4)
    start = 24+16900+9*vertices+4*indices
    collision = json.loads(raw[start:start+size]); streets = collision[1]
    added = streets[19] if len(streets) > 19 else []
    occupied = [make_valid(Polygon(shell, holes)) for _, shell, *holes in streets[0]]
    occupied.extend(make_valid(Polygon(row[2][0],row[2][1:])) for row in collision[0] if row[2])
    deck_faces = np.frombuffer(raw, '<i2', decks*9, start+size+png).reshape(-1,3,3)
    occupied.extend(Polygon(face[:,[0,2]]) for face in deck_faces)
    obstacle = union_all([part for shape in occupied for part in polygons(shape) if part.area], grid_size=1).buffer(0)
    patches = []
    for kind, group in enumerate(selected):
        if not len(group):
            continue
        required = union_all(masks[kind].geometries.take(group), grid_size=1).intersection(boundary,grid_size=1)
        required = translate(union_all(list(polygons(required)), grid_size=1), -west, -north)
        gaps = set_precision(required.difference(obstacle,grid_size=1),1)
        installed = [Polygon(shell, holes) for material,shell,*holes in added if material == kind]
        missing = gaps.difference(union_all(installed)) if installed else gaps
        for part in polygons(missing):
            rings = loops(part)
            patches.append(dict(kind=kind, gap=rings, face=[kind, *rings]))
        obstacle = union_all([obstacle, gaps], grid_size=1).buffer(0)
    if not patches:
        return patches, raw
    while len(streets) < 20:
        streets.append(None if len(streets) in (5, 11, 12, 13) else [])
    streets[19] = [*added, *(entry['face'] for entry in patches)]
    encoded = json.dumps(collision,separators=(',', ':')).encode()
    return patches, raw[:12]+struct.pack('<I',len(encoded))+raw[16:start]+encoded+raw[start+size:]


def coverage(world, apply=False):
    manifest = json.loads((world/'manifest.json').read_bytes())
    masks = network_masks(world)
    changes, worst = {}, []
    areas = defaultdict(float)
    for tile in manifest['chunks']:
        file = world/tile['file']
        patches, updated = patches_for(tile, gzip.decompress(file.read_bytes()), masks)
        if not patches:
            continue
        key = f"{tile['x']},{tile['z']}"
        changes[key] = patches
        for entry in patches:
            shell, *holes = entry['gap']
            shape = Polygon(shell,holes)
            centre = shape.representative_point()
            area = shape.area/10000
            areas[entry['kind']] += area
            worst.append((area, tile['x']+centre.x/100, tile['z']+centre.y/100, entry['kind']))
        if apply:
            file.write_bytes(gzip.compress(updated, compresslevel=5, mtime=0))
            tile['bytes'] = file.stat().st_size
    if apply and changes:
        (world/'manifest.json').write_text(json.dumps(manifest,separators=(',', ':'))+'\n')
    return dict(areas=areas, gaps=len(worst), tiles=len(changes), worst=sorted(worst,reverse=True)[:20]), changes
