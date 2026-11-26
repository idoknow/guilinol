"""Compare finished tracks across mapped island platforms, independent of track spacing.

Run with BASE WORLD. Edge steps use the same coordinate and rail on both builds.
The lower bounds use the triangle inequality and remain valid for any rail solve.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from shapely import LineString, Point, STRtree, box, union_all

from check_rail_platforms import pavement, rail_chords
from common import load_osm
from features import area


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


def inspect(base, world, polygon, material):
    region = polygon.buffer(16)
    old = rail_chords(base, region)
    new = old if base == world else rail_chords(world, region)
    if old.keys() != new.keys():
        raise ValueError('Rail alignments changed between builds')
    keys = list(old)
    axes = [LineString([k[:2], k[2:]]) for k in keys]
    rows = list(transects(polygon, axes))
    sections = [r for r in rows if r is not None]
    result = dict(transects=len(rows), paired=len(sections))
    if not sections:
        return dict(**result, status='no opposing boarding tracks')
    xy = np.concatenate([p for p, _, _ in sections])
    bounds = [polygon.bounds]
    floors = pavement(base, bounds, xy, material)
    finished = floors if base == world else pavement(world, bounds, xy, material)
    offset = 0
    worst = {}
    counts = dict(railGap=0, surfaceGrade=0, edgeError=0, missingFloor=0)
    floor_pairs = 0
    for probes, left, right in sections:
        n = len(probes)
        ref = floors[offset:offset+n]
        now = finished[offset:offset+n]
        offset += n
        def rail_levels(chords):
            return np.array([np.dot([1-t, t], chords[keys[i]]) for i, t in (left, right)])
        native, rail = rail_levels(old), rail_levels(new)
        width = np.linalg.norm(probes[-1] - probes[0])
        def record(name, value):
            if name not in worst or value > worst[name]['value']:
                worst[name] = dict(value=float(value), xz=probes[[0,-1]].tolist(),
                                   widthM=width, baseRailM=native.tolist(), railM=rail.tolist(),
                                   baseEdgeM=[float(x) if np.isfinite(x) else None for x in ref[[0,-1]]])
        gap = abs(rail[1]-rail[0])
        record('railGap', gap)
        counts['railGap'] += int(gap > .050001)
        covered = np.isfinite(now)
        counts['missingFloor'] += int(np.any(np.isfinite(ref) & ~covered))
        both = covered & np.isfinite(ref)
        grades = np.flatnonzero(covered[1:] & covered[:-1])
        if len(grades):
            peak = np.max(abs(now[grades+1]-now[grades]))/(width/(n-1))
            record('surfaceGrade', peak)
            counts['surfaceGrade'] += int(peak > .020001)
        ends = both[[0,-1]]
        if np.any(ends):
            error = np.max(abs(now[[0,-1]][ends]-ref[[0,-1]][ends]-(rail-native)[ends]))
            record('edgeError', error)
            counts['edgeError'] += int(error > .020001)
        if np.all(np.isfinite(ref[[0,-1]])):
            floor_pairs += 1
            if not np.all(np.isfinite(ref)):
                continue
            steps = ref[[0,-1]] - native
            mismatch = abs(steps[1]-steps[0])
            record('minimumGradeAt5cm', max(0, mismatch-.05-.04)/width)
            record('minimumRailGapAt2Percent', max(0, mismatch-.02*width-.04))
    if not floor_pairs:
        counts['missingFloor'] += 1
    return dict(**result, status='island', material=material, nativeDoubleEdges=floor_pairs, violations=counts, worst=worst)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base', type=Path)
    parser.add_argument('world', type=Path)
    args = parser.parse_args()
    manifest = json.loads((args.base / 'manifest.json').read_bytes())
    size = manifest['chunkSize']
    domain = union_all([box(t['x'], t['z'], t['x']+size, t['z']+size) for t in manifest['chunks']])
    report = {}
    for way in load_osm():
        tags = way.get('tags', {})
        if tags.get('railway') != 'platform' or way['type'] != 'way':
            continue
        polygon = area(way)
        if tags.get('monorail') == 'yes':
            result = dict(status='monorail, outside GL04 railway inventory')
        elif not domain.intersects(polygon):
            result = dict(status='outside built world')
        else:
            # Guilin station has dedicated passenger slabs. Generic sidewalks
            # beneath them also appear in plan and are several metres lower.
            material = 'paving-9' if way['id'] in range(376029417, 376029421) else 'paving-1'
            result = inspect(args.base.resolve(), args.world.resolve(), polygon, material)
        report[way['id']] = result
    print(json.dumps(report, indent=2, allow_nan=False))
    raise SystemExit(any(any(row.get('violations', {}).values()) for row in report.values()))
