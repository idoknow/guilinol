"""Audit baked lane and parking heights against the rendered terrain triangles."""
import gzip
import json
import math
from bisect import bisect_right

from landmarks.world_surface import Surface, WORLD


def read(path):
    with gzip.open(path) as source:
        return json.load(source)


def verify():
    surface = Surface(WORLD)
    roads = WORLD/'roads'
    graph = read(roads/'graph.json.gz')
    nodes = {node['id']:node for node in graph['nodes']}
    errors, fuxing, parking = [], [], []
    for lane in graph['lanes']:
        if lane['kind'] != 'motor' or lane.get('gradeSeparated'):
            continue
        start, end = nodes[lane['from']], nodes[lane['to']]
        east, south = end['x']-start['x'], end['z']-start['z']
        length = math.hypot(east, south)
        offset = lane['offset']/length
        heights = lane['heights']
        fractions = heights[::2]

        def error(fraction):
            x = start['x']+east*fraction-south*offset
            z = start['z']+south*fraction+east*offset
            index = min(bisect_right(fractions,fraction)-1,len(fractions)-2)
            along = (fraction-fractions[index])/(fractions[index+1]-fractions[index])
            y = heights[index*2+1]+(heights[index*2+3]-heights[index*2+1])*along
            x = max(surface.left,min(surface.left+surface.width,x))
            z = max(surface.top,min(surface.top+surface.depth,z))
            return abs(y-surface.sample(x,z,include_peaks=False)[0])

        errors.append(max([error(dist/length) for dist in range(0,math.ceil(length),2)]+[error(1)]))
        if {start['id'],end['id']} == {13956749353,2535550108}:
            fuxing.append(error((1127-start['z']-east*offset)/south))
    for key in json.loads((roads/'parking/index.json').read_text()):
        for x,y,z,*_ in read(roads/'parking'/f'{key}.json.gz'):
            parking.append(abs(y-surface.sample(x,z,include_peaks=False)[0]))
    moderate = sum(delta>.3 for delta in errors)
    severe = sum(delta>1 for delta in errors)
    print(f'Motor lanes: {len(errors)}, >0.3m: {moderate}, >1m: {severe}, max: {max(errors):.3f}m; '
          f'parking: {len(parking)}, max: {max(parking):.3f}m; Fuxing z=1127: {fuxing}')
    assert moderate<=50 and severe==0 and max(parking)<=.3 and max(fuxing)<=.15


if __name__ == '__main__':
    verify()
