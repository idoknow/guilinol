"""Share a feasible junction elevation between streets meeting a fixed bridge or lower road."""
from collections import defaultdict
import math

import numpy as np
from shapely import LineString, Point, STRtree, box
from shapely.ops import substring

from canal_passages import sample_road_heights
from features import points
from road_profile import RULES
from service_streets import width
from vehicle_tunnels import grade_limit


def profiles(output,manifest,elements,widths,planned):
    hubs = {8209536556,13919458288}
    highways = [w for w in elements if w['type']=='way' and w.get('tags',{}).get('highway')
                and w.get('geometry') and all(w['geometry'])]
    links = defaultdict(list)
    for way in highways:
        for ref in set(way['nodes']):
            links[ref].append(way)
    x,z,w,h = manifest['extent']
    bounds = box(x,z,x+w,z+h)
    constraints = STRtree([r[0] for r in planned])
    arms, requests, centres = defaultdict(list), [], {}
    for hub in sorted(hubs):
        for road in links[hub]:
            coords,refs = points(road),road['nodes']
            start = refs.index(hub)
            centre = Point(coords[start])
            if not bounds.covers(centre):
                continue
            if hub not in centres:
                centres[hub] = len(requests)
                requests.append(dict(x=centre.x,z=centre.y,way=road['id']))
            for direction in (-1,1):
                indexes=[]
                for i in range(start,len(refs) if direction==1 else -1,direction):
                    indexes.append(i)
                    if i!=start and len(links[refs[i]])>1:
                        break
                if len(indexes)<2:
                    continue
                axis=LineString([coords[i] for i in indexes])
                extent=min(90.,axis.length)
                arm=substring(axis,0,extent)
                end=arm.interpolate(extent)
                probe=dict(x=end.x,z=end.y,way=road['id'])
                if extent==axis.length:
                    ref=refs[indexes[-1]]
                    for bridge in links[ref]:
                        if bridge['tags'].get('bridge','no')=='no':
                            continue
                        xy=points(bridge)
                        if ref==bridge['nodes'][0]:
                            other=xy[1]
                        elif ref==bridge['nodes'][-1]:
                            other=xy[-2]
                        else:
                            continue
                        probe['bridge']=[other[0]-end.x,other[1]-end.y]
                        break
                tags=road['tags']
                paved=widths.get(road['id'],RULES['defaultWidth'].get(tags['highway'],
                                  6.5 if tags['highway']=='unclassified' else width(tags)))
                arms[hub].append((arm,paved/2+.5,grade_limit(tags['highway']),len(requests)))
                requests.append(probe)
    if not requests:
        return []
    heights=sample_road_heights(output,manifest,requests)
    result=[]
    for hub,branches in arms.items():
        lower,upper=-math.inf,math.inf
        ends=[]
        # Keep a level area where the carriageway polygons overlap. Reserve
        # enough run beyond it to ease to the existing approach elevation.
        pad=min(9.,max(half for _,half,_,_ in branches))
        for arm,_,cap,index in branches:
            end=arm.interpolate(arm.length)
            y=heights[index]
            nearby=constraints.query(end,predicate='dwithin',distance=.04)
            if len(nearby) and 'bridge' not in requests[index]:
                row=planned[min(nearby,key=lambda i:planned[i][0].distance(end))]
                y=row[2]+(row[3]-row[2])*row[0].project(end,normalized=True)
            allowance=.9*cap*(arm.length-pad)
            lower=max(lower,y-allowance)
            upper=min(upper,y+allowance)
            ends.append(y)
        if lower>upper:
            raise ValueError(f'No shared grade within the existing road junction at {hub}: {lower}, {upper}')
        level=np.clip(heights[centres[hub]],lower,upper)
        for (arm,half,cap,_),end in zip(branches,ends,strict=True):
            run=arm.length-pad
            ds=sorted({0.,pad,arm.length,*np.arange(2,arm.length,2),
                       *(arm.project(Point(pt)) for pt in arm.coords)})
            prev=None
            for d in ds:
                t=np.clip((d-pad)/run,0,1)
                f=(t*t/.2 if t<.1 else .9-(1-t)**2/.2 if t>.9 else t-.05)/.9
                y=level+(end-level)*f
                pt=arm.interpolate(d)
                if prev and pt.distance(prev[0])>.01:
                    result.append((LineString([prev[0],pt]),half,prev[1],y,cap,0))
                prev=pt,y
    return result


def align_service_junction(nodes, lanes, elements, node_height, profile):
    # The near facades leave 1.62 m and 1.89 m on the building side of this
    # unclassified road. The opposite verge fits both full-width lanes.
    road=next((w for w in elements if w['type']=='way' and w['id']==1082716283),None)
    if not road:
        return
    axis=LineString(points(road))
    moved=set()
    for ref,offset in ((13919458306,.35),(13919458288,1.16)):
        if ref not in nodes:
            continue
        node=nodes[ref]
        station=axis.project(Point(node['x'],node['z']))
        a,b=axis.interpolate(max(0.,station-1)),axis.interpolate(min(axis.length,station+1))
        length=a.distance(b)
        if length<.01:
            continue
        node['x']=round(node['x']+offset*(b.y-a.y)/length,2)
        node['z']=round(node['z']-offset*(b.x-a.x)/length,2)
        node['y']=node_height(node['x'],node['z'],road['id'])
        moved.add(ref)
    for lane in lanes:
        if lane['from'] in moved or lane['to'] in moved:
            lane['heights']=profile(lane['from'],lane['to'],lane['offset'],lane['way'])
