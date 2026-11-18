from shapely.geometry import LineString

from common import load_osm
from features import points


def limit_routes(routes, sample):
    bridges = []
    for way in load_osm():
        tags = way.get('tags', {})
        coords = points(way)
        if tags.get('bridge', 'no') == 'no' or 'highway' not in tags or len(coords) < 2:
            continue
        line = LineString(coords)
        ends = [sample(*coords[index]) for index in (0,-1)]
        bridges.append((way['id'], tags.get('name', '无名'), line, ends))
    kept = []
    for route in routes:
        path = route['path']
        track = LineString([(east,south,level) for east,level,south in path])
        failures = []
        for osm_id, name, line, ends in bridges:
            hit = line.intersection(track)
            hits = hit.geoms if hasattr(hit,'geoms') else [hit]
            for crossing in hits:
                if crossing.is_empty or crossing.geom_type != 'Point':
                    continue
                station = track.project(crossing)
                height = track.interpolate(station).z
                along = line.project(crossing)
                upper = min((ground + 2.5 + distance*.06 for (ground,water),distance in
                             zip(ends,(along,line.length-along)) if water == -32768),default=float('inf'))
                target = height + 1.895 + .4 + .6
                if upper < target:
                    failures.append((osm_id,name,round(target,2),round(float(upper),2)))
        if failures:
            print(f"截航 {route['start']} → {route['end']}: OSM/桥名/最低所需桥面/可达上限(m) {failures}")
        else:
            kept.append(route)
    incoming = {(leg['kind'],leg['end']): leg for leg in kept}
    outgoing = {(leg['kind'],leg['start']) for leg in kept}
    for leg in kept[:]:
        if (leg['kind'],leg['end']) not in outgoing:
            while leg:
                kept.append(dict(kind=leg['kind'], start=leg['end'], end=leg['start'], path=leg['path'][::-1]))
                leg = incoming.get((leg['kind'],leg['start']))
    return kept
