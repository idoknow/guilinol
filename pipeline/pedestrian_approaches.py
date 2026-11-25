"""Connect surveyed junction arms to the continuous street pavement."""
import math

import numpy as np
from shapely import LineString, Point, box
from shapely.ops import substring

from canal_passages import sample_road_heights
from features import points
from service_streets import width


# Surveyed connection nodes. Orient from the motor road toward the path so
# the road elevation is shared across the path entrance and its rounded cap.
CONNECTIONS = {1013429171:9349946067,1013429174:9349946089,1013355638:9349946082,
               923428686:8572142393,1474631011:13528279974,1490465016:13660684190}


def profiles(output, manifest, elements, widths, existing):
    junctions = {way: {node} for way,node in CONNECTIONS.items()}
    junctions.update({
        1013355608:{8572142391},1013355606:{9349162208},1013355613:{9349162228},
        1471515772:{13503053864,13503091119},1471513685:{13503053866},
        1471515770:{13503091110},1471515771:{13503091114},1471528920:{13503178786},
        1472404239:{13509827457},1497561675:{13715269941},
        1497561670:{13715269941,13715269942},
    })
    x,z,w,h=manifest['extent']
    bounds=box(x,z,x+w,z+h)
    paths,requests=[],[]
    for way in elements:
        if way['type']!='way' or way['id'] not in junctions:
            continue
        xy=points(way)
        ends=junctions[way['id']]
        if ends-set((way['nodes'][0],way['nodes'][-1])):
            raise ValueError(f"Recheck the road junction on {way['id']}")
        axis=LineString(xy)
        if not bounds.covers(axis):
            continue
        foot=way['tags']['highway'] in ('path','footway')
        half=widths.get(way['id'],2 if foot else width(way['tags']))/2+.5
        if len(ends)==2 and axis.length<=110:
            arms=[axis]
        else:
            reach=min(50,axis.length)
            arms=[]
            if way['nodes'][0] in ends:
                arms.append(substring(axis,0,reach))
            if way['nodes'][-1] in ends:
                arms.append(substring(axis,axis.length,axis.length-reach))
        for arm in arms:
            paths.append((arm,half,int(foot)))
            for pt in (arm.interpolate(0),arm.interpolate(arm.length)):
                requests.append(dict(x=pt.x,z=pt.y,passageClearance=True) if foot or way['id'] in CONNECTIONS
                                else dict(x=pt.x,z=pt.y,way=way['id']))
    if not paths:
        return []
    levels=iter(sample_road_heights(output,manifest,requests))
    grades=[]
    for axis,half,kind in paths:
        ends=[]
        for p in (axis.interpolate(0),axis.interpolate(axis.length)):
            level=next(levels)
            hits=[row for row in existing if row[0].distance(p)<.03]
            if hits:
                line,_,a,b,*_=min(hits,key=lambda row:row[0].distance(p))
                level=a+(b-a)*line.project(p,normalized=True)
            ends.append(level)
        grades.extend(graded_arm(axis, half, kind, *ends))
    return grades


def graded_arm(axis, half, kind, a, b):
    if abs(b-a)>.08*axis.length:return []
    blend=max(0,min(.12,1-abs(b-a)/(.08*axis.length)))
    knots=sorted({0.,axis.length,*np.arange(2,axis.length,2),
                  *(axis.project(Point(xy)) for xy in axis.coords)})
    grades=[]
    previous=None
    for s in knots:
        t=s/axis.length
        if blend:
            t=(t*t/(2*blend) if t<blend else 1-blend-(1-t)**2/(2*blend)
               if t>1-blend else t-blend/2)/(1-blend)
        point=axis.interpolate(s).coords[0];height=a+(b-a)*t
        if previous and math.dist(previous[0],point)>.01:
            grades.append((LineString([previous[0],point]),half,previous[1],height,.08,kind))
        previous=point,height
    return grades

def footbridge_landing(output, manifest, elements, existing):
    """Meet the actual deck lip at the interior junction on the service road."""
    ways = {w['id']:w for w in elements if w['type']=='way' and w['id'] in (403448112,1471513684)}
    if len(ways)!=2:
        return []
    road, bridge = ways[1471513684], ways[403448112]
    common, = set(road['nodes']).intersection(bridge['nodes'])
    axis = LineString(points(road))
    lip = Point(points(road)[road['nodes'].index(common)])
    x,z,w,h=manifest['extent']
    if not box(x,z,x+w,z+h).covers(lip):
        return []
    station = axis.project(lip)
    # Keep the western branch junction at its old height. To the east the
    # road needs the full 50 m to descend within 8%; its side arm is graded
    # from this profile by profiles() above.
    west = axis.project(Point(points(road)[road['nodes'].index(13503178786)]))
    arms = [substring(axis,west,station),substring(axis,station,min(axis.length,station+50))]
    outer = [Point(arms[0].coords[0]),Point(arms[1].coords[-1])]
    probe = [dict(x=p.x,z=p.y,way=road['id']) for p in outer]
    levels = sample_road_heights(output,manifest,[*probe,dict(x=lip.x,z=lip.y,roofProbe=True)])
    deck = levels[-1][1]
    if deck is None:
        raise ValueError('Missing deck at the mapped footbridge landing')
    for i,point in enumerate(outer):
        hits = [row for row in existing if row[0].distance(point)<.03]
        if hits:
            line,_,a,b,*_ = min(hits,key=lambda row:row[0].distance(point))
            levels[i]=a+(b-a)*line.project(point,normalized=True)
    result = []
    for arm,begin,end in zip(arms,(levels[0],deck),(deck,levels[1]),strict=True):
        rows=graded_arm(arm,3.5,0,begin,end)
        if not rows:
            raise ValueError('Footbridge landing exceeds the service-road grade limit')
        result.extend(rows)
    return result
