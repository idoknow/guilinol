"""Measure the lift needed above the existing inside wheel path at the Sitang River bore."""
import argparse
import gzip
import json
from pathlib import Path

import numpy as np
from shapely import LineString

from canal_passages import sample_road_heights
from common import load_osm
from features import points
from service_streets import width


def measure(base, candidate):
    ids = (1097830334, 842819690, 1494508177, 1494508178, 882310596, 882310597)
    ways = {w['id']: w for w in load_osm() if w['type'] == 'way' and w['id'] in ids}
    bridge, road, tie, tunnel, upper, motorway = (ways[i] for i in ids)
    ref = 10052448934
    coords = []
    inside_lanes = set()
    for way in (bridge, road, tie, tunnel):
        refs = way['nodes']
        # Only the final segment of Y109 returns from the bridge to the bore approach.
        other = 3891277133 if way is road else (refs[-1] if refs[0] == ref else refs[0])
        i, j = refs.index(ref), refs.index(other)
        path = points(way)[min(i, j):max(i, j) + 1]
        if j < i:
            path.reverse()
        coords.extend(path[1:] if coords else path)
        inside_lanes.add((way['id'], other, ref))
        ref = other
    with gzip.open(candidate/'roads/graph.json.gz') as stream:
        lanes = json.load(stream)['lanes']
    offsets = {(l['way'], l['from'], l['to']): l['offset'] for l in lanes if l['kind'] == 'motor'
               and (l.get('way'), l['from'], l['to']) in inside_lanes}
    if offsets.keys() != inside_lanes or len(set(offsets.values())) != 1:
        raise ValueError('Inside lane geometry changed. Survey the new wheel path.')
    graph_offset = next(iter(offsets.values()))
    car_half_track = .795
    track = LineString(coords).offset_curve(-graph_offset-car_half_track, join_style='mitre')
    stations = np.arange(0, min(65, track.length), .01)
    probes = [track.interpolate(s) for s in stations]
    manifests = [json.loads((world/'manifest.json').read_text()) for world in (base, candidate)]

    def samples(world, manifest, pts, flag):
        return sample_road_heights(world, manifest, [dict(x=p.x, z=p.y, **{flag: True}) for p in pts])

    bridge_axis = LineString(points(bridge))
    bridge_zone = bridge_axis.buffer(width(bridge['tags'])/2+1)
    decks = samples(base, manifests[0], probes, 'roofProbe')
    anchor = max(i for i, (_, deck) in enumerate(decks) if deck is not None and bridge_zone.covers(probes[i]))
    surface = samples(base, manifests[0], probes, 'pavementOnly')
    upper_zone = LineString(points(upper)).buffer(width(upper['tags'])/2, cap_style='flat')
    clearance = float(tunnel['tags'].get('maxheight', 4.5))
    bridge_y = decks[anchor][1]
    def lift(i):
        return bridge_y - .08*(stations[i]-stations[anchor]) + clearance - surface[i]
    limit = max((i for i in range(anchor, len(stations)) if surface[i] is not None
                 and upper_zone.covers(probes[i])), key=lift)
    lower = samples(candidate, manifests[1], probes[anchor:limit+1], 'pavementOnly')
    # Continue on the same wheel strip to a point inside the parallel motorway.
    witness = limit + 1200
    point = probes[witness]
    motorway_axis = LineString(points(motorway))
    upper_axis = LineString(points(upper))
    required = bridge_y - .08*(stations[witness]-stations[anchor]) + clearance
    roof = max(y for y in samples(candidate, manifests[1], [point], 'roofProbe')[0] if y is not None)
    motorway_probe = dict(way=motorway['id'], xz=list(point.coords[0]),
                          wheelPathMetres=stations[witness]-stations[anchor],
                          distanceToMotorwayAxis=point.distance(motorway_axis),
                          outsideServiceCorridor=point.distance(upper_axis)-width(upper['tags'])/2-.5,
                          roofMetres=roof, requiredMetres=required, deficitMetres=required-roof)
    return dict(motorwayProbe=motorway_probe, tunnel=tunnel['id'], tags=tunnel['tags'], clearance=clearance, bridge=bridge['id'],
                bridgeXZ=list(probes[anchor].coords[0]), bridgeY=bridge_y, upper=upper['id'],
                upperXZ=list(probes[limit].coords[0]), upperY=surface[limit],
                laneOffset=graph_offset, halfTrack=car_half_track, spacing=.01, gradeLimit=.08,
                wheelPathMetres=stations[limit]-stations[anchor], pavedSamples=sum(y is not None for y in lower),
                samples=len(lower), minimumLiftMetres=lift(limit))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base_world', type=Path)
    parser.add_argument('candidate_world', type=Path)
    args = parser.parse_args()
    print(json.dumps(measure(args.base_world, args.candidate_world), indent=2))
