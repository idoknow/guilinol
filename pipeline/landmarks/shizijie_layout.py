"""Channelizing islands in the bounded gaps between the rendered OSM carriageways."""
import gzip
import json
import struct
from functools import lru_cache
from pathlib import Path

import numpy as np
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

KIOSK_CENTER = (27.2, -2.4)


@lru_cache(maxsize=1)
def surfaces(landmark='shizijie', radius=150):
    world = Path(__file__).resolve().parents[2] / 'public/world'
    manifest = json.loads((world / 'manifest.json').read_text())
    origin_x, _, origin_z = next(entry['position'] for entry in manifest['landmarks'] if entry['id'] == landmark)
    layers = [[], []]
    for chunk in manifest['chunks']:
        dx, dz = chunk['x'] - origin_x, chunk['z'] - origin_z
        if dx > radius or dz > radius or dx + 256 < -radius or dz + 256 < -radius:
            continue
        data = gzip.decompress((world / chunk['file']).read_bytes())
        vertices, indices, length = struct.unpack_from('<3I', data, 4)
        start = 24 + 65 * 65 * 4 + vertices * 9 + indices * 4
        for kind, *loops in json.loads(data[start:start + length])[1][0]:
            if kind in (0, 1):
                rings = [np.array(loop) / 100 + [dx, dz] for loop in loops]
                layers[kind].append(Polygon(rings[0], rings[1:]).buffer(0))
    return tuple(unary_union(parts) for parts in layers)


@lru_cache(maxsize=1)
def islands():
    road, sidewalk = surfaces()
    pockets = [Polygon(ring) for polygon in getattr(road, 'geoms', [road]) for ring in polygon.interiors]
    result = []
    for seed in [(-12, -18), (24, -6), (14, 25), (-29, 21)]:
        pocket, = [polygon for polygon in pockets if polygon.contains(Point(seed))]
        inset = pocket.difference(sidewalk).buffer(-.4, join_style='mitre')
        result.append(max(getattr(inset, 'geoms', [inset]), key=lambda polygon: polygon.area))
    return result
