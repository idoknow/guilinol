"""Generate shore stations from the installed GL04 world, not runtime guesses."""
import gzip
import json
import math
import struct
from pathlib import Path

import numpy as np
from shapely import Point, Polygon, STRtree, union_all

world = Path('public/world')
manifest = json.loads((world / 'manifest.json').read_text())
anchors = [
    ('lijiang_xiangbi', '漓江·象鼻山段', -670, 1110),
    ('lijiang_jiefang', '漓江·解放桥段', -135, -90),
    ('lijiang_fubo', '漓江·伏波山段', 70, -705),
    ('taohuajiang', '桃花江', -1180, 1090),
    ('ronghu', '榕湖', -1360, 300), ('shanhu', '杉湖', -1030, 450),
    ('guihu', '桂湖', -1510, -270), ('mulonghu', '木龙湖', -470, -1640),
    ('xiaodongjiang', '小东江·花桥段', 405, 350),
    ('lijiang_diecai', '漓江·叠彩山段', 130, -1470),
]


def candidates(tile):
    raw = gzip.decompress((world / tile['file']).read_bytes())
    assert raw[:4] == b'GL04'
    vertices, indices, size, image_size, triangles = struct.unpack_from('<IIIII', raw, 4)
    terrain, water = np.frombuffer(raw, '<i2', 8450, 24).reshape(2, 65, 65)
    start = 24 + 16900 + 9 * vertices + 4 * indices
    buildings, streets, *_ = json.loads(raw[start:start + size])
    faces = [entry[2][0] for entry in buildings if entry[2]]
    faces.extend(path[1] for path in streets[0] if len(path) > 1)
    deck = np.frombuffer(raw, '<i2', triangles * 9, start + size + image_size)
    faces.extend(deck.reshape(-1, 3, 3)[:, :, ::2])
    excluded = STRtree([Polygon(ring) for ring in faces if len(ring) >= 3])
    for row, col in zip(*np.where(water == -32768)):
        if not (4 <= row <= 60 and 4 <= col <= 60):
            continue
        if (water[row-1:row+2, col-1:col+2] != -32768).any():
            continue
        nearby = terrain[row-1:row+2, col-1:col+2]
        if int(nearby.max()) - int(nearby.min()) > 12:
            continue
        wet = np.argwhere(water[row-4:row+5, col-4:col+5] != -32768)
        if not len(wet):
            continue
        if len(excluded.query(Point(col*400, row*400), predicate='dwithin', distance=320)):
            continue
        offset = min(wet - 4, key=lambda delta: int(delta @ delta))
        dz, dx = map(int, offset * 4)
        px, pz = int(col*4 + tile['x']), int(row*4 + tile['z'])
        yield dict(x=px, z=pz, yaw=round(math.atan2(dx, dz), 5),
                   target=[px+dx, int(water[row+offset[0], col+offset[1]])/10, pz+dz])


output = []
cache = {}
for index, (key, name, x, z) in enumerate(anchors):
    near = []
    for tile in manifest['chunks']:
        if abs(tile['x']+128-x) > 385 or abs(tile['z']+128-z) > 385:
            continue
        if tile['file'] not in cache:
            cache[tile['file']] = list(candidates(tile))
        near.extend(cache[tile['file']])
    spot = min(near, key=lambda point: math.hypot(point['x']-x, point['z']-z))
    assert math.hypot(spot['x']-x, spot['z']-z) < 250, name
    banks = [spot]
    for point in sorted(near, key=lambda p: math.hypot(p['x']-spot['x'], p['z']-spot['z'])):
        if math.hypot(point['x']-spot['x'], point['z']-spot['z']) > 120:
            break
        if abs(point['target'][1]-spot['target'][1]) > .5:
            continue
        if all(math.hypot(point['x']-p['x'], point['z']-p['z']) >= 12 for p in banks):
            banks.append(point)
    region = union_all([Point(p['x'], p['z']).buffer(32, quad_segs=6) for p in banks])
    parts = region.geoms if region.geom_type == 'MultiPolygon' else [region]
    outlines = [[[[round(px, 2), round(pz, 2)] for px, pz in ring.coords]
                 for ring in [part.exterior, *part.interiors]] for part in parts]
    output.append(dict(id=key, name=name, spot=spot, radius=32, banks=banks, outlines=outlines,
                       circle=dict(x=spot['target'][0], z=spot['target'][2], radius=24,
                                   color=['red', 'blue', 'green'][index % 3])))
Path('web/src/fishing/shores.json').write_text(json.dumps(output, ensure_ascii=False, indent=2)+'\n')
