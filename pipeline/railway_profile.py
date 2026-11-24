"""Solve for railheads before fitting the level-crossing roadway approaches."""

import numpy as np
import clarabel
from scipy.sparse import coo_matrix, diags, eye, vstack
from shapely import LineString, Point, intersects_xy
from features import points

from station_levels import PLATFORMS, RAIL


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


def solve(coords, pieces, ways, target, crossings, yards, pairs):
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
    # The paved width may cross two divided or adjacent carriageways. Hold
    # the rail across the full panel so overlapping pavement has one datum.
    from railways import LEVEL
    panel_nodes = nodes[np.array([bool(flags & LEVEL) for _,_,_,flags,_ in pieces])]
    if len(panel_nodes):
        limit_difference(panel_nodes, np.broadcast_to([1,-1],panel_nodes.shape), 0.)
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
    for platforms, yard in yards:
        # Rail vertices are snapped to 0.1 mm at tile and way intersections.
        # Include vertices snapped just across the clipped yard boundary.
        members = eligible[intersects_xy(yard.buffer(.001), *xy[eligible].T)]
        if PLATFORMS.intersection(platforms):
            low[members] = RAIL
        if len(members) > 1:
            linked = np.column_stack((members[1:], np.full(len(members)-1, members[0])))
            limit_difference(linked, np.broadcast_to([1, -1], linked.shape), 0.)

    from nanxi_crossing import ROAD, TRACKS, design
    nanxi = [node for node,row,*_ in crossings if row.get('road')==ROAD and row['rail'] in TRACKS]
    if nanxi:
        _,_,_,rail_floor = design(ways)
        matrices.append(-eye(count,format='csr')[nanxi])
    fixed = np.flatnonzero(np.isfinite(low))
    matrix = vstack([eye(count, format='csr')[fixed], *matrices], format='csc')
    # Weight DEM residuals by represented length so inserting a tile boundary
    # or short crossing segment does not give its location disproportionate weight.
    weights = np.bincount(nodes.ravel(), np.repeat(lengths/2, 2), minlength=count)
    weights = np.maximum(weights, .001)
    # Smooth the DEM along the connected track graph on the 12 m sampling
    # scale. Length weights keep dense junction samples from biasing this fit.
    from scipy.sparse.linalg import spsolve
    edge_rows = np.repeat(np.arange(len(nodes)), 2)
    gradient = coo_matrix((np.tile([-1.,1.],len(nodes)), (edge_rows,nodes.ravel())),
                          shape=(len(nodes),count)).tocsr()
    target = spsolve(diags(weights) + gradient.T @ diags(144/lengths) @ gradient, weights*target)
    # Centre the datum to keep the objective well scaled.
    datum = np.average(target, weights=weights)
    if nanxi:
        limits.append(np.full(len(nanxi),datum-rail_floor))
    rhs = np.concatenate([low[fixed]-datum, *limits])
    cones = [clarabel.ZeroConeT(len(fixed)), clarabel.NonnegativeConeT(len(rhs)-len(fixed))]
    settings = clarabel.DefaultSettings()
    settings.verbose = False
    result = clarabel.DefaultSolver(diags(weights,format='csc'), -weights*(target-datum),
                                    matrix,rhs,cones,settings).solve()
    if result.status not in (clarabel.SolverStatus.Solved, clarabel.SolverStatus.AlmostSolved):
        raise ValueError(f'Rail least-squares solver failed: {result.status}')
    residual = matrix @ result.x - rhs
    if np.max(residual,initial=0)>1e-7 or np.max(abs(residual[:len(fixed)]),initial=0)>1e-7:
        raise ValueError('Rail least-squares solution violates a geometric constraint')
    heights = np.asarray(result.x)+datum
    return heights, dict(feasible=True, weightedRmsM=float(np.sqrt(np.average((heights-target)**2,weights=weights))),
                         panels=[dict(road=wid, fromM=max(0.,panel[0][1]-2),
                                      toM=min(LineString(points(ways[wid])).length,panel[-1][1]+2),
                                      railY=float(heights[panel[0][0]])) for wid,panel in panels])
