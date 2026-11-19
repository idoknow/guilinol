import csv
import json
from collections import Counter
import zlib
from pathlib import Path

import mapbox_earcut
import numpy as np
from shapely import STRtree, from_wkt, make_valid
from shapely.affinity import affine_transform, rotate
from shapely.geometry import LineString, Polygon, box
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


def ground_features(bounds, school_grounds=()):
    landmarks = json.loads(Path(__file__).with_name('landmarks.json').read_text())
    replaced_pitches = {key for landmark in landmarks for key in landmark.get('replacePitches', [])}
    layers = dict(green=[], water=[], road=[])
    grounds = unary_union(school_grounds)
    layers.update(schoolTrack=[], schoolCourt=[])
    widths = {'primary': 14, 'secondary': 12, 'tertiary': 10, 'trunk': 18, 'residential': 6}
    for element in load_osm():
        tags = element.get('tags', {})
        if tags.get('leisure') == 'pitch' and f"{element['type']}/{element['id']}" in replaced_pitches:
            continue
        if element['type'] != 'node' and tags.get('leisure') in ('track','pitch'):
            shape = area(element)
            if not shape.is_empty and grounds.covers(shape.representative_point()):
                key = 'schoolTrack' if tags['leisure']=='track' else 'schoolCourt'
                layers[key].extend(polygons(shape.intersection(bounds)))
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


def overture_geometry(row):
    shape = affine_transform(from_wkt(row['wkt']), [MLON, 0, 0, -MLAT, -LON0*MLON, LAT0*MLAT])
    if row['id'] == '94d505df-4dd6-4bdf-b242-be218cce7937':
        # IMG_1299 shows an open sidewalk at the survey point. Set the Rongyin
        # frontage behind it, parallel to the existing east facade of this block.
        photo = json.loads((Path(__file__).resolve().parents[1] / 'docs/refs/rock/photo-locations.json').read_text())['IMG_1299.jpg']
        eye = np.array([photo['x'], photo['z']])
        along = np.array([11.22, -24.99])
        along /= np.linalg.norm(along)
        inward = np.array([along[1], -along[0]])
        edge = eye + inward * 2
        reach = shape.length
        cut = Polygon([edge + a * along + b * inward for a, b in
                       [(-reach, 0), (reach, 0), (reach, reach), (-reach, reach)]])
        shape = shape.intersection(cut)
    return shape


def raw_overture_footprints(bounds):
    out = []
    with (Path(RAW)/'overture_buildings.csv').open() as source:
        for row in csv.DictReader(source, delimiter='\t'):
            geometry = overture_geometry(row)
            if geometry.intersects(bounds):
                out.extend(polygons(make_valid(geometry)))
    return out


def buildings(bounds, elevation, peaks, layout, carriageway_mask=None, sidewalk_mask=None):
    footprints, heights = [], []
    grounds = unary_union(layout.school_grounds)
    rules = json.loads(Path(__file__).with_name('building-kinds.json').read_text())
    districts = unary_union([Polygon([ll2xz(*ll) for ll in ring]) for ring in rules['oldDistrictsLatLon']])
    campuses = STRtree([area(el) for el in load_osm() if el['type']!='node' and any(
        el.get('tags',{}).get(tag) in rules['glazedUses'] for tag in ['building','amenity','office','tourism'])])
    replace_excl = getattr(layout, 'replace_exclude', layout.exclude)
    model_excl = getattr(layout, 'model_footprints', Polygon()).buffer(0.10)
    road_tree = STRtree(list(polygons(carriageway_mask))) if carriageway_mask and not carriageway_mask.is_empty else None
    sw_tree = STRtree(list(polygons(sidewalk_mask))) if sidewalk_mask and not sidewalk_mask.is_empty else None
    kinds = Counter()
    removed_road, clipped_road, clipped_sw = 0, 0, 0
    with (Path(RAW)/'overture_buildings.csv').open() as source:
        for row in csv.DictReader(source, delimiter='\t'):
            geometry = overture_geometry(row)
            if row['id'] in layout.ids:
                replace_excl = replace_excl.union(geometry)
                layout.exclude = layout.exclude.union(geometry)
                continue
            if not geometry.intersects(bounds) or replace_excl.intersects(geometry):
                continue
            for raw_poly in polygons(make_valid(geometry)):
                if peaks.query(raw_poly,predicate='intersects').size:
                    continue
                orig_area = raw_poly.area
                if orig_area < 4.0:
                    continue
                cand_polys = [raw_poly]
                if not model_excl.is_empty and raw_poly.intersects(model_excl):
                    diff_m = make_valid(raw_poly.difference(model_excl))
                    if diff_m.is_empty or (orig_area - diff_m.area) / orig_area > 0.40:
                        continue
                    cand_polys = [p for p in polygons(diff_m) if p.area >= 4.0]
                if road_tree is not None:
                    next_polys = []
                    for cp in cand_polys:
                        hits = road_tree.query(cp, predicate='intersects')
                        if not hits.size:
                            next_polys.append(cp)
                            continue
                        local_road = unary_union(road_tree.geometries.take(hits))
                        trimmed = make_valid(cp.difference(local_road))
                        if trimmed.is_empty or (cp.area - trimmed.area) / cp.area > 0.40:
                            removed_road += 1
                            continue
                        clipped_road += 1
                        next_polys.extend(p for p in polygons(trimmed) if p.area >= 6.0)
                    cand_polys = next_polys
                if sw_tree is not None and cand_polys:
                    next_polys = []
                    for cp in cand_polys:
                        hits = sw_tree.query(cp, predicate='intersects')
                        if not hits.size:
                            next_polys.append(cp)
                            continue
                        local_sw = unary_union(sw_tree.geometries.take(hits))
                        trimmed = make_valid(cp.difference(local_sw))
                        if not trimmed.is_empty:
                            clipped_sw += 1
                            next_polys.extend(p for p in polygons(trimmed) if p.area >= 4.0)
                    cand_polys = next_polys
                for poly in cand_polys:
                    poly = poly.buffer(0)
                    if poly.is_empty or poly.area < 4.0:
                        continue
                    for sub in polygons(poly):
                        if sub.area < 4.0 or sub.minimum_rotated_rectangle.area <= 0:
                            continue
                        center = sub.representative_point()
                        seed = zlib.crc32(f"{row['id']}:{round(center.x,1)}:{round(center.y,1)}".encode())
                        variation = seed % 3
                        floors = min(7, 1 + int(np.sqrt(sub.area)/10) + variation)
                        if -1700 < center.x < 300 and -1800 < center.y < 700:
                            floors = min(floors, 4)
                        base = elevation(center.x, center.y)
                        footprints.append(sub)
                        kind = 0
                        if grounds.covers(center):
                            kind = 3
                        elif floors<=rules['oldMaxFloors'] and districts.covers(center):
                            kind = 1
                        elif floors<=rules['glazedMaxFloors'] and seed%100<rules['glazedPercent'] and campuses.query(center,predicate='intersects').size:
                            kind = 2
                        rectangle=[]
                        if kind in (1,2):
                            rect=sub.minimum_rotated_rectangle
                            rectangle=[np.rint((np.array(pt)-center.coords[0])*100).astype(int).tolist() for pt in list(rect.exterior.coords)[:4]]
                        heights.append((base,base+3.1*floors,kind,floors,seed,center,rectangle,sub.area/sub.minimum_rotated_rectangle.area<.78))
                        kinds[kind]+=1
    layout.replace_exclude = replace_excl
    print(f'Building kinds: {dict(kinds)} (road removed={removed_road}, road clipped={clipped_road}, sidewalk clipped={clipped_sw})')
    existing = STRtree(footprints)
    for element in load_osm():
        tags = element.get('tags', {})
        if element['type']=='node' or not tags.get('building'):
            continue
        for poly in polygons(area(element)):
            center = poly.representative_point()
            if not (bounds.covers(center) and grounds.covers(center)) or layout.exclude.intersects(poly):
                continue
            if any(poly.intersection(footprints[key]).area > .45*min(poly.area,footprints[key].area)
                   for key in existing.query(poly)):
                continue
            try:
                floors = max(1,round(float(tags['building:levels']))) if 'building:levels' in tags else max(1,round(float(tags['height'])/3.1))
            except (KeyError,ValueError):
                floors = min(5,max(3,round(np.sqrt(poly.area)/9)))
            base = elevation(center.x,center.y)
            footprints.append(poly)
            heights.append((base,base+3.1*floors,3,floors,element['id']%65536,center,[],False))
    return footprints, heights


def game_court(campus, obstacles):
    free = campus.buffer(-4).difference(unary_union(obstacles).buffer(3))
    best = None
    for part in polygons(free):
        for east in np.arange(part.bounds[0],part.bounds[2],6):
            for south in np.arange(part.bounds[1],part.bounds[3],6):
                for ratio in (.18,.13,.09):
                    width = min(30,np.sqrt(campus.area)*ratio)
                    if width < 7 or (best is not None and width*width*1.7 <= best.area):
                        continue
                    for breadth,depth in ((width,width*1.7),(width*1.7,width)):
                        court = box(east-breadth/2,south-depth/2,east+breadth/2,south+depth/2)
                        if part.covers(court):
                            best = court
                            break
    return best


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
