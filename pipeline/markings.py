"""Geometry shared by junction marking placement and its pre-union audit."""
import math
from collections import defaultdict

from shapely import STRtree
from shapely.geometry import LineString, Point
from shapely.ops import unary_union


def junction_cores(roads):
    directions = defaultdict(list)
    for road in roads:
        if road.kind == 'pedestrian':
            continue
        coords = list(road.line.coords)
        for a, b in zip(coords, coords[1:]):
            for origin, end in ((a, b), (b, a)):
                dx, dz = end[0] - origin[0], end[1] - origin[1]
                length = math.hypot(dx, dz)
                if length:
                    directions[origin].append((dx / length, dz / length, road.width))
    cores = []
    for (x, z), arms in directions.items():
        if len(arms) < 3:
            continue
        reach = max(w for _, _, w in arms) * 1.5
        strips = [LineString([(x - dx*reach, z - dz*reach), (x + dx*reach, z + dz*reach)])
                  .buffer(w/2, cap_style='flat') for dx, dz, w in arms]
        overlaps = [strips[i].intersection(strips[j])
                    for i, (dx, dz, _) in enumerate(arms)
                    for j, (ex, ez, _) in enumerate(arms[:i]) if abs(dx*ez - dz*ex) > .25]
        if overlaps:
            cores.append(unary_union(overlaps))
    return STRtree(cores)


def violations(markings, cores, bounds):
    marks = [g.intersection(bounds) for g in markings if g.intersects(bounds)]
    index = STRtree(marks)
    for i, mark in enumerate(marks):
        obstacles = [marks[j] for j in index.query(mark) if j < i]
        obstacles.extend(cores.geometries.take(cores.query(mark)))
        for obstacle in obstacles:
            overlap = mark.intersection(obstacle)
            if overlap.area > 1e-6:
                p = overlap.representative_point()
                yield [p.x, p.y, overlap.area]
