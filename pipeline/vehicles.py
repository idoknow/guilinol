import base64
import gzip
import json
import math
import random
import subprocess
from pathlib import Path

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
from clearance import audit_routes, navigable_edges
from cars import plan_cars


def plan_vehicles(bounds, surface, roads, buildings, sample, landmark_faces=(), interchange=None, grid_origin=None, routes_only=False):
    left, top, right, bottom = bounds.bounds
    if grid_origin is not None:
        left,top = grid_origin
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
        if routes_only or el['type'] != 'way':
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
    # Guaranteed starter e-bike & pedal bicycle in the open plaza ahead of default walk spawn (-588, -212),
    # clear of the south wall and west aisle and angled east-southeast toward the exit corridor.
    for target_list, (sx, sz, s_yaw, s_paint) in (
        (bikes, (-585, -226, -1.64, 0)),
        (bicycles, (-592, -226, -1.64, 2)),
    ):
        pt = Point(sx, sz)
        if bounds.contains(pt):
            sg, sw = sample(sx, sz)
            if sw == -32768 and not obstacles.query(pt.buffer(0.8), predicate='intersects').size:
                entry = [round(sx, 1), round(sg, 1), round(sz, 1), round(s_yaw, 3), s_paint]
                target_list.append(entry)
                placed.append(entry)
                extras.append(pt.buffer(12.0))
    if interchange is not None:
        origin,angle,bank_pavement=interchange
        transform=np.array([[math.cos(angle),math.sin(angle)],[-math.sin(angle),math.cos(angle)]])
        axis=np.array([[-140,0],[140,0]])@transform+origin
        extras.extend((LineString(axis).buffer(21.5,cap_style='flat'),bank_pavement))
        # Lower bike stand beside the northern landing, clear of the +0.45 m west-bank portal steps.
        x,z=np.array([-117.5,-26.0])@transform+origin
        bikes.append([round(x,2),sample(x,z)[0]+.2,round(z,2),round(angle,3),1])
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
    graphs = {}
    if landmark_faces:
        edges = graph.tocoo()
        row, col = np.unravel_index(cells, wet.shape)
        coords = np.column_stack((xs[col], zs[row]))
        levels = surface[row, col]
        for kind in ('boat', 'raft'):
            keep = navigable_edges(landmark_faces, coords[edges.row], coords[edges.col],
                                   np.maximum(levels[edges.row], levels[edges.col]), kind)
            graphs[kind] = coo_matrix((edges.data[keep], (edges.row[keep], edges.col[keep])), shape=graph.shape).tocsr()
    docks, nodes, routes = {}, {}, []
    if wet.any() and (~wet).any():
        bank = locations((~wet)&(distance_transform_edt(~wet)<=2)); water = locations(clearance>=2) if clearance.max()>=2 else locations(wet)
        shores, moorings = cKDTree(bank), cKDTree(water)
        for name, location in anchors.items():
            if not bounds.covers(Point(location)):continue
            for idx in np.atleast_1d(shores.query(location,k=min(96,len(bank)))[1]):
                east,south = map(float,bank[idx]); point = Point(east,south)
                if obstacles.query(point.buffer(1),predicate='intersects').size: continue
                wx,wz = water[moorings.query((east,south))[1]]; row,col=int((wz-top)/GRID),int((wx-left)/GRID)
                docks[name]=[east,sample(east,south)[0],south];nodes[name]=ids[row,col];break
        for kind, stops in [('raft',['解放桥码头','象山渔人码头','解放桥码头']),('boat',['日月湾码头','杉湖','榕湖','桂湖','木龙湖','解放桥码头','文昌桥码头','知音台码头','日月湾码头'])]:
            for start,end in zip(stops,stops[1:]):
                if start not in nodes or end not in nodes:continue
                costs,prev=dijkstra(graphs.get(kind, graph),directed=False,indices=nodes[start],return_predecessors=True)
                node=nodes[end]; path=[]
                if not np.isfinite(costs[node]):
                    raise ValueError(f"{start} → {end}: 截航，无可通行的水路")
                if node==nodes[start]:continue
                while True:
                    row,col=divmod(cells[node],cols);path.append([int(xs[col]),int(surface[row,col])/10,int(zs[row])])
                    if node==nodes[start]:break
                    node=prev[node]
                routes.append(dict(kind=kind,start=start,end=end,path=path[::-1]))
    if routes_only:
        return {'routes':routes}
    pavement = union_all(roads+extras).buffer(3).intersection(bounds)
    mask = intersects_xy(pavement,xs[None,:],zs[:,None])
    return dict(bikes=bikes,bicycles=bicycles,docks=docks,routes=routes,grid=[left,top,cols,rows,GRID],mask=base64.b64encode(np.packbits(mask).tobytes()).decode(),**plan_cars(bounds,surface,buildings,sample,placed,docks,interchange=interchange))


def write_vehicles(output,data,triangles):
    from pickup_curbs import align_jiefang_pickups
    root = Path(__file__).resolve().parents[1]
    spawns = {key: data[key] for key in ('bikes','sharedBikes','bicycles','cars') if key in data}
    filtered = subprocess.run([root/'node_modules/.bin/tsx', root/'scripts/filter-parked.ts'],
                              input=json.dumps(spawns), capture_output=True, text=True, check=True)
    data.update(json.loads(filtered.stdout))
    align_jiefang_pickups(data['cars'])
    checked = audit_routes(data['routes'], triangles, select=True)
    if len(checked) != len(data['routes']):
        raise ValueError('航道核查失败，有航段净空不足')
    data['routes'] = return_trips(checked)
    data['clearance'] = audit_routes(data['routes'],triangles)
    # Keep the empty cells out of the JSON text that V8 allocates on load.
    data['maskEncoding'] = 'gzip'
    for key in ('mask', 'motorMask'):
        packed = gzip.compress(base64.b64decode(data[key]), compresslevel=6, mtime=0)
        data[key] = base64.b64encode(packed).decode()
    (output/'vehicles.bin').write_bytes(gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
