"""Ground-level passages through the existing tiled building solids."""
import gzip
import json
import math
import struct
from collections import defaultdict

import numpy as np
from shapely.affinity import translate
from shapely import LineString, Point, Polygon, STRtree, box, make_valid, union_all

from canal_passages import sample_road_heights
from features import area, building_mesh, points, polygons
from service_streets import rings, width
from surveyed_corridors import read_chunk

YARD = 1565322396
GARAGE = (2937485852, 1493582667)
LONG_PASSAGE = (2515875700, 1112703462)


def opens_road(seed, way, length):
    pair=(seed,way)
    return seed!=YARD and pair!=GARAGE and length>1 and (length<=40 or pair==LONG_PASSAGE)


def authorized_overlap(seed, wid, overlap, warehouse_roads):
    if seed==21813141 and warehouse_roads is not None:
        return overlap.intersection(warehouse_roads.buffer(.01))
    return overlap if opens_road(seed,wid,overlap.length) else LineString()


def footprint(row, origin):
    shell,*holes = [np.asarray(ring)/100+origin for ring in row[2]]
    return make_valid(Polygon(shell,holes))


def line_parts(shape):
    if shape.geom_type=='LineString' and shape.length:
        yield shape
    elif hasattr(shape,'geoms'):
        for part in shape.geoms:
            yield from line_parts(part)


def garage_boundary(output, chunks, elements):
    street=next((w for w in elements if w['type']=='way' and w['id']==GARAGE[1]),None)
    if street is None:
        return Polygon()
    axis=LineString(points(street))
    walls=[]
    for t in chunks:
        x,z=t['x'],t['z']
        if axis.intersects(box(x,z,x+256,z+256)):
            walls.extend(footprint(r,np.array([x,z])) for r in read_chunk(output/t['file'])[3][0] if r[5]==GARAGE[0])
    return union_all(walls)


def open_segments(way, coords, obstacle, curbs, paved):
    refs=way['nodes']
    for i,(a,b) in enumerate(zip(coords,coords[1:])):
        if way['id']!=GARAGE[1] or not a or not b or obstacle.is_empty:
            yield a,b,refs[i],refs[i+1]
            continue
        line=LineString([a,b])
        if not line.length:continue
        dx,dz=np.subtract(b,a)/line.length
        for part in line_parts(line.difference(obstacle.buffer(.25))):
            p,q=part.coords[0],part.coords[-1]
            if part.length<.5:continue
            ids=[]
            for side,point in enumerate((p,q)):
                if math.dist(point,a)<.001:ids.append(refs[i])
                elif math.dist(point,b)<.001:ids.append(refs[i+1])
                else:
                    ids.append(-2_000_000_000_000-i*2-side)
                    curb=LineString([(point[0]-dz*t,point[1]+dx*t) for t in (-paved/2,paved/2)])
                    curbs.append(curb.buffer(.125,cap_style='flat'))
            yield p,q,*ids


def bake(output, manifest, elements, widths, curbs):
    roads=[w for w in elements if w.get('surfaceUnderlay') and w['tags']['highway'] not in ('footway','path','pedestrian')]
    axes=STRtree([LineString(points(w)) for w in roads])
    requests=[]
    tiles=[]
    for tile in manifest['chunks']:
        x,z=tile['x'],tile['z']
        bounds=box(x,z,x+256,z+256)
        hits=axes.query(bounds,predicate='intersects')
        caps=[q.intersection(bounds) for q in curbs if q.intersects(bounds)]
        if not len(hits) and not caps:continue
        file=output/tile['file']
        origin=np.array([x,z])
        rows=read_chunk(file)[3][0]
        changes=defaultdict(list)
        for index,row in enumerate(rows):
            if row[5]==YARD or any(row[9:]):continue
            poly=footprint(row,origin)
            for i in hits:
                axis=axes.geometries[i]; way=roads[i]
                overlap=authorized_overlap(row[5],way['id'],axis.intersection(poly),way.get('warehousePassages'))
                if overlap.length<=1:continue
                half=widths.get(way['id'],width(way['tags']))/2+.5
                corridor=overlap.buffer(half) if row[5]==21813141 else axis.buffer(half)
                start=len(requests)
                for part in line_parts(overlap):
                    n=math.ceil(part.length/.5)
                    for j in range(n+1):
                        p=part.interpolate(j/n,normalized=True)
                        requests.append(dict(x=p.x,z=p.y))
                if len(requests)>start:changes[index].append((corridor,start,len(requests)))
        if changes or caps:tiles.append((tile,changes,caps))
    levels=sample_road_heights(output,manifest,requests) if requests else []
    for tile,changes,caps in tiles:
        file=output/tile['file'];origin=np.array([tile['x'],tile['z']])
        raw,start,size,collision=read_chunk(file)
        parts=[]
        for index,row in enumerate(collision[0]):
            base,roof,_,kind,floors,seed,anchor,rect,shape,*flags=row
            poly=footprint(row,origin)
            center=Point(np.asarray(anchor)/100+origin) if anchor else Point(origin-1)
            attrs=(kind,floors,seed,center,rect,shape)
            base,roof=base/10,roof/10
            openings=[]; cuts=[]; highest=-math.inf
            for corridor,a,b in changes.get(index,[]):
                road=max(levels[a:b])
                if roof-road<4:
                    cuts.append(corridor)
                else:
                    highest=max(highest,road)
                    openings.append(corridor)
            if cuts:poly=poly.difference(union_all(cuts))
            if openings:
                soffit=math.ceil((highest+3.51)*10)/10
                parts.extend((p,(soffit,roof,*attrs,True)) for p in polygons(poly))
                poly=poly.difference(union_all(openings))
                # Upper floor retains roof decorations. The wings share its facade.
                roof=soffit; attrs=(kind,1,seed,Point(origin-1),[],shape)
            parts.extend((p,(base,roof,*attrs,*flags)) for p in polygons(poly))
        paths=collision[1]
        for cap in caps:
            for row in rings(1,translate(cap,-origin[0],-origin[1])):
                lower=paths[11] if len(paths)>11 else None
                at=lower[0] if lower else len(paths[0])
                if row not in paths[0]:
                    paths[0].insert(at,row)
                    if lower:lower[0]+=1
        write_parts(file,tile,raw,start,size,collision,parts,origin)


def write_parts(file,tile,raw,start,size,collision,parts,origin):
    vertices,normals,indices,collision[0]=building_mesh(parts,origin)
    packed=json.dumps(collision,separators=(',',':')).encode()
    header=struct.pack('<4s5I',raw[:4],len(vertices)//6,len(indices)//4,len(packed),*struct.unpack_from('<2I',raw,16))
    file.write_bytes(gzip.compress(header+raw[24:16924]+vertices+normals+indices+packed+raw[start+size:],mtime=0))
    tile['bytes']=file.stat().st_size


YARD_ROADS = {453854241,453854242,453854243,453854244,453854245,453854246,453854248,453854249,453854250}


def grain_yard(output,manifest,elements,widths):
    site_way=next((w for w in elements if w['type']=='way' and w['id']==985684873),None)
    if site_way is None:return
    site=area(site_way)
    if not any(site.intersects(box(t['x'],t['z'],t['x']+256,t['z']+256)) for t in manifest['chunks']):return
    mapped=[]
    for way in elements:
        if way['type']=='node' or not way.get('tags',{}).get('building'):continue
        for poly in polygons(area(way)):
            if site.covers(poly.representative_point()):
                mapped.append((way,poly))
    warehouse=next((p for w,p in mapped if w['id']==21813141),None)
    if warehouse is not None:
        for w in elements:
            if w['type']=='way' and w['id'] in YARD_ROADS:
                crossing=LineString(points(w)).intersection(warehouse)
                w['warehousePassages']=union_all([part for part in line_parts(crossing) if part.length<=40])
    levels=sample_road_heights(output,manifest,[dict(x=p.representative_point().x,z=p.representative_point().y) for _,p in mapped])
    roads=union_all([LineString(points(w)).buffer(widths.get(w['id'],width(w['tags']))/2+.5)
                     for w in elements if w['type']=='way' and w['id'] in YARD_ROADS])
    structures=union_all([p for _,p in mapped])
    pavement=site.difference(structures.union(roads).buffer(.02))
    for tile in manifest['chunks']:
        x,z=tile['x'],tile['z'];bounds=box(x,z,x+256,z+256)
        if not site.intersects(bounds) and not structures.intersects(bounds):continue
        file=output/tile['file'];origin=np.array([x,z])
        raw,start,size,c=read_chunk(file);parts=[]
        for row in c[0]:
            poly=footprint(row,origin)
            if row[5]==YARD or site.covers(poly.representative_point()) or structures.intersection(poly).area>.8*poly.area:
                continue
            base,roof,_,kind,floors,seed,anchor,rect,shape,*flags=row
            center=Point(np.array(anchor)/100+origin) if anchor else Point(origin-1)
            parts.extend((p,(base/10,roof/10,kind,floors,seed,center,rect,shape,*flags)) for p in polygons(poly))
        for (way,poly),base in zip(mapped,levels,strict=True):
            tags=way['tags'];raised=tags['building']=='roof'
            floors=int(tags.get('building:levels',2 if tags['building']=='warehouse' else 3))
            roof=base+floors*3.1
            for p in polygons(poly.intersection(bounds)):
                if p.area>.01:parts.append((p,(roof-.35 if raised else base,roof,0,floors,way['id'],poly.representative_point(),[],False,raised)))
        paths=c[1];existing=union_all([make_valid(Polygon(np.asarray(r[1])/100,[np.asarray(h)/100 for h in r[2:]]))
                                       for r in paths[0] if len(r[1])>=3])
        fill=translate(pavement.intersection(bounds),-x,-z).difference(existing.buffer(.02))
        for row in rings(4,fill):
            lower=paths[11] if len(paths)>11 else None
            at=lower[0] if lower else len(paths[0])
            paths[0].insert(at,row)
            if lower:lower[0]+=1
        write_parts(file,tile,raw,start,size,c,parts,origin)
