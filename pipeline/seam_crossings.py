"""Compare street features on parallel traces immediately inside/outside a mask."""
import math

import shapely


def nearby_features(streets, region):
    size = streets.world.size
    band = region.boundary.buffer(.4)
    west,north,east,south = band.bounds
    features = {'marking':[], 'curb':[]}
    for col in range(math.floor(west/size),math.floor(east/size)+1):
        for row in range(math.floor(north/size),math.floor(south/size)+1):
            origin = col*size,row*size
            if origin not in streets.world.files: continue
            tree,kinds,_ = streets.tile(origin)
            tile = shapely.box(*origin,origin[0]+size,origin[1]+size)
            for index in tree.query(band):
                kind = kinds[index]
                if kind not in (1,2): continue
                shape = shapely.make_valid(tree.geometries[index])
                geometry = shape if kind==2 else shape.boundary.difference(tile.boundary)
                features['marking' if kind==2 else 'curb'].append(geometry.intersection(band))
    return {kind:shapely.union_all(parts) for kind,parts in features.items()}


def crossings(region, features):
    traces = [region.buffer(distance,join_style='mitre').boundary for distance in (-.01,.01)]
    for kind, feature in features.items():
        groups = shapely.get_parts(feature) if kind=='marking' else [feature]
        for group in groups:
            points = []
            for trace in traces:
                parts = shapely.get_parts(group.intersection(trace))
                points.append([part.interpolate(.5,normalized=True) if part.geom_type=='LineString' else part
                               for part in parts if not part.is_empty and part.geom_type in ('LineString','Point')])
            for side, anchors in enumerate(points):
                others = shapely.STRtree(points[1-side])
                for point in anchors:
                    index = others.nearest(point)
                    match = None if index is None else others.geometries[index]
                    distance = None if match is None else point.distance(match)
                    if side and distance is not None and distance<=.3: continue
                    yield kind,point,distance,side
