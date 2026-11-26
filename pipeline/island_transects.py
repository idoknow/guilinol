"""Boarding-edge transects perpendicular to an island platform’s longitudinal axis."""

import numpy as np
from shapely import LineString, Point, STRtree


def transects(polygon, axes):
    corners = np.asarray(polygon.minimum_rotated_rectangle.exterior.coords)
    edges = np.diff(corners, axis=0)
    axis = edges[np.argmax(np.linalg.norm(edges, axis=1))]
    axis = axis / np.linalg.norm(axis)
    normal = np.array([-axis[1], axis[0]])
    origin = np.asarray(polygon.centroid.coords[0])
    outline = np.asarray(polygon.exterior.coords) - origin
    lower, upper = np.min(outline @ axis), np.max(outline @ axis)
    reach = np.max(abs(outline @ normal)) + 16
    tree = STRtree(axes)
    # On each straight track chord the railhead varies linearly. Include the
    # projected chord ends along with the half-metre survey and polygon corners.
    stations = list(np.arange(lower + .25, upper, .5)) + list(outline @ axis)
    for i in tree.query(polygon.buffer(16), predicate='intersects'):
        stations.extend((np.asarray(axes[i].coords) - origin) @ axis)
    for station in np.unique(np.round(stations, 6)):
        if not lower < station < upper:
            continue
        center = origin + station * axis
        cut = LineString([center - normal * reach, center + normal * reach])
        span = polygon.intersection(cut)
        if span.geom_type != 'LineString' or span.length < .5:
            continue
        ends = np.sort((np.asarray(span.coords) - center) @ normal)[[0, -1]]
        sides = [[], []]
        for i in tree.query(cut, predicate='intersects'):
            line = axes[i]
            direction = np.diff(line.coords, axis=0)[0]
            if abs(direction @ axis) < .9 * line.length:
                continue
            pt = cut.intersection(line)
            if not isinstance(pt, Point):
                continue
            across = (np.array(pt.coords[0]) - center) @ normal
            side = int(across > ends.mean())
            gap = (across - ends[side]) * (1 if side else -1)
            # A boarding edge must face its adjacent rail, not another track
            # beyond a siding or across a neighbouring platform.
            if -.1 <= gap <= 16:
                sides[side].append((abs(gap), i, line.project(pt, normalized=True)))
        if not all(sides):
            yield None
            continue
        left, right = (min(side)[1:] for side in sides)
        start, stop = ends + [.08, -.08]
        probes = center + np.linspace(start, stop, int(np.ceil((stop-start)/.25))+1)[:, None]*normal
        yield probes, left, right
