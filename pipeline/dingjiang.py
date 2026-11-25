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
TIES = (835.212615, 2203.212589)
# Road way, rail chainage, railhead, road chainage.
CROSSINGS = (
    (983781242, 1497.648526, 164.5600, 1335.244),
    (983781244, 1533.597362, 164.1500, 1719.381),
    (1550293846, 1723.464147, 161.9500, 5.447),
    (459580311, 1924.662941, 159.5900, 2946.736),
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
    east = abs(at-2119.212646).argmin()
    neighbor = LineString(points(ways[375923385]))
    neighbor_nodes = sorted({n for i,j,_,_,way in pieces if way==375923385 for n in (i,j)},
                key=lambda n: neighbor.project(Point(coords[n])))
    neighbor_at = [neighbor.project(Point(coords[n])) for n in neighbor_nodes]
    east_nodes = sorted((i for i,s in enumerate(at) if at[east] <= s < at[last]),
                        key=lambda i: at[i])
    # Match the other track until the fixed eastern railhead requires a climb.
    # The grade envelope reaches that tie without moving the adjoining section.
    matched = [max(np.interp(neighbor.project(Point(coords[nodes[i]])),neighbor_at,height[neighbor_nodes])+.008,
                   height[nodes[last]]-.01195*(at[last]-at[i])) for i in east_nodes]
    stations = [at[first],1315.212601,1339.2126,*(r[1] for r in CROSSINGS),
                *(at[i] for i in east_nodes),at[last]]
    levels = [height[nodes[first]],166.381,166.381,*(r[2] for r in CROSSINGS),
              *matched,height[nodes[last]]]
    if np.max(abs(np.diff(levels) / np.diff(stations))) > .012:
        raise ValueError('Dingjiang rail profile exceeds the main-line grade limit')
    active = (at > stations[0]) & (at < stations[-1])
    height[np.asarray(nodes)[active]] = np.interp(at[active], stations, levels)

    # Match the two lower tracks to one longitudinal plane. The 12 per mille
    # bound also holds on a curved track because distance exceeds |delta z|.
    for wid in (259082251, 815078170):
        lower = np.array(sorted({n for i,j,_,_,way in pieces if way == wid for n in (i,j)}))
        z = coords[lower, 1]
        in_section = z < -9200
        design = hengliu(z)
        # Tie to native at the clipped north edge and the first intersection
        # with the unchanged descending grade south of the road tunnel.
        north_ramp = 157.46 - .005 * (z + 9976.)
        cap = np.maximum(north_ramp, design)
        height[lower[in_section]] = np.minimum(height[lower[in_section]], cap[in_section])


def hengliu(z):
    return 157.620 + .01192 * (z + 9888.)


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
        1550293846: (14100547688, 156.2500, 14100547694, None),
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
        knots = [(0., start_y)]
        if road == 459580311:
            knots.append((7., 155.79960))
        if road == 983781244:
            # Keep the approach below the two native sags on either side.
            knots.extend([(6., 159.91), (1647.0-offset, 158.45)])
        knots.append((at-offset, level))
        if road == 983781244:
            knots.extend([(1829.0-offset, 154.985), (1839.0-offset, 154.910)])
        if road == 983781242:
            knots.append((1406.0-offset, 158.44))
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
