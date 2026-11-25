"""Measure the two unresolved vehicle corridors against mapped and baked facades.

Run from the repository root with its pipeline environment:
    PYTHONPATH=pipeline python scripts/verify-facade-clearances.py dist/world
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from shapely import LineString, box, union_all

from common import load_osm
from features import area, points
from ground_passages import footprint, line_parts
from surveyed_corridors import read_chunk


def campus(ways):
    wall = area(ways[1472917067])
    branch = LineString(points(ways[1487527335]))
    closed = LineString(points(ways[1487527338]))
    overlap = branch.intersection(wall)
    return {
        "branch": 1487527335,
        "closedWay": 1487527338,
        "sharedNodes": sorted(set(ways[1487527335]["nodes"]) & set(ways[1487527338]["nodes"])),
        "centrelineInsideWallMetres": [part.length for part in line_parts(overlap)],
        "distanceToClosedOverlapMetres": overlap.distance(closed.intersection(wall)),
        "lengthWithinCarHalfWidthMetres": branch.intersection(wall.buffer(1.82 / 2)).length,
        "lengthWithinCorridorHalfWidthMetres": branch.intersection(wall.buffer(2.5)).length,
    }


def alley(world, way):
    axis = LineString(points(way))
    reach = 15
    search_area = axis.buffer(reach)
    walls = []
    manifest = json.loads((world / "manifest.json").read_text())
    for tile in manifest["chunks"]:
        x, z = tile["x"], tile["z"]
        if search_area.intersects(box(x, z, x + 256, z + 256)):
            buildings = read_chunk(world / tile["file"])[3][0]
            walls.extend(footprint(row, np.array([x, z])) for row in buildings if not any(row[9:]))
    obstacles = union_all(walls)
    intervals = math.ceil(axis.length / 0.25)
    step = axis.length / intervals
    widths = []
    for station in np.linspace(0, axis.length, intervals + 1):
        centre = axis.interpolate(station)
        before = axis.interpolate(max(0, station - 0.05)).coords[0]
        after = axis.interpolate(min(axis.length, station + 0.05)).coords[0]
        dx, dz = np.subtract(after, before)
        normal = np.array([-dz, dx]) / math.hypot(dx, dz)
        q = np.array(centre.coords[0])
        free = LineString([q - reach * normal, q + reach * normal]).difference(obstacles)
        widths.append(max((part.length for part in line_parts(free) if part.distance(centre) < 0.001), default=0))
    return {
        "way": way["id"],
        "lengthMetres": axis.length,
        "stationSpacingMetres": step,
        "crossSections": len(widths),
        "minimumFreeWidthMetres": min(widths),
        "minimumAtMetres": widths.index(min(widths)) * step,
        "approximateLengthBelow2_22Metres": sum(w < 2.22 for w in widths) * step,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("world", type=Path)
    args = parser.parse_args()
    required = {1472917067, 1487527335, 1487527338, 1552207023}
    ways = {w["id"]: w for w in load_osm() if w["type"] == "way" and w["id"] in required}
    print(json.dumps({"campus": campus(ways), "alley": alley(args.world, ways[1552207023])}, indent=2))
