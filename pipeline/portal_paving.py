"""Remove upper paving from excavated ramps while retaining enclosed crossings."""
import base64
import gzip
import json
import math
import numpy as np
from shapely import Polygon, STRtree, box, make_valid, set_precision, union_all
from shapely.affinity import translate
from shapely.geometry.polygon import orient
from shapely import constrained_delaunay_triangles
from service_streets import rings
from surveyed_corridors import read_chunk, write_chunk


def openings(tunnels):
    for t in tunnels:
        a,b=t['portals']
        length=t['length']
        dx,dz=(b[0]-a[0])/length,(b[2]-a[2])/length
        widths=t.get('endWidths',[t['halfWidth']]*2)
        for i,run in enumerate(t.get('openEnds',())):
            if run<=.001:continue
            p=(a,b)[i]
            sign=1 if i==0 else -1
            stations=np.linspace(0,run,math.ceil(run/2)+1)
            sides=[[],[]]
            for s in stations:
                f=min(1,s/min(8,length/2))
                width=t['halfWidth']+(widths[i]-t['halfWidth'])*(1-f*f*(3-2*f))
                for j,d in enumerate((-width,width)):
                    sides[j].append((p[0]+sign*dx*s-dz*d,p[2]+sign*dz*s+dx*d))
            yield Polygon(sides[0]+list(reversed(sides[1])))


def clip_top(packed,cut):
    vertices=np.frombuffer(base64.b64decode(packed),'<i4').reshape(-1,3,3)
    kept=[]
    for tri in vertices:
        xyz=tri/1000
        footprint=Polygon(xyz[:,[0,2]])
        if not cut.intersects(footprint):
            kept.append(tri)
        elif footprint.area>1e-8:
            plane=np.linalg.solve(np.column_stack((xyz[:,[0,2]],np.ones(3))),xyz[:,1])
            for piece in constrained_delaunay_triangles(footprint.difference(cut)).geoms:
                kept.append([[round(x*1000),round((plane@[x,z,1])*1000),round(z*1000)]
                             for x,z in list(orient(piece,sign=-1).exterior.coords)[:3]])
    return base64.b64encode(np.asarray(kept,dtype='<i4').tobytes()).decode()


def restore(output, chunks):
    backup = output / 'vehicle-portal-paving-inputs.json.gz'
    if not backup.exists():
        return
    inputs = json.loads(gzip.decompress(backup.read_bytes()))
    for tile in chunks:
        if tile['file'] not in inputs:
            continue
        file = output / tile['file']
        raw, start, size, collision = read_chunk(file)
        paths = collision[1]
        paths[0], lower = inputs[tile['file']]
        if len(paths) > 11 and paths[11]:
            paths[11][0] = lower
        write_chunk(file, raw, start, size, collision)
        tile['bytes'] = file.stat().st_size


def trim(output,chunks,tunnels):
    inputs = {}
    areas=STRtree(list(openings(tunnels)))
    for tile in chunks:
        x,z=tile['x'],tile['z']
        bounds=box(x,z,x+256,z+256)
        hits=areas.query(bounds,predicate='intersects')
        if not len(hits):continue
        cut=set_precision(translate(union_all(areas.geometries.take(hits)).intersection(bounds),-x,-z),.01)
        if cut.area<.001:continue
        file=output/tile['file']
        raw,start,size,collision=read_chunk(file)
        paths=collision[1]
        survey=paths[12] if len(paths)>12 else None
        lower=paths[11] if len(paths)>11 else None
        rebuilt=[];offsets=[]
        for kind,*loops in paths[0]:
            offsets.append(len(rebuilt))
            poly=make_valid(Polygon(np.asarray(loops[0])/100,[np.asarray(h)/100 for h in loops[1:]]))
            if kind in (0,1,4,5,6) and cut.intersects(poly):
                rebuilt.extend(rings(kind,poly.difference(cut)))
            else:
                rebuilt.append([kind,*loops])
        offsets.append(len(rebuilt))
        if rebuilt == paths[0] and not survey:
            continue
        if not tile.get('gradedCorridor'):
            inputs[tile['file']] = [paths[0], lower[0] if lower else None]
        if lower:lower[0]=offsets[lower[0]]
        if survey:
            survey['start']=offsets[survey['start']]
            survey['end']=offsets[survey['end']]
            for key in ('packed','sidewalk'):
                if survey.get(key):survey[key]=clip_top(survey[key],cut)
        paths[0]=rebuilt
        write_chunk(file,raw,start,size,collision)
        tile['bytes']=file.stat().st_size
    (output/'vehicle-portal-paving-inputs.json.gz').write_bytes(gzip.compress(json.dumps(inputs,separators=(',',':')).encode(),mtime=0))
