"""Propagate a portal's residual grade onto connected surface roads."""
from collections import defaultdict
from heapq import heappop, heappush
import math

from shapely import STRtree
from shapely.geometry import LineString, Point
import numpy as np
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
            if not len(mouths.query(segment,predicate='dwithin',distance=60)):continue
            ids=[a,b]; coords=[p,q]
            inside=[(math.floor(x/256),math.floor(z/256)) in loaded for x,z in coords]
            if inside.count(True)==1:
                # An OSM edge can continue beyond the delivered world. Keep
                # its physical approach up to the boundary of loaded terrain.
                start=inside.index(True);end=1-start
                line=LineString([coords[start],coords[end]])
                stations=np.arange(1,min(line.length,256)+1,1.)
                last=0.
                for d in stations:
                    pt=line.interpolate(d)
                    if (math.floor(pt.x/256),math.floor(pt.y/256)) not in loaded:break
                    last=d
                if last<2:continue
                coords[end]=line.interpolate(last-.1).coords[0]
                ids[end]=-(4_000_000_000_000_000+way['id']*1000+len(guides))
            elif not all(inside):continue
            for ref,(x,z) in zip(ids,coords,strict=True):
                nodes.setdefault(ref,dict(id=ref,x=round(x,2),z=round(z,2),y=None))
            guides.append({'from':ids[0],'to':ids[1],'way':way['id'],'cls':highway,'width':paved,'offset':0,
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
    graded_links=set()
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
        graded_links.add(key)
    return result,failed,graded_links


def ring_road_widths(elements, widths):
    """Use the mapped primary carriageway at both three-lane underpasses."""
    result = dict(widths)
    for way in elements:
        if way['type']!='way' or way['id'] not in (464498741,464498742,420273229,692420952):
            continue
        tags = way['tags']
        if tags.get('highway')!='primary':
            raise ValueError('Recheck West Ring Road carriageway survey')
        result.setdefault(way['id'],width(tags) if 'width' in tags else RULES['defaultWidth']['primary'])
    return result


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

def cycleway_deck_profile(output,manifest,elements,network,widths):
    """The grain-yard cycleway passes under a second deck outside its mouth."""
    from canal_passages import sample_road_heights
    from features import points
    w=next((w for w in elements if w['type']=='way' and w['id']==1028568322),None)
    mouth=9482704290
    if not w or mouth not in network['portals']:return None
    xy=points(w)
    if w['nodes'][-1]==mouth:xy.reverse()
    elif w['nodes'][0]!=mouth:return None
    line=LineString(xy);half=widths.get(w['id'],width(w['tags']))/2+.5
    ds=sorted({0.,line.length,*np.arange(1,line.length),*(line.project(Point(p)) for p in xy)})
    pts=[line.interpolate(d) for d in ds];requests=[]
    for d,pt in zip(ds,pts):
        a=line.interpolate(max(0,d-.1));b=line.interpolate(min(line.length,d+.1))
        direction=np.subtract(b.coords[0],a.coords[0]);direction/=np.linalg.norm(direction)
        for off in (-half+.1,0,half-.1):
            requests.append(dict(x=pt.x-direction[1]*off,z=pt.y+direction[0]*off,roofProbe=True))
    hits=sample_road_heights(output,manifest,requests)
    upper=[];native=[];cap=.08*.85
    for i,d in enumerate(ds):
        row=hits[3*i:3*i+3];native.append(row[1][0])
        # GL04's thickest deck fascia extends 1.2 m below its top.
        upper.append(min((deck-1.2-2.55 for _,deck in row if deck is not None),default=math.inf))
    ys=np.minimum(native,upper)
    for i in range(len(ds)-2,-1,-1):ys[i]=min(ys[i],ys[i+1]+cap*(ds[i+1]-ds[i]))
    return mouth,pts,ds,ys,half,cap


def cycleway_grades(profile,conflicts):
    if not profile:return []
    mouth,pts,ds,ys,half,cap=profile
    ys[0]=min(ys[0],next((r['floor'] for r in conflicts if r.get('node')==mouth),ys[0]))
    for i in range(1,len(ds)):ys[i]=min(ys[i],ys[i-1]+cap*(ds[i]-ds[i-1]))
    return [(LineString([a,b]),half,ya,yb,.08,0) for a,b,ya,yb in zip(pts,pts[1:],ys,ys[1:]) if a.distance(b)>.005]


def cycleway_street_tie(output, manifest, elements, widths, cycleway):
    """Join the residential carriageway to the low cycleway at their shared node."""
    from canal_passages import sample_road_heights
    from features import points
    if not cycleway:
        return []
    road = next(w for w in elements if w['type']=='way' and w['id']==575590550)
    shared = 9482704296
    xy = points(road)
    axis = LineString(xy)
    station = axis.project(Point(xy[road['nodes'].index(shared)]))
    half = widths.get(road['id'],6.5)/2+.5
    _,points_cycle,_,ys,_,_ = cycleway
    if points_cycle[-1].distance(axis.interpolate(station))>.02:
        raise ValueError('Recheck the cycleway to residential street junction')
    low = ys[-1]
    # The public service-road junction 51 m west of the crossing remains
    # on its original grade. Both ramps terminate outside the cycleway cap.
    start, end = station-49, station+72
    ties = [axis.interpolate(d) for d in (start,end)]
    left,right = sample_road_heights(output,manifest,[dict(x=p.x,z=p.y) for p in ties])
    ds = sorted({start,end,station,*np.arange(start+2,end,2),
                 *(d for pt in xy if start<(d:=axis.project(Point(pt)))<end)})
    grades = []
    for d in ds:
        if d<station:
            t = min(1,(station-d)/49)
            level = low+(left-low)*t*t*(3-2*t)
        else:
            t = min(1,(d-station)/72)
            level = low+(right-low)*t*t*(3-2*t)
        pt = axis.interpolate(d)
        if grades or d!=ds[0]:
            if pt.distance(prev)>.01:
                if abs(level-last)>.08*pt.distance(prev):
                    raise ValueError('Residential approach exceeds its grade limit')
                grades.append((LineString([prev,pt]),half,last,level,.08,0))
        prev,last = pt,level
    return grades
