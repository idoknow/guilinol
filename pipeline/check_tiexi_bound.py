"""Reproduce the section 12 rail-only clearance bound on the section 11 world."""
import argparse
import json
from pathlib import Path

from shapely import LineString, Point

from check_rail_stack import elevation, track_pieces
from common import load_osm
from features import points
from rail_approaches import measure
from station_corridor import grade_limit, station_pad

WITNESSES = Path(__file__).resolve().parents[1] / "docs/review/section12/tiexi-paths.json"


def anchor_bound(world, manifest, ways, pad, witness):
    anchor = Point(witness["anchor"])
    if not pad.covers(anchor):
        raise ValueError("Witness anchor is outside the protected station")
    height = witness["railM"]
    end = anchor
    joined_height = height
    for wid, x, z in witness["steps"]:
        start = Point(x, z)
        chord = LineString([start, end])
        way = ways[wid]
        pieces = track_pieces(world, manifest, LineString(points(way)), chord.buffer(.001))
        matches = [p for p in pieces if p[0].hausdorff_distance(chord) < .0001]
        if len(matches) != 1:
            raise ValueError(f"Missing or ambiguous encoded chord on {way['id']}")
        if abs(elevation(matches[0], end) - joined_height) > .0001:
            raise ValueError("Witness path is not joined at the reference height")
        joined_height = elevation(matches[0], start)
        height += matches[0][0].length * grade_limit(way["tags"])
        end = start
    return end, height


def report(world):
    manifest = json.loads((world / "manifest.json").read_bytes())
    ways = {w["id"]: w for w in load_osm() if w["type"] == "way"}
    paths = json.loads(WITNESSES.read_bytes())
    ties = {str(row["rail"]): [0, LineString(points(ways[row["rail"]])).length] for row in paths}
    sections = {"12": {"railTies": ties}}
    floors = {r["upper"]: r for r in measure(world, sections)}
    carriageway = {r["upper"]: r for r in measure(world, sections, surface_roles={"graded-floor"})}
    pad = station_pad(ways)
    results = []
    for row in paths:
        endpoints = [anchor_bound(world, manifest, ways, pad, path) for path in row["paths"]]
        (a, ha), (b, hb) = endpoints
        segment = LineString([a, b])
        rail = LineString(points(ways[row["rail"]]))
        if not any(piece[0].hausdorff_distance(segment) < .0001
                   for piece in track_pieces(world, manifest, rail, segment.buffer(.001))):
            raise ValueError("The two paths do not terminate at one encoded bridge chord")
        for surface, floor in (("fullWidth", floors[row["rail"]]), ("carriageway", carriageway[row["rail"]])):
            worst = floor["worst"]
            p = Point(worst["x"], worst["z"])
            if not segment.buffer(2.051, cap_style="flat").covers(p):
                raise ValueError("Worst road point is outside the witness span")
            t = segment.project(p, normalized=True)
            clearance = ha * (1 - t) + hb * t - worst["y"]
            results.append(dict(**floor, surface=surface, maximumRailToFloorM=clearance,
                                shortfallM=max(0., floor["targetM"] - clearance)))
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("world", type=Path)
    print(json.dumps(report(parser.parse_args().world), indent=2))
