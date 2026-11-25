"""Measure a stacked railway and road crossing from the finished GL04 and tunnel floors."""

import argparse
import json
from pathlib import Path

from shapely import LineString, Point, box, union_all

from check_rail_section_tracks import tile_rails
from common import load_osm
from features import points
from railways import BRIDGE, ELECTRIC


def track_pieces(world, manifest, line, footprint):
    """Read each encoded linear piece whose deck could cover the crossing."""
    result = []
    for tile in manifest["chunks"]:
        x, z, size = tile["x"], tile["z"], manifest["chunkSize"]
        if not box(x, z, x + size, z + size).intersects(footprint):
            continue
        for ax, az, ay, bx, bz, by, _, flags, *_ in tile_rails(world, tile):
            segment = LineString([(x + ax / 100, z + az / 100), (x + bx / 100, z + bz / 100)])
            if not segment.intersects(footprint):
                continue
            if all(line.distance(Point(p)) < 0.001 for p in segment.coords):
                result.append((segment, ay / 100, by / 100, flags))
    return result


def elevation(piece, p):
    segment, start, end, _ = piece
    return start + (end - start) * segment.project(p, normalized=True)


def separation(upper, lower, upper_width, lower_width, depth, expected):
    """On each clipped face the vertical difference is affine, with extrema at its corners."""
    minimum = float("inf")
    covered = []
    for top in upper:
        slab = top[0].buffer(upper_width, cap_style="flat")
        for bottom in lower:
            floor = bottom[0].buffer(lower_width, cap_style="flat") if lower_width else bottom[0]
            overlap = slab.intersection(floor)
            if overlap.is_empty:
                continue
            corners = overlap.exterior.coords if overlap.geom_type == "Polygon" else overlap.coords
            for c in corners:
                p = Point(c)
                minimum = min(minimum, elevation(top, p) - depth - elevation(bottom, p))
            covered.append(overlap)
    if not covered or not union_all(covered).buffer(0.002).covers(expected):
        raise ValueError(f"Incomplete deck or floor at {expected.centroid.wkt}")
    return minimum


def tunnel_floor(manifest, way, crossing):
    bores = [t for t in manifest["tunnels"] if t["way"] == way and not t.get("openCut")]
    for bore in bores:
        center = LineString([(x, z) for x, _, z in bore["portals"]])
        if center.distance(crossing) > 0.002:
            continue
        segments = []
        for (s, y), (t, h) in zip(bore["stations"], bore["stations"][1:]):
            if t > s:
                segments.append((LineString([center.interpolate(s), center.interpolate(t)]), y, h, 0))
        return segments, bore["halfWidth"]
    raise ValueError(f"No finished tunnel floor for {way} at {crossing.wkt}")


def check(world, design):
    manifest = json.loads((world / "manifest.json").read_bytes())
    upper = design["upperRail"]
    rails = [upper, *design["groundRails"]]
    roads = design["roadTunnels"]
    ids = set(rails + roads)
    lines = {w["id"]: LineString(points(w)) for w in load_osm() if w["type"] == "way" and w["id"] in ids}
    width, depth = design["deckHalfWidth"], design["deckDepth"]
    result = []
    for top, bottom in [(upper, r) for r in rails[1:]] + [(r, w) for r in rails for w in roads]:
        crossing = lines[top].intersection(lines[bottom])
        if crossing.geom_type != "Point":
            raise ValueError(f"Expected one crossing for {top} and {bottom}")
        if bottom in roads:
            floor, floor_width = tunnel_floor(manifest, bottom, crossing)
            target = design["roadClearance"]
        else:
            floor_width = 0
            target = design["railClearance"]
        upper_strip = lines[top].buffer(width, cap_style="flat")
        lower_strip = lines[bottom].buffer(floor_width, cap_style="flat") if floor_width else lines[bottom]
        # The centrelines can be outside their common deck footprint at its corners.
        expected = upper_strip.intersection(lower_strip)
        area = expected.buffer(width + floor_width + 0.01)
        ceiling = track_pieces(world, manifest, lines[top], area)
        deduction = depth
        if top == upper:
            ceiling = [piece for piece in ceiling if piece[3] & BRIDGE]
        else:
            # The lower railway is at grade above the tunnel roof.
            deduction = 0
            target = design["groundRailToRoad"]
        if bottom not in roads:
            floor = track_pieces(world, manifest, lines[bottom], area)
            if not floor or not all(piece[3] & ELECTRIC for piece in floor):
                raise ValueError(f"Expected an electrified lower track on {bottom}")
        measured = separation(ceiling, floor, width, floor_width, deduction, expected)
        row = dict(upper=top, lower=bottom, minimumM=measured, targetM=target)
        if bottom not in roads:
            row["wireMarginM"] = measured - design["wireHeight"]
        result.append(row)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("world", type=Path)
    parser.add_argument("design", type=Path, nargs="?")
    parser.add_argument("--approaches", action="store_true", help="Check rendered carriageways, shoulders and curbs for all sections")
    parser.add_argument("--through", type=int, metavar="N", help="Last numbered section for the cumulative approaches check")
    args = parser.parse_args()
    if not args.design and not args.approaches:
        parser.error("Specify a stack design or --approaches")
    if args.through is not None and (not args.approaches or args.through < 1):
        parser.error("--through requires --approaches and a positive section number")
    rows = check(args.world, json.loads(args.design.read_bytes())) if args.design else []
    if args.approaches:
        from rail_approaches import measure
        pipeline = Path(__file__).resolve().parent
        paths = sorted((pipeline / "rail-audits").glob("01-*.json")) + sorted((pipeline / "rail-sections").glob("*.json"))
        sections = {p.stem: json.loads(p.read_bytes()) for p in paths
                    if args.through is None or int(p.stem.split("-")[0]) <= args.through}
        rows.extend(measure(args.world, sections))
    print(json.dumps(rows, indent=2))
    raise SystemExit(0 if all(r["minimumM"] + 1e-6 >= r["targetM"] for r in rows) else 1)
