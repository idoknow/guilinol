"""Read the baked GL04; verify the joined strip and survey the ±100 m approach."""
import gzip
import json
import struct
import sys
from pathlib import Path

from shapely import union_all
from shapely.affinity import translate
from shapely.geometry import LineString, Point, Polygon, box

world = Path(sys.argv[1] if len(sys.argv) > 1 else 'public/world')
manifest = json.loads((world / 'manifest.json').read_bytes())
layers = []
for tile in manifest['chunks']:
    if tile['z'] != -256 or tile['x'] not in (-1024, -768):
        continue
    packed = (world / tile['file']).read_bytes()
    assert len(packed) == tile['bytes']
    data = gzip.decompress(packed)
    assert data[:4] == b'GL04'
    vertices, indices, size = struct.unpack_from('<III', data, 4)
    offset = 16924 + 9 * vertices + 4 * indices
    paths = json.loads(data[offset:offset + size])[1][0]
    for index in tile.get('roadbeds', []):
        assert paths[index if index >= 0 else -index-1][0] in (0, 2, 5)
    for kind, shell, *holes in paths:
        if kind in (0, 1, 4, 5, 6):
            layers.append((kind, translate(Polygon(shell, holes).buffer(0), (tile['x']+1024)*100)))

cycle = [poly for kind, poly in layers if kind == 5]
for point in [Point(19167, 11337), Point(17781, 11409)]:
    assert sum(poly.contains(point) for poly in cycle) == 1
owner, = [poly for poly in cycle if poly.contains(Point(19167,11337))]
assert owner.contains(Point(18430,11760)) or owner.contains(Point(18430,11762))

axis = LineString([(9448,8978), (28887,13696)])
window = box(0,0,51200,25600)
void = window.difference(union_all([poly for _,poly in layers],grid_size=1))
cycle = union_all(cycle,grid_size=1)
island_seeds = [Point(11530,10740),Point(15600,11310)]
for pocket in void.geoms:
    if pocket.area<100 or pocket.distance(axis)>1200 or not pocket.disjoint(window.boundary):
        continue
    if pocket.boundary.intersection(cycle.buffer(1)).length<50:
        continue
    assert any(pocket.covers(seed) for seed in island_seeds), pocket.representative_point()
print('PASS: both former bare pockets paved, incident cycle lane joined, ±100 m corridor checked')
