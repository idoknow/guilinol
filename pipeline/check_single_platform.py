"""Measure the boarding edge of a corrected, single-sided passenger platform in GL04."""
import argparse
import json
from pathlib import Path

import numpy as np
from shapely import LineString, Point, STRtree, polygons, union_all

from check_rail_platforms import pavement, pavement_triangles, rail_chords
from common import load_osm
from features import area, points


def intervals(stations, bad):
    groups = np.split(stations[bad], np.flatnonzero(np.diff(stations[bad]) > .251) + 1)
    return [[float(group[0]), float(group[-1])] for group in groups if len(group)]


def inspect(base, world, platform, track, design, gauge):
    region = platform.buffer(16)
    original = rail_chords(base, region)
    candidate = rail_chords(world, region)
    keys = [key for key in original if all(track.distance(Point(xz)) < .001
                                           for xz in (key[:2], key[2:]))]
    if not keys:
        raise ValueError("No finished segments match the boarding track")
    changed = [key for key in keys if original[key] != candidate.get(key)]
    segments = [LineString([key[:2], key[2:]]) for key in keys]
    index = STRtree(segments)
    bounds = [platform.bounds]
    triangles = pavement_triangles(world, bounds, "paving-1")
    surface = union_all(polygons(triangles[:, :, [0, 2]])).intersection(platform.buffer(.008))
    axis = [track.project(Point(vertex)) for vertex in platform.exterior.coords]
    # Keep probes inside the original end faces; offsets along either end are not boarding edges.
    stations = np.arange(np.ceil((min(axis)+.25)*4)/4, max(axis)-.25, .25)
    span = np.linalg.norm(np.subtract(platform.bounds[2:], platform.bounds[:2]))
    gaps, probes, rail = [], [], []
    for station in stations:
        point = track.interpolate(station)
        xy = np.array(point.coords[0])
        tangent = np.subtract(track.interpolate(station+.01).coords[0],
                              track.interpolate(station-.01).coords[0])
        normal = tangent[::-1]*[1,-1]/np.linalg.norm(tangent)
        if (np.subtract(platform.centroid.coords[0], xy) @ normal) < 0:
            normal *= -1
        section = LineString([xy, xy+span*normal]).intersection(surface)
        distance = section.distance(point) if not section.is_empty else np.nan
        gaps.append(distance-gauge/2)
        probes.append(xy+(gauge/2+design["innerRailClearanceM"]+.08)*normal)
        idx = index.nearest(point)
        frac = segments[idx].project(point, normalized=True)
        rail.append(np.dot([1-frac, frac], candidate[keys[idx]]))
    gaps = np.asarray(gaps)
    bad = ~np.isfinite(gaps) | (abs(gaps-design["innerRailClearanceM"]) > .01)
    rise = pavement(world, bounds, np.array(probes)) - rail
    error = rise-design["passengerRiseM"]
    heights_bad = ~np.isfinite(error) | (abs(error) > .02)
    return dict(rail=design["track"], chords=len(keys), changedChords=changed,
                samples=len(stations), edgeGapM=[float(np.nanmin(gaps)),float(np.nanmax(gaps))],
                gapViolations=intervals(stations,bad), boardingViolations=intervals(stations,heights_bad),
                passed=not(changed or bad.any() or heights_bad.any()))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", type=Path)
    parser.add_argument("world", type=Path)
    args = parser.parse_args()
    ways = {w["id"]: w for w in load_osm() if w["type"] == "way"}
    designs = json.loads(Path(__file__).with_name("platform-outlines.json").read_bytes())
    gauge = json.loads(Path(__file__).with_name("railway-style.json").read_bytes())["gauge"]
    report = {wid: inspect(args.base.resolve(), args.world.resolve(), area(ways[int(wid)]),
                           LineString(points(ways[design["track"]])), design, gauge)
              for wid, design in designs.items() if "passengerRiseM" in design}
    print(json.dumps(report, indent=2, allow_nan=False))
    raise SystemExit(any(not row["passed"] for row in report.values()))
