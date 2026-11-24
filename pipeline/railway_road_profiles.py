"""Propagate required crossing elevations along the connected road graph.

The two envelopes bound every permissible road profile. When they cross,
return the two railway constraints and an actual road path between them.
"""
from collections import defaultdict
import heapq
import math

import numpy as np
from shapely import LineString, Point

from features import points


def crossing_bounds(crossing):
    rail = crossing['railY']
    road = crossing['roadY']
    kind = crossing['type']
    if kind == 'level':
        return rail, rail
    if kind == 'road_over':
        return max(road, road + rail + 7.5 - crossing['originalSoffitM']), math.inf
    return -math.inf, min(road, rail - 5.7)


def grade_cap(tags):
    kind = tags['highway'].removesuffix('_link')
    return .08 if kind in {'service','residential','unclassified','living_street',
                           'steps','path','footway','cycleway','pedestrian','track'} else .05


def envelope(neighbors, anchors):
    levels = np.full(len(neighbors), np.inf)
    origins = np.full(len(neighbors), -1, dtype=int)
    previous = np.full(len(neighbors), -1, dtype=int)
    queue = []
    for node, (value, _) in anchors.items():
        levels[node], origins[node] = value, node
        heapq.heappush(queue,(value,node))
    while queue:
        level, node = heapq.heappop(queue)
        if level != levels[node]:
            continue
        for other, length, cap, *_ in neighbors[node]:
            bound = level + length*cap
            if bound < levels[other]:
                levels[other], origins[other], previous[other] = bound, origins[node], node
                heapq.heappush(queue, (bound,other))
    return levels, origins, previous


def road_profile_constraints(ways, crossings, panels):
    crossing_ways = defaultdict(list)
    for row in crossings:
        crossing_ways[row['road']].append(row)
    panel_ways = defaultdict(list)
    for panel in panels:
        panel_ways[panel['road']].append(panel)
    ids, neighbors, floors, ceilings = {}, [], {}, {}
    adjustments = []

    def vertex(key):
        if key not in ids:
            ids[key] = len(neighbors)
            neighbors.append([])
        return ids[key]

    for wid, way in ways.items():
        tags = way.get('tags', {})
        if 'highway' not in tags or tags['highway'] in ('construction','proposed') or len(way.get('geometry',[]))<2:
            continue
        xy = points(way)
        line = LineString(xy)
        chainage = np.r_[0,np.cumsum(np.linalg.norm(np.diff(xy,axis=0),axis=1))]
        stations = dict(zip(chainage,map(vertex,way['nodes'])))

        def constrain(at, low, high, row):
            closest = min(stations,key=lambda d:abs(d-at))
            if abs(closest-at)<.002:
                n = stations[closest]
            else:
                n = stations[at] = vertex((wid,at))
            if low > floors.get(n,(-math.inf,None))[0]:
                floors[n] = low,row
            if high < ceilings.get(n,(math.inf,None))[0]:
                ceilings[n] = high,row

        for row in crossing_ways[wid]:
            at = line.project(Point(row['x'],row['z']))
            low,high = crossing_bounds(row)
            constrain(at,low,high,row)
            design = min(high,max(low,row['roadY']))
            adjustments.append(dict(road=wid,rail=row['rail'],type=row['type'],atM=round(at,3),
                                    oldM=row['roadY'],requiredM=round(design,4),
                                    changeM=round(design-row['roadY'],4)))
        for panel in panel_ways[wid]:
            y = panel['railY']
            first,last = panel['fromM'],panel['toM']
            source = dict(road=wid,type='level_panel',fromM=first,toM=last,railY=y)
            for at in [first,last,*(d for d in stations if first<d<last)]:
                constrain(at,y,y,source)
        ordered = sorted(stations.items())
        cap = grade_cap(tags)
        for (a,i),(b,j) in zip(ordered,ordered[1:]):
            neighbors[i].append((j,b-a,cap,wid,a,b))
            neighbors[j].append((i,b-a,cap,wid,b,a))

    upper, origin, previous = envelope(neighbors,ceilings)
    conflicts = []
    for n,(floor,source) in floors.items():
        if floor-upper[n] <= .001:
            continue
        path = []
        i = n
        while previous[i]!=-1:
            j = previous[i]
            _,length,cap,wid,start,end = min((e for e in neighbors[i] if e[0]==j),key=lambda e:e[1]*e[2])
            path.append(dict(way=wid, fromM=start, toM=end, lengthM=length, maxGrade=cap))
            i = j
        ceiling, other = ceilings[origin[n]]
        length = sum(leg['lengthM'] for leg in path)
        conflicts.append(dict(fromConstraint=source,toConstraint=other,
                              ways=list(dict.fromkeys(leg['way'] for leg in path)), path=path,
                              distanceM=round(length,4),
                              requiredFallM=round(floor-ceiling,4),permittedFallM=round(upper[n]-ceiling,4),
                              deficitM=round(floor-upper[n],4)))
    return dict(targets=adjustments,conflicts=sorted(conflicts,key=lambda r:-r['deficitM']))
