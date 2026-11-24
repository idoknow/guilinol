"""Open procedural roadside hedges and their fences where a surface road joins."""
import math
from collections import defaultdict

import numpy as np
from shapely import LineString, STRtree, box, union_all

from features import points
from service_streets import width
from surveyed_corridors import read_chunk, write_chunk


def open_verges(output, manifest, elements, widths):
    corridors=[]
    for way in elements:
        if not way.get('surfaceUnderlay'):
            continue
        axis=LineString(points(way))
        half=widths.get(way['id'],width(way['tags']))/2+.5
        corridors.append(axis.buffer(half,quad_segs=4))
    tree=STRtree(corridors)
    moved=defaultdict(list)
    changed={}
    tiles={(tile['x'],tile['z']):tile for tile in manifest['chunks']}
    for origin,tile in tiles.items():
        x,z=origin
        neighbors=tree.query(box(x-3,z-3,x+259,z+259),predicate='intersects')
        if not len(neighbors):
            continue
        raw,at,size,collision=read_chunk(output/tile['file'])
        paths=collision[1]
        if len(paths)<=9 or not paths[9]:
            continue
        keep=[]
        clipped=False
        for row in paths[9]:
            if row[0] not in (5,6):
                keep.append(row)
                continue
            kind,lx,lz,heading,span=row
            centre=np.array([x+lx/10,z+lz/10])
            along=np.array([math.cos(heading/100),math.sin(heading/100)])
            line=LineString([centre-along*span/20,centre+along*span/20])
            hits=tree.query(line,predicate='dwithin',distance=.605)
            if not len(hits):
                keep.append(row)
                continue
            clipped=True
            # The hedge and its offset fence share an anchor. Reserve their
            # full half-width plus decimetre coordinate quantization.
            rest=line.difference(union_all(tree.geometries.take(hits)).buffer(.72))
            for part in getattr(rest,'geoms',[rest]):
                if part.length<.25:
                    continue
                point=part.centroid
                key=(math.floor(point.x/256)*256,math.floor(point.y/256)*256)
                record=[kind,round((point.x-key[0])*10),round((point.y-key[1])*10),heading,
                        math.floor(part.length*10)]
                if key==origin:
                    keep.append(record)
                elif key in tiles:
                    moved[key].append(record)
        if clipped:
            paths[9]=keep
            changed[origin]=(raw,at,size,collision)
    for origin in changed.keys()|moved.keys():
        tile=tiles[origin]
        path=output/tile['file']
        raw,at,size,collision=changed[origin] if origin in changed else read_chunk(path)
        while len(collision[1])<=9:
            collision[1].append([])
        collision[1][9].extend(moved[origin])
        write_chunk(path,raw,at,size,collision)
        tile['bytes']=path.stat().st_size
