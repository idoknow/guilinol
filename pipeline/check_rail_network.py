"""Measure parallel railhead differences across the entire finished GL04 world."""

import argparse
import json
from pathlib import Path

import numpy as np
from shapely import LineString, Point, STRtree

from check_rail_section_tracks import tile_rails
from common import load_osm
from features import points
from station_corridor import parallel_height_audit


def check_network(world):
    ways = {
        way["id"]: way for way in load_osm()
        if way["type"] == "way" and way.get("tags", {}).get("railway") == "rail"
        and len(way.get("geometry", [])) >= 2
    }
    ids = list(ways)
    lines = [LineString(points(ways[wid])) for wid in ids]
    tree = STRtree(lines)
    manifest = json.loads((world / "manifest.json").read_bytes())
    coords, heights, pieces = [], [], []
    for tile in manifest["chunks"]:
        for ax, az, ay, bx, bz, by, station, flags, *_ in tile_rails(world, tile):
            a = (tile["x"] + ax / 100, tile["z"] + az / 100)
            b = (tile["x"] + bx / 100, tile["z"] + bz / 100)
            segment = LineString([a, b])
            probes = (Point(a), segment.interpolate(.5, normalized=True), Point(b))
            matches = [
                ids[index] for index in tree.query(segment, predicate="dwithin", distance=.001)
                if all(lines[index].distance(point) <= .001 for point in probes)
            ]
            if len(matches) != 1 or not segment.length:
                raise ValueError(f"Invalid or ambiguous GL04 segment in {tile['file']} at {a}: {matches}")
            start = len(coords)
            coords.extend((a, b))
            heights.extend((ay / 100, by / 100))
            pieces.append((start, start + 1, station / 100, flags, matches[0]))
    report = parallel_height_audit(pieces, np.asarray(coords), np.asarray(heights), ways, include_structures=True)
    if not report["directedSegmentPairs"]:
        raise ValueError("World contains no comparable rail segments")
    return dict(encodedSegments=len(pieces), matchedWays=len({row[4] for row in pieces}), **report)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("world", type=Path)
    args = parser.parse_args()
    result = check_network(args.world)
    print(json.dumps(result, indent=2))
    raise SystemExit(1 if result["over5cm"] else 0)
