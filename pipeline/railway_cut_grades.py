"""Fit connected cutting floors to the paved road at every daylight junction."""
from collections import defaultdict
from functools import lru_cache
import gzip
import json
import math
import struct

import clarabel
import numpy as np
from scipy import sparse
from shapely import LineString, Point, Polygon

from features import points
from landmarks.world_surface import Surface
from railway_road_profiles import grade_cap
from road_grading import eval_bspline_grid


def paved_height(directory, manifest):
    ground = Surface(directory, manifest)
    tiles = {(t['x'], t['z']): t for t in manifest['chunks']}

    @lru_cache(32)
    def control(x, z):
        tile = tiles.get((x, z))
        if tile is None:
            return None
        raw = gzip.decompress((directory / tile['file']).read_bytes())
        vertices, indices, size = struct.unpack_from('<3I', raw, 4)
        start = 16924 + vertices * 9 + indices * 4
        streets = json.loads(raw[start:start + size])[1]
        if len(streets) > 5 and streets[5]:
            base, values = streets[5]
            return (base + np.array(values).reshape(35, 35)) / 1000

    @lru_cache(8192)
    def height(x, z):
        tx, tz = math.floor(x / 256) * 256, math.floor(z / 256) * 256
        field = control(tx, tz)
        y = ground.sample(x, z, include_peaks=False)[0]
        if field is not None:
            y = max(y, float(eval_bspline_grid(field, tx, tz, np.asarray(x), np.asarray(z))))
        return y + .045
    return height


def smooth_cuttings(tunnels, ways, surface_at, bridge_ends):
    from station_bore_approaches import trim_joint_floors
    trim_joint_floors(tunnels)
    cuts = [t for t in tunnels if t.get('openCut')]
    if not cuts:
        return
    fixed = dict(bridge_ends)
    for tunnel in tunnels:
        if not tunnel.get('openCut'):
            fixed.update((n, p[1]) for n, p in zip(tunnel.get('nodes', ()), tunnel['portals']))

    node_index, old_height = {}, []
    profiles, strips, mouths = [], defaultdict(list), defaultdict(list)
    grade_rows, grade_limits, curve_rows, curve_limits = [], [], [], []

    def add_bounds(matrix, offset, limit, rows, limits):
        rows.extend((matrix, -matrix))
        limits.extend((limit - offset, limit + offset))

    for j, t in enumerate(cuts):
        line = LineString([(x, z) for x, _, z in t['portals']])
        floor = line.buffer(t['halfWidth'], cap_style='flat')
        for joint in t.get('joints', ()):
            if joint:
                for ring in joint.get('wedges', [joint['ring']]):
                    floor = floor.union(Polygon(ring))
        sample = np.linspace(0, t['length'], max(3, math.ceil(t['length'] / 2) + 1))
        levels = np.interp(sample, *np.array(t['stations']).T)
        indices = []
        for k, y in enumerate(levels):
            key = (j, k)
            if k == 0 or k == len(levels) - 1:
                key = t['nodes'][int(k != 0)]
            if key not in node_index:
                node_index[key] = len(old_height)
                old_height.append(y)
            indices.append(node_index[key])
        profiles.append((sample, np.array(indices)))
        strip = (line, floor, j)
        strips[t['way']].append(strip)
        for end, node in enumerate(t['nodes']):
            if t['mouths'][end]:
                mouths[node].append(strip)
                fixed[node] = t['portals'][end][1]

    n = len(old_height)
    for t, (at, ids) in zip(cuts, profiles):
        eye = sparse.csr_matrix((np.ones(len(at)), (np.arange(len(at)), ids)), shape=(len(at), n))
        add_bounds(eye[1:] - eye[:-1], 0, grade_cap(ways[t['way']]['tags']) * np.diff(at),
                   grade_rows, grade_limits)

    for wid, way in ways.items():
        if 'highway' not in way.get('tags', {}) or len(way.get('geometry', ())) < 2:
            continue
        connected = list(strips.get(wid, ()))
        for node in way.get('nodes', ()):
            connected.extend(mouths.get(node, ()))
        if not connected:
            continue
        axis = LineString(points(way))
        cap = grade_cap(way['tags'])
        for strip_axis, _, _ in connected:
            ends = [axis.project(Point(p)) for p in strip_axis.coords]
            start, stop = max(0., min(ends) - 20), min(axis.length, max(ends) + 20)
            if stop - start < .01:
                continue
            at = np.linspace(start, stop, max(2, math.ceil((stop - start) / 2) + 1))
            row, col, value, support = [], [], [], np.zeros(len(at))
            for i, station in enumerate(at):
                p = axis.interpolate(station)
                for line, floor, j in connected:
                    if floor.covers(p):
                        s, ids = profiles[j]
                        a = line.project(p)
                        k = np.clip(np.searchsorted(s, a) - 1, 0, len(s) - 2)
                        f = np.clip((a - s[k]) / (s[k + 1] - s[k]), 0, 1)
                        row.extend((i, i))
                        col.extend(ids[k:k + 2])
                        value.extend((1 - f, f))
                        break
                else:
                    support[i] = surface_at(p.x, p.y)
            basis = sparse.csr_matrix((value, (row, col)), shape=(len(at), n))
            active = np.diff(basis.indptr) > 0
            use = active[1:] | active[:-1]
            diff = basis[1:] - basis[:-1]
            step = at[1] - at[0]
            add_bounds(diff[use], np.diff(support)[use], np.full(sum(use), cap * step),
                       grade_rows, grade_limits)
            use = use[1:] | use[:-1]
            add_bounds((diff[1:] - diff[:-1])[use], np.diff(support, n=2)[use],
                       np.full(sum(use), .006 * step ** 2), curve_rows, curve_limits)

    grade, curvature = (sparse.vstack(rows, format='csc') for rows in (grade_rows, curve_rows))
    # Curvature has a slack variable where the fixed deck or bore constrains
    # the transition. The road-class gradient and structure levels are hard.
    k = curvature.shape[0]
    ident = sparse.eye(k, format='csc')
    equal = [(node_index[key], y) for key, y in fixed.items() if key in node_index]
    eq = sparse.coo_matrix((np.ones(len(equal)), (np.arange(len(equal)), [i for i, _ in equal])),
                           shape=(len(equal), n + k))
    constraints = sparse.vstack([eq, sparse.hstack([grade, sparse.csc_matrix((grade.shape[0], k))]),
                                 sparse.hstack([curvature, -ident]),
                                 sparse.hstack([sparse.csc_matrix((k, n)), -ident])], format='csc')
    reference = np.r_[old_height, np.zeros(k)]
    rhs = np.r_[[y for _, y in equal], np.concatenate(grade_limits),
                np.concatenate(curve_limits), np.zeros(k)] - constraints @ reference
    settings = clarabel.DefaultSettings()
    settings.verbose = False
    solution = clarabel.DefaultSolver(
        sparse.diags(np.r_[np.full(n, .003), np.full(k, 2.)], format='csc'),
        np.r_[np.zeros(n), np.full(k, 10.)], constraints, rhs,
        [clarabel.ZeroConeT(len(equal)), clarabel.NonnegativeConeT(constraints.shape[0] - len(equal))],
        settings).solve()
    if str(solution.status) not in ('Solved', 'AlmostSolved'):
        raise ValueError(f'Fixed crossing or bridge exceeds the connecting road grade: {solution.status}')
    height = reference[:n] + solution.x[:n]
    for t, (sample, ids) in zip(cuts, profiles):
        t['stations'] = np.column_stack((sample, height[ids])).tolist()
        for end in (0, -1):
            t['portals'][end][1] = float(height[ids[end]])
