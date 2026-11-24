"""Exclude parked vehicle footprints from baked railway corridors, including tile seams."""
import argparse
from collections import Counter
import gzip
import json
import math
from pathlib import Path
import struct

from shapely import LineString, Point, Polygon, STRtree, box, union_all
from features import polygons


def compact(obj):
    return json.dumps(obj, separators=(',', ':')).encode()


def tile_data(path):
    data = gzip.decompress(path.read_bytes())
    vertices, indices, size = struct.unpack_from('<3I', data, 4)
    start = 24 + 16900 + 9*vertices + 4*indices
    return data, start, size, json.loads(data[start:start+size])


def filter_world(root, manifest):
    corridors, panels = [], []
    style = json.loads(Path(__file__).with_name('railway-style.json').read_bytes())
    radius = style['gauge']/2 + style['headWidth'] + 3
    for tile in manifest['chunks']:
        _, _, _, collision = tile_data(root/tile['file'])
        for ax, az, _, bx, bz, _, _, flags, *_ in collision[4] if len(collision)>4 else []:
            track = LineString([(tile['x']+ax/100,tile['z']+az/100),(tile['x']+bx/100,tile['z']+bz/100)])
            corridors.append(track)
            if flags & 16:
                panels.append(track.buffer(1.7, cap_style='flat'))
    lines, paving = STRtree(corridors), STRtree(panels)
    removed = Counter()

    def blocked(x, z, footprint):
        point = Point(x,z)
        return (lines.query(point,predicate='dwithin',distance=radius+footprint).size or
                paving.query(point,predicate='dwithin',distance=footprint).size)

    def filter_rows(rows, kind, footprint):
        kept = [r for r in rows if not blocked(r[0],r[2],footprint)]
        removed[kind] += len(rows)-len(kept)
        return kept

    vehicles = root/manifest['vehicles']['file']
    data = json.loads(gzip.decompress(vehicles.read_bytes()))
    for key in ('bikes','bicycles','sharedBikes','cars'):
        if key in data:
            data[key] = filter_rows(data[key],key,2.5 if key=='cars' else 1.1)
    if sum(removed.values()):
        vehicles.write_bytes(gzip.compress(compact(data),mtime=0))
        manifest['vehicles']['bytes'] = vehicles.stat().st_size
    parking = root/'roads/parking'
    index = json.loads((parking/'index.json').read_bytes())
    for cell in index:
        path = parking/(cell+'.json.gz')
        rows = json.loads(gzip.decompress(path.read_bytes()))
        kept = filter_rows(rows,'roadsideCars',2.5)
        if len(kept)!=len(rows):
            index[cell] = len(kept)
            path.write_bytes(gzip.compress(compact(kept),mtime=0))
    if removed['roadsideCars']:
        (parking/'index.json').write_bytes(compact(index))

    for tile in manifest['chunks']:
        x,z=tile['x'],tile['z']
        bounds=box(x,z,x+256,z+256)
        if not lines.query(bounds,predicate='dwithin',distance=8).size:
            continue
        path=root/tile['file']
        data,start,size,collision=tile_data(path)
        streets=collision[1]
        modified=False
        for row in streets[9] if len(streets)>9 else []:
            if row[0]!=3: continue
            old=row[5] if len(row)>5 else 7
            mask=old
            for i,along in enumerate((-1.25,0,1.25)):
                heading=-row[3]/100
                if blocked(x+row[1]/10+along*math.cos(heading),z+row[2]/10-along*math.sin(heading),1.1):
                    mask &= ~(1<<i)
            if old!=mask:
                removed['sidewalkBikes']+=old.bit_count()-mask.bit_count()
                row[5:]=[mask]
                modified=True

        # Trim painted lane markings at the edge of the crossing surface. Keep
        # the lower-road profile pointing at its original group of paths.
        hits=paving.query(bounds,predicate='intersects')
        if len(hits):
            from shapely.affinity import affine_transform
            panel=affine_transform(union_all(paving.geometries.take(hits)),[100,0,0,100,-x*100,-z*100])
            paths=[]
            for i,row in enumerate(streets[0]):
                if len(streets)>11 and streets[11] and i==streets[11][0]:
                    lower_start=len(paths)
                if row[0]!=2:
                    paths.append(row)
                    continue
                poly=Polygon(row[1],row[2:])
                if poly.intersection(panel).area < 1:
                    paths.append(row)
                    continue
                modified=True
                for part in polygons(poly.difference(panel)):
                    rings=[[[round(a,5),round(b,5)] for a,b in ring.coords[:-1]] for ring in [part.exterior,*part.interiors]]
                    if len(set(map(tuple,rings[0])))>=3: paths.append([2,*rings])
            if len(streets)>11 and streets[11]:
                streets[11][0]=lower_start if streets[11][0]<len(streets[0]) else len(paths)
            streets[0]=paths
        if modified:
            packed=compact(collision)
            path.write_bytes(gzip.compress(data[:12]+struct.pack('<I',len(packed))+data[16:start]+packed+data[start+size:],mtime=0))
            tile['bytes']=path.stat().st_size
    return dict(removed)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world',type=Path)
    root=parser.parse_args().world
    path=root/'manifest.json'
    manifest=json.loads(path.read_bytes())
    print(json.dumps(filter_world(root,manifest)))
    path.write_bytes(compact(manifest)+b'\n')
