"""Deterministic visual props, grounded on the same triangles as the player."""
from collections import defaultdict
import json
import math

import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from airport_pavement import pavement_sources
from common import load_osm
from features import area, points


def layout(elements, bounds, ground):
    field,sources = pavement_sources(elements)
    if field is None or not field.intersects(bounds): return {}
    buildings = unary_union([area(row) for row in elements if row['type']=='way' and
                             row.get('tags',{}).get('building') and field.intersects(area(row))])
    terminals = unary_union([area(row) for row in elements if row['type']=='way' and row['id'] in (334128971,631243397)])
    rows = defaultdict(list)
    def put(kind, pair, yaw=0, scale=(1,1,1), lift=0):
        east,south = pair
        if bounds.covers(Point(east,south)):
            rows[kind].append([round(value,3) for value in (east,ground(east,south)+lift,south,yaw,*scale)])
    def vector(start,end):
        delta = np.subtract(end,start)
        return delta / max(.001,np.linalg.norm(delta))
    def angle(direction): return math.atan2(direction[0],direction[1])
    def path(kind,start,end,lift=0):
        put(kind,(np.array(start)+end)/2,angle(vector(start,end)),(1,1,np.linalg.norm(np.subtract(end,start))),lift)
    docks=[]; bridges=[]; roads=[]
    for row in elements:
        tags=row.get('tags',{}); coords=points(row)
        if row['type']!='way' or len(coords)<2: continue
        line=LineString(coords)
        if not field.intersects(line): continue
        if tags.get('aeroway')=='jet_bridge':
            if terminals.distance(Point(coords[-1])) < terminals.distance(Point(coords[0])): coords.reverse()
            for idx,(start,end) in enumerate(zip(coords,coords[1:])):
                path('bridgeFixed' if idx==0 else 'bridgeMobile',start,end)
            put('bridgePivot',coords[-2]); put('bridgeDock',coords[-1],angle(vector(coords[-2],coords[-1])))
            docks.append(np.array(coords[-1])); bridges.append(line.buffer(1.5))
        elif tags.get('aeroway')=='navigationaid': put('beacon',line.centroid.coords[0])
        if tags.get('highway') and tags.get('access') not in ('private','no') and line.crosses(field.boundary):
            roads.append(line.buffer(8))
    occupied=[]; used=set(); bridge_area=unary_union(bridges)
    for index,(_,line) in enumerate(sorted(sources['parking_position'],key=lambda pair:pair[0]['id'])):
        coords=list(line.coords)
        if terminals.distance(Point(coords[0])) < terminals.distance(Point(coords[-1])): coords.reverse()
        end=np.array(coords[-1]); forward=vector(coords[-2],end); right=np.array([forward[1],-forward[0]])
        dock=min(range(len(docks)),key=lambda key:np.linalg.norm(docks[key]-end)) if docks else None
        near=dock is not None and np.linalg.norm(docks[dock]-end)<55
        put('standSign',end+7*right,angle(forward))
        if index%5 >= (3 if near else 1) or (near and dock in used): continue
        size=1.22 if index%11==0 else 1
        for side in (1,-1):
            nose=docks[dock]+side*3.7*right+4*forward if near else end
            center=nose-17*size*forward
            outline=Polygon([center+size*(lateral*right+station*forward) for lateral,station in
                             [(0,17),(2.1,12),(2.1,4),(17,-5),(17,-7),(2,-4),(1.6,-11),(6,-15),(0,-17),(-6,-15),(-1.6,-11),(-2,-4),(-17,-7),(-17,-5),(-2.1,4),(-2.1,12)]])
            if not buildings.intersects(outline) and not bridge_area.intersects(outline) and not any(other.intersects(outline) for other in occupied): break
        else: continue
        occupied.append(outline)
        if near: used.add(dock)
        put('airliner',center,angle(forward),(size,size,size))
        for shift,kind in [(10,['tug','cart','stairs','fuel','bus'][(len(occupied)-1)%5]),(15,'cart')]:
            point=center+right*shift+forward*10
            if not buildings.intersects(Point(point).buffer(3)): put(kind,point,angle(forward))
    for _,line in sources['runway']:
        for side in (-1,1):
            edge=line.offset_curve(side*23)
            for station in np.arange(0,edge.length,60): put('edgeLight',edge.interpolate(station).coords[0])
        for tip,inner in [(line.coords[0],line.coords[1]),(line.coords[-1],line.coords[-2])]:
            forward=vector(inner,tip); right=np.array([forward[1],-forward[0]])
            for distance in range(30,901,30):
                for shift in ((-10,-5,0,5,10) if distance%150==0 else (0,)):
                    put('approachLight',tip+distance*forward+shift*right)
            for shift in (35,43,51,59): put('papi',tip-290*forward+shift*right,angle(forward))
            put('windsock',tip-110*forward+70*right)
    for _,line in sources['taxiway']:
        for station in np.arange(25,line.length,60): put('taxiLight',line.interpolate(station).coords[0])
    for row,_ in sources['apron']:
        edge=area(row).exterior
        for station in np.arange(0,edge.length,120):
            point=edge.interpolate(station)
            if buildings.distance(point)>10 and bridge_area.distance(point)>6: put('mast',point.coords[0])
    fence=field.buffer(-4).boundary.difference(unary_union([*roads,buildings.buffer(1)]))
    for segment in getattr(fence,'geoms',[fence]):
        coords=list(segment.coords)
        for start,end in zip(coords,coords[1:]):
            count=max(1,math.ceil(math.dist(start,end)/5)); delta=np.subtract(end,start)/count
            for idx in range(count):
                first=start+idx*delta;last=first+delta
                center=(first+last)/2
                if not bounds.covers(Point(center)): continue
                base,tip=ground(*first),ground(*last)
                rows['fence'].append([round(float(value),4) for value in
                    (center[0],(base+tip)/2,center[1],angle(vector(first,last)),1,1,np.linalg.norm(delta),tip-base)])
    return rows


def write_props(output,bounds,ground):
    rows=layout(load_osm(),bounds,ground)
    if not rows: return None
    file=output/'airport-props.json'
    file.write_text(json.dumps(rows,separators=(',',':')))
    return dict(file=file.name,bytes=file.stat().st_size)
