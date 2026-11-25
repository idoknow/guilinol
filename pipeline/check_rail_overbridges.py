"""Measure the minimum bridge soffit over each specified GL04 track, including slab edges."""
import argparse
import gzip
import json
import struct
from pathlib import Path

import numpy as np
from shapely import LineString, Point, Polygon, box, union_all

from check_rail_stack import elevation, separation, track_pieces
from common import load_osm
from features import points
from railways import BRIDGE


def road_faces(world, manifest, area):
    depth = json.loads(Path(__file__).with_name("vessel-bounds.json").read_bytes())["bridgeDepth"]
    for tile in manifest["chunks"]:
        x, z, size = tile["x"], tile["z"], manifest["chunkSize"]
        if not box(x, z, x + size, z + size).intersects(area):
            continue
        raw = gzip.decompress((world / tile["file"]).read_bytes())
        vertices, indices, metadata, image, count = struct.unpack_from("<5I", raw, 4)
        start = 16924 + 9 * vertices + 4 * indices
        paths = json.loads(raw[start:start + metadata])
        thin = set(paths[2])
        triangles = np.frombuffer(raw, "<i2", count * 9, start + metadata + image).reshape(-1, 3, 3)
        for i, encoded in enumerate(triangles):
            corners = encoded / 100 + [x, 0, z]
            poly = Polygon(corners[:, [0, 2]])
            if poly.area > 1e-8 and poly.intersects(area):
                corners[:, 1] -= .6 if i in thin else depth
                yield poly, corners


def road_clearance(world, manifest, track, bridge, width, lower):
    # Inspect full encoded triangles through their actual edges. The nominal
    # strip identifies the deck and checks that its full width was present.
    expected = track.intersection(bridge.buffer(width, cap_style="flat"))
    covered = []
    minimum = float("inf")
    for polygon, corners in road_faces(world, manifest, expected.buffer(.03)):
        if any(bridge.distance(Point(x, z)) > width + .025 for x, _, z in corners):
            continue
        a, b, c = corners
        slope = np.linalg.solve((corners[1:] - a)[:, [0, 2]], [b[1] - a[1], c[1] - a[1]])
        for piece in lower:
            span = polygon.intersection(piece[0])
            if span.is_empty:
                continue
            covered.append(span)
            for x, z in span.coords:
                soffit = a[1] + slope @ [x - a[0], z - a[2]]
                minimum = min(minimum, soffit - elevation(piece, Point(x, z)))
    if not covered or not union_all(covered).buffer(.025).covers(expected):
        raise ValueError(f"Incomplete road deck at {expected.centroid.wkt}")
    return minimum


def check(world, design):
    manifest = json.loads((world / "manifest.json").read_bytes())
    decks = design["roadDecks"] + design["railDecks"]
    ids = {wid for deck in decks for wid in [deck["way"], *deck["rails"]]}
    lines = {way["id"]: LineString(points(way)) for way in load_osm()
             if way["type"] == "way" and way["id"] in ids}
    results = []
    for deck in decks:
        upper = lines[deck["way"]]
        width = deck["halfWidthM"]
        for wid in deck["rails"]:
            line = lines[wid]
            expected = line.intersection(upper.buffer(width, cap_style="flat"))
            if expected.is_empty:
                raise ValueError(f"Missing crossing of {deck['way']} and {wid}")
            area = expected.buffer(width + .1)
            lower = track_pieces(world, manifest, line, area)
            if deck in design["railDecks"]:
                top = [p for p in track_pieces(world, manifest, upper, area) if p[3] & BRIDGE]
                minimum = separation(top, lower, width, 0, 1.2, expected)
            else:
                minimum = road_clearance(world, manifest, line, upper, width, lower)
            results.append(dict(upper=deck["way"], lower=wid, minimumM=minimum,
                                wireMarginM=minimum-design["wireHeightM"], targetM=design["clearanceM"]))
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("world", type=Path)
    parser.add_argument("design", type=Path)
    args = parser.parse_args()
    results = check(args.world, json.loads(args.design.read_bytes()))
    print(json.dumps(results, indent=2))
    raise SystemExit(0 if results and all(r["minimumM"] >= r["targetM"] for r in results) else 1)
