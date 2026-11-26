"""Compare rendered station pavement with the section 12 opening main package."""
import argparse
from collections import Counter
import json
from pathlib import Path
import subprocess
import tempfile

import shapely
from shapely import STRtree

from check_station_road_scope import TIEXI
from common import load_osm
from features import area
from station_corridor import PLATFORMS
from station_roads import half_width, road_design
from station_site import footprints

ROOT = Path(__file__).resolve().parents[1]


def compare(reference, candidate, reference_source=None, renderer_source=None):
    worlds = [reference.resolve(), candidate.resolve()]
    manifests = [json.loads((w / "manifest.json").read_bytes()) for w in worlds]
    halls = [next(l for l in m["landmarks"] if l["id"] == "guilin_station") for m in manifests]
    hall_changed = halls[0] != halls[1]
    # The station GLB ships with the client, separately from the world archive.
    asset = Path("public") / halls[0]["file"]
    hall_changed |= subprocess.check_output(
        ["git", "show", f"f11a9657:{asset.as_posix()}"], cwd=ROOT
    ) != (ROOT / asset).read_bytes()
    widths = {s["way"]: s["pairedWidth"] for s in manifests[0]["tunnels"] if s.get("pairedWidth")}
    areas = footprints()
    ways = {w["id"]: w for w in load_osm() if w["type"] == "way"}
    areas.update({str(k): area(ways[k]) for k in PLATFORMS})
    areas.update({str(k): line.buffer(half_width(way) + 2, cap_style="flat")
                  for k, (way, line, _) in road_design(widths).items() if k not in TIEXI})
    command = [ROOT / "node_modules/.bin/tsx", ROOT / "scripts/station-paving-vertices.ts", *worlds]
    with tempfile.TemporaryDirectory() as temp:
        size = manifests[0]["chunkSize"]
        tiles = [t["file"] for t in manifests[0]["chunks"]
                 if any(mask.intersects(shapely.box(t["x"], t["z"], t["x"] + size, t["z"] + size))
                        for mask in areas.values())]
        scope = Path(temp) / "station-tiles.json"
        scope.write_text(json.dumps(tiles))
        first = reference_source or renderer_source
        command.extend([first.resolve() if first else "", scope,
                        renderer_source.resolve() if renderer_source else ""])
        result = json.loads(subprocess.check_output(command, cwd=ROOT))
    # A separately rendered elevated slab can cross a fixed road in plan.
    # Its own bridge/approach audit checks it. Native unowned pavement is
    # always compared, including vertices shared by two roads.
    design = json.loads((ROOT / "pipeline/rail-sections/12-guilin-station.json").read_bytes())
    new_slabs = {r["way"] for r in design["roads"]} | TIEXI
    rows = [r for r in result["vertices"] if not (r[1] == "graded-floor" and r[2] in new_slabs)]
    differences = {}
    if rows:
        tree = STRtree(shapely.points([r[3] for r in rows], [r[5] for r in rows]))
        for name, polygon in areas.items():
            hits = tree.query(polygon, predicate="intersects")
            if len(hits):
                differences[name] = {"vertices": len(hits),
                                     "bySurface": dict(Counter(rows[int(i)][1] for i in hits)),
                                     "example": rows[int(hits[0])]}
    return {"stationHallChanged": hall_changed, "buildingMeshChanges": result["buildingChanges"],
            "fixedFootprints": len(areas), "pavementChanges": differences}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--reference-source", type=Path, help="Checkout with the renderer that shipped the reference world")
    parser.add_argument("--renderer-source", type=Path, help="Use this renderer checkout for both packages")
    args = parser.parse_args()
    report = compare(args.reference, args.candidate, args.reference_source, args.renderer_source)
    print(json.dumps(report, indent=2))
    raise SystemExit(bool(report["stationHallChanged"] or report["buildingMeshChanges"] or report["pavementChanges"]))
