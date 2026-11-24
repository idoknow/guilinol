"""Propagate a portal's residual grade onto connected surface roads."""
from collections import defaultdict
from heapq import heappop, heappush
import math

from shapely import STRtree
from shapely.geometry import LineString, Point
from road_profile import RULES

from common import ll2xz
from service_streets import width
from vehicle_tunnels import grade_limit, underground


def surface_guides(elements, portals, nodes, chunks):
    # Level the physical approach even where the traffic graph omits a
    # segment for access, parking or a quiet zone further along the same way.
    mouths=STRtree([Point(nodes[n]['x'],nodes[n]['z']) for n in portals])
    loaded={(t['x']//256,t['z']//256) for t in chunks}
    guides=[]
    for way in elements:
        tags=way.get('tags',{})
        highway=tags.get('highway')
        if (way['type']!='way' or not highway or underground(way) or tags.get('bridge','no')!='no'
                or tags.get('area')=='yes' or not way.get('geometry') or not all(way['geometry'])):
            continue
        coords=[ll2xz(p['lat'],p['lon']) for p in way['geometry']]
        if len(coords)<2 or not len(mouths.query(LineString(coords),predicate='dwithin',distance=60)):
            continue
        pedestrian=highway in ('footway','pedestrian','path','steps')
        paved=width(tags) if 'width' in tags else RULES['defaultWidth'].get(highway,6 if highway=='unclassified' else width(tags))
        for a,b,p,q in zip(way['nodes'],way['nodes'][1:],coords,coords[1:]):
            if a==b or math.dist(p,q)<.05:continue
            segment=LineString([p,q])
            if any((math.floor(x/256),math.floor(z/256)) not in loaded for x,z in (p,q)):continue
            if not len(mouths.query(segment,predicate='dwithin',distance=60)):continue
            for ref,(x,z) in ((a,p),(b,q)):
                nodes.setdefault(ref,dict(id=ref,x=round(x,2),z=round(z,2),y=None))
            guides.append({'from':a,'to':b,'way':way['id'],'cls':highway,'width':paved,'offset':0,
                           'surfaceKind':1 if pedestrian else 0})
    return guides


def plan(conflicts, lanes, nodes, levels, rail_nodes, widths):
    adjacency=defaultdict(list)
    links={}
    for lane in lanes:
        if lane.get('structure') or lane.get('gradeSeparated'):
            continue
        a,b=sorted((lane['from'],lane['to']))
        key=(a,b,lane['way'])
        if key in links:
            continue
        p,q=nodes[a],nodes[b]
        line=LineString([(p['x'],p['z']),(q['x'],q['z'])])
        cap=grade_limit(lane['cls'])
        half=widths.get(lane['way'],max(lane['width'],2*abs(lane['offset'])+lane['width']))/2+.5
        links[key]=(line,cap,half,lane.get('surfaceKind',0))
        for i,j in [(a,b),(b,a)]:
            adjacency[i].append((j,key))
    targets={}
    queue=[]
    for conflict in conflicts:
        if 'approachCut' not in conflict:
            continue
        k=conflict['node']
        y=conflict['floor']
        if y<targets.get(k,math.inf):
            targets[k]=y
            heappush(queue,(y,k))
    anchors=set(targets)|rail_nodes
    spans=set()
    failed=[]
    while queue:
        y,k=heappop(queue)
        if y!=targets[k]:
            continue
        for j,key in adjacency[k]:
            line,cap,half,kind=links[key]
            dest=levels.get(j,nodes[j].get('y'))
            # Reserve part of the slope for the vertical curves at each end.
            limit=y+line.length*cap*.85
            spans.add(key)
            if dest+line.length*cap<y and k not in anchors:
                targets[k]=dest+line.length*cap*.85
                heappush(queue,(targets[k],k))
                break
            if limit >= dest or limit >= targets.get(j,math.inf):
                continue
            if j in rail_nodes:
                failed.append(dict(reason='fixedLevelCrossing',node=j,way=key[2],
                                   road=dest,reachable=limit,deficit=dest-limit))
                continue
            targets[j]=limit
            heappush(queue,(limit,j))
    result=[]
    for key in sorted(spans):
        a,b,way=key
        line,cap,half,kind=links[key]
        ya=targets.get(a,levels.get(a,nodes[a].get('y')))
        yb=targets.get(b,levels.get(b,nodes[b].get('y')))
        if abs(yb-ya)>cap*line.length+.001:
            # A neighbouring immutable grade needs a longer transition before
            # this edge can be surfaced. Record it without exceeding its cap.
            failed.append(dict(reason='surfaceGradeLimit',way=way,start=a,end=b,
                               length=line.length,grade=abs(yb-ya)/line.length,limit=cap))
            continue
        result.append((line,half,ya,yb,cap,kind))
    return result,failed


def portal_openings(tunnels, elements, widths):
    """Surface branches entering a bore sideways need an opening in its wall."""
    mouths=defaultdict(list)
    for t in tunnels:
        for i,is_mouth in enumerate(t.get('mouths',())):
            if is_mouth:
                x,y,z=t['portals'][i]
                mouths[round(x,2),round(z,2)].append((t,i))
    for way in elements:
        tags=way.get('tags',{})
        if (way['type']!='way' or not tags.get('highway') or underground(way)
                or not way.get('geometry') or not all(way['geometry'])):
            continue
        coords=[ll2xz(p['lat'],p['lon']) for p in way['geometry']]
        for i,(x,z) in enumerate(coords):
            connections=mouths.get((round(x,2),round(z,2)),())
            for t,end in connections:
                for j in (i-1,i+1):
                    if not 0<=j<len(coords):
                        continue
                    dx,dz=coords[j][0]-x,coords[j][1]-z
                    length=math.hypot(dx,dz)
                    if length<.01:
                        continue
                    half=min(t['halfWidth'],widths.get(way['id'],width(tags))/2)
                    t.setdefault('openings',[]).append([end,round(dx/length,5),round(dz/length,5),round(half,2)])
