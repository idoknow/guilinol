"""Solve for railheads before fitting the level-crossing roadway approaches."""

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import coo_matrix, eye, hstack, vstack
from shapely import intersects_xy


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

    # Use source track tags for the yard. A level track crossing *over* a
    # road tunnel may carry a local bridge rendering flag inside its road gap.
    surface_ways = {wid for wid, way in ways.items()
                    if way.get('tags', {}).get('railway') == 'rail'
                    and way['tags'].get('layer', '0') == '0'
                    and all(way['tags'].get(key, 'no') == 'no' for key in ('bridge', 'tunnel'))}
    eligible = np.unique(np.array([i for a, b, _, _, wid in pieces if wid in surface_ways
                                   for i in (a, b)], dtype=int))
    for _, yard in yards:
        members = eligible[intersects_xy(yard, *xy[eligible].T)]
        if len(members) > 1:
            linked = np.column_stack((members[1:], np.full(len(members)-1, members[0])))
            limit_difference(linked, np.broadcast_to([1, -1], linked.shape), 0.)

    # Level crossings impose no unary road-height pins. Existing underpasses
    # and overpasses do impose one-sided bounds to preserve measured clearance.
    low = np.full(count, -np.inf)
    high = np.full(count, np.inf)
    for (i, *_), row in zip(crossings, reference, strict=True):
        if row['clearanceM'] is None:
            continue
        if row['type'] == 'rail_over':
            low[i] = max(low[i], row['railY'])
        elif row['type'] == 'road_over':
            high[i] = min(high[i], row['railY'])

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
        report['maxGradePermille'] = float(np.max(1000 * abs(np.diff(heights[nodes]).ravel()) / lengths))
    return report
