import json
import subprocess
from pathlib import Path

import numpy as np
from shapely import STRtree, get_coordinates
from shapely.geometry import Polygon, LineString
from features import area, points
from common import load_osm


BOUNDS = json.loads(Path(__file__).with_name('vessel-bounds.json').read_text())


def landmark_triangles(landmarks):
    root=Path(__file__).resolve().parent
    specs={entry['id']:entry for entry in json.loads((root/'landmarks.json').read_text())}
    bridges={f"way/{way['id']}":way for way in load_osm() if way['type']=='way' and way.get('tags',{}).get('bridge','no')!='no'}
    for entry in landmarks:
        replacements=specs[entry['id']].get('replace',[])
        for ref in bridges.keys() & set(replacements):
            way=bridges[ref]; shape=area(way)
            if shape.is_empty: shape=LineString(points(way)).buffer(8)
            raw=subprocess.check_output(['node',root/'glb-triangles.mjs',root.parent/'public'/entry['file']])
            vertices=np.frombuffer(raw,'<f4').astype(float).reshape(-1,3,3)
            angle=np.deg2rad(entry['rotation']); cosine,sine=np.cos(angle),np.sin(angle)
            vertices=vertices@np.array([[cosine,0,-sine],[0,1,0],[sine,0,cosine]])+entry['position']
            west,north,east,south=shape.buffer(4).bounds
            nearby=(vertices[:,:,0].min(axis=1)<=east)&(vertices[:,:,0].max(axis=1)>=west)&(vertices[:,:,2].min(axis=1)<=south)&(vertices[:,:,2].max(axis=1)>=north)
            if not nearby.any(): raise ValueError(f'No GLB faces near {ref}')
            for face in vertices[nearby]: yield way['id'],face,0


def audit_routes(routes, triangles, select=False):
    shapes, planes, ids = [], [], []
    for osm_id, vertices, *depth in triangles:
        coords = vertices[:, [0, 2]]
        shape = Polygon(coords)
        if shape.area>1e-9:
            shapes.append(shape)
            planes.append(np.linalg.solve(np.column_stack((coords, np.ones(3))), vertices[:, 1]-(depth[0] if depth else BOUNDS['bridgeDepth'])))
            ids.append(osm_id)
    tree = STRtree(shapes)
    minima = {}
    kept=[]
    for route in routes:
        vessel = BOUNDS[route['kind']]
        route_min={}
        for start, end in zip(route['path'], route['path'][1:]):
            first, last = np.array(start)[[0, 2]], np.array(end)[[0, 2]]
            direction = (last-first)/np.linalg.norm(last-first)
            side = direction[::-1]*[-1, 1]*vessel['width']/2
            nose = direction*vessel['length']/2
            swept = Polygon([first-nose-side, first-nose+side, last+nose+side, last+nose-side])
            top = max(start[1], end[1]) + max(vessel['roof'], vessel['head'])
            for index in tree.query(swept, predicate='intersects'):
                coords = get_coordinates(shapes[index].intersection(swept))
                if not len(coords): continue
                bottom = (coords @ planes[index][:2]).min() + planes[index][2]
                gap = float(bottom-top)
                if not select and gap < .3-1e-10:
                    raise ValueError(f"{route['start']} → {route['end']} {route['kind']} OSM {ids[index]}: 净空 {gap:.4f} m < 0.3 m")
                route_min[ids[index]]=min(gap,route_min.get(ids[index],gap))
        required=.4 if route['kind']=='boat' else .3
        failures={key:round(required-value,3) for key,value in route_min.items() if value<required-1e-10}
        if select:
            print(f"{route['start']} → {route['end']}: "+(f'截航，桥 ID/欠净空(m) {failures}' if failures else f'通航，桥 ID/净空(m) { {key:round(value,3) for key,value in route_min.items()} }'))
            if failures: continue
        kept.append(route)
        for key,value in route_min.items(): minima[key]=min(value,minima.get(key,value))
    if select: return kept
    return {'bridges': sorted(minima), 'minimum': min(minima.values(), default=None)}
