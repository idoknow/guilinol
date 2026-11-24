"""Relocate existing street furniture and vegetation clear of newly paved corridors."""
import base64
import gzip
import json
import math
import struct
import subprocess
import tempfile
from pathlib import Path
import zlib
from collections import defaultdict
from functools import lru_cache

import numpy as np
from shapely import LineString, Point, Polygon, STRtree, box, make_valid, union_all

from common import ll2xz
from surveyed_corridors import read_chunk, write_chunk

TREE = struct.Struct('<HHhBBBBbb')


def footprints(paths, origin, kinds):
    return union_all([make_valid(Polygon(np.asarray(shell)/100+origin,
                         [np.asarray(h)/100+origin for h in holes]))
                      for k,shell,*holes in paths if k in kinds])


def relocate(output, manifest, elements):
    tiles={(t['x'],t['z']):t for t in manifest['chunks']}
    def origin(x,z):
        return (math.floor(x/256)*256,math.floor(z/256)*256)

    @lru_cache(maxsize=48)
    def surfaces(key):
        paths=read_chunk(output/tiles[key]['file'])[3][1]
        return (footprints(paths[0],key,{0,5}), footprints(paths[0],key,{1,4,6}))

    lines=[LineString([ll2xz(p['lat'],p['lon']) for p in w['geometry']])
           for w in elements if w['type']=='way' and w.get('tags',{}).get('highway')
           and (w['tags'].get('layer','0')=='0' or w.get('surfaceUnderlay')) and w['tags'].get('bridge','no')=='no'
           and w.get('geometry') and len(w['geometry'])>1 and all(w['geometry'])]
    axes=STRtree(lines)
    # A paved access junction can retain an old tree from before its
    # resurfacing. Include the travelled lane on both sides of the junction,
    # even where the repaired asphalt overlaps the original footprint.
    access_routes = output / 'vehicle-surface-routes.json'
    routes = json.loads(access_routes.read_text()) if access_routes.exists() else []
    travelled = STRtree([LineString([p[:2] for p in mode['route']]).buffer(1.6)
                         for site in routes for mode in site['modes']
                         if mode['mode']=='car' and len(mode['route'])>1])
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
        access = travelled.query(box(*key,key[0]+256,key[1]+256),predicate='intersects')
        if len(access):
            asphalt = footprints(paths[0][survey['start']:survey['end']],key,{0})
            added = added.union(asphalt.intersection(union_all(travelled.geometries.take(access))))
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
                region=box(key[0]-160,key[1]-160,key[0]+416,key[1]+416)
                blocks=[surfaces(k) for dx in (-256,0,256) for dz in (-256,0,256)
                        if (k:=(key[0]+dx,key[1]+dz)) in tiles]
                nearby=[union_all([b[j].intersection(region) for b in blocks]) for j in (0,1)]
            road,sidewalk=nearby
            candidates=[]
            scale=10 if field else 100
            nearest=axes.nearest(point)
            # A junction can belong to two intersecting carriageways. Keep
            # the station fixed on either axis and use the nearest legal curb.
            road_axes=axes.query(point.buffer(max(3.,lines[nearest].distance(point)+.01)),
                                predicate='intersects')
            for index in road_axes:
                line=lines[index]
                t=line.project(point)
                a,b=line.interpolate(max(0,t-.01)),line.interpolate(min(line.length,t+.01))
                dx,dz=b.x-a.x,b.y-a.y
                length=math.hypot(dx,dz)
                if length<1e-6:
                    continue
                normal=np.array([-dz,dx])/length
                for sign in (-1,1):
                    ray=LineString([(x,z),np.array([x,z])+150*sign*normal])
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
            value=[round((nx-dest[0])*scale),round((nz-dest[1])*scale)]
            if not field:
                value.extend(trees[i][2:])
            moves[key].append((field,i,None))
            moves[dest].append((field,None,value))

    # Sample the same tessellated sidewalks and graded bed used at draw time.
    # Also replant retained trees if their support was rebuilt by this pass.
    positions=[]
    placements=[]
    for key,tile in tiles.items():
        if not tile.get('gradedCorridor') and key not in moves:
            continue
        file=output/tile['file']
        paths=read_chunk(file)[3][1]
        repaired=None
        if tile.get('gradedCorridor'):
            survey=paths[12]
            repaired=footprints(paths[0][survey['start']:survey['end']],key,{0,1}).buffer(1.05)
        edits=moves.get(key,[])
        removed={i for field,i,_ in edits if field==0 and i is not None}
        tree_file=file.with_suffix('.trees')
        if repaired is not None and tree_file.exists():
            for i,row in enumerate(TREE.iter_unpack(gzip.decompress(tree_file.read_bytes()))):
                x,z=key[0]+row[0]/100,key[1]+row[1]/100
                if i not in removed and repaired.covers(Point(x,z)):
                    positions.append([x,z])
                    placements.append((key,0,i,list(row)))
        for field in (1,4):
            removed_indices={i for kind,i,_ in edits if kind==field and i is not None}
            for i,row in enumerate(paths[field]):
                if (i not in removed_indices and len(paths)>13 and paths[13] and
                        f"{row[0]},{row[1]}" in paths[13]):
                    positions.append([key[0]+row[0]/10,key[1]+row[1]/10])
                    placements.append((key,field,i,row))
        for field,i,row in edits:
            if i is None:
                scale=10 if field else 100
                positions.append([key[0]+row[0]/scale,key[1]+row[1]/scale])
                placements.append((key,field,None,row))
    root=Path(__file__).resolve().parents[1]
    retained=defaultdict(dict)
    if positions:
        with tempfile.TemporaryDirectory() as tmp:
            request=Path(tmp)/'props.json'
            request.write_text(json.dumps(dict(manifest=manifest,positions=positions)))
            subprocess.run([root/'node_modules/.bin/tsx',root/'scripts/vehicle-grounding.ts',
                            'prop-heights',output.resolve(),request],cwd=root,check=True)
            heights=json.loads(request.read_text())
        for (key,field,i,row),level in zip(placements,heights,strict=True):
            if field:
                anchors[key][f"{row[0]},{row[1]}"]=round(level*1000)
            elif i is None:
                row[2]=round(level*10)
            elif row[2]!=round(level*10):
                retained[key][i]=round(level*10)
    for key in retained.keys() | anchors.keys():
        moves.setdefault(key,[])
    for key,edits in moves.items():
        tile=tiles[key]
        file=output/tile['file']
        raw,start,size,collision=read_chunk(file)
        for field in (0,1,4):
            removed={i for k,i,_ in edits if k==field and i is not None}
            inserted=[v for k,_,v in edits if k==field and v is not None]
            if not (removed or inserted or (not field and key in retained)):
                continue
            if field:
                collision[1][field]=[v for i,v in enumerate(collision[1][field]) if i not in removed]+inserted
            else:
                path=file.with_suffix('.trees')
                records=TREE.iter_unpack(gzip.decompress(path.read_bytes())) if path.exists() else ()
                kept=[(*v[:2],retained[key].get(i,v[2]),*v[3:]) for i,v in enumerate(records) if i not in removed]
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
