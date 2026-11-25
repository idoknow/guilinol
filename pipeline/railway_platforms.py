"""Bake walkable OSM platform footprints into streamed GL04 sidewalk geometry."""
import gzip
import json
import struct
from pathlib import Path

import numpy as np
from shapely import LineString, Polygon, STRtree, box, make_valid, union_all
from shapely.affinity import translate

from common import load_osm
from features import area, points
from railways import road_radius
from service_streets import rings
from station_site import platform_walking_area


def bake(output, chunks, region):
    ways = load_osm()
    crossings = json.loads((Path(__file__).resolve().parents[1]/'docs/railway-crossings.json').read_bytes())
    road_ids = {row['road'] for row in crossings if row['status']!='construction_unverified'}
    roads = [LineString(points(way)).buffer(max(4.5,road_radius(way['tags'])+1.5))
             for way in ways if way['type']=='way' and way['id'] in road_ids]
    corridors = STRtree(roads)
    platforms = union_all([platform_walking_area(way) for way in ways
                           if way['type'] == 'way' and way.get('tags', {}).get('railway') == 'platform'
                           and way['tags'].get('monorail') != 'yes']).intersection(region)
    station = union_all([area(w) for w in ways if w['type']=='way' and w['id'] in (376029417,376029418,376029419,376029420)])
    for chunk in chunks:
        x, z = chunk['x'], chunk['z']
        footprint = platforms.intersection(box(x, z, x + 256, z + 256))
        if footprint.area < .01:
            continue
        # GL04 bridge decks and painted roads need not have a street polygon.
        # Keep the placeholder and its sidewalk/curb collider out of their approaches.
        occupied_roads = corridors.query(footprint, predicate='intersects')
        footprint = footprint.difference(union_all([roads[i] for i in occupied_roads]))
        if footprint.area < .01:
            continue
        local = translate(footprint, -x, -z)
        file = output / chunk['file']
        data = gzip.decompress(file.read_bytes())
        vertices, indices, size = struct.unpack_from('<3I', data, 4)
        start = 24 + 16900 + 9 * vertices + 4 * indices
        collision = json.loads(data[start:start+size])
        streets = collision[1]
        paths = streets[0]
        # Existing station halls and canopy proxies have solid GL04 building
        # colliders. Only expose platform area pedestrians can actually reach.
        occupied = []
        building_rings = [building[2] for building in collision[0]]
        for shell, *holes in building_rings:
            solid = make_valid(Polygon(np.asarray(shell)/100, [np.asarray(h)/100 for h in holes]))
            if local.intersects(solid):
                occupied.append(solid.buffer(.015))
        for _, shell, *holes in paths:
            polygon = make_valid(Polygon(np.asarray(shell)/100, [np.asarray(h)/100 for h in holes]))
            if local.intersects(polygon):
                occupied.append(polygon)
        additions = list(rings(1, local.difference(union_all(occupied))))
        if not additions:
            continue
        lower = streets[11] if len(streets) > 11 else None
        index = lower[0] if lower else len(paths)
        paths[index:index] = additions
        if lower:
            lower[0] += len(additions)
        if station.intersects(footprint):
            from station_footbridge import PLATFORM
            while len(streets)<12:
                streets.append(None if len(streets) in (5,11) else [])
            streets.append([index,index+len(additions),PLATFORM])
        encoded = json.dumps(collision, separators=(',', ':')).encode()
        payload = data[:12] + struct.pack('<I', len(encoded)) + data[16:start] + encoded + data[start+size:]
        file.write_bytes(gzip.compress(payload, mtime=0))
        chunk['bytes'] = file.stat().st_size
