"""Bake walkable OSM platform footprints into streamed GL04 sidewalk geometry."""
import gzip
import json
import struct

import numpy as np
from shapely import Polygon, box, make_valid, union_all
from shapely.affinity import translate

from common import load_osm
from features import area
from service_streets import rings


def bake(output, chunks, region):
    platforms = union_all([area(way) for way in load_osm()
                           if way['type'] == 'way' and way.get('tags', {}).get('railway') == 'platform'
                           and way['tags'].get('monorail') != 'yes']).intersection(region)
    for chunk in chunks:
        x, z = chunk['x'], chunk['z']
        footprint = platforms.intersection(box(x, z, x + 256, z + 256))
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
        encoded = json.dumps(collision, separators=(',', ':')).encode()
        payload = data[:12] + struct.pack('<I', len(encoded)) + data[16:start] + encoded + data[start+size:]
        file.write_bytes(gzip.compress(payload, mtime=0))
        chunk['bytes'] = file.stat().st_size
