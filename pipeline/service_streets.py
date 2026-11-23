"""Compile at-grade minor streets into the shared GL04 carriageway batch."""
import argparse
import gzip
import io
import json
import math
import re
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageColor
from scipy.ndimage import distance_transform_edt
from shapely import (LineString, Polygon, STRtree, box, intersects_xy, make_valid,
                     set_precision, union_all, points as xy_points)
from shapely.affinity import translate

from common import OUT, load_osm
from features import points, polygons


def width(tags):
    match = re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(m|ft)?\s*', str(tags.get('width', '')))
    if match and float(match[1]) > 0:
        return float(match[1]) * (.3048 if match[2] == 'ft' else 1)
    return 3 if tags.get('service') in ('driveway', 'parking_aisle') else 4


def footprints(elements, connector_ids=()):
    from cars import EXTRA_WIDTHS
    result = []
    for way in elements:
        tags = way.get('tags', {})
        highway = tags.get('highway')
        connector = way['id'] in connector_ids and highway in EXTRA_WIDTHS
        if way['type'] != 'way' or not (connector or highway in ('service', 'track', 'living_street')):
            continue
        if any(tags.get(key, 'no') != 'no' for key in ('bridge', 'tunnel', 'area', 'indoor')) or tags.get('layer', '0') != '0':
            continue
        coords = points(way)
        if len(coords) > 1:
            lane_width = EXTRA_WIDTHS[highway] if connector and not tags.get('width') else width(tags)
            result.append(LineString(coords).buffer(lane_width/2, quad_segs=3))
    return STRtree(result)


def rings(kind, shape):
    for part in polygons(set_precision(make_valid(shape), .01)):
        if part.area > .005:
            yield [kind, *(np.rint(np.asarray(loop.coords)[:-1]*100).astype(int).tolist()
                           for loop in (part.exterior, *part.interiors))]


def clean_texture(data, footprint, color):
    image = np.array(Image.open(io.BytesIO(data)).convert('RGB'))
    road = np.all(image == color, axis=2)
    if not road.any() or road.all():
        return data
    rows, cols = np.nonzero(road)
    selected = intersects_xy(footprint.buffer(1.75), cols+.5, rows+.5)
    rows, cols = rows[selected], cols[selected]
    if not len(rows):
        return data
    nearest = distance_transform_edt(road, return_distances=False, return_indices=True)
    image[rows, cols] = image[nearest[0, rows, cols], nearest[1, rows, cols]]
    encoded = io.BytesIO()
    Image.fromarray(image).save(encoded, format='PNG')
    return encoded.getvalue()


def patch_tile(file, footprint, color):
    raw = gzip.decompress(file.read_bytes())
    vertices, indices, size, png_size = struct.unpack_from('<4I', raw, 4)
    start = 24+16900+9*vertices+4*indices
    collision = json.loads(raw[start:start+size]); streets = collision[1]
    paths = streets[0]
    lower = streets[11] if len(streets)>11 else None
    boundary = lower[0] if lower else len(paths)
    rebuilt, occupied = [], []
    for kind, *loops in paths[:boundary]:
        shape = make_valid(Polygon(np.asarray(loops[0])/100, [np.asarray(loop)/100 for loop in loops[1:]]))
        if kind in (1, 4, 5, 6) and shape.intersects(footprint):
            rebuilt.extend(rings(kind, shape.difference(footprint)))
        else:
            rebuilt.append([kind, *loops]); occupied.append(shape)
    fresh = set_precision(footprint.difference(union_all(occupied)), .01)
    if fresh.area < .01:
        return False
    xmin, zmin, xmax, zmax = fresh.bounds
    for east in range(math.floor(xmin/16)*16, math.ceil(xmax/16)*16, 16):
        for south in range(math.floor(zmin/16)*16, math.ceil(zmax/16)*16, 16):
            rebuilt.extend(rings(0, fresh.intersection(box(east,south,east+16,south+16))))
    if lower:
        lower[0] = len(rebuilt)
    streets[0] = rebuilt + paths[boundary:]
    encoded = json.dumps(collision,separators=(',', ':')).encode()
    image_start = start+size
    image = clean_texture(raw[image_start:image_start+png_size], footprint, color)
    payload = raw[:12]+struct.pack('<II',len(encoded),len(image))+raw[20:start]+encoded+image+raw[image_start+png_size:]
    file.write_bytes(gzip.compress(payload, compresslevel=5, mtime=0))
    return True


def clear_carriageway_trees(output, chunks):
    """Trees are scattered before minor streets are baked. Check the final paved paths."""
    removed = 0
    for tile in chunks:
        file = output/tile['file']
        tree_file = file.with_suffix('.trees')
        trees = np.frombuffer(gzip.decompress(tree_file.read_bytes()),dtype='<u2').reshape(-1,6)
        if not len(trees):
            continue
        raw = gzip.decompress(file.read_bytes())
        vertices,indices,size = struct.unpack_from('<3I',raw,4)
        start = 24+16900+9*vertices+4*indices
        streets = json.loads(raw[start:start+size])[1]
        paths = streets[0]
        if len(streets)>11 and streets[11]:
            paths = paths[:streets[11][0]]
        roads = [Polygon(shell,holes) for kind,shell,*holes in paths if kind==0]
        if not roads:
            continue
        hits,_ = STRtree(roads).query(xy_points(trees[:,:2]),predicate='within')
        if len(hits):
            keep = np.ones(len(trees),dtype=bool)
            keep[hits] = False
            removed += np.count_nonzero(~keep)
            tree_file.write_bytes(gzip.compress(trees[keep].tobytes(),mtime=0))
    return removed


def bake(output, manifest, palette):
    connectors = set()
    if 'region' in manifest:
        corridors = json.loads(Path(__file__).with_name('region.json').read_bytes())['corridors']
        connectors = {way for c in corridors if c['mode']=='drive' and c['end']=='两江机场' for way in c['ways']}
    tree = footprints(load_osm(), connectors); changed = 0
    region = Polygon(manifest['region']['local']) if 'region' in manifest else None
    for tile in manifest['chunks']:
        east, south = tile['x'], tile['z']
        bounds = box(east,south,east+256,south+256)
        hits = tree.query(bounds, predicate='intersects')
        if not len(hits):
            continue
        clipped = union_all(tree.geometries.take(hits)).intersection(bounds)
        if region is not None and not region.covers(bounds):
            clipped = clipped.intersection(region)
            if clipped.area == 0:
                continue
        shape = translate(clipped, -east,-south)
        file = output/tile['file']
        if patch_tile(file, shape, ImageColor.getrgb(palette['road'])):
            changed += 1; tile['bytes'] = file.stat().st_size
    print(f'Minor streets: {len(tree.geometries)} ways, {changed} changed chunks')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output',type=Path,default=Path(OUT))
    output = parser.parse_args().output; file = output/'manifest.json'
    manifest = json.loads(file.read_text())
    bake(output, manifest, json.loads(Path(__file__).with_name('palette.json').read_text()))
    file.write_text(json.dumps(manifest,separators=(',',':'))+'\n')
