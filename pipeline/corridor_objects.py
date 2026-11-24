"""Relocate existing street furniture and vegetation clear of newly paved corridors."""
import base64
import gzip
import json
import math
import struct
import zlib
from collections import defaultdict
from functools import lru_cache

import numpy as np
from shapely import LineString, Point, Polygon, STRtree, box, make_valid, union_all

from common import ll2xz
from road_grading import eval_bspline_grid
from surveyed_corridors import read_chunk, write_chunk

TREE = struct.Struct('<HHhBBBBbb')


def footprints(paths, origin, kinds):
    return union_all([make_valid(Polygon(np.asarray(shell)/100+origin,
                         [np.asarray(h)/100+origin for h in holes]))
                      for k,shell,*holes in paths if k in kinds])


def relocate(output, manifest, elements, surface):
    tiles={(t['x'],t['z']):t for t in manifest['chunks']}
    def origin(x,z):
        return (math.floor(x/256)*256,math.floor(z/256)*256)

    @lru_cache(maxsize=48)
    def surfaces(key):
        paths=read_chunk(output/tiles[key]['file'])[3][1]
        return (footprints(paths[0],key,{0,5}), footprints(paths[0],key,{1,4,6}),paths[5] if len(paths)>5 else None)

    lines=[LineString([ll2xz(p['lat'],p['lon']) for p in w['geometry']])
           for w in elements if w['type']=='way' and w.get('tags',{}).get('highway')
           and w['tags'].get('layer','0')=='0' and w['tags'].get('bridge','no')=='no'
           and w.get('geometry') and len(w['geometry'])>1 and all(w['geometry'])]
    axes=STRtree(lines)
    moves=defaultdict(list)
    anchors=defaultdict(dict)
    for key,tile in tiles.items():
        if not tile.get('gradedCorridor'):
            continue
        paths=read_chunk(output/tile['file'])[3][1]
        survey=paths[12]
        original=json.loads(zlib.decompress(base64.b64decode(survey['input'])))
        # Include the 40 mm bed exposed beneath the repaired asphalt rim.
        # Otherwise objects on the former road edge survive next to the curb.
        added=footprints(paths[0][survey['start']:survey['end']],key,{0}).buffer(.041).difference(
            footprints(original['paths'],key,{0,5}))
        if added.is_empty:
            continue
        trees_path=(output/tile['file']).with_suffix('.trees')
        trees=list(TREE.iter_unpack(gzip.decompress(trees_path.read_bytes()))) if trees_path.exists() else []
        objects=[(0,i,row[0]/100,row[1]/100) for i,row in enumerate(trees)]
        for field in (1,4):
            objects.extend((field,i,x/10,z/10) for i,(x,z) in enumerate(paths[field]))
        nearby=None
        for field,i,lx,lz in objects:
            x,z=key[0]+lx,key[1]+lz
            point=Point(x,z)
            if not added.covers(point):
                continue
            if nearby is None:
                region=box(key[0]-64,key[1]-64,key[0]+320,key[1]+320)
                blocks=[surfaces(k) for dx in (-256,0,256) for dz in (-256,0,256)
                        if (k:=(key[0]+dx,key[1]+dz)) in tiles]
                nearby=[union_all([b[j].intersection(region) for b in blocks]) for j in (0,1)]
            road,sidewalk=nearby
            line=lines[axes.nearest(point)]
            t=line.project(point)
            a,b=line.interpolate(max(0,t-.01)),line.interpolate(min(line.length,t+.01))
            dx,dz=b.x-a.x,b.y-a.y
            length=math.hypot(dx,dz)
            if length<1e-6:
                raise ValueError(f'Degenerate corridor tangent at {point}')
            normal=np.array([-dz,dx])/length
            candidates=[]
            scale=10 if field else 100
            for sign in (-1,1):
                ray=LineString([(x,z),np.array([x,z])+60*sign*normal])
                for clearance in (.55,.75,.95):
                    edges=ray.intersection(road.buffer(clearance).boundary)
                    for edge in getattr(edges,'geoms',[edges]):
                        if edge.geom_type!='Point':
                            continue
                        nx,nz=np.rint(np.array(edge.coords[0])*scale)/scale
                        q=Point(nx,nz)
                        if .5<=road.distance(q)<=1 and origin(nx,nz) in tiles:
                            candidates.append((not sidewalk.covers(q),point.distance(q),nx,nz))
            if not candidates:
                raise ValueError(f'No legal lateral position at {point}')
            shoulder,_,nx,nz=min(candidates)
            dest=origin(nx,nz)
            ny=surface.sample(nx,nz,include_peaks=False)[0]
            control=surfaces(dest)[2]
            if not shoulder:
                if control:
                    grid=(control[0]+np.asarray(control[1]).reshape(35,35))/1000
                    ny=max(ny,float(eval_bspline_grid(grid,0,0,np.array([nx-dest[0]]),np.array([nz-dest[1]]))[0]))
                ny+=.195
            value=[round((nx-dest[0])*scale),round((nz-dest[1])*scale)]
            if field:
                anchors[dest][f"{value[0]},{value[1]}"] = round(ny*1000)
            else:
                value.extend((round(ny*10),*trees[i][3:]))
            moves[key].append((field,i,None))
            moves[dest].append((field,None,value))

    for key,edits in moves.items():
        tile=tiles[key]
        file=output/tile['file']
        raw,start,size,collision=read_chunk(file)
        for field in (0,1,4):
            removed={i for k,i,_ in edits if k==field and i is not None}
            inserted=[v for k,_,v in edits if k==field and v is not None]
            if not (removed or inserted):
                continue
            if field:
                collision[1][field]=[v for i,v in enumerate(collision[1][field]) if i not in removed]+inserted
            else:
                path=file.with_suffix('.trees')
                records=TREE.iter_unpack(gzip.decompress(path.read_bytes())) if path.exists() else ()
                kept=[v for i,v in enumerate(records) if i not in removed]
                path.write_bytes(gzip.compress(b''.join(TREE.pack(*v) for v in kept+inserted),mtime=0))
        if key in anchors:
            paths = collision[1]
            while len(paths)<14:
                paths.append(None if len(paths) in (5,11,12,13) else [])
            paths[13] = {**(paths[13] or {}), **anchors[key]}
        write_chunk(file,raw,start,size,collision)
        tile['bytes']=file.stat().st_size
    return {name:sum(k==field and i is not None for edits in moves.values() for k,i,_ in edits)
            for field,name in ((0,'trees'),(1,'lamps'),(4,'stops'))}
