"""Measure a section's grades and parallel-track height differences in finished GL04 tiles."""

import argparse
import gzip
import struct
import json
from pathlib import Path

import numpy as np
from shapely import LineString, Point, box
from shapely.ops import substring

from common import load_osm
from features import points
from rail_sections import tail_baseline
from station_corridor import parallel_height_audit


def tile_rails(world, tile):
    raw = gzip.decompress((world / tile["file"]).read_bytes())
    vertices, indices, size = struct.unpack_from("<3I", raw, 4)
    start = 16924 + 9 * vertices + 4 * indices
    collision = json.loads(raw[start : start + size])
    return collision[4] if len(collision) > 4 else []


def check(world, design, ways=None):
    manifest = json.loads((world / "manifest.json").read_text())
    ties = {int(key): sorted(pair) for key, pair in design["railTies"].items()}
    if ways is None:
        ways = load_tracks(ties)
    alignments = {wid: LineString(points(ways[wid])) for wid in ties}
    sections = {wid: substring(line, *ties[wid]) for wid, line in alignments.items()}
    intervals = {wid: [] for wid in ties}
    positions, heights, pieces = [], [], []
    baseline = []
    grades = dict.fromkeys(ties, 0.0)
    for tile in manifest["chunks"]:
        x, z = tile["x"], tile["z"]
        size = manifest["chunkSize"]
        bounds = box(x, z, x + size, z + size)
        local = [wid for wid, line in sections.items() if bounds.distance(line) < 0.001]
        if not local:
            continue
        for ax, az, ay, bx, bz, by, _, flags, *_ in tile_rails(world, tile):
            a = Point(x + ax / 100, z + az / 100)
            b = Point(x + bx / 100, z + bz / 100)
            for wid in local:
                line = sections[wid]
                if max(line.distance(a), line.distance(b)) > 0.001:
                    continue
                lo, hi = sorted((line.project(a), line.project(b)))
                intervals[wid].append((lo, hi))
                start = len(heights)
                pieces.append((start, start + 1, lo, flags, wid))
                positions.extend([a.coords[0], b.coords[0]])
                heights.extend([ay / 100, by / 100])
                if "railProfiles" in design:
                    full = alignments[wid]
                    baseline.extend(tail_baseline(design["railProfiles"][str(wid)],
                                                  np.array([full.project(a), full.project(b)])))
                grades[wid] = max(grades[wid], abs(by - ay) / (100 * a.distance(b)))
    for wid, spans in intervals.items():
        end = 0.0
        for lo, hi in sorted(spans):
            if lo > end + 0.002:
                raise ValueError(f"Missing encoded rail on {wid} after {end:.3f} m")
            end = max(end, hi)
        if abs(end - sections[wid].length) > 0.002:
            raise ValueError(f"Incomplete encoded rail on {wid}")
    parallel = parallel_height_audit(
        pieces, np.asarray(positions), np.asarray(heights), ways, include_structures=True,
        baseline=np.asarray(baseline) if baseline else None,
    )
    return dict(maximumGrade=grades, parallel=parallel)


def load_tracks(ids):
    return {w["id"]: w for w in load_osm() if w["type"] == "way" and w["id"] in ids}


def passes(report, design):
    paired = report["parallel"]
    if "railProfiles" in design:
        return bool(paired["directedSegmentPairs"] and not paired["over5cmWorse"]
                    and all(grade <= design["railProfiles"][str(wid)]["maximumGrade"] + 1e-6
                            for wid, grade in report["maximumGrade"].items()))
    return bool(paired["directedSegmentPairs"] and not paired["over5cm"]
                and max(report["maximumGrade"].values()) <= design["maximumGrade"] + 1e-6)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("world", type=Path)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("design", type=Path, nargs="?")
    inputs.add_argument("--all", action="store_true", help="Include every section and both first-section alignments")
    args = parser.parse_args()
    if args.all:
        from check_station_corridor_vertices import compare
        corridor = compare(args.world)
        if (corridor["referenceSegments"] != 1139 or corridor["changedChunks"] or
                corridor["exteriorTies"] != 13 or corridor["changedExteriorTies"]):
            parser.exit(1, f"Station corridor or section 11 ties differ: {corridor}\n")
        pipeline = Path(__file__).resolve().parent
        first_section = pipeline / "rail-audits"
        paths = [
            first_section / "01-upper.json",
            first_section / "01-hengliu.json",
            *sorted((pipeline / "rail-sections").glob("*.json")),
        ]
        designs = {path.stem: json.loads(path.read_text()) for path in paths}
        # A station yard survey includes unchanged tracks between the fitted alignments.
        # Baking checks the construction profiles; report the full specified domain here.
        for name in designs:
            survey = first_section / (name + ".json")
            if survey.is_file():
                designs[name] = json.loads(survey.read_text())
        ways = load_tracks({int(wid) for design in designs.values() for wid in design["railTies"]})
        reports = {}
        for name, design in designs.items():
            report = check(args.world, design, ways)
            reports[name] = dict(**report, passed=passes(report, design))
        print(json.dumps(reports, indent=2))
        raise SystemExit(0 if reports and all(row["passed"] for row in reports.values()) else 1)

    design = json.loads(args.design.read_text())
    report = check(args.world, design)
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if passes(report, design) else 1)
