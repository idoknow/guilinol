"""Check both Shanghai Road carriageways against rendered pavement below the entire slab."""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from shapely import LineString, Point, Polygon, STRtree, union_all

from check_rail_overbridges import road_faces
from common import load_osm
from features import points
from rail_approaches import ROOT
from station_roads import half_width

UPPER = (259020549, 246520670)
LOWER = (226672185, 259020522, 264940314, 410101928)
DECK_HALF_WIDTH = 3.6


def height_at(corners, xy):
    origin = corners[0]
    delta = corners[1:] - origin
    slope = np.linalg.solve(delta[:, [0, 2]], delta[:, 1])
    return origin[1] + (xy - origin[[0, 2]]) @ slope


def check(world):
    manifest = json.loads((world / "manifest.json").read_bytes())
    ways = {w["id"]: w for w in load_osm() if w["type"] == "way" and w["id"] in UPPER + LOWER}
    lines = {wid: LineString(points(way)) for wid, way in ways.items()}
    rows = []
    for upper in UPPER:
        axis = lines[upper]
        strip = axis.buffer(DECK_HALF_WIDTH, cap_style="flat")
        bounds = [strip.buffer(.05).bounds]
        stdout = subprocess.check_output([ROOT / "node_modules/.bin/tsx", ROOT / "scripts/approach-faces.ts", world],
                                         input=json.dumps(bounds).encode())
        faces = [np.asarray(json.loads(row)[1]) for row in stdout.splitlines()]
        surfaces = [Polygon(c[:, [0, 2]]) for c in faces]
        index = STRtree(surfaces)
        decks = [(poly, corners) for poly, corners in road_faces(world, manifest, strip)
                 if all(axis.distance(Point(x, z)) <= DECK_HALF_WIDTH + .025 for x, _, z in corners)]
        for lower in LOWER:
            line = lines[lower]
            if line.intersection(axis).geom_type != "Point":
                raise ValueError(f"Missing crossing {upper}/{lower}")
            road = line.buffer(half_width(ways[lower]) + 2., cap_style="flat")
            deck = union_all([poly for poly, _ in decks])
            # Two-metre chords facet the outside of the curved OSM alignment.
            if not deck.buffer(.06).covers(strip.intersection(road)):
                raise ValueError(f"Incomplete upper deck at {upper}/{lower}")
            overlaps = []
            minimum = float("inf")
            for poly, slab in decks:
                footprint = poly.intersection(road)
                for i in index.query(footprint, predicate="intersects"):
                    clipped = surfaces[i].intersection(footprint)
                    if clipped.area < 1e-9:
                        continue
                    for part in getattr(clipped, "geoms", (clipped,)):
                        if part.geom_type != "Polygon":
                            continue
                        xy = np.asarray(part.exterior.coords)
                        gap = height_at(slab, xy) - height_at(faces[i], xy)
                        minimum = min(minimum, float(gap.min()))
                        overlaps.append(part)
            pavement = union_all(overlaps)
            if not pavement.buffer(.025).covers(strip.intersection(line)):
                raise ValueError(f"Missing lower road surface at {upper}/{lower}")
            rows.append(dict(upper=upper, lower=lower, minimumM=minimum, targetM=5., areaM2=pavement.area))
    return rows


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("world", type=Path)
    results = check(parser.parse_args().world)
    print(json.dumps(results, indent=2))
    raise SystemExit(int(any(r["minimumM"] < r["targetM"] for r in results)))
