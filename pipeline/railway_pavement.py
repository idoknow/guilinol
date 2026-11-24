"""Fill painted approaches beneath railway spans with the native drivable pavement."""
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


def bake(directory, chunks):
    inventory = json.loads((Path(__file__).resolve().parents[1]/'docs/railway-crossings.json').read_bytes())
    sites = defaultdict(list)
    for row in inventory:
        if row['type']=='rail_over' and all(row['roadTags'].get(k,'no')=='no' for k in ('bridge','tunnel')):
            sites[row['road']].append(Point(ll2xz(row['lat'],row['lon'])))
    shapes = []
    for way in load_osm():
        if way['type']!='way' or way['id'] not in sites:
            continue
        tags = way['tags']
        if tags['highway'] in ('footway','cycleway','steps','path','pedestrian'):
            continue
        lanes = tags.get('lanes','')
        road_width = max(width(tags),int(lanes)*RULES['laneWidth'] if lanes.isdecimal() else 0.,
                         RULES['defaultWidth'].get(tags['highway'],0.))
        center = LineString(points(way))
        for site in sites[way['id']]:
            at = center.project(site)
            face = substring(center,max(0.,at-32),min(center.length,at+32))
            shapes.append(face.buffer(road_width/2,cap_style='flat'))
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
        patches = list(rings(0,local.difference(union_all(existing))))
        if not patches:
            continue
        streets[0][end:end] = patches
        if lower:
            lower[0] += len(patches)
        encoded = json.dumps(collision,separators=(',',':')).encode()
        raw = data[:12]+struct.pack('<I',len(encoded))+data[16:start]+encoded+data[start+size:]
        file.write_bytes(gzip.compress(raw,compresslevel=5,mtime=0))
        tile['bytes'] = file.stat().st_size
