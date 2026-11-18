import json
from pathlib import Path

import numpy as np
from shapely import STRtree, get_coordinates
from shapely.geometry import Polygon


BOUNDS = json.loads(Path(__file__).with_name('vessel-bounds.json').read_text())


def audit_routes(routes, triangles):
    shapes, planes, ids = [], [], []
    for osm_id, vertices in triangles:
        coords = vertices[:, [0, 2]]
        shape = Polygon(coords)
        if shape.area:
            shapes.append(shape)
            planes.append(np.linalg.solve(np.column_stack((coords, np.ones(3))), vertices[:, 1]))
            ids.append(osm_id)
    tree = STRtree(shapes)
    minima = {}
    for route in routes:
        vessel = BOUNDS[route['kind']]
        for start, end in zip(route['path'], route['path'][1:]):
            first, last = np.array(start)[[0, 2]], np.array(end)[[0, 2]]
            direction = (last-first)/np.linalg.norm(last-first)
            side = direction[::-1]*[-1, 1]*vessel['width']/2
            nose = direction*vessel['length']/2
            swept = Polygon([first-nose-side, first-nose+side, last+nose+side, last+nose-side])
            top = max(start[1], end[1]) + max(vessel['roof'], vessel['head'])
            for index in tree.query(swept, predicate='intersects'):
                coords = get_coordinates(shapes[index].intersection(swept))
                bottom = (coords @ planes[index][:2]).min() + planes[index][2] - BOUNDS['bridgeDepth']
                gap = float(bottom-top)
                if gap < .3-1e-10:
                    raise ValueError(f"{route['start']} → {route['end']} {route['kind']} OSM {ids[index]}: 净空 {gap:.4f} m < 0.3 m")
                minima[ids[index]] = min(gap, minima.get(ids[index], gap))
    return {'bridges': sorted(minima), 'minimum': min(minima.values(), default=None)}
