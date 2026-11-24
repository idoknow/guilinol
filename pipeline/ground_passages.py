"""Ground-level passages through the existing tiled building solids."""
import gzip
import json
import math
import struct
from collections import defaultdict

import numpy as np
from shapely.ops import substring
from shapely.affinity import translate
from shapely import LineString, Point, Polygon, STRtree, box, make_valid, union_all

from canal_passages import sample_road_heights
from features import area, building_mesh, points, polygons
from common import xz2ll
from service_streets import rings, width
from surveyed_corridors import read_chunk

YARD = 1565322396
GARAGE = (2937485852, 1493582667)
LONG_PASSAGE = (2515875700, 1112703462)


def passage_road(way):
    # The access road continues through a separate building on the approach
    # to surface junction 14286127223. Use the same footprint and soffit rules.
    return way.get('surfaceUnderlay') or (way['type']=='way' and way['id']==1568445637)


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
    blocked=way.get('yardClosure')
    station=0.
    for i,(a,b) in enumerate(zip(coords,coords[1:])):
        if blocked is not None and a and b:
            length=math.dist(a,b)
            allowed=[(max(lo,station),min(hi,station+length)) for lo,hi in way['openStations']]
            line=LineString([a,b]);station+=length
            for lo,hi in allowed:
                if hi-lo<.01:continue
                p,q=[line.interpolate(d-station+length).coords[0] for d in (lo,hi)]
                ids=[refs[i],refs[i+1]]
                for side,(point,d) in enumerate(((p,lo),(q,hi))):
                    if min(abs(d-bound) for bound in blocked)>.001:continue
                    ids[side]=-3_000_000_000_000-way['id']*2-side
                    dx,dz=np.subtract(b,a)/length
                    curb=LineString([(point[0]-dz*t,point[1]+dx*t) for t in (-paved/2,paved/2)])
                    curbs.append(curb.buffer(.125,cap_style='flat'))
                yield p,q,*ids
            continue
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
    roads=[w for w in elements if passage_road(w) and w['tags']['highway'] not in ('footway','path','pedestrian')]
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


def yard_bypass(way,axis,crossing,half,site,buildings,shared):
    """Try a smooth lateral shift, keeping mapped junctions and both tie-ins."""
    lo,hi=sorted(axis.project(Point(p)) for p in (crossing.coords[0],crossing.coords[-1]))
    begin,end=max(0.,lo-18),min(axis.length,hi+18)
    old={round(axis.project(Point(pt)),6):ref for pt,ref in zip(axis.coords,way['nodes'],strict=True)}
    stations=sorted(set(old)|set(np.linspace(begin,end,math.ceil(end-begin)+1)))
    pts=np.asarray([axis.interpolate(d).coords[0] for d in stations])
    vectors=np.asarray([np.subtract(axis.interpolate(min(axis.length,d+.1)).coords[0],
                                    axis.interpolate(max(0,d-.1)).coords[0]) for d in stations])
    normals=vectors[:,[1,0]]/np.linalg.norm(vectors,axis=1)[:,None];normals[:,0]*=-1
    ds=np.asarray(stations)
    t=np.clip(np.minimum((ds-begin)/max(lo-begin,.01),(end-ds)/max(end-hi,.01)),0,1)
    blend=t**3*(10-15*t+6*t*t)
    if any(blend[j]>.001 and old.get(d) in shared for j,d in enumerate(stations)):return False
    for magnitude in np.arange(.25,6.01,.25):
        for shift in (magnitude,-magnitude):
            moved=pts+normals*(blend*shift)[:,None]
            adjusted=LineString(moved[(ds>=begin)&(ds<=end)]).buffer(half)
            if not site.covers(adjusted) or buildings.intersects(adjusted):continue
            way['nodes']=[old.get(d,-4_000_000_000_000-way['id']*1000-j) for j,d in enumerate(stations)]
            way['geometry']=[dict(zip(('lat','lon'),xz2ll(x,z))) for x,z in moved]
            return True
    return False


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
                if w['id'] in (453854244,453854249):
                    axis=LineString(points(w))
                    half=widths.get(w['id'],width(w['tags']))/2+.5
                    for crossing_part in line_parts(crossing):
                        if crossing_part.length<=40:continue
                        # Distance to the nearest facade is a lower bound even
                        # when translation in *any* direction is permitted.
                        probes=[crossing_part.interpolate(j,normalized=True) for j in np.linspace(0,1,101)]
                        required=max(pt.distance(warehouse.boundary)+half for pt in probes)
                        if required<=6:
                            refs=set(w['nodes'])
                            shared={ref for other in elements if other is not w and other.get('tags',{}).get('highway')
                                    for ref in other.get('nodes',()) if ref in refs}
                            if yard_bypass(w,axis,crossing_part,half,site,union_all([p for _,p in mapped]),shared):
                                break
                        margin=half+.25
                        blocked=next(part for part in line_parts(axis.intersection(warehouse.buffer(margin)))
                                     if part.distance(crossing_part.interpolate(.5,normalized=True))<.01)
                        lo,hi=sorted(axis.project(Point(p)) for p in [blocked.coords[0],blocked.coords[-1]])
                        w['yardClosure']=(lo,hi)
                        w['openStations']=[(0,lo),(hi,axis.length)]
                        w['minimumShift']=required
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


def level_soffits(output, manifest, elements, widths):
    """Include crossfall in the headroom check after paving the approaches."""
    roads=[w for w in elements if passage_road(w) and
           w['tags']['highway'] not in ('footway','path','pedestrian') and w['id'] not in (1025751314,1034716138)]
    axes=STRtree([LineString(points(w)) for w in roads])
    work=[];samples=[]
    for tile in manifest['chunks']:
        x,z=tile['x'],tile['z']
        if not len(axes.query(box(x,z,x+256,z+256))):continue
        rows=read_chunk(output/tile['file'])[3][0]
        origin=np.array([x,z]);updates=[]
        for row in rows:
            if not any(row[9:]) or row[5] in (1551968228%65536,1568418630%65536,1572366586):continue
            poly=footprint(row,origin);start=len(samples)
            for i in axes.query(poly,predicate='intersects'):
                w=roads[i];axis=axes.geometries[i]
                overlap=authorized_overlap(row[5],w['id'],axis.intersection(poly),w.get('warehousePassages'))
                if overlap.length<=1:continue
                half=widths.get(w['id'],width(w['tags']))/2+.5
                for part in line_parts(overlap):
                    n=math.ceil(part.length/.45)
                    for j in range(n+1):
                        d=part.length*j/n;pt=part.interpolate(d)
                        a=part.interpolate(max(0,d-.02));b=part.interpolate(min(part.length,d+.02))
                        dx,dz=b.x-a.x,b.y-a.y;length=math.hypot(dx,dz)
                        if length<.001:continue
                        for side in np.linspace(-half,half,2*math.ceil(half/.45)+1):
                            px,pz=pt.x+dz*side/length,pt.y-dx*side/length
                            if poly.covers(Point(px,pz)):samples.append(dict(x=px,z=pz,pavementOnly=True))
            if len(samples)>start:updates.append((row[5],row[0],row[1],start,len(samples)))
        if updates:work.append((tile,updates))
    if not samples:return
    heights=sample_road_heights(output,manifest,samples)
    for tile,updates in work:
        lifts={}
        for seed,old,top,a,b in updates:
            peak=max((y for y in heights[a:b] if y is not None),default=-math.inf)
            if peak==-math.inf or old/10>=peak+3.54:continue
            ceiling=math.ceil((peak+3.54)*10)
            if ceiling>=top:raise ValueError(f'Passage {seed} cannot meet headroom at pavement edge')
            lifts[seed,old]=max(ceiling,lifts.get((seed,old),old))
        if not lifts:continue
        file=output/tile['file'];raw,start,size,c=read_chunk(file)
        origin=np.array([tile['x'],tile['z']]);parts=[]
        for row in c[0]:
            base,roof,_,kind,floors,seed,anchor,rect,shape,*flags=row
            if any(flags):base=lifts.get((seed,base),base)
            else:roof=lifts.get((seed,roof),roof)
            center=Point(np.asarray(anchor)/100+origin) if anchor else Point(origin-1)
            parts.extend((poly,(base/10,roof/10,kind,floors,seed,center,rect,shape,*flags)) for poly in polygons(footprint(row,origin)))
        write_parts(file,tile,raw,start,size,c,parts,origin)
