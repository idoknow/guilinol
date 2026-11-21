"""Keep lower OSM ways independent of the modeled deck's plan-view mask."""
import numpy as np
import shapely

from common import load_osm
from features import points
from landmarks.jiefang_layout import LOWER_ROADS, SPAN_WAYS, widths
from sections import section_layers


def level(tags):
    return int(tags.get('layer', 1 if tags.get('bridge','no')!='no' else 0))


def lower_paths(roads, slab):
    if slab is None: return {}
    osm = {item['id']:item for item in load_osm() if item['type']=='way'}
    spans = [(shapely.LineString(points(osm[key])),level(osm[key]['tags']),set(osm[key]['nodes']))
             for key in SPAN_WAYS if key in osm and level(osm[key]['tags'])>=1]
    forms = {}; portal_zone = slab.buffer(24)
    corners = np.asarray(slab.exterior.coords)[:4]
    along = corners[1]-corners[0]; across = corners[3]-corners[0]
    axes = np.stack([along/np.linalg.norm(along), across/np.linalg.norm(across)])
    lower_terrace = shapely.Polygon(np.array([[-114.7,26.3],[-106.9,26.3],[-106.9,47.3],[-114.7,47.3]])@axes+corners.mean(axis=0))
    def add(kind,shape):
        clipped = shape.intersection(zone)
        if kind in (1,4,6): clipped = clipped.difference(lower_terrace)
        if clipped.area: forms.setdefault(kind,[]).append(clipped)
    for road in roads:
        if not road.line.intersects(slab) or road.way not in osm: continue
        way = osm[road.way]
        if not any(level(way['tags'])<upper and road.line.crosses(axis) and nodes.isdisjoint(way['nodes']) for axis,upper,nodes in spans): continue
        zone = road.line.buffer(road.width/2+max(road.left,road.right)+2) if road.way==682893309 else portal_zone
        add(0,road.pavement)
        modeled = widths(road.way)[:2] if road.way in LOWER_ROADS else None
        for lane in range(1,road.lanes):
            offset = road.width*(lane/road.lanes-.5)
            if modeled and modeled[0] <= offset <= modeled[1]: continue
            add(2,road.line.offset_curve(offset).buffer(.09,quad_segs=1))
        if road.section:
            for kind,tree in zip((1,4,5,6),section_layers([road])):
                add(kind,shapely.union_all(tree.geometries))
        else:
            for side,width in ((-1,road.left),(1,road.right)):
                if width: add(1,road.line.buffer(side*(road.width/2+width),single_sided=True,quad_segs=2).difference(road.pavement))
    merged = {kind:shapely.union_all(parts) for kind,parts in forms.items()}
    if 6 in merged and 1 in merged: merged[1] = merged[1].difference(merged[6])
    return merged


def grade_frame(slab,origin):
    return (np.asarray(slab.exterior.coords)[:4]-origin).round(4).tolist()
