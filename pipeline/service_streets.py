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
from features import area, points, polygons


def width(tags, default=None):
    match = re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(m|ft)?\s*', str(tags.get('width', '')))
    if match and float(match[1]) > 0:
        return float(match[1]) * (.3048 if match[2] == 'ft' else 1)
    return default if default is not None else (3 if tags.get('service') in ('driveway', 'parking_aisle') else 4)


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


def patch_tile(file, footprint, color, *, sidewalk=False, excluded=None):
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
        if not sidewalk and kind in (1, 4, 5, 6) and shape.intersects(footprint):
            rebuilt.extend(rings(kind, shape.difference(footprint)))
        else:
            rebuilt.append([kind, *loops]); occupied.append(shape)
    if sidewalk:
        deck_count, = struct.unpack_from('<I', raw, 20)
        deck = np.frombuffer(raw, '<i2', deck_count*9, start+size+png_size).reshape(-1,3,3)
        occupied.extend(Polygon(face[:,::2]/100) for face in deck)
        for _, _, loops, *_ in collision[0]:
            occupied.append(make_valid(Polygon(np.asarray(loops[0])/100, [np.asarray(loop)/100 for loop in loops[1:]])))
        if excluded is not None:
            occupied.append(excluded)
    obstacles = union_all([part for shape in occupied for part in polygons(shape)]) if sidewalk else union_all(occupied)
    if sidewalk:
        footprint = set_precision(footprint, .01)
    mask = obstacles.buffer(.02) if sidewalk else obstacles
    fresh = set_precision(footprint.difference(mask), .01)
    if sidewalk and any(set_precision(part, 0).intersection(obstacles).area > 1e-10 for part in polygons(fresh)):
        raise ValueError(f'Quantized walk overlaps protected geometry: {file}')
    image_start = start+size
    original = raw[image_start:image_start+png_size]
    if fresh.area < .01 and not sidewalk:
        return False
    image = clean_texture(original, footprint, color)
    if fresh.area < .01 and image == original:
        return False
    if sidewalk:
        rebuilt.extend(rings(1, fresh))
    else:
        xmin, zmin, xmax, zmax = fresh.bounds
        for east in range(math.floor(xmin/16)*16, math.ceil(xmax/16)*16, 16):
            for south in range(math.floor(zmin/16)*16, math.ceil(zmax/16)*16, 16):
                rebuilt.extend(rings(0, fresh.intersection(box(east,south,east+16,south+16))))
    if lower:
        lower[0] = len(rebuilt)
    streets[0] = rebuilt + paths[boundary:]
    encoded = json.dumps(collision,separators=(',', ':')).encode()
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
    bake_footprints(output, manifest, palette, footprints(load_osm(), connectors))


def walk_lines(elements):
    defaults = {'footway': 3, 'path': 2, 'pedestrian': 4}
    for way in elements:
        tags = way.get('tags', {})
        highway = tags.get('highway')
        if (way['type'] != 'way' or highway not in defaults or tags.get('footway') in ('sidewalk','crossing')
                or tags.get('layer', '0') != '0' or any(tags.get(key, 'no') != 'no' for key in ('area','bridge','tunnel','indoor'))):
            continue
        coords = points(way)
        if len(coords) > 1:
            yield LineString(coords), width(tags, defaults[highway])


def occupied_walk_areas(elements):
    for element in elements:
        tags = element.get('tags', {})
        if element['type'] in ('relation', 'way') and (tags.get('man_made') == 'bridge'
                or tags.get('area:highway') in ('footway','pedestrian','steps','cycleway')
                or tags.get('area') == 'yes' and tags.get('highway') in ('footway','path','pedestrian','steps')
                or tags.get('place') == 'square'):
            yield from polygons(area(element))


def bake_walks(output, manifest, palette, exclusions=None):
    if exclusions is None:
        from landmark_layout import Layout
        from features import ground_features
        layout = Layout()
        left, top, span, depth = manifest['extent']
        bounds = box(left, top, left+span, top+depth)
        exclusions = [layout.exclude, *layout.school_grounds, *ground_features(bounds)['water']]
    elements = load_osm()
    protected = STRtree([*(part for shape in exclusions for part in polygons(shape)), *occupied_walk_areas(elements)])
    lines = list(walk_lines(elements))
    print(f'Walk inputs: {len(lines)} ways, {sum(line.length for line, _ in lines)/1000:.3f} km')
    lanes = STRtree([line.buffer(span/2, quad_segs=3) for line, span in lines])
    return bake_footprints(output, manifest, palette, lanes, sidewalk=True, protected=protected)


def bake_footprints(output, manifest, palette, tree, *, sidewalk=False, protected=None):
    changed = 0
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
        excluded = None
        if protected is not None:
            obstacles = protected.geometries.take(protected.query(bounds, predicate='intersects'))
            excluded = translate(union_all(obstacles).intersection(bounds), -east, -south)
        if patch_tile(file, shape, ImageColor.getrgb(palette['road']), sidewalk=sidewalk, excluded=excluded):
            changed += 1; tile['bytes'] = file.stat().st_size
    label = 'City walks' if sidewalk else 'Minor streets'
    print(f'{label}: {len(tree.geometries)} ways, {changed} changed chunks')
    return changed


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output',type=Path,default=Path(OUT))
    parser.add_argument('--walks-only', action='store_true')
    args = parser.parse_args(); output = args.output; file = output/'manifest.json'
    manifest = json.loads(file.read_text())
    compile_streets = bake_walks if args.walks_only else bake
    compile_streets(output, manifest, json.loads(Path(__file__).with_name('palette.json').read_text()))
    file.write_text(json.dumps(manifest,separators=(',',':'))+'\n')


def mark_drivable_services(output, elements, lanes):
    """Extend the player mask to the service carriageways that carry traffic."""
    import base64
    from shapely import intersects_xy
    from common import ll2xz
    file = output/'vehicles.bin'
    data = json.loads(gzip.decompress(file.read_bytes()))
    left,top,cols,rows,step = data['motorGrid']
    packed = base64.b64decode(data['motorMask'])
    compressed = data.get('maskEncoding')=='gzip'
    mask = np.frombuffer(gzip.decompress(packed) if compressed else packed, dtype='u1').copy()
    eligible = {(lane['way'],min(lane['from'],lane['to']),max(lane['from'],lane['to']))
                for lane in lanes if lane['cls']=='service' and not lane.get('structure')}
    for way in elements:
        if way.get('tags',{}).get('highway')!='service':
            continue
        half_width = width(way['tags'])/2
        for i,(a,b) in enumerate(zip(way['nodes'],way['nodes'][1:])):
            if (way['id'],min(a,b),max(a,b)) not in eligible:
                continue
            ends=[ll2xz(p['lat'],p['lon']) for p in way['geometry'][i:i+2]]
            strip=LineString(ends).buffer(half_width,quad_segs=3)
            x0,z0,x1,z1=strip.bounds
            c=np.arange(max(0,math.ceil((x0-left)/step)),min(cols,math.floor((x1-left)/step)+1))
            r=np.arange(max(0,math.ceil((z0-top)/step)),min(rows,math.floor((z1-top)/step)+1))
            j,k=np.nonzero(intersects_xy(strip,left+c[None,:]*step,top+r[:,None]*step))
            index=r[j]*cols+c[k]
            np.bitwise_or.at(mask,index>>3,(128>>(index&7)).astype('u1'))
    raw=mask.tobytes()
    data['motorMask']=base64.b64encode(gzip.compress(raw,mtime=0) if compressed else raw).decode()
    file.write_bytes(gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
