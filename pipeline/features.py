import csv
import json
from collections import Counter
import zlib
from pathlib import Path

import mapbox_earcut
import numpy as np
from shapely import STRtree, from_wkt, make_valid
from shapely.affinity import affine_transform
from shapely.geometry import LineString, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import polygonize, unary_union

from common import LAT0, LON0, MLAT, MLON, RAW, ll2xz, load_osm
from road_profile import RULES


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
    landmarks = json.loads(Path(__file__).with_name('landmarks.json').read_text())
    replaced_pitches = {key for landmark in landmarks for key in landmark.get('replacePitches', [])}
    layers = dict(green=[], water=[], road=[])
    widths = {'primary': 14, 'secondary': 12, 'tertiary': 10, 'trunk': 18, 'residential': 6}
    for element in load_osm():
        tags = element.get('tags', {})
        if tags.get('leisure') == 'pitch' and f"{element['type']}/{element['id']}" in replaced_pitches:
            continue
        if tags.get('natural') == 'water' or tags.get('waterway') == 'riverbank' or 'water' in tags:
            key = 'water'
        elif (tags.get('natural') in ('wood', 'grassland', 'scrub') or tags.get('leisure') in ('park','garden','pitch')
              or tags.get('landuse') in ('forest','grass','meadow','recreation_ground','village_green')):
            key = 'green'
        elif 'highway' in tags and element['type'] == 'way':
            if tags['highway'] in RULES['defaultWidth'] and tags.get('bridge','no')=='no' and tags.get('tunnel','no')=='no':
                continue
            coords = points(element)
            if len(coords) > 1:
                road = LineString(coords).buffer(widths.get(tags['highway'], 3)/2, quad_segs=2)
                layers['road'].extend(polygons(road.intersection(bounds)))
            continue
        else:
            continue
        layers[key].extend(polygons(area(element).intersection(bounds)))
    return layers


def buildings(bounds, elevation, peaks,layout):
    footprints, heights = [], []
    rules = json.loads(Path(__file__).with_name('building-kinds.json').read_text())
    districts = unary_union([Polygon([ll2xz(*ll) for ll in ring]) for ring in rules['oldDistrictsLatLon']])
    campuses = STRtree([area(el) for el in load_osm() if el['type']!='node' and any(
        el.get('tags',{}).get(tag) in rules['glazedUses'] for tag in ['building','amenity','office','tourism'])])
    kinds = Counter()
    with (Path(RAW)/'overture_buildings.csv').open() as source:
        for row in csv.DictReader(source, delimiter='\t'):
            geometry = affine_transform(from_wkt(row['wkt']), [MLON, 0, 0, -MLAT, -LON0*MLON, LAT0*MLAT])
            if row['id'] in layout.ids:
                layout.exclude = layout.exclude.union(geometry)
                continue
            if not geometry.intersects(bounds) or layout.exclude.intersects(geometry):
                continue
            for poly in polygons(make_valid(geometry)):
                if peaks.query(poly,predicate='intersects').size:
                    continue
                center = poly.representative_point()
                seed = zlib.crc32(row['id'].encode())
                variation = seed % 3
                floors = min(7, 1 + int(np.sqrt(poly.area)/10) + variation)
                if -1700 < center.x < 300 and -1800 < center.y < 700:
                    floors = min(floors, 4)
                base = elevation(center.x, center.y)
                footprints.append(poly)
                kind = 0
                if floors<=rules['oldMaxFloors'] and districts.covers(center):
                    kind = 1
                elif floors<=rules['glazedMaxFloors'] and seed%100<rules['glazedPercent'] and campuses.query(center,predicate='intersects').size:
                    kind = 2
                rectangle=[]
                if kind:
                    rect=poly.minimum_rotated_rectangle
                    rectangle=[np.rint((np.array(pt)-center.coords[0])*100).astype(int).tolist() for pt in list(rect.exterior.coords)[:4]]
                heights.append((base,base+3.1*floors,kind,floors,seed,center,rectangle,poly.area/poly.minimum_rotated_rectangle.area<.78))
                kinds[kind]+=1
    print('Building kinds:',dict(kinds))
    return footprints, heights


def building_mesh(parts, origin):
    positions, normals, indices, collision = [], [], [], []
    for polygon, (base, roof, kind, floors, seed, center, rectangle, complex_shape) in parts:
        polygon = orient(polygon, sign=1)
        rings = [np.asarray(ring.coords)[:-1] - origin for ring in [polygon.exterior, *polygon.interiors]]
        coords = np.concatenate(rings)
        triangles = mapbox_earcut.triangulate_float64(coords, np.cumsum([len(ring) for ring in rings], dtype='uint32'))
        indices.extend((triangles.reshape(-1,3)[:, ::-1]+len(positions)).ravel())
        positions.extend((east, roof, south) for east, south in coords)
        normals.extend([(0,127,0)]*len(coords))
        anchor=np.rint((np.asarray(center.coords[0])-origin)*100).astype(int).tolist()
        owner=0<=center.x-origin[0]<256 and 0<=center.y-origin[1]<256 and polygon.covers(center)
        collision.append([round(base*10),round(roof*10),[np.rint(ring*100).astype(int).tolist() for ring in rings],
                          kind,floors,seed,anchor if owner else [],rectangle if owner else [],int(complex_shape)])
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
