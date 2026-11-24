"""Rebuild surveyed surface-road intervals against the tile's graded road spline."""
import base64
import zlib
import gzip
import json
import math
import struct
from collections import defaultdict
from scipy.spatial import Delaunay
from pathlib import Path

import numpy as np
from shapely import (LineString, Point, Polygon, STRtree, box, constrained_delaunay_triangles,
                     make_valid, set_precision, union_all)
from shapely.affinity import translate
from shapely.geometry.polygon import orient
from shapely.ops import substring

from common import ll2xz
from features import polygons
from road_grading import eval_bspline_grid
from service_streets import rings, width


def read_chunk(file):
    raw=gzip.decompress(file.read_bytes())
    n,k,size=struct.unpack_from('<3I',raw,4)
    start=24+16900+9*n+4*k
    return raw,start,size,json.loads(raw[start:start+size])


def write_chunk(file,raw,start,size,collision):
    data=json.dumps(collision,separators=(',',':')).encode()
    file.write_bytes(gzip.compress(raw[:12]+struct.pack('<I',len(data))+raw[16:start]+data+raw[start+size:],compresslevel=5,mtime=0))


def restore(output,chunks):
    # Restore the input roads before surveying mouth heights on repeat builds.
    # Only bake-owned road fields are restored. Other GL04 extensions can be
    # rebaked (including railway geometry) independently.
    for tile in chunks:
        if not tile.pop('gradedCorridor',False):
            continue
        file=output/tile['file']
        raw,start,size,collision=read_chunk(file)
        paths=collision[1]
        previous=paths[12]['input']
        original=json.loads(zlib.decompress(base64.b64decode(previous)))
        paths[0]=original['paths']
        if len(paths)>11 and paths[11]:
            paths[11][0]=original['lower']
        anchors = paths[13] if len(paths)>13 else None
        del paths[original['length']:]
        if anchors:
            while len(paths)<14:
                paths.append(None if len(paths) in (5,11,12,13) else [])
            paths[12] = None
            paths[13] = anchors
        collision[7]=original['bed']
        write_chunk(file,raw,start,size,collision)
        tile['bytes']=file.stat().st_size


def channel_spans(elements, widths):
    """Preserve the existing bed and banks between each bridge's abutments."""
    streams=[]
    spans=[]
    for way in elements:
        if way['type']!='way' or len(way.get('geometry',()))<2 or not all(way['geometry']):
            continue
        tags=way.get('tags',{})
        bridge=tags.get('highway') and tags.get('bridge','no')!='no'
        if not bridge and not tags.get('waterway'):
            continue
        axis=LineString([ll2xz(p['lat'],p['lon']) for p in way['geometry']])
        if bridge:
            spans.append((axis,widths.get(way['id'],width(tags))/2+.5))
        else:
            streams.append(axis)
    water=STRtree(streams)
    # The packed road and deck quantize their edges independently to cm.
    # Overlap the lip by 3 cm at each abutment to keep the pavement closed.
    return STRtree([substring(axis,.03,axis.length-.03).buffer(half,cap_style='flat')
                    for axis,half in spans if axis.length>.06
                    and len(water.query(axis,predicate='intersects'))])


def bake(output, chunks, elements, widths, approaches=(), only_approaches=False, bridge_profiles=()):
    intervals = json.loads(Path(__file__).with_name('road-corridor-survey.json').read_text())
    shapes, footpaths, passage_roads = [], [], []
    for way in elements:
        spans = intervals.get(str(way['id']))
        if way.get('surfaceUnderlay'):
            spans = [(0, math.inf)]
        if way['type'] != 'way' or not spans or not all(way['geometry']):
            continue
        axis = LineString([ll2xz(p['lat'], p['lon']) for p in way['geometry']])
        tags = way['tags']
        paved = widths.get(way['id'], width(tags))
        if tags['highway'] == 'residential' and 'width' not in tags:
            paved = widths.get(way['id'], 6.5)
        for start, end in spans:
            if start < axis.length:
                part=substring(axis,start,min(end,axis.length))
                corridor = part.buffer(paved/2+.5,quad_segs=4)
                shapes.append(corridor)
                if way.get('surfaceUnderlay') and tags['highway'] not in ('path','footway','pedestrian'):
                    passage_roads.append((part,corridor,way['id'],way.get('warehousePassages'),paved/2+.5))
                if way.get('surfaceUnderlay') and tags['highway'] in ('footway','path','pedestrian'):
                    footpaths.append(corridor)
    fixed_grades = {id(row[0]) for row in bridge_profiles}
    grades=STRtree([line.buffer(half,quad_segs=4) for line,half,*_ in approaches])
    tree = STRtree(shapes)
    pedestrian = STRtree(footpaths)
    channels = channel_spans(elements,widths)
    passage_index=STRtree([r[0] for r in passage_roads])
    for tile in chunks:
        x, z = tile['x'], tile['z']
        bounds = box(x,z,x+256,z+256)
        hits = tree.query(bounds, predicate='intersects')
        nearby=grades.query(bounds,predicate='intersects')
        if (only_approaches and not len(nearby)) or not (len(hits) or len(nearby)):
            continue
        area = union_all([shapes[i].intersection(bounds) for i in hits]+
                         [grades.geometries[i].intersection(bounds) for i in nearby])
        protected=channels.query(area,predicate='intersects')
        seam=None
        if len(protected):
            span=union_all(channels.geometries.take(protected))
            area=union_all(list(polygons(area.difference(span))))
            seam=translate(span,-x,-z).boundary.buffer(.025)
        area = set_precision(translate(area, -x, -z), .01)
        area=union_all(list(polygons(area)))
        if area.area > .01:
            local=[(translate(approaches[i][0],-x,-z),*approaches[i][1:]) for i in nearby]
            foot = [translate(footpaths[i],-x,-z) for i in pedestrian.query(bounds,predicate='intersects')]
            crossings=[(translate(passage_roads[i][0],-x,-z),translate(passage_roads[i][1],-x,-z),passage_roads[i][2],
                        translate(passage_roads[i][3],-x,-z) if passage_roads[i][3] is not None else None,passage_roads[i][4])
                       for i in passage_index.query(bounds,predicate='intersects')]
            fixed = {j for j,i in enumerate(nearby) if id(approaches[i][0]) in fixed_grades}
            if patch(output/tile['file'], area, local, foot, seam,crossings,fixed):
                tile['gradedCorridor']=True
            tile['bytes'] = (output/tile['file']).stat().st_size


def patch(file, area, approaches=(), foot=(), seam=None, crossings=(), fixed=()):
    raw = gzip.decompress(file.read_bytes())
    n, k, size, image, deck = struct.unpack_from('<5I', raw, 4)
    start = 24+16900+9*n+4*k
    collision = json.loads(raw[start:start+size])
    paths = collision[1]
    old=paths[12] if len(paths)>12 else None
    if old and isinstance(old,dict) and 'input' in old:
        previous=old['input']
        original=json.loads(zlib.decompress(base64.b64decode(previous)))
    else:
        original=dict(paths=paths[0],lower=paths[11][0] if len(paths)>11 and paths[11] else None,
                      length=len(paths),bed=collision[7] if len(collision)>7 else None)
        previous=base64.b64encode(zlib.compress(json.dumps(original,separators=(',',':')).encode())).decode()
    lower = paths[11] if len(paths)>11 else None
    boundary = lower[0] if lower else len(paths[0])
    # Survey buffers can extend past an existing building facade at the
    # roadside. Keep that occupied ground while preserving mapped passages.
    from ground_passages import authorized_overlap
    obstacles=[]
    for row in collision[0]:
        loops=row[2]
        if not loops or len(loops[0])<3 or any(row[9:]):continue
        poly=make_valid(Polygon(np.asarray(loops[0])/100,[np.asarray(r)/100 for r in loops[1:]]))
        cuts=[]
        for axis,corridor,wid,warehouse,half in crossings:
            overlap=authorized_overlap(row[5],wid,axis.intersection(poly),warehouse)
            if overlap.length>1:
                cuts.append(overlap.buffer(half) if warehouse is not None and row[5]==21813141 else corridor)
        obstacles.append(poly.difference(union_all(cuts)) if cuts else poly)
    solids=union_all(obstacles)
    if not solids.is_empty and solids.intersects(area):
        existing_roads=union_all([make_valid(Polygon(np.asarray(shell)/100,[np.asarray(h)/100 for h in holes]))
                                  for kind,shell,*holes in original['paths'] if kind in (0,5)])
        # The exposed bed stops short of its retaining edge. Carry the asphalt
        # under the facade lip so it meets the wall at street level.
        area=set_precision(area.difference(solids.buffer(-.06).difference(existing_roads)),.01)
        area=union_all(list(polygons(area)))
        if area.is_empty:
            return False
    rebuilt = []
    for kind, *loops in paths[0][:boundary]:
        shape = make_valid(Polygon(np.asarray(loops[0])/100, [np.asarray(r)/100 for r in loops[1:]]))
        if kind in (0,1,4,5,6) and area.intersects(shape):
            remainder=shape.difference(area)
            for poly in polygons(remainder):
                if kind==0 and poly.interiors:
                    for triangle in constrained_delaunay_triangles(poly).geoms:
                        rebuilt.extend(rings(kind,triangle))
                else:
                    rebuilt.extend(rings(kind,poly))
        else:
            rebuilt.append([kind,*loops])
    survey_start = len(rebuilt)
    # Keep a narrow exposed bed between the rim of the driving surface and
    # the outside retaining wall. At a tile seam the road must remain joined.
    exterior=area.boundary.difference(box(0,0,256,256).boundary)
    if seam is not None:
        exterior=exterior.difference(seam)
    top_area=area.difference(exterior.buffer(.04,quad_segs=2))
    walk=union_all([*foot, *(line.buffer(half,quad_segs=4) for line,half,*_,kind in approaches if kind==1)])
    motor=union_all([line.buffer(half,quad_segs=4) for line,half,*_,kind in approaches if kind==0])
    walk=union_all(list(polygons(set_precision(walk.difference(motor).intersection(area),.01))))
    top_area=union_all(list(polygons(top_area)))
    for kind,polygon in [(k,p) for k,g in [(0,top_area.difference(walk)),(1,top_area.intersection(walk))] for p in polygons(g)]:
        xmin,zmin,xmax,zmax=polygon.bounds
        for x in range(math.floor(xmin/16)*16,math.ceil(xmax/16)*16,16):
            for z in range(math.floor(zmin/16)*16,math.ceil(zmax/16)*16,16):
                rebuilt.extend(rings(kind,polygon.intersection(box(x,z,x+16,z+16))))
    survey_end = len(rebuilt)
    if lower:
        lower[0] = len(rebuilt)
    paths[0] = rebuilt + paths[0][boundary:]
    tail = start+size+image+18*deck
    terrain = np.frombuffer(raw,'<i2',4225,tail if len(raw)>tail else 24).reshape(65,65)/10
    wet = np.frombuffer(raw,'<i2',4225,8474).reshape(65,65) != -32768
    step = 4 if wet.any() else 8
    for line, water in ((terrain[0],wet[0]),(terrain[-1],wet[-1]),(terrain[:,0],wet[:,0]),(terrain[:,-1],wet[:,-1])):
        if not water.any():
            line[:] = np.interp(np.arange(65),np.arange(0,65,8),line[::8])
    control = paths[5] if len(paths)>5 else None
    ctrl = ((control[0]+np.asarray(control[1]).reshape(35,35))/1000 if control else
            np.pad(terrain[::2,::2],1,mode='edge'))
    old_bed=original['bed'] or {}
    old_faces=set(old_bed.get('drop',()))
    vertices, drop, paved, spline = [], [], [], []
    knots=defaultdict(set)
    anchors=set()
    for line,half,ya,yb,cap,_ in approaches:
        (ax,az),(bx,bz)=line.coords
        anchors.update(((round(ax,4),round(az,4)),(round(bx,4),round(bz,4))))
        dx,dz=(bx-ax)/line.length,(bz-az)/line.length
        blend=max(0,min(.12,1-abs(yb-ya)/(cap*line.length)))
        run=blend*line.length
        distances=np.linspace(0,run,math.ceil(run/2)+1)
        for distance in {*distances,*(line.length-distances)}:
            for side in (-half+.02,0,half-.02):
                x,z=ax+dx*distance-dz*side,az+dz*distance+dx*side
                knots[int(z//step),int(x//step)].add((round(x,4),round(z,4)))
    top_edge=top_area.boundary
    walked=set()
    rim=[]
    visited = set()
    for piece in polygons(area):
        xmin,zmin,xmax,zmax = piece.bounds
        for row in range(int(zmin//step),min(256//step,math.ceil(zmax/step))):
            for col in range(int(xmin//step),min(256//step,math.ceil(xmax/step))):
                if (row,col) in visited:
                    continue
                visited.add((row,col))
                x,z=col*step,row*step
                a,b,c,d=(x,z),(x,z+step),(x+step,z+step),(x+step,z)
                for face,corners in enumerate(((a,b,d),(b,c,d))):
                    cell = Polygon(corners)
                    inside = cell.intersection(area)
                    if inside.area < 1e-8:
                        continue
                    face_id=2*(row*(256//step)+col)+face
                    drop.append(face_id)
                    plane=np.linalg.solve([[u,v,1] for u,v in corners],[terrain[v//4,u//4] for u,v in corners])
                    def vertex(u,v,graded):
                        if graded:
                            spline.append(len(vertices))
                        vertices.append([round(u,4),0 if graded else round(float(plane@[u,v,1]),4),round(v,4)])
                    top=inside.intersection(top_area)
                    pieces=[(top.difference(walk),True,False,True),(top.intersection(walk),True,True,True)] if not walk.is_empty else [(top,True,False,True)]
                    pieces.append((inside.difference(top_area),True,False,False))
                    if face_id not in old_faces:
                        pieces.append((cell.difference(area),False,False,False))
                    for geom, graded, pedestrian, road_face in pieces:
                        for tri in constrained_delaunay_triangles(geom).geoms:
                            corners=list(orient(tri,sign=-1).exterior.coords)[:3]
                            interior=[point for point in sorted(knots.get((row,col),()))
                                      if graded and tri.contains(Point(point)) and (point in anchors or tri.boundary.distance(Point(point))>.15)]
                            if interior:
                                coords=np.array(corners+interior)
                                faces=[]
                                for ids in Delaunay(coords).simplices:
                                    a,b,c=coords[ids]
                                    if (b[1]-a[1])*(c[0]-a[0])<(b[0]-a[0])*(c[1]-a[1]):
                                        b,c=c,b
                                    faces.append((a,b,c))
                            else:
                                faces=[corners]
                            for points in faces:
                                if road_face:
                                    if pedestrian:
                                        walked.add(len(vertices)//3)
                                    paved.append(len(vertices)//3)
                                    for j,(u,v) in enumerate(points):
                                        s,t=points[(j+1)%3]
                                        if ((u==s and u in (0,256)) or (v==t and v in (0,256))):
                                            continue
                                        if top_edge.distance(Point((u+s)/2,(v+t)/2))<1e-7:
                                            rim.append((len(vertices)+j,len(vertices)+(j+1)%3))
                                for u,v in points:
                                    vertex(u,v,graded)
                    edge = cell.intersection(area.boundary)
                    for line in getattr(edge,'geoms',[edge]):
                        if line.geom_type != 'LineString':
                            continue
                        for (u,v),(s,t) in zip(line.coords,list(line.coords)[1:]):
                            if (u==s and u in (0,256)) or (v==t and v in (0,256)):
                                continue
                            for point in ((u,v,True),(u,v,False),(s,t,True),(s,t,True),(u,v,False),(s,t,False)):
                                vertex(*point)
    if not paved:
        return
    xy = np.asarray([vertices[i] for i in spline])
    levels = eval_bspline_grid(ctrl,0,0,xy[:,0],xy[:,2])-.006
    # Interpolate physical road and bed together. Select the closest axis in
    # overlapping junction areas, with a shared constrained level at each node.
    distance=np.full(len(levels),np.inf)
    owner=np.full(len(levels),-1,dtype=int)
    ends=defaultdict(set)
    data=[]
    for i,(line,half,ya,yb,cap,_) in enumerate(approaches):
        (ax,az),(bx,bz)=line.coords
        for x,z in line.coords:ends[round(x,2),round(z,2)].add(i)
        dx,dz=bx-ax,bz-az
        t=np.clip(((xy[:,0]-ax)*dx+(xy[:,2]-az)*dz)/line.length**2,0,1)
        d=np.hypot(xy[:,0]-ax-t*dx,xy[:,2]-az-t*dz)
        select=(d<=half+.01)&(d<distance)
        blend=max(0,min(.12,1-abs(yb-ya)/(cap*line.length)))
        if blend>1e-6:
            f=np.where(t<blend,t*t/(2*blend),np.where(t>1-blend,1-blend-(1-t)**2/(2*blend),t-blend/2))/(1-blend)
        else:f=t
        target=ya+(yb-ya)*f-.051
        levels[select]=target[select]
        owner[select]=i
        distance[select]=d[select]
        data.append((d,target))
    ceiling=np.full(len(levels),np.inf)
    # Surveyed bridge approaches must keep the abutment profile across
    # their full width, including the end caps shared with a turning road.
    bridge_approach=np.zeros(len(levels),dtype=bool)
    for i in fixed:
        bridge_approach |= data[i][0] <= approaches[i][1] + 2
    for i,((line,half,_,__,cap,kind),(d,target)) in enumerate(zip(approaches,data,strict=True)):
        neighbors=set.union(*(ends[round(x,2),round(z,2)] for x,z in line.coords))-{i}
        connected=np.isin(owner,list(neighbors))
        outside=np.maximum(0,d-half)
        # A connected uphill branch starts rising at the shared centreline.
        # Holding it flat across the entire round end cap creates a step at
        # the cap edge. Propagate the grade continuously through the junction.
        limit=np.where(connected,target+cap*d+.04*outside**2,
                       target+cap*outside+.04*outside**2)
        original=np.where(outside<=.5,target+cap*outside,np.inf)
        limit=np.where(bridge_approach & (owner>=0),original,limit)
        ceiling=np.minimum(ceiling,limit)
    levels=np.minimum(levels,ceiling)
    for i,y in zip(spline,levels):
        vertices[i][1] = round(float(y),4)
    # Encode in millimetres. The worker draws the exact same triangles 51 mm
    # above the bed, independent of the two meshes' tessellation.
    tops = [[round(u*1000),round(y*1000)+51,round(v*1000)] for t in paved for u,y,v in vertices[3*t:3*t+3]]
    sidewalks=[pt for i,t in enumerate(paved) if t in walked for pt in tops[3*i:3*i+3]]
    tops=[pt for i,t in enumerate(paved) if t not in walked for pt in tops[3*i:3*i+3]]
    # Close the visible 51 mm rim between the asphalt and the retaining face.
    skirts=[]
    for i,j in rim:
        a,b=([round(v*1000) for v in vertices[k]] for k in (i,j))
        at=[a[0],a[1]+51,a[2]];bt=[b[0],b[1]+51,b[2]]
        skirts.extend((at,a,bt,bt,a,b))
    while len(paths)<13:
        paths.append(None if len(paths) in (5,11,12) else [])
    paths[12] = dict(start=survey_start,end=survey_end,packed=base64.b64encode(np.asarray(tops,dtype="<i4").tobytes()).decode(),input=previous)
    for name,points in [('sidewalk',sidewalks),('skirt',skirts)]:
        if points:
            paths[12][name]=base64.b64encode(np.asarray(points,dtype='<i4').tobytes()).decode()
    while len(collision)<8:
        collision.append([])
    if isinstance(collision[4],dict) and 'drop' in collision[4]:
        collision[4] = []
    if old_bed:
        old_vertices=(np.frombuffer(base64.b64decode(old_bed['packed']),'<i4').reshape(-1,3)/10000
                      if old_bed.get('packed') else np.asarray(old_bed['vertices']))
        if old_faces.intersection(drop):
            for triangle in old_vertices.reshape(-1,3,3):
                footprint=Polygon(triangle[:,[0,2]])
                if not footprint.intersects(area):
                    vertices.extend(triangle.tolist())
                elif footprint.area>1e-9:
                    plane=np.linalg.solve(np.column_stack((triangle[:,[0,2]],np.ones(3))),triangle[:,1])
                    for part in constrained_delaunay_triangles(footprint.difference(area)).geoms:
                        for u,v in list(orient(part,sign=-1).exterior.coords)[:3]:
                            vertices.append([u,float(plane@[u,v,1]),v])
                else:
                    # Clip a vertical retaining face in its own (distance,y) plane.
                    xy=triangle[:,[0,2]]
                    a,b=max(((a,b) for a in xy for b in xy),key=lambda ab:np.linalg.norm(ab[0]-ab[1]))
                    span=np.linalg.norm(b-a)
                    if span<1e-8:
                        continue
                    outside=LineString([a,b]).difference(area)
                    axis=(b-a)/span
                    profile=Polygon([((xz-a)@axis,h) for xz,h in zip(xy,triangle[:,1])])
                    for line in getattr(outside,'geoms',[outside]):
                        if line.is_empty or line.geom_type!='LineString':
                            continue
                        limits=sorted((np.asarray(pt)-a)@axis for pt in (line.coords[0],line.coords[-1]))
                        clipped=profile.intersection(box(limits[0],triangle[:,1].min()-1,
                                                         limits[-1],triangle[:,1].max()+1))
                        for part in constrained_delaunay_triangles(clipped).geoms:
                            for t,h in list(part.exterior.coords)[:3]:
                                u,v=a+t*axis
                                vertices.append([u,h,v])
        else:
            vertices.extend(old_vertices.tolist())
        drop=sorted(old_faces.union(drop))
    positions=np.rint(np.asarray(vertices)*10000).astype("<i4")
    collision[7] = dict(drop=drop,packed=base64.b64encode(positions.tobytes()).decode())
    write_chunk(file,raw,start,size,collision)
    return True
