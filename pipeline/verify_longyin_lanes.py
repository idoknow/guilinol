"""Check AI trajectories against emitted GL04 paint, without relying on volatile lane IDs."""
import gzip
import json
import math

from shapely.geometry import Point

from landmarks.world_surface import Surface, WORLD
from seam_streets import Streets


def verify():
    world = Surface(WORLD)
    streets = Streets(world)
    with gzip.open(WORLD/'roads/0_1.json.gz') as source:
        graph = json.load(source)
    nodes = {node['id']: node for node in graph['nodes']}
    head, tail = 13680845705, 13683702570
    start, end = nodes[head], nodes[tail]
    east, south = end['x']-start['x'], end['z']-start['z']
    length = math.hypot(east, south)
    lanes = [lane for lane in graph['lanes'] if lane['from'] == head and lane['to'] == tail]
    assert lanes, 'Missing feedback segment'
    for lane in lanes:
        clear = 0
        for station in range(14, 63):
            x = start['x']+(east*station-south*lane['offset'])/length
            z = start['z']+(south*station+east*lane['offset'])/length
            origin = tuple(int(base+world.size*math.floor((coord-base)/world.size))
                           for coord, base in ((x, world.left), (z, world.top)))
            tree, kinds, _ = streets.tile(origin)
            hits = tree.query(Point(x, z), predicate='dwithin', distance=.3)
            clear += not any(kinds[index] == 2 for index in hits)
        print(f"offset {lane['offset']:+.2f} m: {clear}/49 stations clear of paint")
        assert clear >= 46, 'Lane follows a marking rather than crossing it'


if __name__ == '__main__':
    verify()
