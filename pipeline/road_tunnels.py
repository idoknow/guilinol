"""Bake the approved Wuling alignment. Stations and offsets are in metres."""
import math

import numpy as np

from common import ll2xz, load_osm


def profile(station, length):
    def transition(distance):
        return (np.maximum(distance,0)**2-np.maximum(distance-8,0)**2
                -np.maximum(distance-78,0)**2+np.maximum(distance-86,0)**2)/16
    return 266.3-2.2*station/length-.034*transition(np.minimum(station,length-station))


def bake(bounds, fields, left, top, grid):
    from shapely.geometry import LineString
    way = next((item for item in load_osm() if item['type']=='way' and item['id']==237985762),None)
    if not way:
        return []
    coords = [ll2xz(point['lat'],point['lon']) for point in way['geometry']]
    if not bounds.covers(LineString(coords)):
        return []
    if len(coords)!=2 or way['tags'].get('tunnel')!='yes':
        raise ValueError('Recheck the Wuling alignment and estimated profile')
    start, end = np.array(coords)
    length = float(np.linalg.norm(end-start))
    direction = (end-start)/length
    normal = np.array([-direction[1],direction[0]])
    cols, rows = [np.arange(math.floor((min(start[axis],end[axis])-30-base)/grid),
                            math.ceil((max(start[axis],end[axis])+30-base)/grid)+1)
                  for axis,base in enumerate((left,top))]
    east, south = np.meshgrid(cols*grid+left-start[0],rows*grid+top-start[1])
    station = east*direction[0]+south*direction[1]
    offset = east*normal[0]+south*normal[1]
    def smooth(value):
        unit = np.clip(value,0,1)
        return unit*unit*(3-2*unit)
    lift = np.rint(19*smooth((19-np.abs(offset))/8)*smooth((station-20)/13)*smooth((80-station)/20)).astype('i2')
    for field in fields:
        field[np.ix_(rows,cols)] += lift
    stations = sorted({0.,8.,30.,78.,86.,length-86,length-78,length-30,length-8,length,*np.arange(4.,length,4.)})
    return [dict(way=way['id'],profile_source='estimated',portals=[[float(start[0]),266.3,float(start[1])],
                [float(end[0]),264.1,float(end[1])]],length=length,halfWidth=6.,clearance=5.1,approach=30.,
                stations=[[float(distance),round(float(profile(distance,length)),5)] for distance in stations],
                fill=dict(maxMeters=float(lift.max())/10,gridVertices=int(np.count_nonzero(lift)),
                          maxOffset=float(np.abs(offset[lift>0]).max()),stationRange=[float(station[lift>0].min()),float(station[lift>0].max())]))]


def corridor_underpasses(bounds, height):
    """Two straight OSM layer -1 underpasses on the approved T2 driving route."""
    from shapely.geometry import LineString

    widths = {690911289: 4.5, 1494511149: 4.0}
    result = []
    for way in load_osm():
        if way['type']!='way' or way['id'] not in widths:
            continue
        points = [ll2xz(pt['lat'],pt['lon']) for pt in way['geometry']]
        if not bounds.covers(LineString(points)):
            continue
        if len(points)!=2 or way.get('tags',{}).get('tunnel')!='yes':
            raise ValueError(f"Recheck airport corridor underpass {way['id']}")
        start,end = np.asarray(points)
        length = float(np.linalg.norm(end-start))
        approach = length*.35
        direction = (end-start)/length
        lateral = np.array([-direction[1],direction[0]])
        first,last = height(*start),height(*end)
        stations = []
        for at in sorted({0.,length,approach,length-approach,*np.arange(4.,length,4.)}):
            fraction = at/length
            # Estimated invert. Meet the surveyed approach ground at each end.
            point = start+(end-start)*fraction
            grade = first+(last-first)*fraction
            ground = min(height(*(point+d*lateral)) for d in (-widths[way['id']],0,widths[way['id']]))
            cut = min(1.,at/approach,(length-at)/approach)
            stations.append([float(at),round(float(grade+cut*(min(ground,grade)-grade-5.3)),4)])
        result.append(dict(way=way['id'],profile_source='estimated',length=length,
                           portals=[[start[0],first,start[1]],[end[0],last,end[1]]],
                           halfWidth=widths[way['id']],clearance=4.5,approach=approach,stations=stations))
    return result


def clear_cuizhu_overpass(plans, road_height):
    """Provide motor clearance where the westbound airport ramp crosses West Ring Road."""
    from shapely.geometry import LineString
    from features import points

    ramp = next((e for e in load_osm() if e['type']=='way' and e['id']==815082651),None)
    if ramp is None:
        return
    crossing = LineString(points(ramp))
    viaduct = [plans[way] for way in (1017592859,265411058,738018982) if way in plans]
    targets = []
    for line,width,stations,levels in viaduct:
        point = line.intersection(crossing)
        if point.geom_type=='Point' and not point.is_empty:
            targets.append((point,road_height(point.x,point.y)+6.2))
    for line,width,stations,levels in viaduct:
        for i,s in enumerate(stations):
            point = line.interpolate(float(s))
            for center,level in targets:
                levels[i] = max(levels[i],level-.05*max(0.,point.distance(center)-12))


def clear_approach_paving(output, chunks, underpasses):
    """Cut GL04 surface streets at the same open ramps as the terrain mesh."""
    import gzip
    import json
    import struct
    from shapely import LineString, Polygon, box, make_valid, union_all
    from shapely.affinity import translate
    from service_streets import rings

    ramps = []
    for tunnel in underpasses:
        line = LineString([(x,z) for x,_,z in tunnel['portals']])
        approach = tunnel['approach']
        for start,end in ((0,approach), (line.length-approach,line.length)):
            segment = LineString([line.interpolate(start),line.interpolate(end)])
            ramps.append(segment.buffer(tunnel['halfWidth'], cap_style='flat'))
    cut = union_all(ramps)
    for tile in chunks:
        x,z = tile['x'],tile['z']
        if not cut.intersects(box(x,z,x+256,z+256)):
            continue
        local = translate(cut, -x, -z)
        file = output/tile['file']
        raw = gzip.decompress(file.read_bytes())
        vertices,indices,size = struct.unpack_from('<3I',raw,4)
        start = 24+16900+vertices*9+indices*4
        collision = json.loads(raw[start:start+size])
        streets = collision[1]
        lower = streets[11] if len(streets)>11 else None
        paths = []
        for i,item in enumerate(streets[0]):
            if lower and i==lower[0]:
                first_lower = len(paths)
            kind,*loops = item
            shape = make_valid(Polygon(np.asarray(loops[0])/100, [np.asarray(r)/100 for r in loops[1:]]))
            if shape.intersects(local):
                paths.extend(rings(kind,shape.difference(local)))
            else:
                paths.append(item)
        if lower:
            lower[0] = first_lower if lower[0]<len(streets[0]) else len(paths)
        streets[0] = paths
        encoded = json.dumps(collision,separators=(',',':')).encode()
        payload = raw[:12]+struct.pack('<I',len(encoded))+raw[16:start]+encoded+raw[start+size:]
        file.write_bytes(gzip.compress(payload,compresslevel=5,mtime=0))
        tile['bytes'] = file.stat().st_size
