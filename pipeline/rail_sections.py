"""Set paired rail profiles in the chainage of one reference alignment."""

import json
from pathlib import Path

import numpy as np
from shapely import LineString, Point

from features import points

SECTION_DIR = Path(__file__).with_name("rail-sections")


def tail_baseline(profile, stations):
    """Unchanged railhead datum for the approved taper; NaN elsewhere."""
    control = np.asarray(profile.get("nativeTail", []))
    result = np.full(len(stations), np.nan)
    if control.size:
        inside = (stations >= control[0, 0] - .001) & (stations <= control[-1, 0] + .001)
        result[inside] = np.interp(stations[inside], control[:, 0], control[:, 1])
    return result


def split_profile_tiles(section, coords, pieces, height, ways):
    """Expose native GL04 tile-edge vertices before applying a piecewise grade."""
    from common import CHUNK

    axes = {int(w): LineString(points(ways[int(w)])) for w in section["railTies"]}
    positions, levels, result = list(coords), list(height), []
    for i, j, station, flags, way in pieces:
        a, b = coords[i], coords[j]
        limits = section["railTies"].get(str(way))
        length = np.linalg.norm(b-a)
        if not limits or not limits[0] <= axes[way].project(Point((a+b)/2)) <= limits[1]:
            result.append((i,j,station,flags,way))
            continue
        cuts = set()
        for axis in range(2):
            lo, hi = sorted((a[axis], b[axis]))
            for edge in range(int(np.floor(lo/CHUNK))+1, int(np.ceil(hi/CHUNK))):
                cuts.add((edge*CHUNK-a[axis])/(b[axis]-a[axis]))
        first, start = i, 0.
        for t in sorted(cuts):
            if min(t-start, 1-t)*length < .005:
                continue
            node = len(positions)
            positions.append(a+t*(b-a))
            levels.append(height[i]+t*(height[j]-height[i]))
            result.append((first,node,station+start*length,flags,way))
            first, start = node, t
        result.append((first,j,station+start*length,flags,way))
    return np.asarray(positions), result, np.asarray(levels)


def fit_joint_tracks(section, coords, pieces, height, ways):
    from station_corridor import parallel_height_audit

    native = height.copy()
    baseline = np.full(len(height), np.nan)
    active = set()
    assigned = {}
    for key, profile in section["railProfiles"].items():
        wid = int(key)
        line = LineString(points(ways[wid]))
        nodes = sorted({n for i, j, _, _, w in pieces if w == wid for n in (i, j)})
        stations = np.asarray([line.project(Point(coords[n])) for n in nodes])
        start, end = section["railTies"][key]
        if any(not np.any(abs(stations - tie) < .002) for tie in (start, end)):
            raise ValueError(f"Missing native rail tie on {wid}")
        inside = (stations >= start - .001) & (stations <= end + .001)
        nodes = np.asarray(nodes)[inside]
        stations = stations[inside]
        control = np.asarray(profile["offsets"])
        levels = native[nodes] + np.interp(stations, control[:, 0], control[:, 1])
        order = np.argsort(stations)
        if np.any(abs(np.diff(levels[order])) > profile["maximumGrade"] * np.diff(stations[order]) + 1e-6):
            raise ValueError(f"Rail grade limit exceeded on {wid}")
        for n, y in zip(nodes, levels):
            if n in assigned and abs(assigned[n] - y) > 1e-5:
                raise ValueError(f"Inconsistent rail junction on {wid}")
            assigned[n] = y
            active.add((wid, n))
        height[nodes] = levels
        tail = np.isfinite(tail_baseline(profile, stations))
        baseline[nodes[tail]] = native[nodes[tail]]

    local = [p for p in pieces if (p[4], p[0]) in active and (p[4], p[1]) in active]
    report = parallel_height_audit(local, coords, height, ways, include_structures=True, baseline=baseline)
    if not report["directedSegmentPairs"] or report["over5cmWorse"]:
        raise ValueError(f"Joint rail profile exceeds parallel-track limits: {report}")
    return report


def fit_tracks(section, coords, pieces, height, ways):
    if "railProfiles" in section:
        return fit_joint_tracks(section, coords, pieces, height, ways)
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
    return [dict(json.loads(p.read_text()), name=p.stem) for p in sorted(SECTION_DIR.glob("*.json"))]


def rounded_profile(knots, start, preserve=(), lower_only=False):
    """Round interior changes of grade with tangent parabolas; sample at most 2 m apart."""
    stations, levels = knots.T
    slopes = np.diff(levels) / np.diff(stations)
    radii = np.minimum(.35, .4 * np.minimum(np.diff(stations)[:-1], np.diff(stations)[1:]))
    centers = stations[1:-1]
    offsets = np.unique(np.r_[stations, centers - radii, centers + radii,
                              np.linspace(stations[0], stations[-1],
                                          int(np.ceil((stations[-1] - start) / 2)) + 1)])
    y = np.interp(offsets, stations, levels)
    for i, (center, radius) in enumerate(zip(centers, radii)):
        if any(abs(center - position) < .0001 for position in preserve):
            continue
        local = abs(offsets - center) < radius
        dx = offsets[local] - center + radius
        y[local] = (levels[i + 1] - slopes[i] * radius + slopes[i] * dx
                    + (slopes[i + 1] - slopes[i]) * dx**2 / (4 * radius))
    if lower_only:
        y = np.minimum(y, np.interp(offsets, stations, levels))
    return np.column_stack((offsets - start, y))


def road_phases(sections):
    """Keep disjoint profiles on the same OSM way in separate mesh passes."""
    for section in sections:
        yield dict(section, roads=[r for r in section["roads"] if not r.get("withFirstSection")])
        for group in section.get("additionalRoadGroups", []):
            yield dict(section, roads=group)


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
        if abs(stop - line.length) < 1e-5:
            stop = line.length
        if not 0 <= start < stop <= line.length:
            raise ValueError(f"Invalid road profile limits on {wid}")
        stations = np.r_[
            0, np.cumsum(np.linalg.norm(np.diff(line.coords, axis=0), axis=1))
        ]
        if np.any(np.diff(knots[:, 0]) <= 0):
            raise ValueError(f"Non-increasing road chainage on {wid}")
        first = np.searchsorted(stations, start + 1e-5)
        last = np.searchsorted(stations, stop - 1e-5)
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
            surfaceApproach=way["tags"].get("tunnel") != "yes",
            nativeRemainders=[
                substring(line, a, b) for a, b in ((0, start), (stop, line.length)) if b - a > .001
            ],
        )
        if "maxTrafficOffset" in road:
            local["maxTrafficOffset"] = road["maxTrafficOffset"]
        if road.get("stackedRoad"):
            local["stackedRoad"] = True
        if "width" in road:
            local["profileWidth"] = road["width"]
        if wid in widths:
            local["stationWidth"] = widths[wid]
        if "railProfiles" in section:
            local["gradeShoulders"] = True
            exact = section.get("retainRoadNodeLevels", False)
            local["flatNativeTie"] = exact
            profile = rounded_profile(knots, start, stations if exact else (), lower_only=exact)
        else:
            profile = samples([(s - start, y) for s, y in knots], transition=1.0)
        if np.max(abs(np.diff(profile[:, 1]) / np.diff(profile[:, 0]))) > road.get("maximumGrade", .05) + 1e-6:
            raise ValueError(f"Excessive road grade on {wid}")
        result[wid] = local, LineString(coords), profile
    return result


def adjust_prior_roads(name, profiles, sections):
    """Apply local downward corrections to an earlier road profile before mesh generation."""
    for section in sections:
        for wid in section.get("priorShoulders", {}).get(name, []):
            way, line, profile = profiles[wid]
            profiles[wid] = dict(way, fitShoulderPlanes=True), line, profile
        for key, control in section.get("priorRoadAdjustments", {}).get(name, {}).items():
            wid = int(key)
            way, line, profile = profiles[wid]
            stations, offsets = np.asarray(control).T
            if max(offsets) > 0 or np.any(np.diff(stations) <= 0):
                raise ValueError(f"Invalid clearance adjustment for road {wid}")
            at = profile[:, 0]
            delta = np.full(len(at), offsets[0])
            for a, b, first, last in zip(stations, stations[1:], offsets, offsets[1:]):
                t = np.clip((at - a) / (b - a), 0, 1)
                delta += (last - first) * t**2 * (3 - 2*t)
            updated = profile.copy()
            updated[:, 1] += delta
            cap = .08 if way["tags"]["highway"] in ("service", "residential") else .05
            if np.any(abs(np.diff(updated[:, 1])) > cap * np.diff(at) + 1e-6):
                raise ValueError(f"Clearance correction exceeds the road grade on {wid}")
            if way["tags"].get("tunnel") == "yes":
                way = dict(way, gradeShoulders=True)
            profiles[wid] = way, line, updated

        for key, segment in section.get("priorRoadProfiles", {}).get(name, {}).items():
            wid = int(key)
            way, line, native = profiles[wid]
            if segment["startNode"] != way["nodes"][0]:
                raise ValueError(f"Road profile origin changed on {wid}")
            knots = np.asarray(segment["controls"])
            start, end = knots[[0, -1], 0]
            if start < -.00001 or end > line.length + .00001 or np.any(np.diff(knots[:, 0]) <= 0):
                raise ValueError(f"Invalid replacement chainage on {wid}")
            replacement = rounded_profile(knots, start)
            replacement[:, 0] += start
            before = native[native[:, 0] < start - .00001]
            after = native[native[:, 0] > end + .00001]
            profile = np.vstack((before, replacement, after))
            if np.any(profile[:, 1] > np.interp(profile[:, 0], *native.T) + .001):
                raise ValueError(f"Road correction raises {wid}")
            if np.any(abs(np.diff(profile[:, 1])) > .05 * np.diff(profile[:, 0]) + 1.e-7):
                raise ValueError(f"Road correction exceeds 5% on {wid}")
            profiles[wid] = dict(way, fitShoulderPlanes=True), line, profile


def motorway_sections(elements):
    """Append only the solved motorway chords to the optional replay network."""
    ways = {way["id"]: way for way in elements if way["type"] == "way"}
    for section in road_phases(designs()):
        for way, _, _ in road_profiles(section, ways, {}).values():
            if way["tags"]["highway"] in ("motorway", "motorway_link"):
                yield way
