"""Compare finished tracks across mapped island platforms, independent of track spacing.

Run with BASE WORLD. Edge steps use the same coordinate and rail on both builds.
The lower bounds use the triangle inequality and remain valid for any rail solve.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from shapely import LineString, Point, Polygon, STRtree, box, polygons, union_all

from check_rail_platforms import pavement, pavement_triangles, rail_chords
from common import load_osm
from features import area
from island_transects import transects


def rail_head_clearance(world, polygon, material, envelope):
    # The baked sidewalk rings are quantized to centimetres. Include their
    # rounded perimeter when identifying paving on the mapped platform.
    outline = polygon.buffer(.008, join_style="mitre")
    chords = rail_chords(world, outline.buffer(envelope), include_structures=True)
    bands = [LineString([key[:2], key[2:]]).buffer(envelope, cap_style="flat")
             for key in chords]
    zone = outline.intersection(union_all(bands))
    if zone.is_empty or zone.area == 0:
        return dict(overlapM2=0., conflicts=[])
    triangles = pavement_triangles(world, [zone.bounds], material)
    footprints = polygons(triangles[:, :, [0, 2]])
    indices = STRtree(footprints).query(zone, predicate="intersects")
    overlap = union_all(footprints[indices]).intersection(zone)
    conflicts = []
    for key, band in zip(chords, bands):
        patch = band.intersection(overlap)
        if patch.area > 1e-8:
            conflicts.append(dict(chordXZ=key, overlapM2=patch.area))
    return dict(overlapM2=overlap.area, conflicts=conflicts)


def inspect(base, world, polygon, material, boarding_step=None):
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
        if boarding_step is not None:
            ends = covered[[0, -1]]
        if np.any(ends):
            target = ref[[0, -1]] - native if boarding_step is None else np.full(2, boarding_step)
            error = np.max(abs(now[[0, -1]][ends] - rail[ends] - target[ends]))
            record('edgeError', error)
            counts['edgeError'] += int(error > .020001)
        if np.all(np.isfinite(ref[[0,-1]])):
            floor_pairs += 1
            if boarding_step is not None or not np.all(np.isfinite(ref)):
                continue
            steps = ref[[0,-1]] - native
            mismatch = abs(steps[1]-steps[0])
            record('minimumGradeAt5cm', max(0, mismatch-.05-.04)/width)
            record('minimumRailGapAt2Percent', max(0, mismatch-.02*width-.04))
    if not floor_pairs:
        counts['missingFloor'] += 1
    return dict(**result, status='island', material=material, targetStepM=boarding_step, nativeDoubleEdges=floor_pairs, violations=counts, worst=worst)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base', type=Path)
    parser.add_argument('world', type=Path)
    args = parser.parse_args()
    manifest = json.loads((args.base / 'manifest.json').read_bytes())
    outlines = json.loads((args.world / "manifest.json").read_bytes()).get("platformOutlines", {})
    size = manifest['chunkSize']
    domain = union_all([box(t['x'], t['z'], t['x']+size, t['z']+size) for t in manifest['chunks']])
    style = json.loads(Path(__file__).with_name("railway-style.json").read_bytes())
    envelope = style["gauge"]/2 + style["headWidth"] + .10
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
            # Measured on both finished Guilin corridor islands (376029419/420).
            passenger_islands = {375922212, 375922214, 375922215, 375922217, 375922218,
                                  375922219, 375922220, 376029419, 376029420}
            step = 1.2500030517578125 if way['id'] in passenger_islands else None
            ring = outlines.get(str(way["id"]))
            finished_outline = Polygon(ring) if ring else polygon
            result = inspect(args.base.resolve(), args.world.resolve(), finished_outline, material, step)
            clearance = rail_head_clearance(args.world.resolve(), polygon.union(finished_outline), material, envelope)
            result["railHeadClearance"] = clearance
            result.setdefault("violations", {})["railHeadEnvelope"] = len(clearance["conflicts"])
        report[way['id']] = result
    print(json.dumps(report, indent=2, allow_nan=False))
    raise SystemExit(any(any(row.get('violations', {}).values()) for row in report.values()))
