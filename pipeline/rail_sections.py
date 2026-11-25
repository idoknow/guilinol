"""Set paired rail profiles in the chainage of one reference alignment."""

import json
from pathlib import Path

import numpy as np
from shapely import LineString, Point

from features import points

SECTION_DIR = Path(__file__).with_name("rail-sections")


def fit_tracks(section, coords, pieces, height, ways):
    reference = LineString(points(ways[section["referenceRail"]]))
    active = set()
    for key, ties in section["railTies"].items():
        wid = int(key)
        line = LineString(points(ways[wid]))
        nodes = sorted({n for i, j, _, _, w in pieces if w == wid for n in (i, j)})
        if len(nodes) < 2:
            raise ValueError(f"Missing rail alignment on {wid}")
        positions = np.asarray([line.project(Point(coords[n])) for n in nodes])
        ends = [np.argmin(abs(positions - s)) for s in ties]
        if not np.allclose(positions[ends], ties, atol=0.002, rtol=0):
            raise ValueError(f"Missing native rail tie on {wid}")
        selected = (positions >= min(positions[ends])) & (
            positions <= max(positions[ends])
        )
        indices = np.array(nodes)[selected]
        at = np.array([reference.project(Point(coords[n])) for n in indices])
        control = np.array(
            [
                (
                    reference.project(Point(coords[nodes[ends[0]]])),
                    height[nodes[ends[0]]],
                ),
                *section["railControls"],
                (
                    reference.project(Point(coords[nodes[ends[1]]])),
                    height[nodes[ends[1]]],
                ),
            ]
        )
        if np.any(np.diff(control[:, 0]) <= 0):
            raise ValueError(f"Non-increasing reference chainage on {wid}")
        levels = np.interp(at, control[:, 0], control[:, 1])
        order = np.argsort(positions[selected])
        grade = abs(np.diff(levels[order]) / np.diff(positions[selected][order]))
        if np.any(grade > section["maximumGrade"]):
            raise ValueError(f"Rail grade limit exceeded on {wid}: {max(grade):.6f}")
        height[indices] = levels
        active.update((wid, int(n)) for n in indices)
    from station_corridor import parallel_height_audit

    local = [p for p in pieces if (p[4], p[0]) in active and (p[4], p[1]) in active]
    report = parallel_height_audit(local, coords, height, ways, include_structures=True)
    if not report["directedSegmentPairs"]:
        raise ValueError("Section has no paired rail segments")
    if report["over5cm"]:
        raise ValueError(f"Parallel railheads exceed 5 cm: {report}")
    return report


def designs():
    return [json.loads(p.read_text()) for p in sorted(SECTION_DIR.glob("*.json"))]


def road_profiles(section, ways, widths):
    """Clip each road to its design chainage, keeping the native vertices inside."""
    from shapely.ops import substring
    from common import xz2ll
    from station_roads import samples

    result = {}
    for road in section["roads"]:
        wid = road["way"]
        way = ways[wid]
        line = LineString(points(way))
        knots = np.asarray(road["controls"])
        start, stop = knots[[0, -1], 0]
        if not 0 < start < stop < line.length:
            raise ValueError(f"Invalid road profile limits on {wid}")
        stations = np.r_[
            0, np.cumsum(np.linalg.norm(np.diff(line.coords, axis=0), axis=1))
        ]
        if np.any(np.diff(knots[:, 0]) <= 0):
            raise ValueError(f"Non-increasing road chainage on {wid}")
        first, last = np.searchsorted(stations, [start, stop])
        coords = [
            line.interpolate(start).coords[0],
            *line.coords[first:last],
            line.interpolate(stop).coords[0],
        ]
        # Synthetic nodes delimit a partial native chord and do not refer to OSM junctions.
        local = dict(
            way,
            nodes=[road["boundaryNodes"][0], *way["nodes"][first:last], road["boundaryNodes"][1]],
            geometry=[dict(zip(("lat", "lon"), xz2ll(x, z))) for x, z in coords],
            trafficNodes=way["nodes"][first - 1 : last + 1],
            surfaceApproach=True,
            nativeRemainders=[
                substring(line, 0, start),
                substring(line, stop, line.length),
            ],
        )
        if wid in widths:
            local["stationWidth"] = widths[wid]
        profile = samples([(s - start, y) for s, y in knots], transition=1.0)
        if np.max(abs(np.diff(profile[:, 1]) / np.diff(profile[:, 0]))) > 0.05:
            raise ValueError(f"Excessive road grade on {wid}")
        result[wid] = local, LineString(coords), profile
    return result


def motorway_sections(elements):
    """Append only the solved motorway chords to the optional replay network."""
    ways = {way["id"]: way for way in elements if way["type"] == "way"}
    for section in designs():
        for way, _, _ in road_profiles(section, ways, {}).values():
            if way["tags"]["highway"] in ("motorway", "motorway_link"):
                yield way
