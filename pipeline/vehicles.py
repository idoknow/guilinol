import base64
import gzip
import json
import math
import random

import numpy as np
from scipy.ndimage import distance_transform_edt
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from shapely import STRtree, intersects_xy, union_all
from shapely.geometry import LineString, Point

from common import GRID, ll2xz, load_osm
from features import area, points
from navigation import return_trips
from clearance import audit_routes


def plan_vehicles(bounds, surface, roads, buildings, sample):
    left, top, right, bottom = bounds.bounds
    wet = surface != -32768
    rows, cols = wet.shape
    xs = left + np.arange(cols)*GRID
    zs = top + np.arange(rows)*GRID
    obstacles = STRtree(buildings)
    placed, groups, anchors, extras = [], [], {}, []
    lakes = {'桂湖', '木龙湖', '杉湖', '榕湖'}
    for el in load_osm():
        tags = el.get('tags', {})
        name = tags.get('name', '')
        if tags.get('amenity') == 'ferry_terminal' and el['type'] == 'node':
            anchors[name] = ll2xz(el['lat'], el['lon'])
        if name in lakes and tags.get('natural') == 'water':
            lake = area(el).intersection(bounds)
            if not lake.is_empty:
                anchors[name] = lake.boundary.interpolate(.25, normalized=True).coords[0]
        if el['type'] != 'way':
            continue
        road = tags.get('highway')
        if road == 'pedestrian' and tags.get('area') == 'yes':
            extras.append(area(el))
        if el['id']==702246385:
            bridge=area(el)
            center=np.asarray(bridge.centroid.coords[0])
            axis=np.array([math.cos(math.radians(14.5)),math.sin(math.radians(14.5))])
            lateral=np.array([-axis[1],axis[0]])
            for side in (-1,1):
                middle=center+side*9.6*lateral
                extras.append(LineString([middle-75*axis,middle+75*axis]).buffer(1.9,cap_style='flat'))
        if road not in ('trunk', 'primary', 'secondary', 'tertiary') or tags.get('bridge') or len(points(el)) < 2:
            continue
        line = LineString(points(el))
        rng = random.Random(el['id'])
        distance = min(line.length/2, rng.uniform(70, 120))
        while distance < line.length:
            center = np.array(line.interpolate(distance).coords[0])
            tangent = np.array(line.interpolate(distance+1).coords[0])-line.interpolate(distance-1 if distance>=1 else 0).coords[0]
            tangent /= max(.001, np.linalg.norm(tangent))
            normal = np.array([-tangent[1], tangent[0]])
            offset = {'primary':8,'secondary':7,'tertiary':6,'trunk':10}[road]
            group = []
            for slot in range(rng.randint(3, 5)):
                east, south = center + normal*offset + tangent*slot*1.4
                ground, water = sample(east, south)
                if bounds.contains(Point(east,south)) and water == -32768 and not obstacles.query(Point(east,south).buffer(1),predicate='intersects').size:
                    group.append([round(east,1),round(ground,1),round(south,1),round(math.atan2(-normal[0],-normal[1]),3),rng.randrange(4)])
            if len(group)>=3 and all(math.hypot(group[0][0]-bike[0],group[0][2]-bike[2])>145 for bike in placed):
                placed.extend(group)
                groups.append(group)
            distance += rng.uniform(150,250)
    bikes, bicycles = [], []
    for idx, group in enumerate(groups):
        (bicycles if idx % 3 == 2 else bikes).extend(group)
    pavement = union_all(roads+extras).buffer(3)
    mask = intersects_xy(pavement,xs[None,:],zs[:,None])
    clearance = distance_transform_edt(wet)
    cells = np.flatnonzero(wet)
    ids = np.full(wet.size,-1); ids[cells] = np.arange(len(cells)); ids = ids.reshape(wet.shape)
    sources, targets, weights = [], [], []
    for dy, dx in [(0,1),(1,0),(1,1),(1,-1)]:
        row,col = np.where(wet); rr,cc = row+dy,col+dx
        ok = (rr<rows)&(cc>=0)&(cc<cols); row,col,rr,cc = (arr[ok] for arr in (row,col,rr,cc))
        ok = wet[rr,cc]&wet[row,cc]&wet[rr,col]; row,col,rr,cc = (arr[ok] for arr in (row,col,rr,cc))
        sources.extend(ids[row,col]); targets.extend(ids[rr,cc]); weights.extend(math.hypot(dx,dy)*(1+12/np.minimum(clearance[row,col],clearance[rr,cc])**1.5))
    graph = coo_matrix((weights,(sources,targets)),shape=(len(cells),len(cells))).tocsr()
    def locations(condition):
        row,col = np.where(condition);return np.column_stack((xs[col],zs[row]))
    docks, nodes, routes = {}, {}, []
    if wet.any() and (~wet).any():
        bank = locations((~wet)&(distance_transform_edt(~wet)<=2)); water = locations(clearance>=2) if clearance.max()>=2 else locations(wet)
        shores, moorings = cKDTree(bank), cKDTree(water)
        for name, location in anchors.items():
            if not bounds.covers(Point(location)):continue
            for idx in np.atleast_1d(shores.query(location,k=min(96,len(bank)))[1]):
                east,south = bank[idx]; point = Point(east,south)
                if obstacles.query(point.buffer(1),predicate='intersects').size: continue
                wx,wz = water[moorings.query((east,south))[1]]; row,col=int((wz-top)/GRID),int((wx-left)/GRID)
                docks[name]=[east,sample(east,south)[0],south];nodes[name]=ids[row,col];break
        for kind, stops in [('raft',['解放桥码头','象山渔人码头','解放桥码头']),('boat',['日月湾码头','杉湖','榕湖','桂湖','木龙湖','解放桥码头','文昌桥码头','知音台码头','日月湾码头'])]:
            for start,end in zip(stops,stops[1:]):
                if start not in nodes or end not in nodes:continue
                costs,prev=dijkstra(graph,directed=False,indices=nodes[start],return_predecessors=True)
                node=nodes[end]; path=[]
                if not np.isfinite(costs[node]) or node==nodes[start]:continue
                while True:
                    row,col=divmod(cells[node],cols);path.append([int(xs[col]),int(surface[row,col])/10,int(zs[row])])
                    if node==nodes[start]:break
                    node=prev[node]
                routes.append(dict(kind=kind,start=start,end=end,path=path[::-1]))
    return dict(bikes=bikes,bicycles=bicycles,docks=docks,routes=routes,grid=[left,top,cols,rows,GRID],mask=base64.b64encode(np.packbits(mask).tobytes()).decode())


def write_vehicles(output,data,triangles):
    data['routes']=return_trips(audit_routes(data['routes'],triangles,select=True))
    data['clearance'] = audit_routes(data['routes'],triangles)
    (output/'vehicles.bin').write_bytes(gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
