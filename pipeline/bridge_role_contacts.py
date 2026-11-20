"""Measure GL04 to packed bridge role contacts for the projected review ledger."""
import argparse
import csv
import json
import math
from pathlib import Path

import numpy as np
import shapely

from audit_seams import ROOT, Streets, Surface, projected_faces, world_triangles
from common import ll2xz, load_osm
from seam_bridge import CurbFaces


def road_axes():
    roads = []; identifiers = []
    for way in load_osm():
        if way['type']!='way' or way.get('tags',{}).get('highway') not in ('primary','secondary','tertiary','residential','unclassified','service','primary_link','secondary_link','tertiary_link'): continue
        coords = [ll2xz(vertex['lat'],vertex['lon']) for vertex in way.get('geometry',[])]
        if len(coords)>1:
            roads.append(shapely.LineString(coords)); identifiers.append(way['id'])
    return shapely.STRtree(roads),identifiers


def stripe_profile(streets, point, axis):
    world = streets.world
    origin = tuple(int(base+world.size*math.floor((value-base)/world.size)) for value,base in zip(point.coords[0],(world.left,world.top)))
    tree,kinds,_ = streets.tile(origin)
    profiles = []
    for index in tree.query(point,predicate='dwithin',distance=.03):
        if kinds[index]!=2: continue
        clipped = shapely.make_valid(tree.geometries[index]).intersection(point.buffer(3))
        for piece in shapely.get_parts(clipped):
            if piece.geom_type!='Polygon' or point.distance(piece)>.03: continue
            edges = np.diff(piece.minimum_rotated_rectangle.exterior.coords,axis=0)[:2]
            lengths = np.linalg.norm(edges,axis=1)
            direction = edges[np.argmax(lengths)]/max(lengths)
            angle = math.degrees(math.acos(np.clip(abs(direction@axis),0,1)))
            profiles.append(dict(width=round(min(lengths),3),length=round(max(lengths),3),roadAngle=round(angle,2)))
    return profiles


def alignment_trace(point, road, streets, model_heights):
    initial = road.project(point)
    offset = np.subtract(point.coords[0],road.interpolate(initial).coords[0])
    samples = []
    for distance in range(-48,49,2):
        station = initial+distance
        if not 0<=station<=road.length: continue
        position = np.array(road.interpolate(station).coords[0])+offset
        probe = shapely.Point(position)
        height,coverage = streets.at(*position)
        samples.append([distance,*position.round(3),round(height,3),sorted(coverage),sorted(set(np.round(model_heights(probe),3)))])
    return samples


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report',type=Path); parser.add_argument('frustum',type=Path); parser.add_argument('out',type=Path)
    args = parser.parse_args(); world = Surface(ROOT/'public/world'); streets = Streets(world)
    entry = world.entries['jiefang_bridge']; public = ROOT/'public'
    shapes,paint_height = projected_faces(entry,'',public,node='lod0_road_paint'); paint = shapely.STRtree(shapes)
    curb = CurbFaces(world_triangles(entry,'',public,node='lod0_curb_face'))
    _,model_heights = projected_faces(entry,'',public)
    roads,identifiers = road_axes(); rows = []
    crossings = json.loads(args.report.read_text())['landmarks']['jiefang_bridge']['streetCrossings']
    with args.frustum.open() as source:
        for record in csv.DictReader(source):
            if record['source']!='streetCrossings' or record['camera'] not in ('bridge-east','bridge-west'): continue
            label,kind,east,south,_,_,flag = crossings[int(record['index'])]
            if json.loads(record['worldXZ'])!=[east,south] or flag!=record['flag']: raise ValueError('Camera ledger does not match report')
            point = shapely.Point(east,south); road_index = roads.nearest(point); road = roads.geometries[road_index]
            station = road.project(point); axis = np.subtract(road.interpolate(min(station+.5,road.length)).coords[0],road.interpolate(max(station-.5,0)).coords[0]); axis /= np.linalg.norm(axis)
            native = paint if kind=='marking' else curb.lines
            nearest = shapely.shortest_line(point,native.geometries[native.nearest(point)])
            peer = shapely.Point(nearest.coords[-1]); street_y,coverage = streets.at(east,south)
            levels = list(paint_height(peer)) if kind=='marking' else [high for _,high in curb.spans(np.array(peer.coords[0]))]
            delta = min((abs(height-street_y) for height in levels),default=None)
            rows.append(dict(camera=record['camera'],kind=kind,boundary=label,worldXZ=[east,south],GL04=sorted(coverage),streetY=round(street_y,3),nearestWay=identifiers[road_index],axisDistance=round(road.distance(point),3),profiles=stripe_profile(streets,point,axis) if kind=='marking' else [],nativeXZ=peer.coords[0],nativeGap=round(nearest.length,3),nativeLevels=sorted(set(round(height,3) for height in levels)),gradeDelta=None if delta is None else round(delta,3),withinTolerance=nearest.length<=.3 and delta is not None and delta<=.05))
            rows[-1]['offsetRoadTrace'] = alignment_trace(point,road,streets,model_heights)
            candidates = []
            for index in native.query(point,predicate='dwithin',distance=.3):
                contact = shapely.shortest_line(point,native.geometries[index]); endpoint = shapely.Point(contact.coords[-1])
                elevations = paint_height(endpoint) if kind=='marking' else [upper for _,upper in curb.spans(np.array(endpoint.coords[0]))]
                for elevation in elevations:
                    if abs(elevation-street_y)<=.05:
                        candidates.append([*np.round(endpoint.coords[0],3),round(elevation,3)])
            rows[-1]['withinTolerance'] = bool(candidates)
            rows[-1]['possibleContacts'] = sorted(set(map(tuple,candidates)))
    args.out.write_text(json.dumps(rows,ensure_ascii=False,indent=2,allow_nan=False)+'\n')


if __name__=='__main__': main()
