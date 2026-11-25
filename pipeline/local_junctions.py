"""Fit the connected arms of surveyed surface junctions within their grade limits."""
from collections import defaultdict
from heapq import heapify, heappop, heappush
import math

import numpy as np
from scipy.optimize import linprog
from shapely import LineString, STRtree

from canal_passages import sample_road_heights
from features import points
from road_profile import RULES
from service_streets import width
from vehicle_tunnels import grade_limit, underground


def profiles(output, manifest, elements, widths, previous):
    # Reach follows the road graph. Each outer arm returns to its previous elevation.
    survey = [([9349162218], 68), ([9349162228], 68), ([6501439896], 42),
              ([14086733487], 42), ([14141257617], 42), ([13651472305], 42),
              ([13409900006], 42), ([13715269941, 13715269942], 42),
              ([13715292332], 42), ([6821519239], 42), ([14286127223], 42),
              ([4514289513], 42), ([11883815125], 42),
              ([6480631919], 32), ([13726833648], 32)]
    edges = defaultdict(list)
    pos, fixed = {}, set()
    for way in elements:
        tags = way.get('tags', {})
        kind = tags.get('highway')
        if way['type'] != 'way' or not kind or not way.get('geometry') or not all(way['geometry']):
            continue
        refs = way['nodes']
        if underground(way) or tags.get('bridge', 'no') != 'no':
            fixed.update((refs[0], refs[-1]))
            continue
        xy = points(way)
        pos.update(zip(refs, xy))
        half = widths.get(way['id'], RULES['defaultWidth'].get(kind, width(tags))) / 2 + .5
        for a, b, p, q in zip(refs, refs[1:], xy, xy[1:]):
            distance = math.dist(p, q)
            if distance < .01:
                continue
            for head, tail in ((a, b), (b, a)):
                edges[head].append((tail, distance, way['id'], half, grade_limit(kind),
                                    int(kind in ('footway', 'path', 'pedestrian', 'steps'))))
    old = STRtree([row[0] for row in previous])
    result = []
    for starts, reach in survey:
        if any(node not in edges for node in starts):
            continue
        west, north, w, h = manifest['extent']
        if not all(west <= pos[n][0] < west+w and north <= pos[n][1] < north+h for n in starts):
            continue
        distances = dict.fromkeys(starts, 0.)
        pending = [(0., n) for n in starts]
        heapify(pending)
        while pending:
            d, n = heappop(pending)
            if n in fixed or distances[n] != d:
                continue
            for neighbor, length, *_ in edges[n]:
                end = d + length
                if end < min(reach-.1, distances.get(neighbor, math.inf)):
                    distances[neighbor] = end
                    heappush(pending, (end, neighbor))
        spans, seen, outer = [], set(), set()
        for a, d in distances.items():
            if a in fixed:
                outer.add(a)
                continue
            for b, length, wid, half, cap, foot in edges[a]:
                key = min(a,b), max(a,b), wid
                if key in seen:
                    continue
                seen.add(key)
                end = b
                if b not in distances:
                    end = (a, b, wid)
                    fraction = min(1, (reach-d)/length)
                    pos[end] = np.asarray(pos[a]) + fraction*(np.asarray(pos[b])-pos[a])
                    outer.add(end)
                spans.append((a, end, wid, half, cap, foot))
        result.extend(fit_arms(output, manifest, spans, pos, outer, starts, previous, old))
    return result


def fit_arms(output, manifest, spans, pos, outer, starts, previous, old):
    from shapely import Point
    by_node, neighbors, half_width = {}, defaultdict(set), defaultdict(float)
    for a, b, wid, half, _, _ in spans:
        for i, j in ((a,b), (b,a)):
            by_node[i] = wid
            neighbors[i].add(j)
            half_width[i] = max(half_width[i], half)
    nodes = list(by_node)
    count = len(nodes)
    indices = {n:i for i,n in enumerate(nodes)}
    native = sample_road_heights(output, manifest, [dict(x=pos[n][0],z=pos[n][1],way=by_node[n]) for n in nodes])
    # Preserve an already designed surface or bridge approach at the boundary.
    for i, n in enumerate(nodes):
        pt = Point(pos[n])
        candidates = old.query(pt, predicate='dwithin', distance=.04)
        if len(candidates):
            line, _, low, high, *_ = previous[min(candidates, key=lambda j: previous[j][0].distance(pt))]
            native[i] = low + (high-low)*line.project(pt, normalized=True)
    pad = {n:min(5., half_width[n]) if n in starts or len(neighbors[n]) >= 3 else 0. for n in nodes}
    # The second variable at each node bounds the absolute change from its old height.
    constraints, limits = [], []
    for a,b,_,_,cap,_ in spans:
        budget = max(0, math.dist(pos[a], pos[b])-pad[a]-pad[b]) * cap*.86
        row = np.zeros(2*count)
        row[indices[a]], row[indices[b]] = 1, -1
        constraints.extend((row,-row))
        limits.extend((budget,budget))
    for i, y in enumerate(native):
        row = np.zeros(2*count)
        row[i], row[count+i] = 1, -1
        constraints.append(row)
        negative = row.copy()
        negative[i] = -1
        constraints.append(negative)
        limits.extend((y,-y))
    bounds = [(native[i], native[i]) if n in outer else (None,None) for i,n in enumerate(nodes)]
    fit = linprog(np.r_[np.zeros(count), np.ones(count)], A_ub=constraints, b_ub=limits,
                  bounds=bounds + [(0,None)]*count, method='highs')
    if not fit.success:
        raise ValueError(f'No feasible grade at surface junctions {starts}')
    rows = []
    for a,b,_,half,cap,foot in spans:
        axis = LineString([pos[a],pos[b]])
        begin = min(pad[a], axis.length)
        end = max(begin, axis.length-pad[b])
        low, high = fit.x[indices[a]], fit.x[indices[b]]
        last = None
        for d in sorted({0., begin, end, axis.length, *np.arange(2,axis.length,2)}):
            t = np.clip((d-begin)/max(.00001,end-begin),0,1)
            f = (t*t/.2 if t<.1 else .9-(1-t)**2/.2 if t>.9 else t-.05)/.9
            point, y = axis.interpolate(d), low + (high-low)*f
            if last and last[0].distance(point)>.01:
                rows.append((LineString([last[0],point]),half,last[1],y,cap,foot))
            last = point,y
    return rows
