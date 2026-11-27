"""Measure the two Huancheng South Road decks over the full residential carriageway."""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from shapely import LineString, Point, Polygon, union_all

from check_rail_overbridges import road_faces
from check_shanghai_overpasses import height_at
from common import load_osm
from features import points
from rail_approaches import ROOT


def measure(world):
    manifest = json.loads((world / "manifest.json").read_bytes())
    widths = {213171576: 3.85, 1017592858: 3.88}
    lower = 1041976618
    axes = {w["id"]: LineString(points(w)) for w in load_osm()
            if w["type"] == "way" and (w["id"] in widths or w["id"] == lower)}
    road = axes[lower].buffer(3, cap_style="flat")
    results = []
    for way, width in widths.items():
        axis = axes[way]
        crossing = axis.intersection(axes[lower])
        area = road.intersection(crossing.buffer(15))
        required = area.intersection(axis.buffer(width, cap_style="flat"))
        faces = subprocess.check_output([ROOT / "node_modules/.bin/tsx", ROOT / "scripts/approach-faces.ts", world],
                                        input=json.dumps([area.bounds]).encode())
        decks = [(p, c) for p, c in road_faces(world, manifest, area)
                 if all(axis.distance(Point(x, z)) <= width + .025 for x, _, z in c)]
        if not union_all([p for p, _ in decks]).buffer(.06).covers(required):
            raise ValueError(f"Incomplete deck on {way}")
        minimum = float("inf")
        location = None
        supports = []
        for raw in faces.splitlines():
            role, xyz = json.loads(raw)
            surface = np.asarray(xyz)
            polygon = Polygon(surface[:, [0, 2]])
            if polygon.area < 1e-9:
                continue
            for deck, slab in decks:
                overlap = polygon.intersection(deck).intersection(area)
                for part in getattr(overlap, "geoms", [overlap]):
                    if part.area < 1e-9:
                        continue
                    if role in ("graded-floor", "paving-0"):
                        supports.append(part)
                    coords = np.asarray(part.exterior.coords)
                    gaps = height_at(slab, coords) - height_at(surface, coords)
                    i = gaps.argmin()
                    if gaps[i] < minimum:
                        minimum, location = float(gaps[i]), coords[i].tolist()
        footprint = area.intersection(union_all([p for p, _ in decks]))
        if location is None or not union_all(supports).buffer(.012).covers(footprint):
            raise ValueError(f"Missing carriageway under {way}")
        results.append(dict(upper=way, lower=lower, minimumM=minimum, worstXZ=location, targetM=4.5))
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("world", type=Path)
    rows = measure(parser.parse_args().world)
    print(json.dumps(rows, indent=2))
    raise SystemExit(int(any(row["minimumM"] < row["targetM"] for row in rows)))
