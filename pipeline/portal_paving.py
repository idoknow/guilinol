"""Remove upper paving from excavated ramps while retaining enclosed crossings."""
import gzip
import json
import math
import numpy as np
from shapely import LineString, Polygon, STRtree, box, make_valid, set_precision, union_all
from shapely.affinity import translate
from common import ll2xz
from vehicle_tunnels import underground
from service_streets import rings, width
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


def trim(output,chunks,tunnels,elements,widths):
    inputs = {}
    areas=STRtree(list(openings(tunnels)))
    protected = []
    for way in elements:
        tags = way.get('tags', {})
        if (way['type'] != 'way' or not tags.get('highway') or underground(tags)
                or not way.get('geometry') or not all(way['geometry'])):
            continue
        axis = LineString([ll2xz(p['lat'], p['lon']) for p in way['geometry']])
        radius = widths.get(way['id'], width(tags)) / 2 + .5
        if len(areas.query(axis.buffer(radius, quad_segs=2))):
            protected.append(axis.buffer(radius))
    surface_roads = STRtree(protected)
    for tile in chunks:
        x,z=tile['x'],tile['z']
        bounds=box(x,z,x+256,z+256)
        hits=areas.query(bounds,predicate='intersects')
        if not len(hits):continue
        opening = union_all(areas.geometries.take(hits)).intersection(bounds)
        upper = surface_roads.query(opening, predicate='intersects')
        if len(upper):
            opening = opening.difference(union_all(surface_roads.geometries.take(upper)))
        cut=set_precision(translate(opening,-x,-z),.01)
        if cut.area<.001:continue
        file=output/tile['file']
        raw,start,size,collision=read_chunk(file)
        paths=collision[1]
        survey=paths[12] if len(paths)>12 else None
        lower=paths[11] if len(paths)>11 else None
        rebuilt=[];offsets=[]
        for index,(kind,*loops) in enumerate(paths[0]):
            offsets.append(len(rebuilt))
            poly=make_valid(Polygon(np.asarray(loops[0])/100,[np.asarray(h)/100 for h in loops[1:]]))
            # A surveyed approach already meets the designed floor. Keep
            # its triangles and path labels across the portal seam.
            surveyed = survey and survey['start'] <= index < survey['end']
            if not surveyed and kind in (0,1,4,5,6) and cut.intersects(poly):
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
        paths[0]=rebuilt
        write_chunk(file,raw,start,size,collision)
        tile['bytes']=file.stat().st_size
    (output/'vehicle-portal-paving-inputs.json.gz').write_bytes(gzip.compress(json.dumps(inputs,separators=(',',':')).encode(),mtime=0))
