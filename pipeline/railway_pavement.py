"""Fill missing drivable pavement on rail crossings and their approaches."""
import gzip
import json
import struct
from collections import defaultdict
from pathlib import Path

import numpy as np
from shapely import LineString, Point, Polygon, STRtree, box, make_valid, union_all
from shapely.affinity import translate
from shapely.ops import substring

from common import ll2xz, load_osm
from features import points
from road_profile import RULES
from service_streets import rings, width


def bake(directory, chunks, graded=None):
    inventory = json.loads((Path(__file__).resolve().parents[1]/'docs/railway-crossings.json').read_bytes())
    sites = defaultdict(list)
    for row in inventory:
        if row['type'] in ('level','rail_over') and all(row['roadTags'].get(k,'no')=='no' for k in ('bridge','tunnel')):
            sites[row['road']].append(Point(ll2xz(row['lat'],row['lon'])))
    shapes = []
    elements = load_osm()
    from features import area
    footprints = [area(w) for w in elements if w.get('tags',{}).get('building') and
                  w['type']=='way' and len(w.get('geometry',()))>=4]
    buildings = STRtree(footprints)
    bridge_nodes = {node for w in elements if w['type']=='way' and w.get('tags',{}).get('highway')
                    and w['tags'].get('bridge','no')!='no' and len(w['nodes'])>=2
                    for node in (w['nodes'][0],w['nodes'][-1])}
    for way in elements:
        if way['type']!='way' or not way.get('tags',{}).get('highway') or len(way.get('geometry',()))<2:
            continue
        tags = way['tags']
        minor = graded is not None and tags['highway'] in ('service','unclassified','living_street') and all(
            tags.get(k,'no')=='no' for k in ('bridge','tunnel')) and tags.get('access') not in ('no','private')
        if way['id'] not in sites and not minor:
            continue
        if tags['highway'] in ('footway','cycleway','steps','path','pedestrian'):
            continue
        lanes = tags.get('lanes','')
        single = tags.get('oneway') in ('yes','1','true','-1') or tags.get('junction')=='roundabout'
        inferred_width = 3. if single or tags['highway']=='residential' else 6.
        lane_width = int(lanes)*RULES['laneWidth'] if lanes.isdecimal() else inferred_width
        road_width = max(width(tags),lane_width,
                         RULES['defaultWidth'].get(tags['highway'],0.))
        center = LineString(points(way))
        segments = []
        for site in sites.get(way['id'],()):
            at = center.project(site)
            segments.append(substring(center,max(0.,at-60),min(center.length,at+60)))
        if minor:
            coords = np.asarray(center.coords)
            for a,b in zip(coords,coords[1:]):
                if graded.affects_carriageway(a,b,road_width/2):
                    segments.append(LineString([a,b]))
        for segment in segments:
            face = segment.buffer(road_width/2,cap_style='flat')
            # Overlap the quantized deck edge by a few centimetres, so the
            # abutment has continuous asphalt on both sides of the seam.
            for index,neighbor in ((0,1),(-1,-2)):
                point = Point(center.coords[index])
                if way['nodes'][index] in bridge_nodes and segment.distance(point)<.01:
                    outward = np.subtract(center.coords[index],center.coords[neighbor])
                    length = np.linalg.norm(outward)
                    if length>.01:
                        extended = translate(face,* (outward*.10/length))
                        face = face.union(extended.intersection(point.buffer(road_width)))
            occupied = buildings.query(face,predicate='intersects')
            if len(occupied):
                face = face.difference(union_all([make_valid(footprints[i]) for i in occupied]))
            if not face.is_empty:
                shapes.append(face)
    new_pavement = []
    tree = STRtree(shapes)
    for tile in chunks:
        x,z = tile['x'],tile['z']
        bounds = box(x,z,x+256,z+256)
        hits = tree.query(bounds,predicate='intersects')
        if not len(hits):
            continue
        local = translate(union_all([shapes[i] for i in hits]).intersection(bounds),-x,-z)
        file = directory/tile['file']
        data = gzip.decompress(file.read_bytes())
        vertices,indices,size = struct.unpack_from('<3I',data,4)
        start = 24+16900+9*vertices+4*indices
        collision = json.loads(data[start:start+size])
        streets = collision[1]
        lower = streets[11] if len(streets)>11 else None
        end = lower[0] if lower else len(streets[0])
        existing = [make_valid(Polygon(np.array(shell)/100,[np.array(r)/100 for r in holes]))
                    for kind,shell,*holes in streets[0][:end] if len(shell)>=3]
        missing = local.difference(union_all(existing))
        if missing.is_empty:
            continue
        blocks = [make_valid(Polygon(np.asarray(loops[0])/100,[np.asarray(r)/100 for r in loops[1:]]))
                  for _,_,loops,*_ in collision[0] if loops and len(loops[0])>=3]
        if blocks:
            missing = missing.difference(union_all(blocks))
        patches = list(rings(0,missing))
        if not patches:
            continue
        new_pavement.append(translate(missing,x,z))
        streets[0][end:end] = patches
        if graded is not None and (len(streets)<6 or not streets[5]):
            # Rural tiles may first receive drivable geometry here. Encode
            # the fitted road spline along with the new pavement triangles.
            from road_grading import STEP
            row,col = int((z-graded.top)//STEP),int((x-graded.left)//STEP)
            control = graded.after[2][row:row+35,col:col+35]
            mm = np.rint(control*1000).astype(int)
            knots = [int(mm.min()),(mm-mm.min()).ravel().tolist()]
            while len(streets)<6:
                streets.append(None if len(streets)==5 else [])
            streets[5] = knots
        if lower:
            lower[0] += len(patches)
        encoded = json.dumps(collision,separators=(',',':')).encode()
        raw = data[:12]+struct.pack('<I',len(encoded))+data[16:start]+encoded+data[start+size:]
        file.write_bytes(gzip.compress(raw,compresslevel=5,mtime=0))
        tile['bytes'] = file.stat().st_size
    return new_pavement
