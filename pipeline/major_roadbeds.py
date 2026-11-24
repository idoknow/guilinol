"""Mark native at-grade arterial polygons eligible for roadbed closure."""
import argparse
import gzip
import json
import struct
from pathlib import Path

import shapely
import numpy as np
from shapely import LineString, Polygon, STRtree
from shapely.affinity import translate

from common import load_osm
from features import points, polygons
from road_profile import RULES, profile


def bake(directory, manifest):
    eligible, elevated, positive_bridges = [], [], []
    empty = STRtree([])
    for element in load_osm():
        tags = element.get('tags', {})
        kind = tags.get('highway', '')
        if element['type'] != 'way' or not kind:
            continue
        arterial = kind.removesuffix('_link') in ('trunk','primary','secondary')
        bridge = tags.get('bridge','no') != 'no'
        if not arterial and not bridge:
            continue
        axis = LineString(points(element))
        radius = profile(axis, tags, empty, element['id']).width / 2 if kind in RULES['defaultWidth'] else 1
        if bridge and int(tags.get('layer', '1').split(';')[0]) >= 0:
            positive_bridges.append(axis.buffer(radius+1))
        if not arterial:
            continue
        separated = any(tags.get(tag, 'no') != 'no' for tag in ('bridge','tunnel')) or tags.get('layer','0') != '0'
        (elevated if separated else eligible).append(axis.buffer(radius+1))
    major, bridges, upper = STRtree(eligible), STRtree(elevated), STRtree(positive_bridges)
    count = 0
    for tile in manifest['chunks']:
        tile.pop('roadbeds', None)
        origin = tile['x'],tile['z']
        bounds = shapely.box(*origin,origin[0]+256,origin[1]+256)
        hits = major.query(bounds, predicate='intersects')
        separated = bridges.query(bounds, predicate='intersects')
        if not len(hits) and not len(separated):
            continue
        mask = shapely.union_all([*major.geometries.take(hits), *bridges.geometries.take(separated)])
        data = gzip.decompress((directory / tile['file']).read_bytes())
        vertices, indices, size = struct.unpack_from('<3I',data,4)
        offset = 24+16900+9*vertices+4*indices
        payload = json.loads(data[offset:offset+size]); streets = payload[1]
        image_bytes, deck_count = struct.unpack_from('<2I',data,16)
        deck = np.frombuffer(data, '<i2', deck_count*9, offset+size+image_bytes).reshape((-1,3,3))
        deck_cm = shapely.union_all([Polygon(triangle[:,[0,2]]) for triangle in deck if Polygon(triangle[:,[0,2]]).area])
        def local_cm(geometry):
            return shapely.set_precision(shapely.affinity.scale(translate(geometry,-origin[0],-origin[1]),xfact=100,yfact=100,origin=(0,0)),1)
        upper_hits = upper.query(bounds,predicate='intersects')
        axes = local_cm(shapely.union_all(upper.geometries.take(upper_hits)))
        owned = shapely.union_all([part for part in polygons(deck_cm) if part.intersects(axes)])
        transition = local_cm(shapely.union_all(bridges.geometries.take(separated))).union(deck_cm.buffer(60),grid_size=1)
        corridor = local_cm(mask)
        cutoff = streets[11][0] if len(streets)>11 and streets[11] else len(streets[0])
        paths, new_paths = [], []
        for index, (kind, shell, *holes) in enumerate(streets[0][:cutoff]):
            if kind not in (0, 2, 5):
                new_paths.append([kind,shell,*holes])
                continue
            polygon = shapely.union_all(list(polygons(shapely.make_valid(Polygon(shell,holes)))))
            if polygon.intersection(corridor).area <= 50:
                new_paths.append([kind,shell,*holes]);continue
            remainder = shapely.union_all(list(polygons(polygon.difference(owned,grid_size=1))))
            for protected,shape in [(False,remainder.difference(transition,grid_size=1)),(True,remainder.intersection(transition,grid_size=1))]:
                for part in polygons(shape):
                    paths.append(-len(new_paths)-1 if protected else len(new_paths))
                    new_paths.append([kind,*[[[round(x),round(z)] for x,z in ring.coords[:-1]] for ring in [part.exterior,*part.interiors]]])
        if len(streets)>11 and streets[11]:
            streets[11][0]=len(new_paths)
            for index,(kind,shell,*holes) in enumerate(streets[0][cutoff:],start=len(new_paths)):
                if kind in (0,2,5) and Polygon(shell,holes).intersects(corridor):paths.append(index)
        streets[0]=new_paths+streets[0][cutoff:]
        encoded=json.dumps(payload,separators=(',',':')).encode()
        if encoded!=data[offset:offset+size]:
            packed=gzip.compress(data[:12]+struct.pack('<I',len(encoded))+data[16:offset]+encoded+data[offset+size:],compresslevel=5,mtime=0)
            (directory/tile['file']).write_bytes(packed);tile['bytes']=len(packed)
        if paths:
            tile['roadbeds'] = paths
            count += len(paths)
    print('Native at-grade arterial roadbeds:',count)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path)
    directory=parser.parse_args().directory
    path=directory/'manifest.json'
    manifest=json.loads(path.read_bytes())
    bake(directory,manifest)
    path.write_text(json.dumps(manifest,separators=(',',':'))+'\n')
