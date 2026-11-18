import csv
import zlib
from pathlib import Path

import mapbox_earcut
import numpy as np
from shapely import from_wkt, make_valid
from shapely.affinity import affine_transform
from shapely.geometry import LineString, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import polygonize, unary_union

from common import LAT0, LON0, MLAT, MLON, RAW, ll2xz, load_osm


def polygons(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type == 'Polygon':
        yield geometry
    elif hasattr(geometry, 'geoms'):
        for part in geometry.geoms:
            yield from polygons(part)


def points(way):
    return [ll2xz(node['lat'], node['lon']) for node in way.get('geometry', [])]


def area(element):
    if element['type'] == 'way':
        coords = points(element)
        return make_valid(Polygon(coords)) if len(coords) >= 4 and coords[0] == coords[-1] else Polygon()
    def rings(role):
        lines = [points(member) for member in element.get('members', []) if member['role'] == role]
        return unary_union(list(polygonize([LineString(line) for line in lines if len(line) >= 2])))
    return rings('outer').difference(rings('inner'))


def ground_features(bounds):
    layers = dict(green=[], water=[], road=[])
    widths = {'primary': 14, 'secondary': 12, 'tertiary': 10, 'trunk': 18, 'residential': 6}
    for element in load_osm():
        tags = element.get('tags', {})
        if tags.get('natural') == 'water' or tags.get('waterway') == 'riverbank' or 'water' in tags:
            key = 'water'
        elif (tags.get('natural') in ('wood', 'grassland', 'scrub') or tags.get('leisure') in ('park','garden','pitch')
              or tags.get('landuse') in ('forest','grass','meadow','recreation_ground','village_green')):
            key = 'green'
        elif 'highway' in tags and element['type'] == 'way':
            coords = points(element)
            if len(coords) > 1:
                road = LineString(coords).buffer(widths.get(tags['highway'], 3)/2, quad_segs=2)
                layers['road'].extend(polygons(road.intersection(bounds)))
            continue
        else:
            continue
        layers[key].extend(polygons(area(element).intersection(bounds)))
    return layers


def buildings(bounds, elevation):
    footprints, heights = [], []
    with (Path(RAW)/'overture_buildings.csv').open() as source:
        for row in csv.DictReader(source, delimiter='\t'):
            geometry = affine_transform(from_wkt(row['wkt']), [MLON, 0, 0, -MLAT, -LON0*MLON, LAT0*MLAT])
            if not geometry.intersects(bounds):
                continue
            for poly in polygons(make_valid(geometry)):
                center = poly.representative_point()
                variation = zlib.crc32(row['id'].encode()) % 3
                floors = min(7, 1 + int(np.sqrt(poly.area)/10) + variation)
                if -1700 < center.x < 300 and -1800 < center.y < 700:
                    floors = min(floors, 4)
                base = elevation(center.x, center.y)
                footprints.append(poly)
                heights.append((base, base + 3.1*floors))
    return footprints, heights


def building_mesh(parts, origin):
    positions, normals, indices, collision = [], [], [], []
    for polygon, (base, roof) in parts:
        polygon = orient(polygon, sign=1)
        rings = [np.asarray(ring.coords)[:-1] - origin for ring in [polygon.exterior, *polygon.interiors]]
        coords = np.concatenate(rings)
        triangles = mapbox_earcut.triangulate_float64(coords, np.cumsum([len(ring) for ring in rings], dtype='uint32'))
        indices.extend((triangles.reshape(-1,3)[:, ::-1]+len(positions)).ravel())
        positions.extend((east, roof, south) for east, south in coords)
        normals.extend([(0,127,0)]*len(coords))
        collision.append([round(base*10), round(roof*10), [np.rint(ring*100).astype(int).tolist() for ring in rings]])
        for ring in rings:
            for start, end in zip(ring, np.roll(ring, -1, axis=0)):
                delta = end - start
                length = np.linalg.norm(delta)
                if length < 0.005:
                    continue
                normal = np.rint(127*delta/length).astype(int)
                offset = len(positions)
                positions.extend([(start[0],base-3,start[1]), (start[0],roof,start[1]),
                                  (end[0],roof,end[1]), (end[0],base-3,end[1])])
                normals.extend([(normal[1],0,-normal[0])]*4)
                indices.extend(offset+corner for corner in (0,1,2,0,2,3))
    quantized = np.rint(np.asarray(positions).reshape(-1,3)*[100,10,100])
    if np.any(np.abs(quantized)>32767):
        raise ValueError('Building outside int16 quantization range')
    return (quantized.astype('<i2').tobytes(), np.asarray(normals,'i1').tobytes(),
            np.asarray(indices,'<u4').tobytes(), collision)
