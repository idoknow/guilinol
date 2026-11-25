"""Find sustained, car-width pinch points between ground-level building faces."""
import math

import numpy as np
from shapely import LineString, Point, STRtree, box, get_coordinates, union_all
from shapely.affinity import affine_transform

from features import points
from ground_passages import footprint, line_parts
from surveyed_corridors import read_chunk
from vehicle_tunnels import underground

CAR_CLEARANCE = 2.22
MIN_LENGTH = 10.


def narrow_intervals(axis, walls):
    """Intersect perpendicular sections through the centreline with both facades.

    Between projected polygon vertices and centreline crossings the nearest wall
    on either side is linear in station. Solve the width crossing inside each
    interval, including when a single concave footprint supplies both walls.
    """
    runs = []
    station = 0.
    for start, end in zip(axis.coords, list(axis.coords)[1:]):
        length = math.dist(start, end)
        if not length:
            continue
        dx, dz = (np.subtract(end, start) / length).tolist()
        ux, uz = start
        local = affine_transform(walls, [dx, dz, -dz, dx, -dx*ux-dz*uz, dz*ux-dx*uz])
        local = local.intersection(box(0, -CAR_CLEARANCE, length, CAR_CLEARANCE))
        if not local.is_empty:
            centre = LineString([(0, 0), (length, 0)])
            breaks = sorted({0., length, *get_coordinates(local)[:,0],
                             *get_coordinates(local.intersection(centre))[:,0]})

            def width_at(x):
                section = LineString([(x,-CAR_CLEARANCE),(x,CAR_CLEARANCE)])
                gaps = section.difference(local)
                return next((p.length for p in line_parts(gaps) if p.distance(Point(x,0))<1e-8), None)

            for a, b in zip(breaks, breaks[1:]):
                if b-a < 1e-8:
                    continue
                left, right = width_at((2*a+b)/3), width_at((a+2*b)/3)
                if left is None or right is None:
                    continue  # A road inside a solid is handled by the passage rules.
                low, high = 2*left-right, 2*right-left
                if min(low,high) >= CAR_CLEARANCE-1e-8:
                    continue
                if max(low,high) > CAR_CLEARANCE:
                    cross = a + (b-a)*(CAR_CLEARANCE-low)/(high-low)
                    if low > high:
                        a = cross
                    else:
                        b = cross
                a, b = station+a, station+b
                if runs and a-runs[-1][1]<1e-6:
                    runs[-1][1]=b
                else:
                    runs.append([a,b])
        station += length
    return [r for r in runs if r[1]-r[0]>MIN_LENGTH]


def rider_alignment(way, walls, shared, paved):
    """Keep the two-wheel path clear of the wall even when OSM hugs one side."""
    routed=[]
    serial=0
    xy=points(way)
    for index,(start,end) in enumerate(zip(xy,xy[1:])):
        a,b=np.asarray(start),np.asarray(end)
        length=np.linalg.norm(b-a)
        if length<.01:
            continue
        tangent=(b-a)/length
        normal=np.array([-tangent[1],tangent[0]])
        stations=np.linspace(0,length,math.ceil(length)+1)
        limits=[]
        for d in stations:
            q=a+d*tangent
            half=paved/2+.5
            cross=LineString([q-half*normal,q+half*normal])
            gap=min(line_parts(cross.difference(walls)),key=lambda line:line.distance(Point(q)),default=None)
            if gap is None:
                raise ValueError(f'Missing riding corridor on {way["id"]} at {q}')
            lo,hi=sorted(np.dot(np.asarray(pt)-q,normal) for pt in (gap.coords[0],gap.coords[-1]))
            margin=min(.65,(hi-lo)/2)
            limits.append([lo+margin,hi-margin])
        # Anticipate each narrowing at a lateral gradient of 1:5. Preserve
        # the fixed network centres at shared junctions.
        for order in (range(1,len(stations)),range(len(stations)-2,-1,-1)):
            for j in order:
                k=j-order.step
                step=abs(stations[j]-stations[k])*.2
                limits[j][0]=max(limits[j][0],limits[k][0]-step)
                limits[j][1]=min(limits[j][1],limits[k][1]+step)
        offsets=[np.clip(0,lo,hi) if lo<=hi else (lo+hi)/2 for lo,hi in limits]
        for j,ref in ((0,way['nodes'][index]),(-1,way['nodes'][index+1])):
            if ref in shared:
                offsets[j]=0.
        curve=LineString([a+d*tangent+v*normal for d,v in zip(stations,offsets)]).simplify(.015)
        for j,(x,z) in enumerate(curve.coords):
            if j==0 and routed:
                continue
            if j==0:
                ref=way['nodes'][index]
            elif j==len(curve.coords)-1:
                ref=way['nodes'][index+1]
            else:
                serial+=1
                ref=-50_000_000_000_000-way['id']*10000-serial
            routed.append([x,z,ref])
    return routed


def classify(output, chunks, elements, motor_classes, widths):
    solids = []
    for tile in chunks:
        origin = np.array([tile['x'], tile['z']])
        for row in read_chunk(output / tile['file'])[3][0]:
            if not any(row[9:]):
                solids.append(footprint(row, origin))
    from collections import Counter
    from service_streets import width
    counts=Counter(ref for w in elements if w['type']=='way' and w.get('tags',{}).get('highway')
                   for ref in set(w['nodes']))
    shared={ref for ref,n in counts.items() if n>1}
    index = STRtree(solids)
    result = []
    for way in elements:
        tags = way.get('tags', {})
        if (way['type']!='way' or tags.get('highway','').removesuffix('_link') not in motor_classes
                or tags.get('bridge','no')!='no' or underground(way)
                or tags.get('area')=='yes' or not way.get('geometry') or not all(way['geometry'])):
            continue
        axis = LineString(points(way))
        if axis.length <= MIN_LENGTH:
            continue
        nearby = index.query(axis, predicate='dwithin', distance=CAR_CLEARANCE)
        if not len(nearby):
            continue
        walls = union_all(index.geometries.take(nearby))
        # A qualifying run must lie within reach of a solid for its entire length.
        if all(p.length <= MIN_LENGTH for p in line_parts(axis.intersection(walls.buffer(CAR_CLEARANCE)))):
            continue
        runs = narrow_intervals(axis, walls)
        if runs:
            result.append(dict(way=way['id'], length=axis.length, narrowStations=runs,
                               alignment=rider_alignment(way,walls,shared,widths.get(way['id'],width(tags)))))
    return result


def end_curbs(axis, paved, curbs):
    # Short kerbs flank the entrance. Keep a central opening for the permitted
    # two-wheel traffic and for a player who needs to reverse back out.
    for start, end in ((axis.coords[0],axis.coords[1]),(axis.coords[-1],axis.coords[-2])):
        delta = np.subtract(end,start)
        if np.linalg.norm(delta) < .01:
            continue
        normal = np.array([-delta[1],delta[0]]) / np.linalg.norm(delta)
        for sign in (-1,1):
            side = normal*sign
            if paved/2 > .9:
                kerb = LineString([start+side*.9,start+side*(paved/2)])
                curbs.append(kerb.buffer(.125,cap_style='flat'))


def driving_sites(elements, clearances, permits):
    by_way = {r['way']:r for r in clearances}
    sites = []
    for w in elements:
        if w['type']!='way' or w['id'] not in by_way:
            continue
        route = [[x,z,w['id']] for x,z,_ in by_way[w['id']]['alignment']]
        modes = [dict(mode=mode,direction=direction,route=path)
                 for mode in ('foot','bike','bicycle') if permits(w['tags'],mode)
                 for direction,path in [('in',route),('out',route[::-1])]]
        if w['id']==1552207023:
            # Start at the intersection with 1552207020, facing the measured pinch.
            axis = LineString(points(w))
            target = axis.interpolate(by_way[w['id']]['narrowStations'][0][0]+1)
            modes.append(dict(mode='car',direction='reverse-exit',reverseExit=True,
                              route=[[*axis.coords[0],w['id']],[target.x,target.y,w['id']]]))
        sites.append(dict(id=w['id'],way=w['id'],singleFile=True,modes=modes))
    return sites
