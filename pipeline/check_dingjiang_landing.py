"""Verify the north yard's grade-crossing cover and rail-side retaining wall in GL04."""

import argparse
import json
from pathlib import Path

import numpy as np
from shapely import LineString, Point, STRtree, get_coordinates

from section_track_strips import section_strips


def cells(section, pad=0.0):
    a, b = np.asarray(section["portals"])[:, [0, 2]]
    unit = (b - a) / section["length"]
    stations = section["stations"]
    for index, ((lo, y), (hi, h)) in enumerate(zip(stations, stations[1:])):
        axis = LineString([a + lo * unit, a + hi * unit])
        footprint = axis.buffer(section["halfWidth"] + pad, cap_style="flat")
        yield index, axis, footprint, y, h


def height(axis, y, h, point):
    return y + (h - y) * axis.project(point, normalized=True)


def check(world):
    manifest = json.loads((world / "manifest.json").read_bytes())
    tunnels = manifest["tunnels"]
    crossing = [t for t in tunnels if t["way"] == 983781267]
    bores = [t for t in tunnels if t["way"] == 727929887 and not t["openCut"]]
    cover = []
    for road in crossing:
        for _, axis, outer, y, h in cells(road, pad=1):
            for bore in bores:
                for _, tube, inner, low, high in cells(bore):
                    for xz in get_coordinates(outer.intersection(inner)):
                        pt = Point(xz)
                        roof = height(tube, low, high, pt) + bore["clearance"] + 1.2
                        cover.append(height(axis, y, h, pt) - roof)
    rows = section_strips(world)["06-dingjiang"]
    tracks = [LineString([(r[1], r[2]), (r[4], r[5])]) for r in rows]
    tree = STRtree(tracks)
    spans = [t for t in tunnels if t["way"] == 983781244 and "wallTop" in t]
    if not spans or not cover:
        raise ValueError("Missing finished retaining wall or crossing above bore")
    protected = []
    failed = 0
    for wall in spans:
        side = wall["wallSide"]
        top = wall["wallTop"]
        if len(top) != len(wall["stations"]):
            raise ValueError("Retaining-wall top does not match the finished section")
        for k, axis, _, y, h in cells(wall):
            start, end = np.array(axis.coords)
            dx, dz = (end - start) / axis.length
            # Include the entire width of the cap out to its outer face.
            toe = axis.parallel_offset(
                wall["halfWidth"] + 0.18, "left" if side == 1 else "right"
            )
            nearest = tree.nearest(toe)
            distance = toe.distance(tracks[nearest])
            for f in np.linspace(0, 1, max(2, int(np.ceil(axis.length / 0.25)) + 1)):
                pt = axis.interpolate(f, normalized=True)
                idx = tree.nearest(pt)
                track_y = height(tracks[idx], rows[idx][3], rows[idx][6], pt)
                road_y = y + f * (h - y)
                if abs(track_y - road_y) <= 0.5:
                    continue
                rail_point = tracks[idx].interpolate(tracks[idx].project(pt))
                lateral = (rail_point.y - pt.y) * dx - (rail_point.x - pt.x) * dz
                wall_y = top[k] + f * (top[k + 1] - top[k])
                protected.append(distance)
                if (
                    distance <= 3.7
                    or lateral * side <= 0
                    or wall_y < max(road_y, track_y) - 0.02
                ):
                    failed += 1
    return dict(
        minimumCoverM=min(cover),
        wallSamples=len(protected),
        minimumWallToeToTrackM=min(protected, default=0),
        wallViolations=failed,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("world", type=Path)
    result = check(parser.parse_args().world)
    print(json.dumps(result, indent=2))
    raise SystemExit(
        int(
            result["minimumCoverM"] < 0.5
            or not result["wallSamples"]
            or result["wallViolations"] > 0
        )
    )
