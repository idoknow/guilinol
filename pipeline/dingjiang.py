"""First rail-priority section on the Guibei–Dingjiang viaduct.

Stations refer to the complete OSM way, including its unplayable end.
The two tie points are native rail vertices. Interior controls are the
accepted rail-first solution, ordered from the north-east boundary.
"""
import numpy as np
from shapely import LineString, Point
from common import xz2ll
from features import points

RAIL = 375923389
TIES = (1231.212624, 2203.212589)
# Road way, rail chainage, railhead, road chainage.
CROSSINGS = (
    (983781242, 1497.648526, 159.7840, 1335.244),
    (983781244, 1533.597362, 159.3534, 1719.381),
    (1550293846, 1723.464147, 157.0789, 5.447),
    (459580311, 1924.662941, 154.6686, 2946.736),
)
ROAD_IDS = {row[0] for row in CROSSINGS}


def fit_rail(coords, pieces, height, ways):
    line = LineString(points(ways[RAIL]))
    nodes = sorted({n for i, j, _, _, way in pieces if way == RAIL for n in (i, j)})
    at = np.array([line.project(Point(coords[n])) for n in nodes])
    ends = [abs(at - tie).argmin() for tie in TIES]
    if any(abs(at[i] - tie) > .002 for i, tie in zip(ends, TIES)):
        raise ValueError('Dingjiang native tie vertex missing')
    first, last = ends
    stations = [at[first], *(r[1] for r in CROSSINGS), at[last]]
    levels = [height[nodes[first]], *(r[2] for r in CROSSINGS), height[nodes[last]]]
    if np.max(abs(np.diff(levels) / np.diff(stations))) > .012:
        raise ValueError('Dingjiang rail profile exceeds the main-line grade limit')
    active = (at > stations[0]) & (at < stations[-1])
    height[np.asarray(nodes)[active]] = np.interp(at[active], stations, levels)


def road_profiles(elements, paired_widths):
    from station_roads import samples

    ways = {w['id']: w for w in elements if w['type'] == 'way' and w['id'] in ROAD_IDS}
    # Tie to existing carriageway vertices sampled on the baseline road mesh.
    # The service-road cul-de-sac and its junction with Changfeng are both
    # inside the cut. Give the junction the same elevation on both ways.
    bounds = {
        983781242: (9096632919, 155.04343, 9096632923, 159.85444),
        983781244: (9096632966, 160.13599, 9096632971, 154.93321),
        459580311: (9096622970, 155.79481, 4553929619, 158.71084),
        1550293846: (14100547688, 151.3789, 14100547694, None),
    }
    controls = {road: (at, rail - 5.7) for road, _, rail, at in CROSSINGS}
    profiles = {}
    for road, (start, start_y, end, end_y) in bounds.items():
        way = ways[road]
        i, j = way['nodes'].index(start), way['nodes'].index(end)
        whole = LineString(points(way))
        nodes = way['nodes'][i:j+1]
        geometry = way['geometry'][i:j+1]
        line = LineString(whole.coords[i:j+1])
        offset = whole.project(Point(line.coords[0]))
        if road == 1550293846:
            # Continue the lowered dead end under the rear axle of a car
            # stopped at the terminal node.
            a, b = np.asarray(line.coords[:2])
            tip = a + 3 * (a - b) / np.linalg.norm(a - b)
            lat, lon = xz2ll(*tip)
            geometry = [dict(lat=lat, lon=lon), *geometry]
            nodes = [-start, *nodes]
            line = LineString([tip, *line.coords])
            offset -= 3
        at, level = controls[road]
        if end_y is None:
            _, parent, profile = profiles[459580311]
            joint = parent.project(Point(line.coords[-1]))
            end_y = np.interp(joint, profile[:, 0], profile[:, 1])
        knots = [(0., start_y), (at-offset, level)]
        if road == 459580311:
            # The retained east junction owns the final six metres of paving.
            # Match its native crest before the clipped floor ends at the curb.
            knots.append((line.length-8., 158.79226))
        heights = samples([*knots, (line.length, end_y)], transition=16.)
        local = dict(way, nodes=nodes, geometry=geometry, surfaceApproach=True,
                     trafficNodes=way['nodes'][max(0, i-1):j+2])
        if way['tags']['highway'] == 'service':
            # Two directions share these walled approaches. Leave room for
            # the swept wheels where neighbouring lane chords meet at a bend.
            local['profileWidth'] = 6.5
        if road in paired_widths:
            local['stationWidth'] = paired_widths[road]
        profiles[road] = local, line, heights
    return profiles
