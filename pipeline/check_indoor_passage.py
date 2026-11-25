"""Verify the enclosed passage, terminal and original roofs using baked GL04 data."""
import argparse
import gzip
import json
import struct
from pathlib import Path

import numpy as np
from shapely import LineString, Point, Polygon, box, union_all

from common import load_osm
from features import points


def read_geometry(world, bounds, seeds):
    buildings, floors = [], []
    manifest = json.loads((world / "manifest.json").read_bytes())
    for tile in manifest["chunks"]:
        origin = np.array([tile["x"], tile["z"]])
        if not box(*origin, *(origin + manifest["chunkSize"])).intersects(bounds):
            continue
        raw = gzip.decompress((world / tile["file"]).read_bytes())
        vertices, indices, size = struct.unpack_from("<3I", raw, 4)
        offset = 16924 + 9 * vertices + 4 * indices
        content = json.loads(raw[offset:offset + size])

        def footprint(ring):
            shell, *holes = [np.asarray(loop)/100 + origin for loop in ring[2]]
            return Polygon(shell, holes)

        for ring in content[0]:
            if ring[5] in seeds:
                buildings.append((ring[5], ring[0]/10, ring[1]/10, footprint(ring)))
        for ring in content[7] if len(content) > 7 and isinstance(content[7], list) else []:
            floors.append((footprint(ring), origin, np.array(ring[10])))
    return buildings, floors


def check(base, world, section):
    config = section["indoorPassage"]
    ways = {w["id"]: w for w in load_osm() if w["type"] == "way"}
    main, branch = [LineString(points(ways[i])) for i in config["ways"]]
    bounds = main.union(branch).buffer(config["width"])
    old, _ = read_geometry(base, bounds, config["buildingSeeds"])
    new, floors = read_geometry(world, bounds, config["buildingSeeds"])
    minimum, maximum_grade, samples = float("inf"), 0., 0
    for seed in config["buildingSeeds"]:
        roof = max(y for ident, _, y, _ in old if ident == seed)
        def roof_shape(rows):
            return union_all([p for ident, _, y, p in rows if ident == seed and y == roof])
        if roof_shape(old).symmetric_difference(roof_shape(new)).area > .001:
            raise ValueError(f"Changed roof footprint at {seed}")
    shell = union_all([p for _, base_y, top_y, p in new if base_y < config["ceiling"] <= top_y])
    original = union_all([p for _, _, _, p in old])
    cuts = original.boundary.difference(shell.buffer(.005))
    contours = [g for g in getattr(cuts, "geoms", [cuts]) if g.length > .02]
    mouths = [Point(main.coords[i]) for i in (0, -1)]
    if len(contours) != 2 or any(min(g.distance(p) for g in contours) > 1.8 for p in mouths):
        raise ValueError("Exterior wall openings must be confined to the two bridge entrances")
    if any(not g.covered_by(p.buffer(3.5)) for g, p in
           [(g, min(mouths,key=g.distance)) for g in contours]):
        raise ValueError("Exterior wall breach outside a bridge entrance")
    ceiling = union_all([p for _, base_y, _, p in new if base_y == config["ceiling"]])
    for line in (main, branch):
        length = line.length - (config["endWallDepth"] if line is branch else 0)
        for station in np.arange(.05, length, .2):
            xy = np.asarray(line.interpolate(station).coords[0])
            direction = np.subtract(line.interpolate(station+.01).coords[0],
                                    line.interpolate(station-.01).coords[0])
            normal = np.array([-direction[1], direction[0]]) / np.linalg.norm(direction)
            for side in (0, config["width"]/2-.025, -config["width"]/2+.025):
                pos = xy + normal*side
                point = Point(pos)
                heights = []
                for poly, origin, plane in floors:
                    if poly.distance(point) < .012:
                        heights.append(plane[:2] @ (pos-origin) + plane[2])
                        maximum_grade = max(maximum_grade, np.linalg.norm(plane[:2]))
                if not heights or max(heights)-min(heights) > .02:
                    raise ValueError(f"Missing or discontinuous floor at {pos}")
                if shell.contains(point):
                    raise ValueError(f"Impassable building wall at {pos}")
                if ceiling.covers(point):
                    minimum = min(minimum, config["ceiling"]-max(heights))
                samples += 1
    if not np.isfinite(minimum) or minimum < 2.5 or maximum_grade > .08:
        raise ValueError("Insufficient headroom or excessive ramp grade")
    end = np.asarray(branch.coords[-1])
    direction = end - branch.coords[-2]
    direction /= np.linalg.norm(direction)
    side = np.array([-direction[1], direction[0]])
    for along in np.linspace(.3, 3.3, 16):
        center = end-direction*along
        for sign in (-1, 1):
            if not shell.covers(Point(center + sign*side*(config["width"]/2+.04))):
                raise ValueError("Unclosed terminal side wall")
    if not shell.covers(Point(end-direction*.1)):
        raise ValueError("Open terminal facade")
    return dict(mainLength=main.length, branchLength=branch.length, samples=samples,
                minimumHeadroom=minimum, maximumRampGrade=maximum_grade, exteriorOpenings=len(contours), roofChanges=0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("base", "world", "section"):
        parser.add_argument(arg, type=Path)
    args = parser.parse_args()
    print(json.dumps(check(args.base, args.world, json.loads(args.section.read_bytes())), indent=2))
