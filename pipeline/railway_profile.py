"""Solve for railheads before fitting the level-crossing roadway approaches."""

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import coo_matrix, eye, hstack, vstack
from shapely import LineString, Point, intersects_xy
from features import points

from station_levels import FOOTBRIDGE, PLATFORMS, RAIL, UNDERPASS, STYLE


def level_panels(coords, crossings, ways):
    """Identify contiguous sets of parallel tracks crossed by a single road."""
    groups = {}
    for vertex, row, *_ in crossings:
        if row['type'] == 'level' and row['road'] in ways:
            groups.setdefault(row['road'], {}).setdefault(vertex, row['rail'])
    for road, tracks in groups.items():
        alignment = LineString(points(ways[road]))
        panel = []
        previous = None
        for at, vertex, rail in sorted((alignment.project(Point(coords[v])), v, r) for v,r in tracks.items()):
            line = LineString(points(ways[rail]))
            point = Point(coords[vertex])
            along = line.project(point)
            ends = [line.interpolate(np.clip(along+d,0,line.length)).coords[0] for d in (-1.,1.)]
            tangent = np.subtract(ends[1],ends[0])
            tangent /= np.linalg.norm(tangent)
            if previous:
                last_line,last_point,last_axis = previous
                same_panel = (line.distance(last_point)<=8 and last_line.distance(point)<=8
                              and abs(tangent @ last_axis)>=np.cos(np.deg2rad(10)))
                if not same_panel:
                    yield road, panel
                    panel = []
            panel.append((vertex,at))
            previous = line,point,tangent
        yield road, panel


def solve(coords, pieces, ways, target, crossings, reference, yards, pairs):
    xy = np.asarray(coords)
    count = len(xy)
    matrices, limits = [], []

    def limit_difference(nodes, coefficients, margin):
        """The signed height difference must lie within [-margin, margin]."""
        rows = np.broadcast_to(np.arange(len(nodes))[:, None], nodes.shape)
        matrix = coo_matrix((coefficients.ravel(), (rows.ravel(), nodes.ravel())),
                            shape=(len(nodes), count)).tocsr()
        matrices.extend((matrix, -matrix))
        bound = np.broadcast_to(margin, len(nodes))
        limits.extend((bound, bound))

    nodes = np.array([[i, j] for i, j, *_ in pieces])
    service = np.array([bool(ways[wid]['tags'].get('service')) or
                        ways[wid]['tags'].get('usage') == 'branch' for *_, wid in pieces])
    named_main = np.array([any(name in ways[wid]['tags'].get('name', '')
                               for name in ('衡柳', '湘桂', '贵广')) for *_, wid in pieces])
    lengths = np.linalg.norm(xy[nodes[:, 1]] - xy[nodes[:, 0]], axis=1)
    grade = np.where(service & ~named_main, .02498, .01198)
    limit_difference(nodes, np.broadcast_to([1, -1], nodes.shape),
                     np.maximum(0, lengths * grade - .000004))
    if pairs is not None:
        a, b, along_a, along_b, *_ = pairs
        for end in range(2):
            u, v = along_a[:, end], along_b[:, end]
            limit_difference(np.column_stack((a, b)),
                             np.column_stack((1-u, u, v-1, -v)), .0499)

    panels = list(level_panels(coords, crossings, ways))
    for _, panel in panels:
        if len(panel)>1:
            members = np.array([vertex for vertex,_ in panel])
            nodes_on_panel = np.column_stack((members[1:],np.full(len(members)-1,members[0])))
            limit_difference(nodes_on_panel, np.broadcast_to([1,-1],nodes_on_panel.shape), 0.)

    # Use source track tags for the yard. A level track crossing *over* a
    # road tunnel may carry a local bridge rendering flag inside its road gap.
    surface_ways = {wid for wid, way in ways.items()
                    if way.get('tags', {}).get('railway') == 'rail'
                    and way['tags'].get('layer', '0') == '0'
                    and all(way['tags'].get(key, 'no') == 'no' for key in ('bridge', 'tunnel'))}
    eligible = np.unique(np.array([i for a, b, _, _, wid in pieces if wid in surface_ways
                                   for i in (a, b)], dtype=int))
    low = np.full(count, -np.inf)
    high = np.full(count, np.inf)
    for platforms, yard in yards:
        members = eligible[intersects_xy(yard, *xy[eligible].T)]
        if PLATFORMS.intersection(platforms):
            low[members] = high[members] = RAIL
        if len(members) > 1:
            linked = np.column_stack((members[1:], np.full(len(members)-1, members[0])))
            limit_difference(linked, np.broadcast_to([1, -1], linked.shape), 0.)

    # At Guilin the tunnel and footbridge follow the station rail datum. Other
    # structures impose the design headroom, independently of legacy rail Y.
    bounds_by_rail = {}
    for (i, crossing, road, _, soffit), row in zip(crossings, reference, strict=True):
        if row['clearanceM'] is None or crossing.get('road') in (UNDERPASS, FOOTBRIDGE):
            continue
        if row['type'] == 'rail_over':
            walking = crossing.get('roadTags', {}).get('highway') in ('steps','footway','path','pedestrian','cycleway')
            limit = road + STYLE['structureDepth'] + (2.5 if walking else STYLE['roadClearance'])
            low[i] = max(low[i], limit)
        elif row['type'] == 'road_over':
            electric = crossing.get('railTags', {}).get('electrified') in ('yes','contact_line')
            limit = soffit - (STYLE['overheadClearance'] if electric else 5.5)
            high[i] = min(high[i], limit)
        else:
            continue
        if 'rail' in row:
            bounds_by_rail.setdefault(row['rail'], []).append((i,row,limit))

    # Minimise total absolute departure from the DEM-based target, subject to
    # the hard geometry constraints. Slack belongs only to the fitting cost.
    ident = eye(count, format='csr')
    constraints = vstack(matrices, format='csr')
    system = vstack((hstack((constraints, coo_matrix(constraints.shape))),
                     hstack((ident, -ident)), hstack((-ident, -ident))), format='csr')
    bounds = np.vstack((np.column_stack((low, high)),
                        np.column_stack((np.zeros(count), np.full(count, np.inf)))))
    result = linprog(np.r_[np.zeros(count), np.ones(count)], A_ub=system,
                     b_ub=np.concatenate([*limits, target, -target]), bounds=bounds,
                     method='highs')
    report = dict(feasible=bool(result.success), status=int(result.status), message=result.message)
    if result.success:
        heights = result.x[:count]
        report['crossings'] = [dict(rail=r['rail'], road=r['road'], node=r['sharedNode'],
                                    railY=float(heights[i]), originalRoadY=float(road))
                               for i, r, road, *_ in crossings if r['type'] == 'level']
        report['panels'] = [dict(road=wid, fromM=max(0.,panel[0][1]-2),
                                 toM=min(LineString(points(ways[wid])).length,panel[-1][1]+2),
                                 railY=float(heights[panel[0][0]])) for wid,panel in panels]
        report['maxGradePermille'] = float(np.max(1000 * abs(np.diff(heights[nodes]).ravel()) / lengths))
    elif result.status == 2:
        conflicts = []
        for wid, records in bounds_by_rail.items():
            line = LineString(points(ways[wid]))
            tags = ways[wid]['tags']
            cap = .025 if tags.get('service') or tags.get('usage')=='branch' else .012
            if any(name in tags.get('name','') for name in ('衡柳','湘桂','贵广')):
                cap = .012
            for i,lower,minimum in records:
                if lower['type'] != 'rail_over':
                    continue
                for j,upper,maximum in records:
                    if upper['type'] != 'road_over':
                        continue
                    length = abs(line.project(Point(xy[i]))-line.project(Point(xy[j])))
                    miss = minimum-maximum-cap*length
                    if miss > .001:
                        conflicts.append(dict(rail=wid, lowerRoad=lower['road'], upperRoad=upper['road'],
                                              railMinimumM=round(minimum,4),railMaximumM=round(maximum,4),
                                              distanceM=round(length,3),gradeCapPermille=1000*cap,
                                              deficiencyM=round(miss,4)))
        report['sameWayClearanceConflicts'] = conflicts
    return report
