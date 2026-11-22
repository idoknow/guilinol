"""Report projected mountain/at-grade highway overlap, including 2 m beyond sidewalks."""
import gzip
import json
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString, Polygon, box

from common import OUT
from dongxi_streets import street_surface
from features import area, points, raw_overture_footprints
from landmark_solids import load_landmark_meshes
from road_profile import RULES
from scatter import extract_road_network


def road_buffers(bounds):
    elements, roads, *_ = extract_road_network(raw_overture_footprints(bounds))
    profiles = {r.way: r.aligned_section() for r in roads}
    ways, buffers = [], []
    for e in elements:
        tags = e.get('tags', {})
        if e['type'] != 'way' or 'highway' not in tags or len(points(e)) < 2:
            continue
        if any(tags.get(key, 'no') != 'no' for key in ('bridge', 'tunnel')):
            continue
        if tags.get('area') == 'yes':
            surface = area(e)
        elif e['id'] in profiles:
            road = profiles[e['id']]
            parts = [street_surface(road)]
            for side, width in ((-1, road.left), (1, road.right)):
                if width:
                    if str(road.way) in RULES['frontageSections']:
                        width = sum(road.dimensions[k] for k in ('verge','cycle','curb','walk'))
                    parts.append(road.side_line(side).buffer(side*(road.width/2+width),
                                                             single_sided=True, quad_segs=2))
            surface = shapely.union_all(parts)
        else:
            surface = LineString(points(e)).buffer(1.5, quad_segs=2)
        ways.append(e)
        buffers.append(surface.buffer(2))
    return ways, shapely.STRtree(buffers)


def footprint(peak, data, output):
    if 'model' in peak:
        lm = dict(id=peak['name'], file=peak['model'], position=peak['center'])
        mesh = load_landmark_meshes(output.parent.parent, {'landmarks':[lm]})[lm['id']]
        triangles = np.concatenate((mesh['vis_tris'], mesh['coll_tris']))
        return shapely.union_all(shapely.polygons(triangles[:,:,[0,2]]))
    parts = []
    for level, lod in enumerate(peak['lods']):
        verts = np.frombuffer(data,'<i2',lod['vertices']*3,lod['offset']).reshape(-1,3)
        coords = verts[:,[0,2]]/100 + np.array(peak['center'])[::2]
        ring = Polygon(coords[:32 if level else 128])
        indices = np.frombuffer(data,'<u2',lod['indices'],lod['indexOffset']).reshape(-1,3)
        outside = ~shapely.intersects_xy(ring, *coords.T)
        parts.extend(shapely.polygons(coords[indices[outside[indices].any(axis=1)]]))
        parts.append(ring)
    return shapely.union_all(parts)


def verify(output=Path(OUT)):
    manifest = json.loads((output/'manifest.json').read_text())
    x,z,w,h = manifest['extent']
    ways, tree = road_buffers(box(x,z,x+w,z+h))
    peaks = manifest['peaks']
    data = gzip.decompress((output/peaks['file']).read_bytes())
    print('peak\tunion_m2\tOSM way (individual m2)')
    for peak in peaks['entries']:
        shape = footprint(peak, data, output.resolve())
        hits = sorted(tree.query(shape, predicate='intersects'))
        overlaps = [(ways[i], shape.intersection(tree.geometries[i])) for i in hits]
        total = shapely.union_all([p for _, p in overlaps]).area
        details = ', '.join(f"{e['id']} {e['tags'].get('name',e['tags']['highway'])} ({p.area:.2f})"
                            for e,p in overlaps if p.area)
        print(f"{peak['name']}\t{total:.2f}\t{details}")
        if peak['name'] == '伏波山':
            fubo_area = total
    return fubo_area == 0


if __name__ == '__main__':
    raise SystemExit(0 if verify() else 1)
